import {
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
import {
  pgConversations,
  pgMessages,
  sqliteConversations,
  sqliteMessages,
} from "./messaging";

/**
 * Slice 5: outbox and audit. `outbox_entries` queues one row per outbound
 * message (unique `message_id`); status starts `queued` and nothing in the
 * demonstrator moves it further. `audit_events` stores who did what to
 * which entity — never a body, credential, or raw token.
 */
export const pgOutboxEntries = pgTable(
  "outbox_entries",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    messageId: text("message_id")
      .notNull()
      .references(() => pgMessages.id),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => pgConversations.id),
    recipient: text("recipient").notNull(),
    status: text("status").notNull(),
    attempts: pgInteger("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // Send invariant: one outbox row per outbound message.
    pgUniqueIndex("outbox_entries_message_id_unique").on(table.messageId),
    pgIndex("outbox_entries_organization_idx").on(table.organizationId),
  ],
);

export const sqliteOutboxEntries = sqliteTable(
  "outbox_entries",
  {
    id: sqliteText("id").primaryKey(),
    organizationId: sqliteText("organization_id").notNull(),
    messageId: sqliteText("message_id")
      .notNull()
      .references(() => sqliteMessages.id),
    conversationId: sqliteText("conversation_id")
      .notNull()
      .references(() => sqliteConversations.id),
    recipient: sqliteText("recipient").notNull(),
    status: sqliteText("status").notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastError: sqliteText("last_error"),
    createdAt: sqliteText("created_at").notNull(),
    updatedAt: sqliteText("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("outbox_entries_message_id_unique").on(table.messageId),
    index("outbox_entries_organization_idx").on(table.organizationId),
  ],
);

export const pgAuditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    revisionId: text("revision_id"),
    correlationId: text("correlation_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    pgIndex("audit_events_organization_idx").on(table.organizationId),
  ],
);

export const sqliteAuditEvents = sqliteTable(
  "audit_events",
  {
    id: sqliteText("id").primaryKey(),
    organizationId: sqliteText("organization_id").notNull(),
    actor: sqliteText("actor").notNull(),
    action: sqliteText("action").notNull(),
    entityType: sqliteText("entity_type").notNull(),
    entityId: sqliteText("entity_id").notNull(),
    revisionId: sqliteText("revision_id"),
    correlationId: sqliteText("correlation_id"),
    createdAt: sqliteText("created_at").notNull(),
  },
  (table) => [index("audit_events_organization_idx").on(table.organizationId)],
);
