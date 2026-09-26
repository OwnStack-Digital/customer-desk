import { describe, expect, it } from "vitest";
import type { KnowledgeBase } from "../../domain/config";
import type { DraftRevision } from "../../domain/drafting";
import { ConflictError, StaleRevisionError } from "../../domain/errors";
import { ProcessInboundMessage } from "../ingress/process-inbound-message";
import {
  classificationOf,
  email,
  FixedClock,
  harness,
  ORG,
  SequentialIds,
} from "../testing";

/**
 * Slice 5 acceptance (PLAN.md tasks 5.2–5.4): the draft state machine
 * (edit invalidates approval, approve binds one revision, discard is
 * terminal), take-over, send idempotency, and the processing draft-
 * replacement policy. All ports are fakes; no database, no network.
 */

/** Carried note 14: audit actors are operator emails, never "operator". */
const OPERATOR_EMAIL = "owner@harbourandpine.example";

function faqClassification(factIds: string[] = ["kb_hours"]) {
  return {
    ...classificationOf("faq"),
    faqFactIds: factIds,
    summary: "Question about our service details",
  };
}

/** Ingests an FAQ email into the harness and returns the live draft. */
async function receiveFaq(
  h: ReturnType<typeof harness>,
  overrides: Parameters<typeof email>[0] = {},
  factIds: string[] = ["kb_hours"],
) {
  h.classifier.script(faqClassification(factIds));
  return h.receive.run(
    email({
      subject: "Your hours",
      text: "What are your hours?",
      ...overrides,
    }),
  );
}

describe("ReviewDraft (task 5.2)", () => {
  it("edit creates a new proposed revision and supersedes the old one", async () => {
    const h = harness();
    const received = await receiveFaq(h);
    const original = h.drafts.rows[0] as DraftRevision;

    const reviewed = await h.reviewDraft.run(
      ORG,
      received.conversationId,
      original.id,
      { action: "edit", bodyText: "Hi,\n\nWe clean Mon to Fri.\n\nThanks," },
      OPERATOR_EMAIL,
    );
    expect(reviewed).toMatchObject({
      status: "proposed",
      bodyText: "Hi,\n\nWe clean Mon to Fri.\n\nThanks,",
    });
    expect(await h.drafts.findById(ORG, original.id)).toMatchObject({
      status: "superseded",
    });
    expect(
      await h.drafts.findById(ORG, reviewed?.revisionId ?? ""),
    ).toMatchObject({
      status: "proposed",
      origin: "operator",
      conversationId: received.conversationId,
      factIds: [],
      knowledgeBaseVersion: null,
    });
    // Carried note 14: the audit event names the operator email.
    expect(h.audit.rows).toEqual([
      expect.objectContaining({
        action: "draft.edited",
        actor: OPERATOR_EMAIL,
      }),
    ]);
  });

  it("edit invalidates approval: edited approved draft → old superseded, new one unapproved", async () => {
    const h = harness();
    const received = await receiveFaq(h);
    const original = h.drafts.rows[0] as DraftRevision;
    await h.reviewDraft.run(
      ORG,
      received.conversationId,
      original.id,
      {
        action: "approve",
      },
      "operator",
    );
    expect(await h.drafts.findById(ORG, original.id)).toMatchObject({
      status: "approved",
    });

    const reviewed = await h.reviewDraft.run(
      ORG,
      received.conversationId,
      original.id,
      { action: "edit", bodyText: "Manually worded reply." },
      "operator",
    );
    expect(reviewed).toMatchObject({ status: "proposed" });
    expect(await h.drafts.findById(ORG, original.id)).toMatchObject({
      status: "superseded",
    });
    expect(
      await h.drafts.findById(ORG, reviewed?.revisionId ?? ""),
    ).toMatchObject({
      status: "proposed",
    });
  });

  it("approve binds exactly that revision", async () => {
    const h = harness();
    const received = await receiveFaq(h);
    const original = h.drafts.rows[0] as DraftRevision;
    const reviewed = await h.reviewDraft.run(
      ORG,
      received.conversationId,
      original.id,
      { action: "approve" },
      "operator",
    );
    expect(reviewed).toEqual({
      revisionId: original.id,
      status: "approved",
      bodyText: original.bodyText,
    });
    expect(h.audit.rows.map((row) => row.action)).toEqual(["draft.approved"]);
  });

  it("editing or approving a stale revision is 409 stale_revision", async () => {
    const h = harness();
    const received = await receiveFaq(h);
    const original = h.drafts.rows[0] as DraftRevision;
    const edited = await h.reviewDraft.run(
      ORG,
      received.conversationId,
      original.id,
      { action: "edit", bodyText: "New text." },
      "operator",
    );

    // The old revision is superseded: both edit and approve are 409.
    await expect(
      h.reviewDraft.run(
        ORG,
        received.conversationId,
        original.id,
        { action: "approve" },
        "operator",
      ),
    ).rejects.toBeInstanceOf(StaleRevisionError);
    await expect(
      h.reviewDraft.run(
        ORG,
        received.conversationId,
        original.id,
        { action: "edit", bodyText: "Too late." },
        "operator",
      ),
    ).rejects.toBeInstanceOf(StaleRevisionError);

    // A discarded revision is stale the same way.
    const draftId = edited?.revisionId as string;
    await h.reviewDraft.run(
      ORG,
      received.conversationId,
      draftId,
      {
        action: "discard",
      },
      "operator",
    );
    await expect(
      h.reviewDraft.run(
        ORG,
        received.conversationId,
        draftId,
        {
          action: "approve",
        },
        "operator",
      ),
    ).rejects.toBeInstanceOf(StaleRevisionError);
  });

  it("discard is terminal; a second discard is 409", async () => {
    const h = harness();
    const received = await receiveFaq(h);
    const original = h.drafts.rows[0] as DraftRevision;
    const reviewed = await h.reviewDraft.run(
      ORG,
      received.conversationId,
      original.id,
      { action: "discard" },
      OPERATOR_EMAIL,
    );
    expect(reviewed).toMatchObject({
      revisionId: original.id,
      status: "discarded",
    });
    await expect(
      h.reviewDraft.run(
        ORG,
        received.conversationId,
        original.id,
        {
          action: "discard",
        },
        "operator",
      ),
    ).rejects.toBeInstanceOf(StaleRevisionError);
    // Carried note 14: the audit event names the operator email.
    expect(h.audit.rows).toEqual([
      expect.objectContaining({
        action: "draft.discarded",
        actor: OPERATOR_EMAIL,
      }),
    ]);
  });

  it("an unknown revision or a foreign conversation resolves to undefined (404)", async () => {
    const h = harness();
    const received = await receiveFaq(h);
    const original = h.drafts.rows[0] as DraftRevision;
    expect(
      await h.reviewDraft.run(
        ORG,
        received.conversationId,
        "ulid-nope",
        {
          action: "approve",
        },
        "operator",
      ),
    ).toBeUndefined();
    expect(
      await h.reviewDraft.run(
        ORG,
        "ulid-other-conversation",
        original.id,
        {
          action: "approve",
        },
        "operator",
      ),
    ).toBeUndefined();
  });

  it("editing a consumed revision is 409 stale_revision", async () => {
    const h = harness();
    const received = await receiveFaq(h);
    const original = h.drafts.rows[0] as DraftRevision;
    await h.reviewDraft.run(
      ORG,
      received.conversationId,
      original.id,
      {
        action: "approve",
      },
      "operator",
    );
    await h.sendDraft.run(ORG, original.id, "operator");
    await expect(
      h.reviewDraft.run(
        ORG,
        received.conversationId,
        original.id,
        { action: "edit", bodyText: "Too late." },
        "operator",
      ),
    ).rejects.toBeInstanceOf(StaleRevisionError);
  });
});

describe("take-over (task 5.4)", () => {
  it("pauses the conversation and records the audit event", async () => {
    const h = harness();
    const received = await receiveFaq(h);
    const paused = await h.takeOver.run(
      ORG,
      received.conversationId,
      OPERATOR_EMAIL,
    );
    expect(paused).toBe(true);
    expect(h.conversations.rows[0]).toMatchObject({
      automationPaused: true,
    });
    // Carried note 14: the audit event names the operator email.
    expect(h.audit.rows).toEqual([
      expect.objectContaining({
        action: "conversation.takeover",
        actor: OPERATOR_EMAIL,
      }),
    ]);
  });

  it("an unknown conversation resolves to undefined (404)", async () => {
    const h = harness();
    expect(await h.takeOver.run(ORG, "ulid-nope", "operator")).toBeUndefined();
  });

  it("a paused conversation's draft is untouched by new inbound mail", async () => {
    const h = harness();
    const first = await receiveFaq(h, {
      sourceMessageId: "src-take-1",
      messageId: "<take-1@customer.example>",
    });
    const draft = h.drafts.rows[0] as DraftRevision;
    await h.reviewDraft.run(
      ORG,
      first.conversationId,
      draft.id,
      {
        action: "approve",
      },
      "operator",
    );
    await h.takeOver.run(ORG, first.conversationId, "operator");

    // A new FAQ email in the same thread: classification is still recorded
    // (a new processing revision), but the draft is untouched — same
    // revisionId, same status, no new drafts.
    h.classifier.script(faqClassification(["kb_areas"]));
    const second = await h.receive.run(
      email({
        sourceMessageId: "src-take-2",
        messageId: "<take-2@customer.example>",
        inReplyTo: "<take-1@customer.example>",
        subject: "Your hours",
        text: "What are your hours?",
      }),
    );
    expect(second.conversationId).toBe(first.conversationId);
    expect(second.processing).toBe("needs_human");
    expect(h.drafts.rows).toHaveLength(1);
    expect(await h.drafts.findById(ORG, draft.id)).toEqual(draft);

    // Classification still happened: two processing revisions now.
    expect(
      h.revisions.rows.filter((row) => row.messageId === second.messageId),
    ).toHaveLength(1);
    const latest = await h.getThread.run(ORG, first.conversationId);
    expect(latest?.processing).toMatchObject({ lane: "faq" });
  });
});

describe("SendApprovedDraft (task 5.3)", () => {
  it("sends an approved draft: one message, one queued outbox row, draft consumed", async () => {
    const h = harness();
    const received = await receiveFaq(h);
    const draft = h.drafts.rows[0] as DraftRevision;
    await h.reviewDraft.run(
      ORG,
      received.conversationId,
      draft.id,
      {
        action: "approve",
      },
      "operator",
    );

    const result = await h.sendDraft.run(ORG, draft.id, "operator");
    expect(result).toMatchObject({
      conversationId: received.conversationId,
      revisionId: draft.id,
    });
    expect(result?.messageId).toEqual(expect.any(String));
    expect(h.messages.rows).toHaveLength(2); // inbound + outbound
    expect(h.outbox.rows).toHaveLength(1);
    expect(h.outbox.rows[0]).toMatchObject({
      messageId: result?.messageId,
      conversationId: received.conversationId,
      recipient: "sam@example.test",
      status: "queued",
      attempts: 0,
      lastError: null,
    });
    expect(await h.drafts.findById(ORG, draft.id)).toMatchObject({
      status: "consumed",
      outboundMessageId: result?.messageId,
    });
    expect(h.audit.rows.map((row) => row.action)).toEqual([
      "draft.approved",
      "draft.sent",
    ]);
    const outbound = h.messages.rows.find(
      (row) => row.id === result?.messageId,
    );
    expect(outbound).toMatchObject({
      direction: "outbound",
      fromAddress: "hello@harbourandpine.example",
      to: ["sam@example.test"],
      subject: "Re: Your hours",
      text: draft.bodyText,
    });
  });

  it("sending the same revision twice returns the same message and creates nothing new", async () => {
    const h = harness();
    const received = await receiveFaq(h);
    const draft = h.drafts.rows[0] as DraftRevision;
    await h.reviewDraft.run(
      ORG,
      received.conversationId,
      draft.id,
      {
        action: "approve",
      },
      "operator",
    );
    const first = await h.sendDraft.run(ORG, draft.id, "operator");
    const second = await h.sendDraft.run(ORG, draft.id, "operator");
    expect(second?.messageId).toBe(first?.messageId);
    expect(second).toEqual(first);
    expect(h.messages.rows).toHaveLength(2); // still one outbound
    expect(h.outbox.rows).toHaveLength(1); // still one outbox row
    expect(
      h.audit.rows.filter((row) => row.action === "draft.sent"),
    ).toHaveLength(1);
  });

  it("sending a proposed, discarded, or superseded revision is 409 conflict", async () => {
    const h = harness();
    const received = await receiveFaq(h);
    const draft = h.drafts.rows[0] as DraftRevision;
    await expect(
      h.sendDraft.run(ORG, draft.id, "operator"),
    ).rejects.toBeInstanceOf(ConflictError);

    await h.reviewDraft.run(
      ORG,
      received.conversationId,
      draft.id,
      {
        action: "discard",
      },
      "operator",
    );
    await expect(
      h.sendDraft.run(ORG, draft.id, "operator"),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("an unknown revision resolves to undefined (404)", async () => {
    const h = harness();
    expect(await h.sendDraft.run(ORG, "ulid-nope", "operator")).toBeUndefined();
  });
});

describe("processing draft-replacement policy (task 5.4)", () => {
  it("a new machine draft supersedes the untouched machine original", async () => {
    const h = harness();
    await receiveFaq(h, {
      sourceMessageId: "src-replace-1",
      messageId: "<replace-1@customer.example>",
    });
    const original = h.drafts.rows[0] as DraftRevision;
    h.classifier.script(faqClassification(["kb_areas"]));
    await h.receive.run(
      email({
        sourceMessageId: "src-replace-2",
        inReplyTo: "<replace-1@customer.example>",
        subject: "Your areas",
        text: "What areas do you serve?",
      }),
    );
    expect(h.drafts.rows).toHaveLength(2);
    expect(await h.drafts.findById(ORG, original.id)).toMatchObject({
      status: "superseded",
    });
    expect(
      h.drafts.rows.filter((row) => row.status === "proposed"),
    ).toHaveLength(1);
  });

  it("an operator draft is never silently superseded by processing", async () => {
    const h = harness();
    const first = await receiveFaq(h, {
      sourceMessageId: "src-operator-1",
      messageId: "<operator-1@customer.example>",
    });
    const machine = h.drafts.rows[0] as DraftRevision;
    const edited = await h.reviewDraft.run(
      ORG,
      first.conversationId,
      machine.id,
      { action: "edit", bodyText: "Operator wording." },
      "operator",
    );
    const operatorDraftId = edited?.revisionId as string;

    h.classifier.script(faqClassification(["kb_areas"]));
    await h.receive.run(
      email({
        sourceMessageId: "src-operator-2",
        inReplyTo: "<operator-1@customer.example>",
        subject: "Your areas",
        text: "What areas do you serve?",
      }),
    );
    expect(await h.drafts.findById(ORG, operatorDraftId)).toMatchObject({
      status: "proposed",
      origin: "operator",
    });
    expect(await h.drafts.findById(ORG, machine.id)).toMatchObject({
      status: "superseded", // the edit already superseded it explicitly
    });
  });

  it("approved, discarded, and consumed drafts are never superseded by processing", async () => {
    // Approved: processing appends a new proposed draft but leaves the
    // approval alone — the operator decides which one to send.
    const approved = harness();
    const first = await receiveFaq(approved, {
      sourceMessageId: "src-keep-1",
      messageId: "<keep-1@customer.example>",
    });
    const approvedDraft = approved.drafts.rows[0] as DraftRevision;
    await approved.reviewDraft.run(
      ORG,
      first.conversationId,
      approvedDraft.id,
      {
        action: "approve",
      },
      "operator",
    );
    approved.classifier.script(faqClassification(["kb_areas"]));
    await approved.receive.run(
      email({
        sourceMessageId: "src-keep-2",
        inReplyTo: "<keep-1@customer.example>",
        subject: "Your areas",
        text: "What areas do you serve?",
      }),
    );
    expect(await approved.drafts.findById(ORG, approvedDraft.id)).toMatchObject(
      { status: "approved" },
    );

    // Discarded and consumed: terminal states stay terminal.
    for (const action of ["discard", "approve"] as const) {
      const h = harness();
      const received = await receiveFaq(h, {
        sourceMessageId: `src-term-${action}`,
        messageId: `<term-${action}@customer.example>`,
      });
      const draft = h.drafts.rows[0] as DraftRevision;
      await h.reviewDraft.run(
        ORG,
        received.conversationId,
        draft.id,
        {
          action,
        },
        "operator",
      );
      if (action === "approve") {
        await h.sendDraft.run(ORG, draft.id, "operator");
      }
      h.classifier.script(faqClassification(["kb_areas"]));
      await h.receive.run(
        email({
          sourceMessageId: `src-term-${action}-2`,
          inReplyTo: `<term-${action}@customer.example>`,
          subject: "Your areas",
          text: "What areas do you serve?",
        }),
      );
      expect(await h.drafts.findById(ORG, draft.id)).toMatchObject({
        status: action === "discard" ? "discarded" : "consumed",
      });
    }
  });

  it("while paused, processing supersedes nothing and creates no draft", async () => {
    const h = harness();
    const first = await receiveFaq(h, {
      sourceMessageId: "src-paused-1",
      messageId: "<paused-1@customer.example>",
    });
    const draft = h.drafts.rows[0] as DraftRevision;
    await h.takeOver.run(ORG, first.conversationId, "operator");

    h.classifier.script(faqClassification(["kb_areas"]));
    const second = await h.receive.run(
      email({
        sourceMessageId: "src-paused-2",
        inReplyTo: "<paused-1@customer.example>",
        subject: "Your areas",
        text: "What areas do you serve?",
      }),
    );
    expect(second.processing).toBe("needs_human");
    expect(h.drafts.rows).toHaveLength(1);
    expect(await h.drafts.findById(ORG, draft.id)).toEqual(draft);
  });
});

describe("fact-id order (carried note 11)", () => {
  it("stored factIds order matches the body order for mixed-case ids", async () => {
    // Mixed-case fact ids: a locale-sensitive sort would order "kb_apple"
    // before "kb_Zebra" (or the reverse in another locale); the shared
    // code-unit comparator must decide both sites identically.
    const mixedCaseBase: KnowledgeBase = {
      version: "kb-mixed",
      blocks: [
        { id: "kb_hours", tags: ["hours"], text: "We clean Mon to Fri." },
        { id: "kb_Zebra", tags: ["zebra"], text: "Zebra fact." },
        { id: "kb_apple", tags: ["apple"], text: "Apple fact." },
        { id: "kb_Mixed", tags: ["mixed"], text: "Mixed fact." },
      ],
    };
    const h = harness();
    const drafts = h.drafts;
    const processing = new ProcessInboundMessage({
      messages: h.messages,
      conversations: h.conversations,
      revisions: h.revisions,
      drafts,
      classifier: h.classifier,
      drafter: h.drafter,
      knowledgeBase: { getKnowledgeBase: () => mixedCaseBase },
      priceList: h.priceList,
      profile: h.profile,
      quotes: h.quotes,
      ids: new SequentialIds(),
      clock: new FixedClock(),
    });
    // A stored inbound message this processing run can work on.
    const message = {
      id: "ulid-msg-mixed",
      organizationId: ORG,
      mailboxId: "mb_main",
      conversationId: "conv-mixed",
      direction: "inbound" as const,
      sourceMessageId: "src-mixed",
      messageId: "<mixed@customer.example>",
      inReplyTo: null,
      references: null,
      fromAddress: "sam@example.test",
      fromName: null,
      to: [],
      cc: null,
      replyTo: null,
      subject: "Facts",
      text: "Tell me facts.",
      html: null,
      attachments: null,
      receivedAt: "2025-06-01T00:00:00.000Z",
      sentAt: null,
    };
    h.conversations.rows.push({
      id: "conv-mixed",
      organizationId: ORG,
      mailboxId: "mb_main",
      fromAddress: "sam@example.test",
      fromName: null,
      subject: "Facts",
      automationPaused: false,
      createdAt: "2025-06-01T00:00:00.000Z",
      updatedAt: "2025-06-01T00:00:00.000Z",
    });
    h.messages.rows.push(message);
    h.classifier.script({
      ...classificationOf("faq"),
      faqFactIds: ["kb_apple", "kb_Mixed", "kb_hours", "kb_Zebra"],
      summary: "Question about our service details",
    });
    const result = await processing.run(ORG, "ulid-msg-mixed");
    expect(result.status).toBe("ready");

    const draft = drafts.rows[0] as DraftRevision;
    // Code-unit order: uppercase letters sort before lowercase, so
    // kb_Mixed < kb_Zebra < kb_apple (kb_hours is lowercase too).
    expect(draft.factIds).toEqual([
      "kb_Mixed",
      "kb_Zebra",
      "kb_apple",
      "kb_hours",
    ]);
    const body = draft.bodyText.split("\n\n");
    expect(body.indexOf("Mixed fact.")).toBeLessThan(
      body.indexOf("Zebra fact."),
    );
    expect(body.indexOf("Zebra fact.")).toBeLessThan(
      body.indexOf("Apple fact."),
    );
    expect(body.indexOf("Apple fact.")).toBeLessThan(
      body.indexOf("We clean Mon to Fri."),
    );
  });
});
