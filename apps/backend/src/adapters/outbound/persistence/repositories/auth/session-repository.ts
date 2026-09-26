import { and, eq } from "drizzle-orm";
import type { OperatorSession } from "../../../../../core/domain/auth";
import type { SessionRepository } from "../../../../../core/ports/session-repository";
import type { PersistenceClient, PostgresDb, SqliteDb } from "../../client";
import { pgOperatorSessions, sqliteOperatorSessions } from "../../schema";

/** Drizzle-backed session repository (see operator-credential-repository). */
export class DrizzleSessionRepository implements SessionRepository {
  constructor(private readonly client: PersistenceClient) {}

  async create(session: OperatorSession): Promise<void> {
    if (this.client.dialect === "sqlite") {
      await this.sqlite().insert(sqliteOperatorSessions).values(session);
    } else {
      await this.postgres().insert(pgOperatorSessions).values(session);
    }
  }

  async findByTokenHash(
    organizationId: string,
    tokenHash: string,
  ): Promise<OperatorSession | undefined> {
    const rows =
      this.client.dialect === "sqlite"
        ? await this.sqlite()
            .select()
            .from(sqliteOperatorSessions)
            .where(
              and(
                eq(sqliteOperatorSessions.organizationId, organizationId),
                eq(sqliteOperatorSessions.tokenHash, tokenHash),
              ),
            )
        : await this.postgres()
            .select()
            .from(pgOperatorSessions)
            .where(
              and(
                eq(pgOperatorSessions.organizationId, organizationId),
                eq(pgOperatorSessions.tokenHash, tokenHash),
              ),
            );
    return rows[0];
  }

  async revoke(sessionId: string, revokedAt: string): Promise<void> {
    if (this.client.dialect === "sqlite") {
      await this.sqlite()
        .update(sqliteOperatorSessions)
        .set({ revokedAt })
        .where(eq(sqliteOperatorSessions.id, sessionId));
    } else {
      await this.postgres()
        .update(pgOperatorSessions)
        .set({ revokedAt })
        .where(eq(pgOperatorSessions.id, sessionId));
    }
  }

  private sqlite(): SqliteDb {
    return this.client.open() as SqliteDb;
  }

  private postgres(): PostgresDb {
    return this.client.open() as PostgresDb;
  }
}
