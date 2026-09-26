import { describe, expect, it } from "vitest";
import { ValidationError } from "../../domain/errors";
import { email, FakeUnitOfWork, harness, NOW, ORG } from "../testing";
import { SendOperatorMessage } from "./send-operator-message";

const OPERATOR = "owner@harbourandpine.example";

function sender(h: ReturnType<typeof harness>) {
  let seq = 0;
  return new SendOperatorMessage({
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
    ids: { nextId: () => `op-${++seq}` },
    clock: { now: () => new Date(NOW) },
  });
}

describe("SendOperatorMessage", () => {
  it("queues a message with no draft and does not touch quote state", async () => {
    const h = harness();
    const received = await h.receive.run(email());
    const quoteBefore = h.quotes.rows.length;
    const draftsBefore = h.drafts.rows.length;

    const sent = await sender(h).run(
      ORG,
      received.conversationId,
      "  We can do Saturday morning.  ",
      OPERATOR,
    );

    expect(sent).toEqual({
      messageId: expect.any(String),
      conversationId: received.conversationId,
    });
    const outbound = h.messages.rows.find((row) => row.id === sent?.messageId);
    expect(outbound).toMatchObject({
      direction: "outbound",
      text: "We can do Saturday morning.",
      to: ["sam@example.test"],
      fromAddress: "hello@harbourandpine.example",
      subject: "Re: Oven clean",
      inReplyTo: "<msg-1@customer.example>",
    });
    expect(h.outbox.rows).toEqual([
      expect.objectContaining({
        messageId: sent?.messageId,
        recipient: "sam@example.test",
        status: "queued",
      }),
    ]);
    expect(h.audit.rows.at(-1)).toMatchObject({
      actor: OPERATOR,
      action: "message.sent",
      entityType: "message",
      entityId: sent?.messageId,
    });
    expect(h.quotes.rows).toHaveLength(quoteBefore);
    expect(h.drafts.rows).toHaveLength(draftsBefore);
    const thread = await h.getThread.run(ORG, received.conversationId);
    expect(thread?.messages.map((message) => message.text)).toContain(
      "We can do Saturday morning.",
    );
  });

  it("still sends after a quote has been accepted", async () => {
    const h = harness();
    const received = await h.receive.run(email());
    const sent = await sender(h).run(
      ORG,
      received.conversationId,
      "Thanks, we will confirm the booking separately.",
      OPERATOR,
    );
    expect(sent?.conversationId).toBe(received.conversationId);
    expect(h.outbox.rows).toHaveLength(1);
  });

  it("rejects an unknown conversation and an empty body", async () => {
    const h = harness();
    const send = sender(h);
    expect(await send.run(ORG, "missing", "Hello", OPERATOR)).toBeUndefined();
    await expect(
      send.run(ORG, "missing", "   ", OPERATOR),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
