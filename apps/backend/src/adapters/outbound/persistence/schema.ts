import { pgTable, text, unique } from "drizzle-orm/pg-core";
import {
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
