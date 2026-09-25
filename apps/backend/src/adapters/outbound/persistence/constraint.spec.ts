import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPersistenceClient,
  PERSISTENCE_CLIENT,
  type PersistenceClient,
  type SqliteDb,
} from "./client";
import {
  sqliteConversations,
  sqliteDraftRevisions,
  sqliteMessages,
  sqliteOutboxEntries,
} from "./schema";

// src/adapters/outbound/persistence -> apps/backend/drizzle/migrations/sqlite.
const MIGRATIONS = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "drizzle",
  "migrations",
  "sqlite",
);

let dbFile: string;
let client: PersistenceClient;

beforeAll(() => {
  dbFile = join(mkdtempSync(join(tmpdir(), "bos-constraint-")), "test.db");
  process.env.DB_DIALECT = "sqlite";
  process.env.DATABASE_URL = `file:${dbFile}`;
  client = createPersistenceClient();
  // Proves the generated migrations apply cleanly on SQLite.
  migrate(client.open() as SqliteDb, { migrationsFolder: MIGRATIONS });
});

afterAll(() => {
  rmSync(dbFile, { recursive: true, force: true });
});

function conversationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "conv-1",
    organizationId: "org_harbour_pine",
    mailboxId: "mb_main",
    fromAddress: "sam@example.test",
    fromName: "Sam",
    subject: "Oven clean",
    automationPaused: false,
    createdAt: "2025-06-01T00:00:00.000Z",
    updatedAt: "2025-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function messageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    organizationId: "org_harbour_pine",
    mailboxId: "mb_main",
    conversationId: "conv-1",
    direction: "inbound",
    sourceMessageId: "src-1",
    messageId: null,
    inReplyTo: null,
    references: null,
    fromAddress: "sam@example.test",
    fromName: null,
    to: "[]",
    cc: null,
    replyTo: null,
    subject: null,
    text: null,
    html: null,
    attachments: null,
    receivedAt: "2025-06-01T00:00:00.000Z",
    sentAt: null,
    ...overrides,
  };
}

describe("messages inbound dedupe constraint (SQLite)", () => {
  it("enforces the partial unique index at the database level", () => {
    const db = client.open() as SqliteDb;
    db.insert(sqliteConversations).values(conversationRow()).run();

    db.insert(sqliteMessages)
      .values(messageRow({ id: "msg-1", direction: "inbound" }))
      .run();

    // Same (mailboxId, sourceMessageId) inbound pair: rejected by the
    // partial unique index, not just the use-case dedupe check.
    expect(() =>
      db
        .insert(sqliteMessages)
        .values(messageRow({ id: "msg-2", direction: "inbound" }))
        .run(),
    ).toThrow(
      /UNIQUE constraint failed: messages\.mailbox_id, messages\.source_message_id/,
    );

    // Outbound rows may share the source pair (the index is partial).
    expect(() =>
      db
        .insert(sqliteMessages)
        .values(messageRow({ id: "msg-3", direction: "outbound" }))
        .run(),
    ).not.toThrow();

    // Another mailbox may reuse the same source id.
    expect(() =>
      db
        .insert(sqliteMessages)
        .values(
          messageRow({
            id: "msg-4",
            direction: "inbound",
            mailboxId: "mb_other",
          }),
        )
        .run(),
    ).not.toThrow();
  });

  it("exposes the same client via the PERSISTENCE_CLIENT token contract", () => {
    // The DI token is a string constant consumed by the Nest providers.
    expect(PERSISTENCE_CLIENT).toBe("BOS_PERSISTENCE_CLIENT");
  });
});

describe("draft_revisions outbound_message_id constraint (SQLite)", () => {
  it("the partial unique index fires on a second non-null value and tolerates nulls", () => {
    const db = client.open() as SqliteDb;
    db.insert(sqliteConversations)
      .values(conversationRow({ id: "conv-draft" }))
      .run();
    db.insert(sqliteMessages)
      .values(
        messageRow({
          id: "msg-draft",
          conversationId: "conv-draft",
          sourceMessageId: "src-draft",
        }),
      )
      .run();

    const draftRow = (overrides: Record<string, unknown> = {}) => ({
      id: "draft-1",
      organizationId: "org_harbour_pine",
      conversationId: "conv-draft",
      messageId: "msg-draft",
      status: "proposed",
      bodyText: "Hi,\n\nWe clean Mon to Fri.\n\nThanks,",
      factIds: JSON.stringify(["kb_hours"]),
      knowledgeBaseVersion: "kb-1",
      assumptions: JSON.stringify([]),
      outboundMessageId: null,
      quoteVersionId: null,
      createdAt: "2025-06-01T00:00:00.000Z",
      updatedAt: "2025-06-01T00:00:00.000Z",
      ...overrides,
    });

    // Two unbound proposed drafts may both have a null outbound message.
    db.insert(sqliteDraftRevisions).values(draftRow()).run();
    expect(() =>
      db
        .insert(sqliteDraftRevisions)
        .values(draftRow({ id: "draft-2" }))
        .run(),
    ).not.toThrow();

    // The first draft bound to an outbound message wins; a second draft
    // claiming the same outbound message hits the partial unique index
    // (the slice-5 send constraint).
    db.insert(sqliteDraftRevisions)
      .values(draftRow({ id: "draft-3", outboundMessageId: "msg-out-1" }))
      .run();
    expect(() =>
      db
        .insert(sqliteDraftRevisions)
        .values(draftRow({ id: "draft-4", outboundMessageId: "msg-out-1" }))
        .run(),
    ).toThrow(/UNIQUE constraint failed: draft_revisions\.outbound_message_id/);

    // A different outbound message is of course fine.
    expect(() =>
      db
        .insert(sqliteDraftRevisions)
        .values(draftRow({ id: "draft-5", outboundMessageId: "msg-out-2" }))
        .run(),
    ).not.toThrow();
  });
});

describe("outbox_entries message_id constraint (SQLite, slice 5)", () => {
  it("the unique index fires on a second row with the same message id", () => {
    const db = client.open() as SqliteDb;
    db.insert(sqliteConversations)
      .values(conversationRow({ id: "conv-outbox" }))
      .run();
    db.insert(sqliteMessages)
      .values(
        messageRow({
          id: "msg-outbox",
          conversationId: "conv-outbox",
          sourceMessageId: "src-outbox",
        }),
      )
      .run();

    const outboxRow = (overrides: Record<string, unknown> = {}) => ({
      id: "outbox-1",
      organizationId: "org_harbour_pine",
      messageId: "msg-outbox",
      conversationId: "conv-outbox",
      recipient: "sam@example.test",
      status: "queued",
      attempts: 0,
      lastError: null,
      createdAt: "2025-06-01T00:00:00.000Z",
      updatedAt: "2025-06-01T00:00:00.000Z",
      ...overrides,
    });

    db.insert(sqliteOutboxEntries).values(outboxRow()).run();
    // One outbox row per outbound message: the unique index is the last
    // line of defense behind the conditional consume.
    expect(() =>
      db
        .insert(sqliteOutboxEntries)
        .values(outboxRow({ id: "outbox-2" }))
        .run(),
    ).toThrow(/UNIQUE constraint failed: outbox_entries\.message_id/);
  });
});
