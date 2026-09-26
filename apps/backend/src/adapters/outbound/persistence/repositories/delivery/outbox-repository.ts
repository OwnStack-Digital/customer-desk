import { desc, eq } from "drizzle-orm";
import type {
  OutboxEntry,
  OutboxItem,
} from "../../../../../core/domain/outbox";
import type { OutboxRepository } from "../../../../../core/ports/outbox-repository";
import type { PersistenceClient, PostgresDb, SqliteDb } from "../../client";
import { pgOutboxEntries, sqliteOutboxEntries } from "../../schema";

/**
 * Drizzle-backed outbox repository (PLAN.md slice 5). Rows are inserted
 * `queued` by the send unit of work; nothing in the demonstrator moves a
 * row beyond `queued` (that transition belongs to the pilot worker).
 */
export class DrizzleOutboxRepository implements OutboxRepository {
  constructor(private readonly client: PersistenceClient) {}

  async insertOutbox(entry: OutboxEntry): Promise<void> {
    if (this.client.dialect === "sqlite") {
      await this.sqlite()
        .insert(sqliteOutboxEntries)
        .values({ ...entry });
    } else {
      await this.postgres()
        .insert(pgOutboxEntries)
        .values({ ...entry });
    }
  }

  async listByOrganization(organizationId: string): Promise<OutboxItem[]> {
    const rows =
      this.client.dialect === "sqlite"
        ? await this.sqlite()
            .select()
            .from(sqliteOutboxEntries)
            .where(eq(sqliteOutboxEntries.organizationId, organizationId))
            .orderBy(
              desc(sqliteOutboxEntries.createdAt),
              desc(sqliteOutboxEntries.id),
            )
        : await this.postgres()
            .select()
            .from(pgOutboxEntries)
            .where(eq(pgOutboxEntries.organizationId, organizationId))
            .orderBy(desc(pgOutboxEntries.createdAt), desc(pgOutboxEntries.id));
    return rows.map((row) => ({
      messageId: row.messageId,
      conversationId: row.conversationId,
      recipient: row.recipient,
      status: row.status as OutboxItem["status"],
      attempts: row.attempts,
      lastError: row.lastError,
      createdAt: row.createdAt,
    }));
  }

  private sqlite(): SqliteDb {
    return this.client.open() as SqliteDb;
  }

  private postgres(): PostgresDb {
    return this.client.open() as PostgresDb;
  }
}
