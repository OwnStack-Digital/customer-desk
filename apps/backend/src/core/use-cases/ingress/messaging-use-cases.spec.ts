import { describe, expect, it } from "vitest";
import type { InboundEmail } from "../../domain/messaging";
import { InboundValidationError } from "../../domain/messaging";
import {
  email,
  FakeMessages,
  FakeProfile,
  FixedClock,
  harness,
  MAILBOX,
  NOW,
  ORG,
} from "../testing";
import { ReceiveInboundEmail } from "./receive-inbound-email";

describe("ReceiveInboundEmail", () => {
  it("stores a new email and creates the conversation snapshot", async () => {
    const h = harness();
    const result = await h.receive.run(email());
    expect(result).toEqual({
      messageId: "ulid-2",
      conversationId: "ulid-1",
      duplicate: false,
      processing: "ready",
    });
    expect(h.conversations.rows).toHaveLength(1);
    expect(h.conversations.rows[0]).toMatchObject({
      organizationId: ORG,
      mailboxId: MAILBOX,
      fromAddress: "sam@example.test",
      fromName: "Sam",
      subject: "Oven clean",
      automationPaused: false,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(h.messages.rows).toHaveLength(1);
    expect(h.messages.rows[0]).toMatchObject({
      id: "ulid-2",
      conversationId: "ulid-1",
      direction: "inbound",
      messageId: "<msg-1@customer.example>",
      text: "Hi, how much for an oven clean?",
    });
  });

  it("threads a reply by inReplyTo into the existing conversation", async () => {
    const h = harness();
    const first = await h.receive.run(email());
    const reply = await h.receive.run(
      email({
        sourceMessageId: "src-2",
        messageId: "<msg-2@customer.example>",
        inReplyTo: "<msg-1@customer.example>",
        subject: "Re: Oven clean",
      }),
    );
    expect(reply.conversationId).toBe(first.conversationId);
    expect(reply.duplicate).toBe(false);
    expect(h.conversations.rows).toHaveLength(1);
    expect(h.messages.rows).toHaveLength(2);
  });

  it("threads by references, walking from the end", async () => {
    const h = harness();
    const original = await h.receive.run(
      email({ messageId: "<grand@customer.example>" }),
    );
    const reply = await h.receive.run(
      email({
        sourceMessageId: "src-2",
        messageId: "<msg-2@customer.example>",
        // The matching ancestor is not the first element.
        references: [
          "<unrelated@customer.example>",
          "<grand@customer.example>",
        ],
        subject: "Re: Oven clean",
      }),
    );
    expect(reply.conversationId).toBe(original.conversationId);
    expect(h.conversations.rows).toHaveLength(1);
  });

  it("never threads on subject alone: same subject, different sender, no refs", async () => {
    const h = harness();
    const first = await h.receive.run(email());
    const unrelated = await h.receive.run(
      email({
        sourceMessageId: "src-2",
        messageId: "<other@elsewhere.example>",
        from: { address: "alex@example.test", name: "Alex" },
      }),
    );
    expect(unrelated.conversationId).not.toBe(first.conversationId);
    expect(h.conversations.rows).toHaveLength(2);
    expect(h.conversations.rows[1]?.fromAddress).toBe("alex@example.test");
  });

  it("threads only within the same mailbox", async () => {
    const h = harness();
    // A message in another mailbox reusing the same RFC id must not match.
    const foreign = email({ sourceMessageId: "src-foreign" });
    h.messages.rows.push({
      id: "ulid-foreign",
      organizationId: ORG,
      mailboxId: "mb_other",
      conversationId: "ulid-foreign-conversation",
      direction: "inbound",
      sourceMessageId: foreign.sourceMessageId,
      messageId: "<shared@customer.example>",
      inReplyTo: null,
      references: null,
      fromAddress: foreign.from.address,
      fromName: null,
      to: [...foreign.to],
      cc: null,
      replyTo: null,
      subject: foreign.subject ?? null,
      text: foreign.text ?? null,
      html: null,
      attachments: null,
      receivedAt: foreign.receivedAt,
      sentAt: null,
    });
    const mine = await h.receive.run(
      email({ inReplyTo: "<shared@customer.example>" }),
    );
    // No reliable match in this mailbox ⇒ a new conversation.
    expect(mine.conversationId).not.toBe("ulid-foreign-conversation");
    expect(h.conversations.rows).toHaveLength(1);
  });

  it("replays the same (mailboxId, sourceMessageId) idempotently", async () => {
    const h = harness();
    const first = await h.receive.run(email());
    const replay = await h.receive.run(email());
    expect(replay).toEqual({
      messageId: first.messageId,
      conversationId: first.conversationId,
      duplicate: true,
      processing: "ready",
    });
    expect(h.messages.rows).toHaveLength(1);
    expect(h.conversations.rows).toHaveLength(1);
  });

  it("rejects a mailbox mismatch as a validation error", async () => {
    const h = harness();
    await expect(
      h.receive.run(email({ mailboxId: "mb_someone_elses" })),
    ).rejects.toBeInstanceOf(InboundValidationError);
    expect(h.messages.rows).toHaveLength(0);
  });

  it("rejects malformed DTOs", async () => {
    const h = harness();
    await expect(
      h.receive.run(email({ sourceMessageId: "" })),
    ).rejects.toBeInstanceOf(InboundValidationError);
    await expect(
      h.receive.run(email({ from: { address: "" } })),
    ).rejects.toBeInstanceOf(InboundValidationError);
    await expect(
      h.receive.run(email({ receivedAt: "not-a-date" })),
    ).rejects.toBeInstanceOf(InboundValidationError);
    await expect(h.receive.run(email({ to: [""] }))).rejects.toBeInstanceOf(
      InboundValidationError,
    );
    expect(h.messages.rows).toHaveLength(0);
    expect(h.conversations.rows).toHaveLength(0);
  });
});

describe("ListInbox", () => {
  it("lists newest activity first with pending processing and a text preview", async () => {
    const h = harness();
    const older = await h.receive.run(
      email({
        sourceMessageId: "src-1",
        receivedAt: "2025-06-01T00:00:00.000Z",
      }),
    );
    const newer = await h.receive.run(
      email({
        sourceMessageId: "src-2",
        from: { address: "jo@example.test" },
        receivedAt: "2025-06-02T00:00:00.000Z",
      }),
    );

    const page = await h.listInbox.run(ORG);
    expect(page.items.map((item) => item.conversationId)).toEqual([
      newer.conversationId,
      older.conversationId,
    ]);
    const item = page.items[0];
    expect(item).toMatchObject({
      conversationId: newer.conversationId,
      from: { address: "jo@example.test" },
      lane: "quote",
      processing: "ready",
      urgent: false,
      automationPaused: false,
      latestAt: "2025-06-02T00:00:00.000Z",
      preview: "Hi, how much for an oven clean?",
    });
    expect(item.lane).toBe("quote");
  });

  it("collapses whitespace and truncates the preview at 140 characters", async () => {
    const h = harness();
    await h.receive.run(
      email({
        text: `line one\n\n${"a".repeat(200)}`,
      }),
    );
    const page = await h.listInbox.run(ORG);
    // 9 chars of "line one " + 131 a's + ellipsis = 141.
    expect(page.items[0]?.preview).toBe(`line one ${"a".repeat(131)}…`);
  });
});

describe("GetThread", () => {
  it("returns the conversation snapshot and plain-text messages only", async () => {
    const h = harness();
    const first = await h.receive.run(
      email({ html: "<p>Hi, how much for an oven clean?</p>" }),
    );
    await h.receive.run(
      email({
        sourceMessageId: "src-2",
        messageId: "<msg-2@customer.example>",
        inReplyTo: "<msg-1@customer.example>",
        subject: "Re: Oven clean",
        text: "Any chance of Saturday?",
      }),
    );

    const thread = await h.getThread.run(ORG, first.conversationId);
    expect(thread?.conversation).toEqual({
      id: first.conversationId,
      customer: { address: "sam@example.test", name: "Sam" },
      subject: "Oven clean",
      automationPaused: false,
    });
    expect(thread?.messages).toHaveLength(2);
    expect(thread?.messages[0]).toEqual({
      id: first.messageId,
      direction: "inbound",
      at: "2025-06-01T00:00:00.000Z",
      from: "sam@example.test",
      subject: "Oven clean",
      text: "Hi, how much for an oven clean?",
    });
    expect(thread?.messages[1]?.text).toBe("Any chance of Saturday?");
    // HTML is stored but never returned to the UI.
    expect(thread?.messages.every((message) => !("html" in message))).toBe(
      true,
    );
    // Processing comes from the latest revision of the latest message.
    expect(thread?.processing).toEqual({
      status: "ready",
      lane: "quote",
      summary: "Quote request",
    });
  });

  it("resolves an unknown conversation to undefined", async () => {
    const h = harness();
    expect(await h.getThread.run(ORG, "ulid-nope")).toBeUndefined();
  });
});

describe("ingress hardening (carried notes 6-8)", () => {
  it("note 7: normalizes +10:00 receivedAt/sentAt to UTC ISO before storing", async () => {
    const h = harness();
    await h.receive.run(
      email({
        sourceMessageId: "src-offset",
        receivedAt: "2025-06-01T10:00:00.000+10:00",
        sentAt: "2025-06-01T09:59:00.000+10:00",
      }),
    );
    const stored = h.messages.rows.find(
      (row) => row.sourceMessageId === "src-offset",
    );
    expect(stored?.receivedAt).toBe("2025-06-01T00:00:00.000Z");
    expect(stored?.sentAt).toBe("2025-05-31T23:59:00.000Z");
  });

  it("note 8: rejects non-string values for the optional free-text fields", async () => {
    const h = harness();
    const nonStrings = [
      { subject: 42 },
      { text: 42 },
      { html: 42 },
      { replyTo: 42 },
      { messageId: 42 },
      { inReplyTo: 42 },
      // Non-strings are exactly what note 8 rejects; the cast keeps the
      // compiler from enforcing the DTO on deliberately-invalid input.
    ] as unknown as Array<Partial<InboundEmail>>;
    for (const override of nonStrings) {
      await expect(h.receive.run(email(override))).rejects.toBeInstanceOf(
        InboundValidationError,
      );
    }
    expect(h.messages.rows).toHaveLength(0);
    expect(h.conversations.rows).toHaveLength(0);
  });

  it("note 6 + 9: a lost insert race reports duplicate and deletes the orphan conversation", async () => {
    const h = harness();
    // Simulates the unique-index violation the loser of a concurrent
    // duplicate receives: the initial lookup misses, the insert throws.
    await h.receive.run(email({ sourceMessageId: "src-race" }));
    const original = h.messages.rows[0];
    const racing = new FakeMessages();
    let lookedUp = false;
    racing.findBySourceKey = async (mailboxId: string, sourceId: string) => {
      // First lookup misses (the race); the post-violation re-check hits.
      if (lookedUp) {
        return h.messages.findBySourceKey(mailboxId, sourceId);
      }
      lookedUp = true;
      return undefined;
    };
    racing.listByConversation = (
      organizationId: string,
      conversationId: string,
    ) => h.messages.listByConversation(organizationId, conversationId);
    racing.insertMessage = async () => {
      // The insert lost the race: nothing is stored, the index throws.
      throw new Error("UNIQUE constraint failed: messages.mailbox_id");
    };
    const raceHarness = new ReceiveInboundEmail({
      conversations: h.conversations,
      messages: racing,
      revisions: h.revisions,
      profile: new FakeProfile({
        id: ORG,
        name: "Harbour & Pine Cleaning",
        timezone: "Australia/Sydney",
        currency: "AUD",
        fromAddress: "hello@harbourandpine.example",
        quoteValidityDays: 14,
        taxMode: "exclusive",
        mailboxId: MAILBOX,
      }),
      processing: h.processing,
      // Distinct ids so the loser's orphan conversation cannot collide with
      // the winner's conversation id in the fake.
      ids: {
        nextId: (() => {
          let seq = 100;
          return () => {
            seq += 1;
            return `ulid-race-${seq}`;
          };
        })(),
      },
      clock: new FixedClock(),
    });
    const conversationsBefore = h.conversations.rows.length;
    const result = await raceHarness.run(
      email({ sourceMessageId: "src-race" }),
    );
    expect(result).toEqual({
      messageId: original.id,
      conversationId: original.conversationId,
      duplicate: true,
      processing: "ready",
    });
    // Note 9: the loser's just-created conversation had no messages and
    // was deleted — the inbox keeps exactly the winner's conversation.
    expect(h.conversations.rows).toHaveLength(conversationsBefore);
    expect(
      h.conversations.rows.every((row) => row.id === original.conversationId),
    ).toBe(true);
    // No phantom message from the losing insert.
    expect(h.messages.rows).toHaveLength(1);
  });
});
