import { describe, expect, it } from "vitest";
import type { ProcessingResult } from "../../domain/processing";
import {
  classificationOf,
  email,
  harness,
  NOW,
  ORG,
  outboundFixture,
} from "../testing";
import { RetryMessageProcessing } from "./retry-message-processing";

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
    ["noise", "ready"],
    ["complaint", "needs_human"],
    ["other", "needs_human"],
    // Slice 7: a quote reply with no sent candidate quote to confirm is a
    // human item, not a ready owner action.
    ["quote_reply", "needs_human"],
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

  it("service lane stores the internal note on the artifact and creates no draft (7.1)", async () => {
    const h = harness();
    h.classifier.script(classificationOf("service"));
    const received = await h.receive.run(email());
    expect(received.processing).toBe("ready");
    const revision = h.revisions.rows[0];
    expect(revision?.classification?.service).toMatchObject({
      request: "Oven clean",
      supplied: [],
      missing: [],
      nextAction: "Reply to the customer to arrange the service.",
    });
    // Internal note only: no outbound draft for the service lane.
    expect(h.drafts.rows).toHaveLength(0);
    const thread = await h.getThread.run(ORG, received.conversationId);
    expect(thread?.serviceNote).toEqual({
      request: "Oven clean",
      supplied: [],
      missing: [],
      nextAction: "Reply to the customer to arrange the service.",
    });
  });

  it("complaint lane records the fixed optional draft and no outbox row (7.2)", async () => {
    const h = harness();
    h.classifier.script(classificationOf("complaint"));
    const received = await h.receive.run(email());
    expect(received.processing).toBe("needs_human");
    const draft = h.drafts.rows.at(-1);
    // Exactly the fixed sentence: no model apology, no wrapper wording.
    expect(draft).toMatchObject({
      status: "proposed",
      origin: "processing",
      bodyText: "Thanks — the owner will reply personally.",
      conversationId: received.conversationId,
    });
    // Processing alone never queues anything for delivery.
    expect(h.outbox.rows).toHaveLength(0);
    expect(h.messages.rows).toHaveLength(1); // only the inbound message
  });

  it("a paused conversation keeps the complaint human with no machine draft", async () => {
    const h = harness();
    h.classifier.script(classificationOf("noise"));
    await h.receive.run(email());
    await h.takeOver.run(
      ORG,
      h.conversations.rows[0]?.id as string,
      "operator",
    );
    h.classifier.script(classificationOf("complaint"));
    const second = await h.receive.run(
      email({
        sourceMessageId: "src-2",
        messageId: "<msg-2@customer.example>",
        inReplyTo: "<msg-1@customer.example>",
      }),
    );
    expect(second.processing).toBe("needs_human");
    expect(h.drafts.rows).toHaveLength(0);
  });

  it("quote reply with one sent candidate and accept intent is a ready owner action (7.3)", async () => {
    const h = harness();
    // Quote → approve → send: one sent quote version on the conversation.
    h.classifier.script(classificationOf("quote"));
    const quoted = await h.receive.run(email());
    const draft = h.drafts.rows.at(-1);
    await h.reviewDraft.run(
      ORG,
      quoted.conversationId,
      draft?.id as string,
      { action: "approve" },
      "owner@harbourandpine.example",
    );
    const sent = await h.sendDraft.run(
      ORG,
      draft?.id as string,
      "owner@harbourandpine.example",
    );
    const sentQuote = h.quotes.rows.find(
      (row) => row.conversationId === quoted.conversationId,
    );
    expect(sentQuote?.status).toBe("sent");

    // The customer replies to the sent quote message.
    h.classifier.script({
      ...classificationOf("quote_reply"),
      quoteReply: { intent: "accept" },
    });
    const reply = await h.receive.run(
      email({
        sourceMessageId: "src-reply",
        messageId: "<reply-1@customer.example>",
        inReplyTo: `<${draft?.id}@harbourandpine.example>`,
        subject: "Re: Oven clean",
        text: "Looks good, I accept the quote.",
        receivedAt: "2025-06-01T01:00:00.000Z",
      }),
    );
    expect(reply.conversationId).toBe(quoted.conversationId);
    expect(reply.processing).toBe("ready");
    const revision = h.revisions.rows.at(-1);
    expect(revision?.classification?.quoteReply).toEqual({
      intent: "accept",
      candidateQuoteVersionIds: [sentQuote?.id],
    });
    // The reply itself never changed the quote state.
    expect(h.quotes.rows.find((row) => row.id === sentQuote?.id)?.status).toBe(
      "sent",
    );
    // The outbound message id is a usable threading key for the spec above.
    expect(sent?.messageId).toBeDefined();
    const thread = await h.getThread.run(ORG, reply.conversationId);
    expect(thread?.quoteReply).toEqual({
      intent: "accept",
      candidateQuoteVersionIds: [sentQuote?.id],
    });
  });

  it("quote reply with accept intent but no sent quote versions is needs_human", async () => {
    const h = harness();
    // A replied-to outbound quote message, but no sent quote version on the
    // conversation: even a clear accept has no candidate to confirm.
    h.messages.rows.push(outboundFixture());
    h.classifier.script({
      ...classificationOf("quote_reply"),
      quoteReply: { intent: "accept" },
    });
    const result = await h.receive.run(
      email({
        sourceMessageId: "src-qr-none",
        messageId: "<qr-none@customer.example>",
        inReplyTo: "<quote-1@harbourandpine.example>",
      }),
    );
    expect(result.processing).toBe("needs_human");
    const revision = h.revisions.rows.at(-1);
    expect(revision?.classification?.quoteReply).toEqual({
      intent: "accept",
      candidateQuoteVersionIds: [],
    });
  });

  it("quote reply with change/unclear intent or multiple candidates is needs_human", async () => {
    const h = harness();
    const conversationId = "ulid-outbound-conversation";
    // Two sent candidate versions on the replied-to conversation.
    for (const id of ["ulid-quote-a", "ulid-quote-b"]) {
      h.quotes.rows.push({
        id,
        organizationId: ORG,
        conversationId,
        draftRevisionId: null,
        status: "sent",
        tokenHash: `hash(${id})`,
        lines: [],
        assumptions: [],
        currency: "AUD",
        subtotalMinor: 0,
        taxMinor: 0,
        totalMinor: 0,
        priceListVersion: "pl-1",
        validUntil: "2025-07-01T00:00:00.000Z",
        sentAt: NOW,
        decidedAt: null,
        decision: null,
        createdAt: NOW,
        updatedAt: NOW,
      });
    }
    h.messages.rows.push(outboundFixture());
    for (const intent of ["accept", "change", "unclear"] as const) {
      h.classifier.script({
        ...classificationOf("quote_reply"),
        quoteReply: { intent },
      });
      const result = await h.receive.run(
        email({
          sourceMessageId: `src-qr-${intent}`,
          messageId: `<qr-${intent}@customer.example>`,
          inReplyTo: "<quote-1@harbourandpine.example>",
        }),
      );
      // Multiple candidates: even a clear accept needs a human.
      expect(result.processing).toBe("needs_human");
      const revision = h.revisions.rows.at(-1);
      expect(
        revision?.classification?.quoteReply?.candidateQuoteVersionIds,
      ).toEqual(["ulid-quote-a", "ulid-quote-b"]);
    }
  });

  it("attachment-only mail with no usable text is needs_human in every lane (7.4)", async () => {
    for (const lane of [
      "faq",
      "quote",
      "service",
      "complaint",
      "quote_reply",
    ] as const) {
      const h = harness();
      h.classifier.script(classificationOf(lane));
      const result = await h.receive.run(
        email({
          text: "   ",
          html: undefined,
          attachments: [
            { name: "scan.pdf", mime: "application/pdf", size: 10 },
          ],
        }),
      );
      expect(result.processing).toBe("needs_human");
      const revision = h.revisions.rows[0];
      expect(revision).toMatchObject({
        status: "needs_human",
        lane: null,
        classification: null,
      });
      expect(revision?.summary).toContain("No usable text");
      expect(h.drafts.rows).toHaveLength(0);
    }
  });

  it("a later quote request with enough detail generates a quote", async () => {
    const h = harness();
    const first = await h.receive.run(email());
    h.classifier.script({
      lane: "quote",
      confidence: "high",
      summary: "Customer asks for another quote",
      quoteRequest: { lines: [{ label: "Oven clean", ruleId: "oven_clean" }] },
    });
    const second = await h.receive.run(
      email({
        sourceMessageId: "src-2",
        messageId: "<msg-2@customer.example>",
        inReplyTo: "<msg-1@customer.example>",
        text: "Please quote a regular clean of 2 bedrooms",
        receivedAt: "2025-06-02T00:00:00.000Z",
      }),
    );
    expect(second.processing).toBe("ready");
    const thread = await h.getThread.run(ORG, first.conversationId);
    expect(thread?.draft?.bodyText).toContain("Regular clean × 2");
  });

  it("a later quote request with a missing quantity asks the customer", async () => {
    const h = harness();
    const first = await h.receive.run(email());
    h.classifier.script({
      lane: "quote",
      confidence: "high",
      summary: "Quote for a commercial office",
      quoteRequest: {
        lines: [
          { ruleId: "regular_clean", label: "Regular clean" },
          { ruleId: "oven_clean", label: "Oven clean" },
        ],
      },
    });
    const second = await h.receive.run(
      email({
        sourceMessageId: "src-2",
        messageId: "<msg-2@customer.example>",
        inReplyTo: "<msg-1@customer.example>",
        text: "Please give me a quote for a regular clean of 100 square meters",
        receivedAt: "2025-06-02T00:00:00.000Z",
      }),
    );
    expect(second.processing).toBe("needs_human");
    const thread = await h.getThread.run(ORG, first.conversationId);
    expect(thread?.draft?.bodyText).toContain(
      "How many bedrooms should we allow for Regular clean?",
    );
    expect(thread?.draft?.bodyText).toContain("100 square meters");
    expect(thread?.draft?.bodyText).not.toContain("Oven clean");
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
