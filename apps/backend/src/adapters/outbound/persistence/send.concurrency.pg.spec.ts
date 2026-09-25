import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { PostgresDb } from "./client";
import postgres from "postgres";
import type { OrganizationProfile } from "../../../core/domain/config";
import type { Clock } from "../../../core/ports/clock";
import type { IdGenerator } from "../../../core/ports/id-generator";
import type { OrganizationProfileRepository } from "../../../core/ports/organization-profile-repository";
import { SendApprovedDraft } from "../../../core/use-cases/send-approved-draft";
import { createPersistenceClient } from "./client";
import { DrizzleConversationRepository } from "./conversation-repository";
import { DrizzleDraftRevisionRepository } from "./draft-revision-repository";
import { DrizzleUnitOfWork } from "./unit-of-work";

/**
 * PLAN.md slice-5 acceptance: two concurrent sends of the same approved
 * revision against real Postgres produce exactly one outbound message and
 * one outbox row, and both calls return the same message id.
 *
 * Runs only when TEST_DATABASE_URL is set (the root `test:pg` script boots
 * the docker-compose Postgres and points this spec at it); it skips with a
 * clear reason otherwise so `bun run check` stays hermetic (SQLite only).
 */

// src/adapters/outbound/persistence -> apps/backend/drizzle/migrations/postgresql.
const PG_MIGRATIONS = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "drizzle",
  "migrations",
  "postgresql",
);

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const ORG = "org_harbour_pine";
const NOW = "2025-06-01T00:00:00.000Z";

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

/** A scratch database per run so the spec never dirties a shared DB. */
async function scratchDatabaseUrl(base: string): Promise<string> {
  const sql = postgres(base, { max: 1 });
  const name = `bos_send_pg_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await sql.unsafe(`CREATE DATABASE "${name}"`);
  await sql.end();
  return base.replace(/\/[^/]+$/, `/${name}`);
}

describe("concurrent send of one approved revision (Postgres)", () => {
  it("two simultaneous sends create one message, one outbox row, same id", async (context) => {
    if (!TEST_DATABASE_URL) {
      context.skip(
        "TEST_DATABASE_URL is not set; run `bun run test:pg` to exercise this spec",
      );
      return;
    }
    const databaseUrl = await scratchDatabaseUrl(TEST_DATABASE_URL as string);
    process.env.DB_DIALECT = "postgres";
    process.env.DATABASE_URL = databaseUrl;
    const client = createPersistenceClient();
    await migrate(client.open() as PostgresDb, {
      migrationsFolder: PG_MIGRATIONS,
    });

    const drafts = new DrizzleDraftRevisionRepository(client);
    const conversations = new DrizzleConversationRepository(client);

    // Seed: conversation, inbound message, approved draft.
    const { ulid } = await import("ulid");
    const conversationId = ulid();
    const messageId = ulid();
    const draftId = ulid();
    const sql = postgres(databaseUrl, { max: 1 });
    await sql`INSERT INTO conversations (id, organization_id, mailbox_id, from_address, from_name, subject, automation_paused, created_at, updated_at)
      VALUES (${conversationId}, ${ORG}, 'mb_main', 'sam@example.test', NULL, 'Your hours', false, ${NOW}, ${NOW})`;
    await sql`INSERT INTO messages (id, organization_id, mailbox_id, conversation_id, direction, source_message_id, from_address, from_name, "to", subject, text, received_at)
      VALUES (${messageId}, ${ORG}, 'mb_main', ${conversationId}, 'inbound', 'src-pg-1', 'sam@example.test', NULL, '[]', 'Your hours', 'What are your hours?', ${NOW})`;
    await sql`INSERT INTO draft_revisions (id, organization_id, conversation_id, message_id, status, origin, body_text, fact_ids, knowledge_base_version, assumptions, outbound_message_id, quote_version_id, created_at, updated_at)
      VALUES (${draftId}, ${ORG}, ${conversationId}, ${messageId}, 'approved', 'processing', 'Hi, We clean Mon to Fri.', '[]', 'kb-1', '[]', NULL, NULL, ${NOW}, ${NOW})`;

    const makeSend = () =>
      new SendApprovedDraft({
        conversations,
        drafts,
        profile: PROFILE_REPO,
        unitOfWork: new DrizzleUnitOfWork(client),
        ids: new SequentialIds(ulid()),
        clock: new FixedClock(),
      });

    // Two simultaneous sends of the same approved revision.
    const [first, second] = await Promise.all([
      makeSend().run(ORG, draftId, "operator"),
      makeSend().run(ORG, draftId, "operator"),
    ]);

    expect(first?.revisionId).toBe(draftId);
    expect(second?.revisionId).toBe(draftId);
    // Both calls return the same outbound message.
    expect(second?.messageId).toBe(first?.messageId);

    // Exactly one outbound message and one outbox row in the database.
    const messageRows = await sql`SELECT id, direction FROM messages WHERE conversation_id = ${conversationId} AND direction = 'outbound'`;
    expect(messageRows).toHaveLength(1);
    expect(messageRows[0]?.id).toBe(first?.messageId);
    const outboxRows = await sql`SELECT message_id, status FROM outbox_entries WHERE conversation_id = ${conversationId}`;
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]).toEqual({
      message_id: first?.messageId,
      status: "queued",
    });

    // The draft is consumed exactly once, referencing that message.
    const draftRow = await sql`SELECT status, outbound_message_id FROM draft_revisions WHERE id = ${draftId}`;
    expect(draftRow[0]).toEqual({
      status: "consumed",
      outbound_message_id: first?.messageId,
    });
    await sql.end();
  });
});