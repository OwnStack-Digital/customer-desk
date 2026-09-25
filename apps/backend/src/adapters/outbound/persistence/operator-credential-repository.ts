import { and, eq } from "drizzle-orm";
import type { OperatorCredential } from "../../../core/domain/auth";
import type { OperatorCredentialRepository } from "../../../core/ports/operator-credential-repository";
import type { PersistenceClient, PostgresDb, SqliteDb } from "./client";
import { pgOperatorCredentials, sqliteOperatorCredentials } from "./schema";

/**
 * Drizzle-backed credentials repository. The pg and sqlite builders expose
 * the same method surface for these simple queries; each method branches once
 * on the dialect so both stay fully typed against their own schema mapping.
 */
export class DrizzleOperatorCredentialRepository
  implements OperatorCredentialRepository
{
  constructor(private readonly client: PersistenceClient) {}

  async findByEmail(
    organizationId: string,
    email: string,
  ): Promise<OperatorCredential | undefined> {
    const rows =
      this.client.dialect === "sqlite"
        ? await this.sqlite()
            .select()
            .from(sqliteOperatorCredentials)
            .where(
              and(
                eq(sqliteOperatorCredentials.organizationId, organizationId),
                eq(sqliteOperatorCredentials.email, email),
              ),
            )
        : await this.postgres()
            .select()
            .from(pgOperatorCredentials)
            .where(
              and(
                eq(pgOperatorCredentials.organizationId, organizationId),
                eq(pgOperatorCredentials.email, email),
              ),
            );
    return rows[0];
  }

  async create(credential: OperatorCredential): Promise<void> {
    if (this.client.dialect === "sqlite") {
      await this.sqlite().insert(sqliteOperatorCredentials).values(credential);
    } else {
      await this.postgres().insert(pgOperatorCredentials).values(credential);
    }
  }

  async count(organizationId: string): Promise<number> {
    const rows =
      this.client.dialect === "sqlite"
        ? await this.sqlite()
            .select({ id: sqliteOperatorCredentials.id })
            .from(sqliteOperatorCredentials)
            .where(eq(sqliteOperatorCredentials.organizationId, organizationId))
        : await this.postgres()
            .select({ id: pgOperatorCredentials.id })
            .from(pgOperatorCredentials)
            .where(eq(pgOperatorCredentials.organizationId, organizationId));
    return rows.length;
  }

  private sqlite(): SqliteDb {
    return this.client.open() as SqliteDb;
  }

  private postgres(): PostgresDb {
    return this.client.open() as PostgresDb;
  }
}
