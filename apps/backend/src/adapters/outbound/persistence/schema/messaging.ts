import { sql } from "drizzle-orm";
import {
  boolean,
  jsonb,
  index as pgIndex,
  integer as pgInteger,
  pgTable,
  uniqueIndex as pgUniqueIndex,
  text,
} from "drizzle-orm/pg-core";
import {
  index,
  integer,
  sqliteTable,
  text as sqliteText,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

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
 * Slice 4: draft revisions. `fact_ids` and `assumptions` are JSON columns
 * (jsonb on Postgres, text JSON on SQLite). `outbound_message_id` is
 * unique when set: a partial unique index, the slice-5 send constraint.
 */
export const pgDraftRevisions = pgTable(
  "draft_revisions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => pgConversations.id),
    messageId: text("message_id")
      .notNull()
      .references(() => pgMessages.id),
    status: text("status").notNull(),
    origin: text("origin").notNull().default("processing"),
    bodyText: text("body_text").notNull(),
    factIds: jsonb("fact_ids").$type<string[]>(),
    knowledgeBaseVersion: text("knowledge_base_version"),
    assumptions: jsonb("assumptions").$type<string[]>(),
    outboundMessageId: text("outbound_message_id"),
    quoteVersionId: text("quote_version_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    pgUniqueIndex("draft_revisions_outbound_message_unique")
      .on(table.outboundMessageId)
      .where(sql`outbound_message_id is not null`),
    pgIndex("draft_revisions_conversation_idx").on(table.conversationId),
    pgIndex("draft_revisions_organization_idx").on(table.organizationId),
  ],
);

export const sqliteDraftRevisions = sqliteTable(
  "draft_revisions",
  {
    id: sqliteText("id").primaryKey(),
    organizationId: sqliteText("organization_id").notNull(),
    conversationId: sqliteText("conversation_id")
      .notNull()
      .references(() => sqliteConversations.id),
    messageId: sqliteText("message_id")
      .notNull()
      .references(() => sqliteMessages.id),
    status: sqliteText("status").notNull(),
    origin: sqliteText("origin").notNull().default("processing"),
    bodyText: sqliteText("body_text").notNull(),
    factIds: sqliteText("fact_ids"),
    knowledgeBaseVersion: sqliteText("knowledge_base_version"),
    assumptions: sqliteText("assumptions"),
    outboundMessageId: sqliteText("outbound_message_id"),
    quoteVersionId: sqliteText("quote_version_id"),
    createdAt: sqliteText("created_at").notNull(),
    updatedAt: sqliteText("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("draft_revisions_outbound_message_unique")
      .on(table.outboundMessageId)
      .where(sql`outbound_message_id is not null`),
    index("draft_revisions_conversation_idx").on(table.conversationId),
    index("draft_revisions_organization_idx").on(table.organizationId),
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
