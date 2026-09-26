import { describe, expect, it } from "vitest";
import { COMPLAINT_DRAFT_BODY } from "../../domain/drafting";
import { ConflictError } from "../../domain/errors";
import { classificationOf, email, harness, NOW, ORG } from "../testing";

/**
 * Slice 7 acceptance (PLAN.md task 7.3): the operator-side confirmation of
 * a quote-reply email records the customer's accept/decline on the open
 * sent quote version — never the classification itself — in one unit of
 * work, with an audit event naming the operator email (carried note 14) and
 * `updated_at` moving with the decision (carried note 17). All ports are
 * fakes; no database, no network, no framework.
 */

const OPERATOR_EMAIL = "owner@harbourandpine.example";

/** Ingests, approves, and sends one quote; returns the sent version id. */
async function sentQuote(h: ReturnType<typeof harness>) {
  h.classifier.script(classificationOf("quote"));
  const received = await h.receive.run(email());
  const draft = h.drafts.rows.at(-1);
  await h.reviewDraft.run(
    ORG,
    received.conversationId,
    draft?.id as string,
    { action: "approve" },
    OPERATOR_EMAIL,
  );
  await h.sendDraft.run(ORG, draft?.id as string, OPERATOR_EMAIL);
  return {
    conversationId: received.conversationId,
    quoteVersionId: h.quotes.rows.at(-1)?.id as string,
    draftId: draft?.id as string,
  };
}

describe("ConfirmQuoteDecision (task 7.3)", () => {
  it("records an accept on the open sent quote in one unit of work", async () => {
    const h = harness();
    const { conversationId, quoteVersionId } = await sentQuote(h);
    const outcome = await h.confirmQuoteDecision.run(
      ORG,
      conversationId,
      quoteVersionId,
      "accept",
      OPERATOR_EMAIL,
    );
    expect(outcome).toMatchObject({
      kind: "confirmed",
      quoteVersionId,
      status: "accepted",
      decision: "accept",
    });
    expect(h.quotes.rows.at(-1)).toMatchObject({
      status: "accepted",
      decision: "accept",
      decidedAt: NOW,
      // Carried note 17: the decision is a state change.
      updatedAt: NOW,
    });
    // The audit event names the operator email, not "operator".
    expect(h.audit.rows.at(-1)).toMatchObject({
      actor: OPERATOR_EMAIL,
      action: "quote.accepted",
      entityType: "quote_version",
      entityId: quoteVersionId,
    });
    const thread = await h.getThread.run(ORG, conversationId);
    expect(thread?.openQuote).toBeUndefined();
    expect(thread?.quote).toMatchObject({
      quoteVersionId,
      status: "accepted",
      decision: "accept",
      decidedAt: NOW,
    });
  });

  it("records a decline the same way", async () => {
    const h = harness();
    const { conversationId, quoteVersionId } = await sentQuote(h);
    const outcome = await h.confirmQuoteDecision.run(
      ORG,
      conversationId,
      quoteVersionId,
      "decline",
      OPERATOR_EMAIL,
    );
    expect(outcome).toMatchObject({ status: "declined", decision: "decline" });
    expect(h.quotes.rows.at(-1)).toMatchObject({
      status: "declined",
      decidedAt: NOW,
      updatedAt: NOW,
    });
    expect(h.audit.rows.at(-1)?.action).toBe("quote.declined");
  });

  it("replaying the same decision is idempotent: no new rows", async () => {
    const h = harness();
    const { conversationId, quoteVersionId } = await sentQuote(h);
    await h.confirmQuoteDecision.run(
      ORG,
      conversationId,
      quoteVersionId,
      "accept",
      OPERATOR_EMAIL,
    );
    const auditCount = h.audit.rows.length;
    const second = await h.confirmQuoteDecision.run(
      ORG,
      conversationId,
      quoteVersionId,
      "accept",
      OPERATOR_EMAIL,
    );
    expect(second).toMatchObject({ kind: "confirmed", status: "accepted" });
    expect(h.audit.rows).toHaveLength(auditCount);
  });

  it("a conflicting decision on a decided version is 409", async () => {
    const h = harness();
    const { conversationId, quoteVersionId } = await sentQuote(h);
    await h.confirmQuoteDecision.run(
      ORG,
      conversationId,
      quoteVersionId,
      "accept",
      OPERATOR_EMAIL,
    );
    await expect(
      h.confirmQuoteDecision.run(
        ORG,
        conversationId,
        quoteVersionId,
        "decline",
        OPERATOR_EMAIL,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("an unknown quote version resolves to unknown (404 at the edge)", async () => {
    const h = harness();
    const { conversationId } = await sentQuote(h);
    const outcome = await h.confirmQuoteDecision.run(
      ORG,
      conversationId,
      "ulid-no-such-quote",
      "accept",
      OPERATOR_EMAIL,
    );
    expect(outcome).toEqual({ kind: "unknown" });
  });

  it("a quote of another conversation is a conflict, not a decision", async () => {
    const h = harness();
    const { quoteVersionId } = await sentQuote(h);
    await expect(
      h.confirmQuoteDecision.run(
        ORG,
        "ulid-some-other-conversation",
        quoteVersionId,
        "accept",
        OPERATOR_EMAIL,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("a prepared (not yet sent) quote version is a conflict", async () => {
    const h = harness();
    h.classifier.script(classificationOf("quote"));
    await h.receive.run(email());
    const quote = h.quotes.rows.at(-1);
    expect(quote?.status).toBe("prepared");
    const draft = h.drafts.rows.at(-1);
    const conversationId = h.conversations.rows.at(-1)?.id as string;
    await expect(
      h.confirmQuoteDecision.run(
        ORG,
        conversationId,
        quote?.id as string,
        "accept",
        OPERATOR_EMAIL,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(draft?.quoteVersionId).toBe(quote?.id);
  });

  it("processing a quote reply never decides the quote (no auto-record)", async () => {
    const h = harness();
    const { conversationId, quoteVersionId, draftId } = await sentQuote(h);
    h.classifier.script({
      ...classificationOf("quote_reply"),
      quoteReply: { intent: "accept" },
    });
    await h.receive.run(
      email({
        sourceMessageId: "src-reply",
        messageId: "<reply-1@customer.example>",
        inReplyTo: `<${draftId}@harbourandpine.example>`,
        subject: "Re: Oven clean",
        text: "I accept the quote.",
        receivedAt: "2025-06-01T01:00:00.000Z",
      }),
    );
    // The reply itself leaves the quote sent and undecided.
    expect(h.quotes.rows.at(-1)).toMatchObject({
      id: quoteVersionId,
      status: "sent",
      decidedAt: null,
    });
    // Only the explicit operator confirm changes the state.
    await h.confirmQuoteDecision.run(
      ORG,
      conversationId,
      quoteVersionId,
      "accept",
      OPERATOR_EMAIL,
    );
    expect(h.quotes.rows.at(-1)?.status).toBe("accepted");
  });
});

describe("complaint draft and send (task 7.2)", () => {
  it("sending the complaint's proposed draft requires approval: 409 on proposed", async () => {
    const h = harness();
    h.classifier.script(classificationOf("complaint"));
    const received = await h.receive.run(email());
    const draft = h.drafts.rows.at(-1);
    expect(draft?.bodyText).toBe(COMPLAINT_DRAFT_BODY);
    await expect(
      h.sendDraft.run(ORG, draft?.id as string, OPERATOR_EMAIL),
    ).rejects.toBeInstanceOf(ConflictError);
    // Nothing was sent: no outbox row, no outbound message.
    expect(h.outbox.rows).toHaveLength(0);
    expect(
      h.messages.rows.filter((row) => row.direction === "outbound"),
    ).toHaveLength(0);
    expect(received.processing).toBe("needs_human");
  });

  it("approve-then-send works for the complaint draft", async () => {
    const h = harness();
    h.classifier.script(classificationOf("complaint"));
    const received = await h.receive.run(email());
    const draft = h.drafts.rows.at(-1);
    await h.reviewDraft.run(
      ORG,
      received.conversationId,
      draft?.id as string,
      { action: "approve" },
      OPERATOR_EMAIL,
    );
    const sent = await h.sendDraft.run(
      ORG,
      draft?.id as string,
      OPERATOR_EMAIL,
    );
    expect(sent?.revisionId).toBe(draft?.id);
    expect(h.outbox.rows).toHaveLength(1);
    expect(h.outbox.rows[0]).toMatchObject({ status: "queued" });
    // The audit trail names the operator email (carried note 14).
    expect(h.audit.rows.map((row) => `${row.action}:${row.actor}`)).toContain(
      `draft.sent:${OPERATOR_EMAIL}`,
    );
  });

  it("complaint processing alone never creates an outbox row", async () => {
    const h = harness();
    h.classifier.script(classificationOf("complaint"));
    await h.receive.run(email());
    expect(h.outbox.rows).toHaveLength(0);
  });
});
