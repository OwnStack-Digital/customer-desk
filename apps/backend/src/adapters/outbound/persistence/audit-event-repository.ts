import type { AuditEvent } from "../../../core/domain/outbox";
import type { AuditEventRepository } from "../../../core/ports/audit-event-repository";
import type { PersistenceClient, PostgresDb, SqliteDb } from "./client";
import { pgAuditEvents, sqliteAuditEvents } from "./schema";

/**
 * Drizzle-backed audit-trail repository (PLAN.md slice 5). Audit rows are
 * append-only: this adapter only inserts, and the table has no body,
 * credential, or raw-token columns to leak.
 */
export class DrizzleAuditEventRepository implements AuditEventRepository {
  constructor(private readonly client: PersistenceClient) {}

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
