import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import {
  createPersistenceClient,
  PERSISTENCE_CLIENT,
  type PersistenceClient,
  type SqliteDb,
} from "./client";
import { sqliteConversations, sqliteMessages } from "./schema";

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
      db.insert(sqliteMessages)
        .values(messageRow({ id: "msg-2", direction: "inbound" }))
        .run(),
    ).toThrow(/UNIQUE constraint failed: messages\.mailbox_id, messages\.source_message_id/);

    // Outbound rows may share the source pair (the index is partial).
    expect(() =>
      db.insert(sqliteMessages)
        .values(messageRow({ id: "msg-3", direction: "outbound" }))
        .run(),
    ).not.toThrow();

    // Another mailbox may reuse the same source id.
    expect(() =>
      db.insert(sqliteMessages)
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