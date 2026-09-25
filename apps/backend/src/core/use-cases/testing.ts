/**
 * Shared fake ports and harnesses for the messaging/processing use-case
 * specs. Fakes only: no database, no adapters, no framework imports
 * (docs/ARCHITECTURE.md "Use cases: fakes/in-memory adapters; no network").
 */
import type { KnowledgeBase, OrganizationProfile } from "../domain/config";
import type { DraftRevision } from "../domain/drafting";
import type {
  Conversation,
  InboundEmail,
  Lane,
  StoredMessage,
} from "../domain/messaging";
import type { AuditEvent, OutboxEntry, OutboxItem } from "../domain/outbox";
import type {
  Classification,
  ClassifierInput,
  ProcessingRevision,
} from "../domain/processing";
import { ClassifierError } from "../domain/processing";
import type { AuditEventRepository } from "../ports/audit-event-repository";
import type { ClassifierPort } from "../ports/classifier";
import type { Clock } from "../ports/clock";
import type { ConversationRepository } from "../ports/conversation-repository";
import type { DraftRevisionRepository } from "../ports/draft-revision-repository";
import type { DrafterPort } from "../ports/drafter";
import type { IdGenerator } from "../ports/id-generator";
import type { KnowledgeBaseRepository } from "../ports/knowledge-base-repository";
import type { MessageRepository } from "../ports/message-repository";
import type { OrganizationProfileRepository } from "../ports/organization-profile-repository";
import type { OutboxRepository } from "../ports/outbox-repository";
import type { ProcessingRevisionRepository } from "../ports/processing-revision-repository";
import type {
  TransactionScopedRepositories,
  UnitOfWork,
} from "../ports/unit-of-work";
import { GetThread } from "./get-thread";
import { ListInbox } from "./list-inbox";
import { ListOutbox } from "./list-outbox";
import { ProcessInboundMessage } from "./process-inbound-message";
import { ReceiveInboundEmail } from "./receive-inbound-email";
import { ReviewDraft } from "./review-draft";
import { SendApprovedDraft } from "./send-approved-draft";
import { TakeOverConversation } from "./take-over-conversation";

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
    {
      id: "kb_areas",
      tags: ["areas", "suburbs"],
      text: "We serve Balmain and Rozelle.",
    },
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

/** Trivial constant drafter double — same wording every call. */
export class ConstantDrafter implements DrafterPort {
  async draft(): Promise<{ greeting?: string; closing?: string }> {
    return { greeting: "Hi,", closing: "Thanks," };
  }
}

export class FakeDraftRevisions implements DraftRevisionRepository {
  readonly rows: DraftRevision[] = [];

  insertDraft(revision: DraftRevision): Promise<void> {
    this.rows.push({ ...revision });
    return Promise.resolve();
  }

  findById(
    organizationId: string,
    revisionId: string,
  ): Promise<DraftRevision | undefined> {
    return Promise.resolve(
      this.rows.find(
        (row) => row.organizationId === organizationId && row.id === revisionId,
      ),
    );
  }

  supersede(organizationId: string, revisionId: string): Promise<void> {
    const row = this.row(organizationId, revisionId);
    Object.assign(row, { status: "superseded" as const });
    return Promise.resolve();
  }

  supersedeProcessingProposed(
    organizationId: string,
    conversationId: string,
  ): Promise<number> {
    let count = 0;
    for (const row of this.rows) {
      if (
        row.organizationId === organizationId &&
        row.conversationId === conversationId &&
        row.origin === "processing" &&
        row.status === "proposed"
      ) {
        Object.assign(row, { status: "superseded" as const });
        count += 1;
      }
    }
    return Promise.resolve(count);
  }

  updateStatus(
    organizationId: string,
    revisionId: string,
    from: "proposed" | "approved",
    to: "approved" | "discarded",
  ): Promise<boolean> {
    const row = this.row(organizationId, revisionId);
    if (row.status !== from) {
      return Promise.resolve(false);
    }
    Object.assign(row, { status: to });
    return Promise.resolve(true);
  }

  consume(
    organizationId: string,
    revisionId: string,
    outboundMessageId: string,
    updatedAt: string,
  ): Promise<boolean> {
    const row = this.row(organizationId, revisionId);
    if (row.status !== "approved" || row.outboundMessageId !== null) {
      return Promise.resolve(false);
    }
    Object.assign(row, {
      status: "consumed" as const,
      outboundMessageId,
      updatedAt,
    });
    return Promise.resolve(true);
  }

  findLatestByConversation(
    organizationId: string,
    conversationId: string,
  ): Promise<DraftRevision | undefined> {
    const rows = this.rows
      .filter(
        (row) =>
          row.organizationId === organizationId &&
          row.conversationId === conversationId,
      )
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      );
    return Promise.resolve(rows.at(-1));
  }

  private row(organizationId: string, revisionId: string): DraftRevision {
    const row = this.rows.find(
      (candidate) =>
        candidate.organizationId === organizationId &&
        candidate.id === revisionId,
    );
    if (!row) {
      throw new Error(`no draft revision ${revisionId}`);
    }
    return row;
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

  deleteById(organizationId: string, conversationId: string): Promise<void> {
    const index = this.rows.findIndex(
      (row) =>
        row.organizationId === organizationId && row.id === conversationId,
    );
    if (index >= 0) {
      this.rows.splice(index, 1);
    }
    return Promise.resolve();
  }
  setAutomationPaused(
    organizationId: string,
    conversationId: string,
    paused: boolean,
  ): Promise<boolean> {
    const row = this.rows.find(
      (candidate) =>
        candidate.organizationId === organizationId &&
        candidate.id === conversationId,
    );
    if (!row) {
      return Promise.resolve(false);
    }
    Object.assign(row, { automationPaused: paused });
    return Promise.resolve(true);
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

export class FakeOutbox implements OutboxRepository {
  readonly rows: OutboxEntry[] = [];

  insertOutbox(entry: OutboxEntry): Promise<void> {
    this.rows.push({ ...entry });
    return Promise.resolve();
  }

  listByOrganization(organizationId: string): Promise<OutboxItem[]> {
    const items = this.rows
      .filter((row) => row.organizationId === organizationId)
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) ||
          right.id.localeCompare(left.id),
      )
      .map((row) => ({
        messageId: row.messageId,
        conversationId: row.conversationId,
        recipient: row.recipient,
        status: row.status,
        attempts: row.attempts,
        lastError: row.lastError,
        createdAt: row.createdAt,
      }));
    return Promise.resolve(items);
  }
}

export class FakeAuditEvents implements AuditEventRepository {
  readonly rows: AuditEvent[] = [];

  insertEvent(event: AuditEvent): Promise<void> {
    this.rows.push(event);
    return Promise.resolve();
  }
}

/** UnitOfWork double: no transaction, the same fake repositories. */
export class FakeUnitOfWork implements UnitOfWork {
  constructor(private readonly repos: TransactionScopedRepositories) {}

  run<T>(fn: (repos: TransactionScopedRepositories) => Promise<T>): Promise<T> {
    return fn(this.repos);
  }
}

export function harness() {
  const conversations = new FakeConversations();
  const messages = new FakeMessages();
  const revisions = new FakeProcessingRevisions();
  const drafts = new FakeDraftRevisions();
  const drafter = new ConstantDrafter();
  const outbox = new FakeOutbox();
  const audit = new FakeAuditEvents();
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
  // One shared id generator: ids stay unique across use cases so a draft
  // id can never collide with a message or audit id in a test.
  const ids = new SequentialIds();
  const clock = new FixedClock();
  // Default classification: the "how much" fixture reads as a quote.
  const classifier = new ScriptedClassifier(classificationOf("quote"));
  const knowledgeBase = new FakeKnowledgeBase();
  const processing = new ProcessInboundMessage({
    messages,
    conversations,
    revisions,
    drafts,
    classifier,
    drafter,
    knowledgeBase,
    ids,
    clock,
  });
  const receive = new ReceiveInboundEmail({
    conversations,
    messages,
    revisions,
    profile,
    processing,
    ids,
    clock,
  });
  const listInbox = new ListInbox({ conversations, messages, revisions });
  const getThread = new GetThread({
    conversations,
    messages,
    revisions,
    drafts,
  });
  const unitOfWork = new FakeUnitOfWork({
    messages,
    drafts,
    outbox,
    audit,
  });
  const sendDraft = new SendApprovedDraft({
    conversations,
    drafts,
    profile,
    unitOfWork,
    ids,
    clock,
  });
  const reviewDraft = new ReviewDraft({
    drafts,
    audit,
    ids,
    clock,
  });
  const takeOver = new TakeOverConversation({
    conversations,
    audit,
    ids,
    clock,
  });
  const listOutbox = new ListOutbox(outbox);
  return {
    conversations,
    messages,
    revisions,
    drafts,
    drafter,
    outbox,
    audit,
    classifier,
    knowledgeBase,
    processing,
    receive,
    listInbox,
    getThread,
    sendDraft,
    reviewDraft,
    takeOver,
    listOutbox,
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
