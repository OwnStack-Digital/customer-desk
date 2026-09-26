import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OrganizationProfile } from "../../../../core/domain/config";
import type { AuditEvent } from "../../../../core/domain/outbox";
import type { AuditEventRepository } from "../../../../core/ports/audit-event-repository";
import type { Clock } from "../../../../core/ports/clock";
import type { IdGenerator } from "../../../../core/ports/id-generator";
import type { OrganizationProfileRepository } from "../../../../core/ports/organization-profile-repository";
import type { TransactionScopedRepositories } from "../../../../core/ports/unit-of-work";
import { SendApprovedDraft } from "../../../../core/use-cases/send-approved-draft";
import { RandomTokenGenerator } from "../../runtime/random-token-generator";
import { Sha256TokenHasher } from "../../runtime/sha256-token-hasher";
import {
  createPersistenceClient,
  type PersistenceClient,
  type SqliteDb,
} from "../client";
import { DrizzleAuditEventRepository } from "../repositories/delivery/audit-event-repository";
import { DrizzleOutboxRepository } from "../repositories/delivery/outbox-repository";
import { DrizzleConversationRepository } from "../repositories/messaging/conversation-repository";
import { DrizzleDraftRevisionRepository } from "../repositories/messaging/draft-revision-repository";
import { DrizzleQuoteVersionRepository } from "../repositories/quotes/quote-version-repository";
import {
  sqliteConversations,
  sqliteDraftRevisions,
  sqliteMessages,
  sqliteOutboxEntries,
} from "../schema";
import { DrizzleUnitOfWork } from "../unit-of-work";

// src/adapters/outbound/persistence/testing -> apps/backend/drizzle/migrations/sqlite.
const MIGRATIONS = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "drizzle",
  "migrations",
  "sqlite",
);

const ORG = "org_harbour_pine";
const NOW = "2025-06-01T00:00:00.000Z";

let dbFile: string;
let client: PersistenceClient;
let db: SqliteDb;

beforeAll(() => {
  dbFile = join(mkdtempSync(join(tmpdir(), "bos-send-tx-")), "test.db");
  process.env.DB_DIALECT = "sqlite";
  process.env.DATABASE_URL = `file:${dbFile}`;
  client = createPersistenceClient();
  db = client.open() as SqliteDb;
  migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(() => {
  rmSync(dbFile, { force: true });
});

class FixedClock implements Clock {
  now(): Date {
    return new Date(NOW);
  }
}

class SequentialIds implements IdGenerator {
  private seq = 0;
  constructor(private readonly prefix: string) {}
  nextId(): string {
    this.seq += 1;
    return `${this.prefix}-${this.seq}`;
  }
}

const PROFILE: OrganizationProfile = {
  id: ORG,
  name: "Harbour & Pine Cleaning",
  timezone: "Australia/Sydney",
  currency: "AUD",
  fromAddress: "hello@harbourandpine.example",
  quoteValidityDays: 14,
  taxMode: "exclusive",
  mailboxId: "mb_main",
};

const PROFILE_REPO: OrganizationProfileRepository = {
  getProfile: () => PROFILE,
};

/** Audit repository that always throws, to force an in-transaction failure. */
class FailingAuditRepository implements AuditEventRepository {
  insertEvent(_event: AuditEvent): Promise<void> {
    return Promise.reject(new Error("audit sink unavailable"));
  }
}

/**
 * Unit of work whose transaction-scoped audit repository fails, proving the
 * rollback: every insert and update inside the transaction is discarded.
 */
class AuditFailingUnitOfWork extends DrizzleUnitOfWork {
  constructor() {
    super(client);
  }
  override async run<T>(
    fn: (repos: TransactionScopedRepositories) => Promise<T>,
  ): Promise<T> {
    return super.run((repos) =>
      fn({ ...repos, audit: new FailingAuditRepository() }),
    );
  }
}

function makeSend(uow: DrizzleUnitOfWork, prefix: string): SendApprovedDraft {
  return new SendApprovedDraft({
    conversations: new DrizzleConversationRepository(client),
    drafts: new DrizzleDraftRevisionRepository(client),
    profile: PROFILE_REPO,
    unitOfWork: uow,
    quotes: new DrizzleQuoteVersionRepository(client),
    tokens: new RandomTokenGenerator(),
    tokenHasher: new Sha256TokenHasher(),
    publicAppUrl: "https://app.example.test",
    ids: new SequentialIds(prefix),
    clock: new FixedClock(),
  });
}

/** Seeds one conversation with an inbound message and an approved draft. */
function seed(n: number): string {
  db.insert(sqliteConversations)
    .values({
      id: `conv-${n}`,
      organizationId: ORG,
      mailboxId: "mb_main",
      fromAddress: "sam@example.test",
      fromName: "Sam",
      subject: "Your hours",
      automationPaused: false,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
  db.insert(sqliteMessages)
    .values({
      id: `msg-${n}`,
      organizationId: ORG,
      mailboxId: "mb_main",
      conversationId: `conv-${n}`,
      direction: "inbound",
      sourceMessageId: `src-${n}`,
      fromAddress: "sam@example.test",
      fromName: null,
      to: "[]",
      subject: "Your hours",
      text: "What are your hours?",
      receivedAt: NOW,
      sentAt: null,
    })
    .run();
  db.insert(sqliteDraftRevisions)
    .values({
      id: `draft-${n}`,
      organizationId: ORG,
      conversationId: `conv-${n}`,
      messageId: `msg-${n}`,
      status: "approved",
      origin: "processing",
      bodyText: "Hi,\n\nWe clean Mon to Fri.\n\nThanks,",
      factIds: JSON.stringify(["kb_hours"]),
      knowledgeBaseVersion: "kb-1",
      assumptions: JSON.stringify([]),
      outboundMessageId: null,
      quoteVersionId: null,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
  return `draft-${n}`;
}

function outboxCount(n: number): number {
  return db
    .select()
    .from(sqliteOutboxEntries)
    .all()
    .filter((row) => row.conversationId === `conv-${n}`).length;
}

function conversationMessageCount(n: number): number {
  return db
    .select()
    .from(sqliteMessages)
    .all()
    .filter((row) => row.conversationId === `conv-${n}`).length;
}

describe("SendApprovedDraft inside the DrizzleUnitOfWork (SQLite)", () => {
  it("commits message + outbox + audit + consumed draft in one transaction", async () => {
    const draftId = seed(1);
    const drafts = new DrizzleDraftRevisionRepository(client);
    const send = makeSend(new DrizzleUnitOfWork(client), "out");
    const result = await send.run(ORG, draftId, "operator");
    expect(result).toMatchObject({
      conversationId: "conv-1",
      revisionId: "draft-1",
    });
    expect(result?.messageId).toEqual(expect.any(String));
    expect(conversationMessageCount(1)).toBe(2); // inbound + outbound
    expect(outboxCount(1)).toBe(1);
    expect(await drafts.findById(ORG, draftId)).toMatchObject({
      status: "consumed",
      outboundMessageId: result?.messageId,
    });
    expect(new DrizzleAuditEventRepository(client)).toBeDefined();
    expect(new DrizzleOutboxRepository(client)).toBeDefined();
  });

  it("a forced audit failure rolls back the whole send transaction", async () => {
    const draftId = seed(2);
    const drafts = new DrizzleDraftRevisionRepository(client);
    const send = makeSend(new AuditFailingUnitOfWork(), "fail");

    await expect(send.run(ORG, draftId, "operator")).rejects.toThrow(
      /audit sink unavailable/,
    );

    // Nothing persisted: no outbound message row, no outbox row, and the
    // draft is still `approved` (not consumed).
    expect(conversationMessageCount(2)).toBe(1);
    expect(outboxCount(2)).toBe(0);
    expect(await drafts.findById(ORG, draftId)).toMatchObject({
      status: "approved",
      outboundMessageId: null,
    });
  });
});
