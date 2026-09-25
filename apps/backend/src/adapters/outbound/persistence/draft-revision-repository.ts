import { and, eq } from "drizzle-orm";
import type { DraftRevision } from "../../../core/domain/drafting";
import type { DraftRevisionRepository } from "../../../core/ports/draft-revision-repository";
import type { PersistenceClient, PostgresDb, SqliteDb } from "./client";
import { pgDraftRevisions, sqliteDraftRevisions } from "./schema";

type PgRow = typeof pgDraftRevisions.$inferSelect;
type SqliteRow = typeof sqliteDraftRevisions.$inferSelect;

/**
 * Drizzle-backed draft-revision repository. `fact_ids` and `assumptions`
 * are jsonb on Postgres and text JSON on SQLite, so the two dialects get
 * explicit value/row mappers (mirrors the processing-revision repo).
 * Status changes are conditional updates (slice 5): the SQL `WHERE`
 * clause carries the expected current status, so a stale revision loses
 * the race instead of being silently mutated.
 */
export class DrizzleDraftRevisionRepository implements DraftRevisionRepository {
  constructor(private readonly client: PersistenceClient) {}

  async insertDraft(revision: DraftRevision): Promise<void> {
    if (this.client.dialect === "sqlite") {
      await this.sqlite()
        .insert(sqliteDraftRevisions)
        .values({
          id: revision.id,
          organizationId: revision.organizationId,
          conversationId: revision.conversationId,
          messageId: revision.messageId,
          status: revision.status,
          origin: revision.origin,
          bodyText: revision.bodyText,
          factIds: JSON.stringify([...revision.factIds]),
          knowledgeBaseVersion: revision.knowledgeBaseVersion,
          assumptions: JSON.stringify([...revision.assumptions]),
          outboundMessageId: revision.outboundMessageId,
          quoteVersionId: revision.quoteVersionId,
          createdAt: revision.createdAt,
          updatedAt: revision.updatedAt,
        });
    } else {
      await this.postgres()
        .insert(pgDraftRevisions)
        .values({
          id: revision.id,
          organizationId: revision.organizationId,
          conversationId: revision.conversationId,
          messageId: revision.messageId,
          status: revision.status,
          origin: revision.origin,
          bodyText: revision.bodyText,
          factIds: [...revision.factIds],
          knowledgeBaseVersion: revision.knowledgeBaseVersion,
          assumptions: [...revision.assumptions],
          outboundMessageId: revision.outboundMessageId,
          quoteVersionId: revision.quoteVersionId,
          createdAt: revision.createdAt,
          updatedAt: revision.updatedAt,
        });
    }
  }

  async findById(
    organizationId: string,
    revisionId: string,
  ): Promise<DraftRevision | undefined> {
    const rows =
      this.client.dialect === "sqlite"
        ? await this.sqlite()
            .select()
            .from(sqliteDraftRevisions)
            .where(
              and(
                eq(sqliteDraftRevisions.organizationId, organizationId),
                eq(sqliteDraftRevisions.id, revisionId),
              ),
            )
        : await this.postgres()
            .select()
            .from(pgDraftRevisions)
            .where(
              and(
                eq(pgDraftRevisions.organizationId, organizationId),
                eq(pgDraftRevisions.id, revisionId),
              ),
            );
    const row = rows[0];
    return row ? this.toDraft(row) : undefined;
  }

  async supersede(organizationId: string, revisionId: string): Promise<void> {
    if (this.client.dialect === "sqlite") {
      await this.sqlite()
        .update(sqliteDraftRevisions)
        .set({ status: "superseded" })
        .where(
          and(
            eq(sqliteDraftRevisions.organizationId, organizationId),
            eq(sqliteDraftRevisions.id, revisionId),
          ),
        );
    } else {
      await this.postgres()
        .update(pgDraftRevisions)
        .set({ status: "superseded" })
        .where(
          and(
            eq(pgDraftRevisions.organizationId, organizationId),
            eq(pgDraftRevisions.id, revisionId),
          ),
        );
    }
  }

  async supersedeProcessingProposed(
    organizationId: string,
    conversationId: string,
  ): Promise<number> {
    const where = { organizationId, conversationId } as const;
    let rows: { id: string }[];
    if (this.client.dialect === "sqlite") {
      rows = await this.sqlite()
        .update(sqliteDraftRevisions)
        .set({ status: "superseded" })
        .where(
          and(
            eq(sqliteDraftRevisions.organizationId, where.organizationId),
            eq(sqliteDraftRevisions.conversationId, where.conversationId),
            eq(sqliteDraftRevisions.origin, "processing"),
            eq(sqliteDraftRevisions.status, "proposed"),
          ),
        )
        .returning({ id: sqliteDraftRevisions.id });
    } else {
      rows = await this.postgres()
        .update(pgDraftRevisions)
        .set({ status: "superseded" })
        .where(
          and(
            eq(pgDraftRevisions.organizationId, where.organizationId),
            eq(pgDraftRevisions.conversationId, where.conversationId),
            eq(pgDraftRevisions.origin, "processing"),
            eq(pgDraftRevisions.status, "proposed"),
          ),
        )
        .returning({ id: pgDraftRevisions.id });
    }
    return rows.length;
  }

  async updateStatus(
    organizationId: string,
    revisionId: string,
    from: "proposed" | "approved",
    to: "approved" | "discarded",
  ): Promise<boolean> {
    const where = { organizationId, revisionId, from } as const;
    let rows: { id: string }[];
    if (this.client.dialect === "sqlite") {
      rows = await this.sqlite()
        .update(sqliteDraftRevisions)
        .set({ status: to })
        .where(
          and(
            eq(sqliteDraftRevisions.organizationId, where.organizationId),
            eq(sqliteDraftRevisions.id, where.revisionId),
            eq(sqliteDraftRevisions.status, where.from),
          ),
        )
        .returning({ id: sqliteDraftRevisions.id });
    } else {
      rows = await this.postgres()
        .update(pgDraftRevisions)
        .set({ status: to })
        .where(
          and(
            eq(pgDraftRevisions.organizationId, where.organizationId),
            eq(pgDraftRevisions.id, where.revisionId),
            eq(pgDraftRevisions.status, where.from),
          ),
        )
        .returning({ id: pgDraftRevisions.id });
    }
    return rows.length > 0;
  }

  async consume(
    organizationId: string,
    revisionId: string,
    outboundMessageId: string,
    updatedAt: string,
  ): Promise<boolean> {
    if (this.client.dialect === "sqlite") {
      const rows = await this.sqlite()
        .update(sqliteDraftRevisions)
        .set({ status: "consumed", outboundMessageId, updatedAt })
        .where(
          and(
            eq(sqliteDraftRevisions.organizationId, organizationId),
            eq(sqliteDraftRevisions.id, revisionId),
            eq(sqliteDraftRevisions.status, "approved"),
          ),
        )
        .returning({ id: sqliteDraftRevisions.id });
      return rows.length > 0;
    }
    const rows = await this.postgres()
      .update(pgDraftRevisions)
      .set({ status: "consumed", outboundMessageId, updatedAt })
      .where(
        and(
          eq(pgDraftRevisions.organizationId, organizationId),
          eq(pgDraftRevisions.id, revisionId),
          eq(pgDraftRevisions.status, "approved"),
        ),
      )
      .returning({ id: pgDraftRevisions.id });
    return rows.length > 0;
  }

  async findLatestByConversation(
    organizationId: string,
    conversationId: string,
  ): Promise<DraftRevision | undefined> {
    const rows =
      this.client.dialect === "sqlite"
        ? await this.sqlite()
            .select()
            .from(sqliteDraftRevisions)
            .where(
              and(
                eq(sqliteDraftRevisions.organizationId, organizationId),
                eq(sqliteDraftRevisions.conversationId, conversationId),
              ),
            )
        : await this.postgres()
            .select()
            .from(pgDraftRevisions)
            .where(
              and(
                eq(pgDraftRevisions.organizationId, organizationId),
                eq(pgDraftRevisions.conversationId, conversationId),
              ),
            );
    return rows
      .map((row) => this.toDraft(row))
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      )
      .at(-1);
  }

  private toDraft(row: PgRow | SqliteRow): DraftRevision {
    return {
      id: row.id,
      organizationId: row.organizationId,
      conversationId: row.conversationId,
      messageId: row.messageId,
      status: row.status as DraftRevision["status"],
      origin: row.origin as DraftRevision["origin"],
      bodyText: row.bodyText,
      factIds: parseJsonArray(row.factIds),
      knowledgeBaseVersion: row.knowledgeBaseVersion,
      assumptions: parseJsonArray(row.assumptions),
      outboundMessageId: row.outboundMessageId,
      quoteVersionId: row.quoteVersionId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private sqlite(): SqliteDb {
    return this.client.open() as SqliteDb;
  }

  private postgres(): PostgresDb {
    return this.client.open() as PostgresDb;
  }
}

function parseJsonArray(column: string | string[] | null): string[] {
  if (!column) {
    return [];
  }
  const parsed =
    typeof column === "string" ? JSON.parse(column) : (column as unknown[]);
  return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
}