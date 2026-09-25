import { sql } from "drizzle-orm";
import type {
  TransactionScopedRepositories,
  UnitOfWork,
} from "../../../core/ports/unit-of-work";
import type {
  DbClient,
  DbDialect,
  PersistenceClient,
  PostgresDb,
  SqliteDb,
} from "./client";
import { DrizzleAuditEventRepository } from "./audit-event-repository";
import { DrizzleDraftRevisionRepository } from "./draft-revision-repository";
import { DrizzleMessageRepository } from "./message-repository";
import { DrizzleOutboxRepository } from "./outbox-repository";

/**
 * A `PersistenceClient` whose `open()` returns the transaction handle
 * instead of the root client: transaction-scoped repository instances
 * read and write inside the open transaction without knowing it.
 */
class TransactionClient implements PersistenceClient {
  constructor(
    readonly dialect: DbDialect,
    private readonly handle: DbClient,
  ) {}

  open(): DbClient {
    return this.handle;
  }
}

/**
 * Drizzle-backed `UnitOfWork` (PLAN.md slice 5). `fn` runs inside one
 * database transaction with transaction-scoped repositories; any throw
 * rolls every insert and update inside it back.
 *
 * - Postgres uses drizzle's `db.transaction` (async, real BEGIN/COMMIT).
 * - SQLite (better-sqlite3) is a synchronous driver whose drizzle
 *   transaction callback cannot await async repository calls, so this
 *   adapter drives `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` itself. All
 *   awaited statements on the single connection run inside that
 *   transaction; single-writer serialization keeps it safe.
 */
export class DrizzleUnitOfWork implements UnitOfWork {
  constructor(private readonly client: PersistenceClient) {}

  async run<T>(
    fn: (repos: TransactionScopedRepositories) => Promise<T>,
  ): Promise<T> {
    const db = this.client.open();
    if (this.client.dialect === "postgres") {
      return (db as PostgresDb).transaction(async (tx) =>
        // The transaction handle carries the same query surface as the
        // root client (schema-less drizzle instance); the repos only need
        // `open()` to return something they can query with.
        fn(this.scoped(new TransactionClient("postgres", tx as unknown as PostgresDb))),
      );
    }
    const sqlite = db as SqliteDb;
    await sqlite.run(sql`BEGIN IMMEDIATE`);
    try {
      const result = await fn(this.scoped(new TransactionClient("sqlite", sqlite)));
      await sqlite.run(sql`COMMIT`);
      return result;
    } catch (error) {
      await sqlite.run(sql`ROLLBACK`);
      throw error;
    }
  }

  private scoped(
    txClient: PersistenceClient,
  ): TransactionScopedRepositories {
    return {
      messages: new DrizzleMessageRepository(txClient),
      drafts: new DrizzleDraftRevisionRepository(txClient),
      outbox: new DrizzleOutboxRepository(txClient),
      audit: new DrizzleAuditEventRepository(txClient),
    };
  }
}