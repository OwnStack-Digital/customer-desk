import { describe, expect, it } from "vitest";
import { ValidationError } from "../domain/errors";
import type { Clock } from "../ports/clock";
import { RecordCustomerMessage } from "./record-customer-message";
import {
  classificationOf,
  email,
  FakeUnitOfWork,
  harness,
  ORG,
} from "./testing";

class LateClock implements Clock {
  now(): Date {
    return new Date("2025-06-20T00:00:00.000Z");
  }
}

async function sentQuote(h: ReturnType<typeof harness>) {
  h.classifier.script(classificationOf("quote"));
  const received = await h.receive.run(email());
  const draft = h.drafts.rows.at(-1);
  await h.reviewDraft.run(
    ORG,
    received.conversationId,
    draft?.id as string,
    { action: "approve" },
    "operator",
  );
  await h.sendDraft.run(ORG, draft?.id as string, "operator");
  return {
    conversationId: received.conversationId,
    rawToken: h.tokens.tokens[0] as string,
  };
}

function recorder(
  h: ReturnType<typeof harness>,
  clock: Clock = { now: () => new Date("2025-06-01T00:01:00.000Z") },
) {
  return new RecordCustomerMessage({
    quotes: h.quotes,
    tokenHasher: h.tokenHasher,
    profile: h.profile,
    conversations: h.conversations,
    messages: h.messages,
    unitOfWork: new FakeUnitOfWork({
      messages: h.messages,
      drafts: h.drafts,
      outbox: h.outbox,
      audit: h.audit,
      quotes: h.quotes,
    }),
    processing: h.processing,
    ids: { nextId: () => `cust-${h.messages.rows.length + 1}` },
    clock,
  });
}

describe("RecordCustomerMessage", () => {
  it("adds the customer's text to the thread and classifies it", async () => {
    const h = harness();
    const { conversationId, rawToken } = await sentQuote(h);
    h.classifier.script({
      ...classificationOf("other"),
      summary: "Customer asked about Saturday",
    });

    const recorded = await recorder(h).run(
      ORG,
      rawToken,
      "Can you do Saturday instead?",
    );

    expect(recorded?.conversationId).toBe(conversationId);
    const inbound = h.messages.rows.find(
      (row) => row.id === recorded?.messageId,
    );
    expect(inbound).toMatchObject({
      direction: "inbound",
      fromAddress: "sam@example.test",
      text: "Can you do Saturday instead?",
      inReplyTo: expect.stringContaining("@"),
    });
    expect(h.audit.rows.at(-1)).toMatchObject({
      actor: "customer",
      action: "message.received",
      entityId: recorded?.messageId,
    });
    const thread = await h.getThread.run(ORG, conversationId);
    expect(thread?.messages.at(-1)?.text).toBe("Can you do Saturday instead?");
    expect(thread?.processing?.summary).toBe("Customer asked about Saturday");
    const shown = await h.getPublicQuote.run(ORG, rawToken);
    expect(shown?.messages.at(-1)).toMatchObject({
      from: "You",
      text: "Can you do Saturday instead?",
    });
    expect(JSON.stringify(shown)).not.toContain(rawToken);
  });

  it("still accepts a message after the quote is declined", async () => {
    const h = harness();
    const { rawToken } = await sentQuote(h);
    await h.recordQuoteDecision.run(ORG, rawToken, "decline");
    const recorded = await recorder(h).run(
      ORG,
      rawToken,
      "Please send a revised quote.",
    );
    expect(recorded?.messageId).toBeDefined();
    expect(h.quotes.rows.some((row) => row.status === "declined")).toBe(true);
  });

  it("does not accept a message on an expired or unknown token", async () => {
    const h = harness();
    const { rawToken } = await sentQuote(h);
    expect(
      await recorder(h, new LateClock()).run(ORG, rawToken, "Hello"),
    ).toBeUndefined();
    expect(
      await recorder(h).run(ORG, "no-such-token", "Hello"),
    ).toBeUndefined();
    await expect(recorder(h).run(ORG, rawToken, "  ")).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
