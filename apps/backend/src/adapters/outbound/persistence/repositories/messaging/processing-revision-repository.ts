import { and, eq } from "drizzle-orm";
import type {
  Classification,
  ProcessingRevision,
} from "../../../../../core/domain/processing";
import type { ProcessingRevisionRepository } from "../../../../../core/ports/processing-revision-repository";
import type { PersistenceClient, PostgresDb, SqliteDb } from "../../client";
import { pgProcessingRevisions, sqliteProcessingRevisions } from "../../schema";

type PgRow = typeof pgProcessingRevisions.$inferSelect;
type SqliteRow = typeof sqliteProcessingRevisions.$inferSelect;

type CompleteResult = Parameters<
  ProcessingRevisionRepository["completeRevision"]
>[1];

/**
 * Drizzle-backed processing-revision repository. The classification
 * artifact is jsonb on Postgres and text JSON on SQLite, so the two
 * dialects get explicit value/row mappers (mirrors the message repo).
 */
export class DrizzleProcessingRevisionRepository
  implements ProcessingRevisionRepository
{
  constructor(private readonly client: PersistenceClient) {}

  async insertRevision(revision: ProcessingRevision): Promise<void> {
    if (this.client.dialect === "sqlite") {
      await this.sqlite()
        .insert(sqliteProcessingRevisions)
        .values(sqliteValues(revision));
    } else {
      await this.postgres()
        .insert(pgProcessingRevisions)
        .values(pgValues(revision));
    }
  }

  async completeRevision(id: string, result: CompleteResult): Promise<void> {
    if (this.client.dialect === "sqlite") {
      await this.sqlite()
        .update(sqliteProcessingRevisions)
        .set({
          status: result.status,
          lane: result.lane,
          summary: result.summary,
          classification: result.classification
            ? JSON.stringify(result.classification)
            : null,
          error: result.error,
        })
        .where(eq(sqliteProcessingRevisions.id, id));
    } else {
      await this.postgres()
        .update(pgProcessingRevisions)
        .set({
          status: result.status,
          lane: result.lane,
          summary: result.summary,
          classification: result.classification,
          error: result.error,
        })
        .where(eq(pgProcessingRevisions.id, id));
    }
  }

  async findLatestByMessage(
    organizationId: string,
    messageId: string,
  ): Promise<ProcessingRevision | undefined> {
    const rows =
      this.client.dialect === "sqlite"
        ? await this.sqlite()
            .select()
            .from(sqliteProcessingRevisions)
            .where(
              and(
                eq(sqliteProcessingRevisions.organizationId, organizationId),
                eq(sqliteProcessingRevisions.messageId, messageId),
              ),
            )
        : await this.postgres()
            .select()
            .from(pgProcessingRevisions)
            .where(
              and(
                eq(pgProcessingRevisions.organizationId, organizationId),
                eq(pgProcessingRevisions.messageId, messageId),
              ),
            );
    return rows
      .map((row) => this.toRevision(row))
      .sort((left, right) => left.revisionNumber - right.revisionNumber)
      .at(-1);
  }

  async findLatestPerMessage(
    organizationId: string,
  ): Promise<ProcessingRevision[]> {
    const rows =
      this.client.dialect === "sqlite"
        ? await this.sqlite()
            .select()
            .from(sqliteProcessingRevisions)
            .where(eq(sqliteProcessingRevisions.organizationId, organizationId))
        : await this.postgres()
            .select()
            .from(pgProcessingRevisions)
            .where(eq(pgProcessingRevisions.organizationId, organizationId));
    // One revision per message with the greatest revision number.
    const latest = new Map<string, ProcessingRevision>();
    for (const row of rows) {
      const revision = this.toRevision(row);
      const current = latest.get(revision.messageId);
      if (!current || revision.revisionNumber > current.revisionNumber) {
        latest.set(revision.messageId, revision);
      }
    }
    return [...latest.values()];
  }

  private toRevision(row: PgRow | SqliteRow): ProcessingRevision {
    return {
      id: row.id,
      organizationId: row.organizationId,
      messageId: row.messageId,
      revisionNumber: row.revisionNumber,
      status: row.status as ProcessingRevision["status"],
      lane: (row.lane as ProcessingRevision["lane"]) ?? null,
      summary: row.summary,
      classification: row.classification
        ? typeof row.classification === "string"
          ? (JSON.parse(row.classification) as Classification)
          : (row.classification as Classification)
        : null,
      error: row.error,
      knowledgeBaseVersion: row.knowledgeBaseVersion,
      createdAt: row.createdAt,
    };
  }

  private sqlite(): SqliteDb {
    return this.client.open() as SqliteDb;
  }

  private postgres(): PostgresDb {
    return this.client.open() as PostgresDb;
  }
}

function pgValues(revision: ProcessingRevision) {
  return { ...revision };
}

function sqliteValues(revision: ProcessingRevision) {
  return {
    id: revision.id,
    organizationId: revision.organizationId,
    messageId: revision.messageId,
    revisionNumber: revision.revisionNumber,
    status: revision.status,
    lane: revision.lane,
    summary: revision.summary,
    classification: revision.classification
      ? JSON.stringify(revision.classification)
      : null,
    error: revision.error,
    knowledgeBaseVersion: revision.knowledgeBaseVersion,
    createdAt: revision.createdAt,
  };
}
