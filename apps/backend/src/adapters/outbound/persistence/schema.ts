import { sql } from "drizzle-orm";
import {
  boolean,
  jsonb,
  index as pgIndex,
  integer as pgInteger,
  pgTable,
  uniqueIndex as pgUniqueIndex,
  text,
  unique,
} from "drizzle-orm/pg-core";
import {
  index,
  integer,
  sqliteTable,
  text as sqliteText,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Drizzle schema for the auth tables (PLAN.md slice 1). The Postgres mapping
 * is the source of truth; the SQLite mapping mirrors it for tests. A spec in
 * this directory fails if table or column names diverge. Timestamps are
 * ISO-8601 strings so both dialects store identical values.
 */

export const pgOperatorCredentials = pgTable(
  "operator_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [unique("operator_credentials_email_unique").on(table.email)],
);

export const pgOperatorSessions = pgTable(
  "operator_sessions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    unique("operator_sessions_token_hash_unique").on(table.tokenHash),
  ],
);

export const sqliteOperatorCredentials = sqliteTable(
  "operator_credentials",
  {
    id: sqliteText("id").primaryKey(),
    organizationId: sqliteText("organization_id").notNull(),
    email: sqliteText("email").notNull(),
    passwordHash: sqliteText("password_hash").notNull(),
    createdAt: sqliteText("created_at").notNull(),
  },
  (table) => [uniqueIndex("operator_credentials_email_unique").on(table.email)],
);

export const sqliteOperatorSessions = sqliteTable(
  "operator_sessions",
  {
    id: sqliteText("id").primaryKey(),
    organizationId: sqliteText("organization_id").notNull(),
    tokenHash: sqliteText("token_hash").notNull(),
    expiresAt: sqliteText("expires_at").notNull(),
    revokedAt: sqliteText("revoked_at"),
    createdAt: sqliteText("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("operator_sessions_token_hash_unique").on(table.tokenHash),
  ],
);

/**
 * Slice 2: conversations and messages. Addressing lists, `references`, and
 * `attachments` are JSON columns: jsonb on Postgres, text JSON on SQLite.
 */
export const sqliteConversations = sqliteTable(
  "conversations",
  {
    id: sqliteText("id").primaryKey(),
    organizationId: sqliteText("organization_id").notNull(),
    mailboxId: sqliteText("mailbox_id").notNull(),
    fromAddress: sqliteText("from_address").notNull(),
    fromName: sqliteText("from_name"),
    subject: sqliteText("subject"),
    automationPaused: integer("automation_paused", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: sqliteText("created_at").notNull(),
    updatedAt: sqliteText("updated_at").notNull(),
  },
  (table) => [index("conversations_organization_idx").on(table.organizationId)],
);

export const sqliteMessages = sqliteTable(
  "messages",
  {
    id: sqliteText("id").primaryKey(),
    organizationId: sqliteText("organization_id").notNull(),
    mailboxId: sqliteText("mailbox_id").notNull(),
    conversationId: sqliteText("conversation_id")
      .notNull()
      .references(() => sqliteConversations.id),
    direction: sqliteText("direction").notNull(),
    sourceMessageId: sqliteText("source_message_id").notNull(),
    messageId: sqliteText("message_id"),
    inReplyTo: sqliteText("in_reply_to"),
    references: sqliteText("references"),
    fromAddress: sqliteText("from_address").notNull(),
    fromName: sqliteText("from_name"),
    to: sqliteText("to"),
    cc: sqliteText("cc"),
    replyTo: sqliteText("reply_to"),
    subject: sqliteText("subject"),
    text: sqliteText("text"),
    html: sqliteText("html"),
    attachments: sqliteText("attachments"),
    receivedAt: sqliteText("received_at").notNull(),
    sentAt: sqliteText("sent_at"),
  },
  (table) => [
    index("messages_conversation_idx").on(table.conversationId),
    // Dedupe invariant: only inbound rows are unique on the source pair.
    uniqueIndex("messages_inbound_source_unique")
      .on(table.mailboxId, table.sourceMessageId)
      .where(sql`direction = 'inbound'`),
  ],
);

export const pgConversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    mailboxId: text("mailbox_id").notNull(),
    // Customer identity snapshot; there is no contact table in v3.
    fromAddress: text("from_address").notNull(),
    fromName: text("from_name"),
    subject: text("subject"),
    automationPaused: boolean("automation_paused").notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    pgIndex("conversations_organization_idx").on(table.organizationId),
  ],
);

export const pgMessages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    mailboxId: text("mailbox_id").notNull(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => pgConversations.id),
    direction: text("direction").notNull(),
    sourceMessageId: text("source_message_id").notNull(),
    messageId: text("message_id"),
    inReplyTo: text("in_reply_to"),
    references: jsonb("references").$type<string[]>(),
    fromAddress: text("from_address").notNull(),
    fromName: text("from_name"),
    to: jsonb("to").$type<string[]>(),
    cc: jsonb("cc").$type<string[]>(),
    replyTo: text("reply_to"),
    subject: text("subject"),
    text: text("text"),
    html: text("html"),
    attachments: jsonb("attachments").$type<unknown[]>(),
    receivedAt: text("received_at").notNull(),
    sentAt: text("sent_at"),
  },
  (table) => [
    pgIndex("messages_conversation_idx").on(table.conversationId),
    // Dedupe invariant: only inbound rows are unique on the source pair.
    pgUniqueIndex("messages_inbound_source_unique")
      .on(table.mailboxId, table.sourceMessageId)
      .where(sql`direction = 'inbound'`),
  ],
);

/**
 * Slice 3: processing revisions. `classification` is the full
 * Classification artifact (jsonb on Postgres, text JSON on SQLite).
 */
export const pgProcessingRevisions = pgTable(
  "processing_revisions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    messageId: text("message_id")
      .notNull()
      .references(() => pgMessages.id),
    revisionNumber: pgInteger("revision_number").notNull(),
    status: text("status").notNull(),
    lane: text("lane"),
    summary: text("summary"),
    classification: jsonb("classification").$type<unknown>(),
    error: text("error"),
    knowledgeBaseVersion: text("knowledge_base_version"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    // One revision number per message; attempts append, never overwrite.
    pgUniqueIndex("processing_revisions_message_revision_unique").on(
      table.messageId,
      table.revisionNumber,
    ),
    pgIndex("processing_revisions_message_idx").on(table.messageId),
    pgIndex("processing_revisions_organization_idx").on(table.organizationId),
  ],
);

export const sqliteProcessingRevisions = sqliteTable(
  "processing_revisions",
  {
    id: sqliteText("id").primaryKey(),
    organizationId: sqliteText("organization_id").notNull(),
    messageId: sqliteText("message_id")
      .notNull()
      .references(() => sqliteMessages.id),
    revisionNumber: integer("revision_number").notNull(),
    status: sqliteText("status").notNull(),
    lane: sqliteText("lane"),
    summary: sqliteText("summary"),
    classification: sqliteText("classification"),
    error: sqliteText("error"),
    knowledgeBaseVersion: sqliteText("knowledge_base_version"),
    createdAt: sqliteText("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("processing_revisions_message_revision_unique").on(
      table.messageId,
      table.revisionNumber,
    ),
    index("processing_revisions_message_idx").on(table.messageId),
    index("processing_revisions_organization_idx").on(table.organizationId),
  ],
);
