import {
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
import {
  pgConversations,
  pgDraftRevisions,
  sqliteConversations,
  sqliteDraftRevisions,
} from "./messaging";

/**
 * Slice 6: quote versions. One row per priced quote snapshot. `lines`
 * and `assumptions` are JSON (jsonb on Postgres, text JSON on SQLite);
 * money is always integers. `token_hash` is unique — null while the
 * version is only `prepared` (both dialects allow many nulls), and the
 * hash of the single live public token once it is `sent`.
 */
export const pgQuoteVersions = pgTable(
  "quote_versions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => pgConversations.id),
    draftRevisionId: text("draft_revision_id").references(
      () => pgDraftRevisions.id,
    ),
    status: text("status").notNull(),
    tokenHash: text("token_hash"),
    lines: jsonb("lines").$type<unknown[]>(),
    assumptions: jsonb("assumptions").$type<string[]>(),
    currency: text("currency").notNull(),
    subtotalMinor: pgInteger("subtotal_minor").notNull(),
    taxMinor: pgInteger("tax_minor").notNull(),
    totalMinor: pgInteger("total_minor").notNull(),
    priceListVersion: text("price_list_version").notNull(),
    validUntil: text("valid_until"),
    sentAt: text("sent_at"),
    decidedAt: text("decided_at"),
    decision: text("decision"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // One live token per quote; the hash is the only stored form.
    pgUniqueIndex("quote_versions_token_hash_unique").on(table.tokenHash),
    pgIndex("quote_versions_conversation_idx").on(table.conversationId),
    pgIndex("quote_versions_organization_idx").on(table.organizationId),
  ],
);

export const sqliteQuoteVersions = sqliteTable(
  "quote_versions",
  {
    id: sqliteText("id").primaryKey(),
    organizationId: sqliteText("organization_id").notNull(),
    conversationId: sqliteText("conversation_id")
      .notNull()
      .references(() => sqliteConversations.id),
    draftRevisionId: sqliteText("draft_revision_id").references(
      () => sqliteDraftRevisions.id,
    ),
    status: sqliteText("status").notNull(),
    tokenHash: sqliteText("token_hash"),
    lines: sqliteText("lines"),
    assumptions: sqliteText("assumptions"),
    currency: sqliteText("currency").notNull(),
    subtotalMinor: integer("subtotal_minor").notNull(),
    taxMinor: integer("tax_minor").notNull(),
    totalMinor: integer("total_minor").notNull(),
    priceListVersion: sqliteText("price_list_version").notNull(),
    validUntil: sqliteText("valid_until"),
    sentAt: sqliteText("sent_at"),
    decidedAt: sqliteText("decided_at"),
    decision: sqliteText("decision"),
    createdAt: sqliteText("created_at").notNull(),
    updatedAt: sqliteText("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("quote_versions_token_hash_unique").on(table.tokenHash),
    index("quote_versions_conversation_idx").on(table.conversationId),
    index("quote_versions_organization_idx").on(table.organizationId),
  ],
);
