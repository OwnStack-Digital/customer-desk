import { describe, expect, it } from "vitest";
import type { DraftRevision } from "../../domain/drafting";
import type { ProcessingRevision } from "../../domain/processing";
import {
  classificationOf,
  email,
  FakeProcessingRevisions,
  FixedClock,
  harness,
  ORG,
  SequentialIds,
} from "../testing";
import { ProcessInboundMessage } from "./process-inbound-message";
import { RetryMessageProcessing } from "./retry-message-processing";

/**
 * Slice 4 acceptance (PLAN.md tasks 4.2–4.4): grounded FAQ drafts, the
 * explicit unknown body, the HTML-only rule, and no drafts outside the
 * FAQ lane. All ports are fakes; no database, no network.
 */

function faqClassification(factIds: string[]) {
  return {
    ...classificationOf("faq"),
    faqFactIds: factIds,
    summary: "Question about our service details",
  };
}

describe("FAQ drafts (task 4.2)", () => {
  it("matched facts: ready + one proposed draft grounded in the blocks", async () => {
    const h = harness();
    h.classifier.script(faqClassification(["kb_hours", "kb_areas"]));
    const received = await h.receive.run(email());
    expect(received.processing).toBe("ready");

    expect(h.drafts.rows).toHaveLength(1);
    const draft = h.drafts.rows[0] as DraftRevision;
    expect(draft).toMatchObject({
      organizationId: ORG,
      conversationId: received.conversationId,
      messageId: received.messageId,
      status: "proposed",
      // Fact ids stored in the order used in the body (fact-id order:
      // kb_areas sorts before kb_hours).
      factIds: ["kb_areas", "kb_hours"],
      knowledgeBaseVersion: "kb-1",
      assumptions: [],
      outboundMessageId: null,
      quoteVersionId: null,
    });
    expect(draft.bodyText).toBe(
      "Hi,\n\nWe serve Balmain and Rozelle.\n\nWe clean Mon to Fri.\n\nThanks,",
    );
  });

  it("no supporting fact: needs_human + the explicit unknown body", async () => {
    const h = harness();
    h.classifier.script(faqClassification([]));
    const received = await h.receive.run(email());
    expect(received.processing).toBe("needs_human");

    const draft = h.drafts.rows[0] as DraftRevision;
    expect(draft?.status).toBe("proposed");
    expect(draft?.factIds).toEqual([]);
    // The unknown line names the asked topic (the subject) and never
    // answers from model knowledge.
    expect(draft?.bodyText).toBe(
      'Hi,\n\nWe don\'t have that information yet about "Oven clean".\n\nThanks,',
    );
    const revision = h.revisions.rows[0];
    expect(revision).toMatchObject({ status: "needs_human", lane: "faq" });
  });

  it("the draft body never contains a sentence absent from the blocks", async () => {
    const h = harness();
    h.classifier.script(faqClassification(["kb_hours", "kb_areas"]));
    await h.receive.run(email());
    const body = (h.drafts.rows[0] as DraftRevision).bodyText;
    const wrapperLines = new Set(["Hi,", "Thanks,"]);
    const kb = h.knowledgeBase.getKnowledgeBase();
    const grounded = body
      .split("\n\n")
      .filter((line) => !wrapperLines.has(line))
      .every((line) => kb.blocks.some((block) => block.text === line));
    expect(grounded).toBe(true);
  });

  it("no drafts for the non-FAQ lanes", async () => {
    for (const lane of [
      // The complaint lane gained its optional fixed draft in slice 7;
      // it is covered (and contrasted) in the slice-7 specs.
      "service",
      "quote_reply",
      "noise",
      "other",
    ] as const) {
      const h = harness();
      h.classifier.script(classificationOf(lane));
      await h.receive.run(email());
      expect(h.drafts.rows).toHaveLength(0);
    }
  });

  it("the thread response carries the draft with the fact ids (task 4.5)", async () => {
    const h = harness();
    h.classifier.script(faqClassification(["kb_hours"]));
    const received = await h.receive.run(email());
    const thread = await h.getThread.run(ORG, received.conversationId);
    expect(thread?.draft).toEqual({
      revisionId: h.drafts.rows[0]?.id,
      status: "proposed",
      bodyText: "Hi,\n\nWe clean Mon to Fri.\n\nThanks,",
      assumptions: [],
      factIds: ["kb_hours"],
    });
  });
});

describe("HTML-only and attachments-only mail (task 4.4)", () => {
  it("html without usable text: needs_human, message kept, no draft", async () => {
    const h = harness();
    const received = await h.receive.run(
      email({ text: undefined, html: "<p>How much for a clean?</p>" }),
    );
    expect(received.processing).toBe("needs_human");
    expect(h.messages.rows).toHaveLength(1); // nothing is deleted
    expect(h.drafts.rows).toHaveLength(0); // nothing to ground on
    expect(h.classifier.calls).toHaveLength(0); // no lane is trusted
    expect(h.revisions.rows[0]).toMatchObject({
      status: "needs_human",
      lane: null,
    });
    expect(h.revisions.rows[0]?.summary).toMatch(/No usable text/);
  });

  it("whitespace-only text counts as no text", async () => {
    const h = harness();
    const received = await h.receive.run(
      email({ text: "   \n\t", html: "<p>hello</p>" }),
    );
    expect(received.processing).toBe("needs_human");
    expect(h.drafts.rows).toHaveLength(0);
  });

  it("attachments without text: needs_human regardless of lane", async () => {
    const h = harness();
    const received = await h.receive.run(
      email({
        text: undefined,
        html: undefined,
        attachments: [{ name: "photo.pdf", mime: "application/pdf", size: 10 }],
      }),
    );
    expect(received.processing).toBe("needs_human");
    expect(h.drafts.rows).toHaveLength(0);
    expect(h.messages.rows).toHaveLength(1);
  });
});

describe("retry hardening (carried note 10)", () => {
  /** Simulates the concurrent-retry race: a stale pre-read loser. */
  class RacingProcessingRevisions extends FakeProcessingRevisions {
    private lookups = 0;

    constructor(winner: ProcessingRevision) {
      super();
      this.rows.push(winner);
    }

    async findLatestByMessage(
      organizationId: string,
      messageId: string,
    ): Promise<ProcessingRevision | undefined> {
      this.lookups += 1;
      if (this.lookups === 1) {
        return undefined; // the loser read before the winner inserted
      }
      return super.findLatestByMessage(organizationId, messageId);
    }

    async insertRevision(revision: ProcessingRevision): Promise<void> {
      // The database-level unique index on (message_id, revision_number).
      if (
        this.rows.some(
          (row) =>
            row.messageId === revision.messageId &&
            row.revisionNumber === revision.revisionNumber,
        )
      ) {
        throw new Error(
          "UNIQUE constraint failed: processing_revisions.message_id, processing_revisions.revision_number",
        );
      }
      return super.insertRevision(revision);
    }
  }

  it("a unique-violation loser returns the winning revision, not a 500", async () => {
    const h = harness();
    const received = await h.receive.run(email());
    const winner: ProcessingRevision = {
      ...h.revisions.rows[0],
      id: "ulid-winner",
      status: "processing",
      lane: null,
      summary: null,
    };

    const racing = new RacingProcessingRevisions(winner);
    const loserProcessing = new ProcessInboundMessage({
      messages: h.messages,
      conversations: h.conversations,
      revisions: racing,
      drafts: h.drafts,
      classifier: h.classifier,
      drafter: h.drafter,
      knowledgeBase: h.knowledgeBase,
      priceList: h.priceList,
      profile: h.profile,
      quotes: h.quotes,
      ids: new SequentialIds(),
      clock: new FixedClock(),
    });
    const result = await loserProcessing.run(ORG, received.messageId);
    expect(result).toEqual({
      revisionId: "ulid-winner",
      status: "processing",
      summary: "Processing is already running.",
    });
    // No stacked duplicate revision, no classifier call.
    expect(racing.rows).toHaveLength(1);
    expect(h.classifier.calls).toHaveLength(1); // only the winner's run
  });

  it("retry stays idempotent and reprocessing works after the race", async () => {
    const h = harness();
    const received = await h.receive.run(email());
    h.classifier.script(faqClassification(["kb_hours"]));
    const retry = new RetryMessageProcessing({
      messages: h.messages,
      revisions: h.revisions,
      processing: h.processing,
    });
    const result = await retry.run(ORG, received.messageId);
    expect(result?.status).toBe("ready");
    // The retry appended a second revision and a draft, not a 500. The
    // initial quote draft (slice 6) is superseded by the retry's machine
    // FAQ draft; exactly one proposed draft remains.
    expect(h.revisions.rows.map((row) => row.revisionNumber)).toEqual([1, 2]);
    expect(
      h.drafts.rows.filter((row) => row.status === "proposed"),
    ).toHaveLength(1);
    expect(h.drafts.rows.some((row) => row.status === "superseded")).toBe(true);
  });
});
