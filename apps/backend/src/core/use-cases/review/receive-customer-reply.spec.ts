import { describe, expect, it } from "vitest";
import { ValidationError } from "../../domain/errors";
import { email, FakeUnitOfWork, harness, NOW, ORG } from "../testing";
import { ReceiveCustomerReply } from "./receive-customer-reply";

const OPERATOR = "owner@harbourandpine.example";
let seq = 0;

function receiver(h: ReturnType<typeof harness>) {
  return new ReceiveCustomerReply({
    conversations: h.conversations,
    messages: h.messages,
    profile: h.profile,
    unitOfWork: new FakeUnitOfWork({
      messages: h.messages,
      drafts: h.drafts,
      outbox: h.outbox,
      audit: h.audit,
      quotes: h.quotes,
    }),
    processing: h.processing,
    ids: { nextId: () => `cust-${++seq}` },
    clock: { now: () => new Date(NOW) },
  });
}

describe("ReceiveCustomerReply", () => {
  it("stores an inbound customer message and processes it", async () => {
    const h = harness();
    const received = await h.receive.run(email());
    const before = h.messages.rows.length;

    const reply = await receiver(h).run(
      ORG,
      received.conversationId,
      "  Can you do a weekly clean of 2 bedrooms?  ",
      OPERATOR,
    );

    expect(reply?.conversationId).toBe(received.conversationId);
    expect(h.messages.rows).toHaveLength(before + 1);
    const stored = h.messages.rows.at(-1);
    expect(stored).toMatchObject({
      direction: "inbound",
      fromAddress: "sam@example.test",
      text: "Can you do a weekly clean of 2 bedrooms?",
    });
    expect(h.outbox.rows).toHaveLength(0);
    const thread = await h.getThread.run(ORG, received.conversationId);
    expect(thread?.timeline.some((entry) => entry.kind === "received")).toBe(
      true,
    );
    expect(
      thread?.timeline.filter((entry) => entry.kind === "received"),
    ).toHaveLength(2);
  });

  it("rejects an empty message and an unknown conversation", async () => {
    const h = harness();
    await expect(
      receiver(h).run(ORG, "missing", "Hello", OPERATOR),
    ).resolves.toBeUndefined();
    const received = await h.receive.run(email());
    await expect(
      receiver(h).run(ORG, received.conversationId, "   ", OPERATOR),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
