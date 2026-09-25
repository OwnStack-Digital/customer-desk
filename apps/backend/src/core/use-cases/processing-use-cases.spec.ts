import { describe, expect, it } from "vitest";
import type { ProcessingResult } from "../domain/processing";
import { RetryMessageProcessing } from "./retry-message-processing";
import {
  classificationOf,
  email,
  harness,
  ORG,
  outboundFixture,
} from "./testing";

/**
 * Slice 3 processing state machine, per PLAN.md acceptance: one fixture per
 * lane plus the failure, low-confidence, complaint-precedence, duplicate,
 * and retry paths. All ports are fakes; no database, no network.
 */

describe("ProcessInboundMessage", () => {
  it.each([
    ["faq", "ready"],
    ["quote", "ready"],
    ["service", "ready"],
    ["quote_reply", "ready"],
    ["noise", "ready"],
    ["complaint", "needs_human"],
    ["other", "needs_human"],
  ] as const)(
    "lane %s ends %s with the lane recorded on the revision",
    async (lane, status) => {
      const h = harness();
      h.classifier.script(classificationOf(lane));
      const result = await h.receive.run(email());
      expect(result.processing).toBe(status);
      const revision = h.revisions.rows[0];
      expect(revision).toMatchObject({
        messageId: result.messageId,
        revisionNumber: 1,
        status,
        lane,
      });
    },
  );

  it("records the classification artifact and KB version on the revision", async () => {
    const h = harness();
    h.classifier.script(classificationOf("service"));
    await h.receive.run(email());
    const revision = h.revisions.rows[0];
    expect(revision?.classification?.service?.nextAction).toBe(
      "Reply to the customer to arrange the service.",
    );
    expect(revision?.knowledgeBaseVersion).toBe("kb-1");
    expect(revision?.summary).toBe("Service request");
  });

  it("a thrown classifier ([bos:fail]) records failed and keeps the message", async () => {
    const h = harness();
    h.classifier.script("throw");
    const result = await h.receive.run(email());
    expect(result.processing).toBe("failed");
    expect(h.messages.rows).toHaveLength(1); // message stays stored
    expect(h.revisions.rows[0]).toMatchObject({
      status: "failed",
      lane: null,
      classification: null,
      error: "classifier timeout",
    });
  });

  it("low confidence goes to a human, never parked as noise", async () => {
    const h = harness();
    h.classifier.script(classificationOf("noise", "low"));
    const result = await h.receive.run(email());
    expect(result.processing).toBe("needs_human");
    expect(h.revisions.rows[0]).toMatchObject({
      status: "needs_human",
      lane: "noise",
    });
  });

  it("other at low confidence is needs_human", async () => {
    const h = harness();
    h.classifier.script(classificationOf("other", "low"));
    const result = await h.receive.run(email());
    expect(result.processing).toBe("needs_human");
  });

  it("complaint is urgent in the inbox and appears in the complaints filter", async () => {
    const h = harness();
    h.classifier.script(classificationOf("complaint"));
    await h.receive.run(email());
    const all = await h.listInbox.run(ORG);
    expect(all.items[0]).toMatchObject({
      lane: "complaint",
      processing: "needs_human",
      urgent: true,
    });
    const complaints = await h.listInbox.run(ORG, "complaints");
    expect(complaints.items).toHaveLength(1);
    const needsHuman = await h.listInbox.run(ORG, "needs_human");
    expect(needsHuman.items).toHaveLength(1);
  });

  it("noise is parked: ready, no draft artifact beyond the classification", async () => {
    const h = harness();
    h.classifier.script(classificationOf("noise"));
    const result = await h.receive.run(email());
    expect(result.processing).toBe("ready");
    expect(h.revisions.rows).toHaveLength(1);
    expect(h.revisions.rows[0]?.classification?.summary).toBe(
      "Automated or non-human mail",
    );
  });

  it("duplicate ingress does not restart processing", async () => {
    const h = harness();
    await h.receive.run(email());
    const revisionsBefore = h.revisions.rows.length;
    const callsBefore = h.classifier.calls.length;
    const replay = await h.receive.run(email());
    expect(replay.duplicate).toBe(true);
    expect(h.classifier.calls).toHaveLength(callsBefore);
    expect(h.revisions.rows).toHaveLength(revisionsBefore);
  });

  it("passes repliedToOutboundQuote when inReplyTo hits a stored outbound message", async () => {
    const h = harness();
    // Seed an outbound message carrying an RFC Message-ID in this mailbox.
    h.messages.rows.push(outboundFixture());
    h.classifier.script(classificationOf("quote_reply"));
    await h.receive.run(
      email({ inReplyTo: "<quote-1@harbourandpine.example>" }),
    );
    expect(h.classifier.calls[0]?.repliedToOutboundQuote).toBe(true);
  });

  it("an inbound reply is not an outbound quote context", async () => {
    const h = harness();
    await h.receive.run(email());
    h.classifier.script(classificationOf("quote"));
    await h.receive.run(
      email({
        sourceMessageId: "src-2",
        inReplyTo: "<msg-1@customer.example>",
      }),
    );
    expect(h.classifier.calls.at(-1)?.repliedToOutboundQuote).toBe(false);
  });
});

describe("RetryMessageProcessing", () => {
  it("appends a new revision and reprocesses", async () => {
    const h = harness();
    const received = await h.receive.run(email());
    h.classifier.script(classificationOf("faq"));
    const retry = new RetryMessageProcessing({
      messages: h.messages,
      revisions: h.revisions,
      processing: h.processing,
    });
    const result: ProcessingResult | undefined = await retry.run(
      ORG,
      received.messageId,
    );
    expect(result?.status).toBe("ready");
    expect(h.revisions.rows.map((row) => row.revisionNumber)).toEqual([1, 2]);
    expect(h.revisions.rows[1]).toMatchObject({
      status: "ready",
      lane: "faq",
    });
    // The message is untouched: same id, still one row.
    expect(h.messages.rows).toHaveLength(1);
  });

  it("is a no-op returning the in-flight revision while one is processing", async () => {
    const h = harness();
    const received = await h.receive.run(email());
    // Simulate an attempt that never completed.
    h.revisions.rows[0] = { ...h.revisions.rows[0], status: "processing" };
    const callsBefore = h.classifier.calls.length;
    const retry = new RetryMessageProcessing({
      messages: h.messages,
      revisions: h.revisions,
      processing: h.processing,
    });
    const result = await retry.run(ORG, received.messageId);
    expect(result).toMatchObject({
      revisionId: h.revisions.rows[0].id,
      status: "processing",
    });
    expect(h.classifier.calls).toHaveLength(callsBefore);
    expect(h.revisions.rows).toHaveLength(1);
  });

  it("resolves an unknown message to undefined (404 at the edge)", async () => {
    const h = harness();
    const retry = new RetryMessageProcessing({
      messages: h.messages,
      revisions: h.revisions,
      processing: h.processing,
    });
    expect(await retry.run(ORG, "ulid-nope")).toBeUndefined();
  });
});
