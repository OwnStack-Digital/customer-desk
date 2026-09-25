import { describe, expect, it } from "vitest";
import type { OrganizationProfile } from "../domain/config";
import type {
  Conversation,
  InboundEmail,
  StoredMessage,
} from "../domain/messaging";
import { InboundValidationError } from "../domain/messaging";
import type { Clock } from "../ports/clock";
import type { ConversationRepository } from "../ports/conversation-repository";
import type { IdGenerator } from "../ports/id-generator";
import type { MessageRepository } from "../ports/message-repository";
import type { OrganizationProfileRepository } from "../ports/organization-profile-repository";
import { GetThread } from "./get-thread";
import { ListInbox } from "./list-inbox";
import { ReceiveInboundEmail } from "./receive-inbound-email";

const ORG = "org_harbour_pine";
const MAILBOX = "mb_main";
const NOW = "2025-06-01T00:00:00.000Z";

class FixedClock implements Clock {
  now(): Date {
    return new Date(NOW);
  }
}

class SequentialIds implements IdGenerator {
  private seq = 0;
  nextId(): string {
    this.seq += 1;
    return `ulid-${this.seq}`;
  }
}

class FakeConversations implements ConversationRepository {
  readonly rows: Conversation[] = [];

  insertConversation(conversation: Conversation): Promise<void> {
    this.rows.push(conversation);
    return Promise.resolve();
  }

  findById(
    organizationId: string,
    conversationId: string,
  ): Promise<Conversation | undefined> {
    return Promise.resolve(
      this.rows.find(
        (row) =>
          row.organizationId === organizationId && row.id === conversationId,
      ),
    );
  }

  listByOrganization(organizationId: string): Promise<Conversation[]> {
    return Promise.resolve(
      this.rows.filter((row) => row.organizationId === organizationId),
    );
  }
}

class FakeMessages implements MessageRepository {
  readonly rows: StoredMessage[] = [];

  insertMessage(message: StoredMessage): Promise<void> {
    this.rows.push(message);
    return Promise.resolve();
  }

  findBySourceKey(
    mailboxId: string,
    sourceMessageId: string,
  ): Promise<StoredMessage | undefined> {
    return Promise.resolve(
      this.rows.find(
        (row) =>
          row.mailboxId === mailboxId &&
          row.sourceMessageId === sourceMessageId &&
          row.direction === "inbound",
      ),
    );
  }

  findByRfcMessageId(
    mailboxId: string,
    rfcMessageId: string,
  ): Promise<StoredMessage | undefined> {
    return Promise.resolve(
      this.rows.find(
        (row) => row.mailboxId === mailboxId && row.messageId === rfcMessageId,
      ),
    );
  }

  findLatestPerConversation(organizationId: string): Promise<StoredMessage[]> {
    const latest = new Map<string, StoredMessage>();
    for (const message of this.rows) {
      if (message.organizationId !== organizationId) {
        continue;
      }
      const current = latest.get(message.conversationId);
      if (
        !current ||
        message.receivedAt > current.receivedAt ||
        (message.receivedAt === current.receivedAt && message.id > current.id)
      ) {
        latest.set(message.conversationId, message);
      }
    }
    return Promise.resolve([...latest.values()]);
  }

  listByConversation(
    organizationId: string,
    conversationId: string,
  ): Promise<StoredMessage[]> {
    return Promise.resolve(
      this.rows
        .filter(
          (row) =>
            row.organizationId === organizationId &&
            row.conversationId === conversationId,
        )
        .sort(
          (left, right) =>
            left.receivedAt.localeCompare(right.receivedAt) ||
            left.id.localeCompare(right.id),
        ),
    );
  }
}

class FakeProfile implements OrganizationProfileRepository {
  constructor(private readonly profile: OrganizationProfile) {}
  getProfile(): OrganizationProfile {
    return this.profile;
  }
}

function harness() {
  const conversations = new FakeConversations();
  const messages = new FakeMessages();
  const profile = new FakeProfile({
    id: ORG,
    name: "Harbour & Pine Cleaning",
    timezone: "Australia/Sydney",
    currency: "AUD",
    fromAddress: "hello@harbourandpine.example",
    quoteValidityDays: 14,
    taxMode: "exclusive",
    mailboxId: MAILBOX,
  });
  const receive = new ReceiveInboundEmail({
    conversations,
    messages,
    profile,
    ids: new SequentialIds(),
    clock: new FixedClock(),
  });
  const listInbox = new ListInbox({ conversations, messages });
  const getThread = new GetThread({ conversations, messages });
  return { conversations, messages, receive, listInbox, getThread };
}

/** A minimal valid inbound email; override per test. */
function email(overrides: Partial<InboundEmail> = {}): InboundEmail {
  return {
    mailboxId: MAILBOX,
    sourceMessageId: "src-1",
    messageId: "<msg-1@customer.example>",
    from: { address: "sam@example.test", name: "Sam" },
    to: [`${MAILBOX}@harbourandpine.example`],
    subject: "Oven clean",
    text: "Hi, how much for an oven clean?",
    receivedAt: "2025-06-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ReceiveInboundEmail", () => {
  it("stores a new email and creates the conversation snapshot", async () => {
    const h = harness();
    const result = await h.receive.run(email());
    expect(result).toEqual({
      messageId: "ulid-2",
      conversationId: "ulid-1",
      duplicate: false,
      processing: "pending",
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
      processing: "pending",
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
      processing: "pending",
      urgent: false,
      automationPaused: false,
      latestAt: "2025-06-02T00:00:00.000Z",
      preview: "Hi, how much for an oven clean?",
    });
    expect(Object.keys(item)).not.toContain("lane");
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
  });

  it("resolves an unknown conversation to undefined", async () => {
    const h = harness();
    expect(await h.getThread.run(ORG, "ulid-nope")).toBeUndefined();
  });
});
