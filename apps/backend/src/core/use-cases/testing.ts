/**
 * Shared fake ports and harnesses for the messaging/processing use-case
 * specs. Fakes only: no database, no adapters, no framework imports
 * (docs/ARCHITECTURE.md "Use cases: fakes/in-memory adapters; no network").
 */
import type { KnowledgeBase, OrganizationProfile } from "../domain/config";
import type {
  Conversation,
  InboundEmail,
  Lane,
  StoredMessage,
} from "../domain/messaging";
import type {
  Classification,
  ClassifierInput,
  ProcessingRevision,
} from "../domain/processing";
import { ClassifierError } from "../domain/processing";
import type { ClassifierPort } from "../ports/classifier";
import type { Clock } from "../ports/clock";
import type { ConversationRepository } from "../ports/conversation-repository";
import type { IdGenerator } from "../ports/id-generator";
import type { KnowledgeBaseRepository } from "../ports/knowledge-base-repository";
import type { MessageRepository } from "../ports/message-repository";
import type { OrganizationProfileRepository } from "../ports/organization-profile-repository";
import type { ProcessingRevisionRepository } from "../ports/processing-revision-repository";
import { GetThread } from "./get-thread";
import { ListInbox } from "./list-inbox";
import { ProcessInboundMessage } from "./process-inbound-message";
import { ReceiveInboundEmail } from "./receive-inbound-email";

export const ORG = "org_harbour_pine";
export const MAILBOX = "mb_main";
export const NOW = "2025-06-01T00:00:00.000Z";

/** Classification fixture for a lane; the fake adapter maps words to these. */
export function classificationOf(
  lane: Lane,
  confidence: "high" | "low" = "high",
): Classification {
  switch (lane) {
    case "complaint":
      return { lane, confidence, summary: "Customer complaint" };
    case "quote_reply":
      return {
        lane,
        confidence,
        quoteReply: { intent: "unclear" },
        summary: "Quote reply (unclear)",
      };
    case "service":
      return {
        lane,
        confidence,
        service: {
          request: "Oven clean",
          supplied: [],
          missing: [],
          nextAction: "Reply to the customer to arrange the service.",
        },
        summary: "Service request",
      };
    case "faq":
      return {
        lane,
        confidence,
        faqFactIds: ["kb_hours"],
        summary: "Question about our service details",
      };
    case "noise":
      return { lane, confidence, summary: "Automated or non-human mail" };
    default:
      return { lane, confidence, summary: "Quote request" };
  }
}

/** Scriptable classifier double: returns queued (or default) classifications. */
export class ScriptedClassifier implements ClassifierPort {
  readonly calls: ClassifierInput[] = [];
  private queued: Classification | "throw" | undefined;

  constructor(private readonly fallback: Classification) {}

  /** Next classify() call returns this (or throws for "throw"). */
  script(next: Classification | "throw"): void {
    this.queued = next;
  }

  async classify(input: ClassifierInput): Promise<Classification> {
    this.calls.push(input);
    if (this.queued === "throw") {
      this.queued = undefined;
      throw new ClassifierError("classifier timeout");
    }
    const classification = this.queued ?? this.fallback;
    this.queued = undefined;
    return classification;
  }
}

export const KNOWLEDGE_BASE: KnowledgeBase = {
  version: "kb-1",
  blocks: [
    { id: "kb_hours", tags: ["hours", "open"], text: "We clean Mon to Fri." },
  ],
};

export class FakeKnowledgeBase implements KnowledgeBaseRepository {
  getKnowledgeBase(): KnowledgeBase {
    return KNOWLEDGE_BASE;
  }
}

export class FakeProcessingRevisions implements ProcessingRevisionRepository {
  readonly rows: ProcessingRevision[] = [];

  insertRevision(revision: ProcessingRevision): Promise<void> {
    this.rows.push({ ...revision });
    return Promise.resolve();
  }

  completeRevision(
    id: string,
    result: {
      status: "ready" | "needs_human" | "failed";
      lane: ProcessingRevision["lane"];
      summary: ProcessingRevision["summary"];
      classification: ProcessingRevision["classification"];
      error: ProcessingRevision["error"];
    },
  ): Promise<void> {
    const row = this.rows.find((revision) => revision.id === id);
    if (!row) {
      throw new Error(`no revision ${id}`);
    }
    Object.assign(row, result);
    return Promise.resolve();
  }

  findLatestByMessage(
    organizationId: string,
    messageId: string,
  ): Promise<ProcessingRevision | undefined> {
    const rows = this.rows
      .filter(
        (row) =>
          row.organizationId === organizationId && row.messageId === messageId,
      )
      .sort((left, right) => left.revisionNumber - right.revisionNumber);
    return Promise.resolve(rows.at(-1));
  }

  findLatestPerMessage(organizationId: string): Promise<ProcessingRevision[]> {
    const latest = new Map<string, ProcessingRevision>();
    for (const row of this.rows.filter(
      (revision) => revision.organizationId === organizationId,
    )) {
      const current = latest.get(row.messageId);
      if (!current || row.revisionNumber > current.revisionNumber) {
        latest.set(row.messageId, row);
      }
    }
    return Promise.resolve([...latest.values()]);
  }
}

export class FixedClock implements Clock {
  now(): Date {
    return new Date(NOW);
  }
}

export class SequentialIds implements IdGenerator {
  private seq = 0;
  nextId(): string {
    this.seq += 1;
    return `ulid-${this.seq}`;
  }
}

export class FakeConversations implements ConversationRepository {
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

export class FakeMessages implements MessageRepository {
  readonly rows: StoredMessage[] = [];

  insertMessage(message: StoredMessage): Promise<void> {
    this.rows.push(message);
    return Promise.resolve();
  }

  findById(
    organizationId: string,
    messageId: string,
  ): Promise<StoredMessage | undefined> {
    return Promise.resolve(
      this.rows.find(
        (row) => row.organizationId === organizationId && row.id === messageId,
      ),
    );
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

export class FakeProfile implements OrganizationProfileRepository {
  constructor(private readonly profile: OrganizationProfile) {}
  getProfile(): OrganizationProfile {
    return this.profile;
  }
}

export function harness() {
  const conversations = new FakeConversations();
  const messages = new FakeMessages();
  const revisions = new FakeProcessingRevisions();
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
  // Default classification: the "how much" fixture reads as a quote.
  const classifier = new ScriptedClassifier(classificationOf("quote"));
  const knowledgeBase = new FakeKnowledgeBase();
  const processing = new ProcessInboundMessage({
    messages,
    revisions,
    classifier,
    knowledgeBase,
    ids: new SequentialIds(),
    clock: new FixedClock(),
  });
  const receive = new ReceiveInboundEmail({
    conversations,
    messages,
    revisions,
    profile,
    processing,
    ids: new SequentialIds(),
    clock: new FixedClock(),
  });
  const listInbox = new ListInbox({ conversations, messages, revisions });
  const getThread = new GetThread({ conversations, messages, revisions });
  return {
    conversations,
    messages,
    revisions,
    classifier,
    knowledgeBase,
    processing,
    receive,
    listInbox,
    getThread,
  };
}

/** A minimal valid inbound email; override per test. */
export function email(overrides: Partial<InboundEmail> = {}): InboundEmail {
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

/** A stored outbound message with an RFC Message-ID (quote-reply context). */
export function outboundFixture(): StoredMessage {
  return {
    id: "ulid-outbound-1",
    organizationId: ORG,
    mailboxId: MAILBOX,
    conversationId: "ulid-outbound-conversation",
    direction: "outbound",
    sourceMessageId: "src-outbound-1",
    messageId: "<quote-1@harbourandpine.example>",
    inReplyTo: null,
    references: null,
    fromAddress: "hello@harbourandpine.example",
    fromName: null,
    to: ["sam@example.test"],
    cc: null,
    replyTo: null,
    subject: "Your quote",
    text: "Here is your quote.",
    html: null,
    attachments: null,
    receivedAt: NOW,
    sentAt: NOW,
  };
}
