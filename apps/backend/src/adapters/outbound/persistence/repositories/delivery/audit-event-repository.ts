import { and, asc, eq, inArray } from "drizzle-orm";
import type { AuditEvent } from "../../../../../core/domain/outbox";
import type { AuditEventRepository } from "../../../../../core/ports/audit-event-repository";
import type { PersistenceClient, PostgresDb, SqliteDb } from "../../client";
import { pgAuditEvents, sqliteAuditEvents } from "../../schema";

/**
 * Drizzle-backed audit-trail repository (PLAN.md slice 5). Audit rows are
 * append-only: this adapter only inserts, and the table has no body,
 * credential, or raw-token columns to leak.
 */
export class DrizzleAuditEventRepository implements AuditEventRepository {
  constructor(private readonly client: PersistenceClient) {}

  async listByEntityIds(
    organizationId: string,
    entityIds: readonly string[],
  ): Promise<readonly AuditEvent[]> {
    if (entityIds.length === 0) {
      return [];
    }
    const ids = [...entityIds];
    const rows =
      this.client.dialect === "sqlite"
        ? await this.sqlite()
            .select()
            .from(sqliteAuditEvents)
            .where(
              and(
                eq(sqliteAuditEvents.organizationId, organizationId),
                inArray(sqliteAuditEvents.entityId, ids),
              ),
            )
            .orderBy(
              asc(sqliteAuditEvents.createdAt),
              asc(sqliteAuditEvents.id),
            )
        : await this.postgres()
            .select()
            .from(pgAuditEvents)
            .where(
              and(
                eq(pgAuditEvents.organizationId, organizationId),
                inArray(pgAuditEvents.entityId, ids),
              ),
            )
            .orderBy(asc(pgAuditEvents.createdAt), asc(pgAuditEvents.id));
    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      actor: row.actor,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      revisionId: row.revisionId,
      correlationId: row.correlationId,
      createdAt: row.createdAt,
    }));
  }

  async insertEvent(event: AuditEvent): Promise<void> {
    if (this.client.dialect === "sqlite") {
      await this.sqlite()
        .insert(sqliteAuditEvents)
        .values({ ...event });
    } else {
      await this.postgres()
        .insert(pgAuditEvents)
        .values({ ...event });
    }
  }

  private sqlite(): SqliteDb {
    return this.client.open() as SqliteDb;
  }

  private postgres(): PostgresDb {
    return this.client.open() as PostgresDb;
  }
}
