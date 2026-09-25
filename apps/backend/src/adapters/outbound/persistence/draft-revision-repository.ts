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
