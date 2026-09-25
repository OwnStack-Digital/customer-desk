import DatabaseConstructor from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export type DbDialect = "postgres" | "sqlite";

export type PostgresDb = ReturnType<typeof drizzlePostgres>;
export type SqliteDb = ReturnType<typeof drizzleSqlite>;
export type DbClient = PostgresDb | SqliteDb;

/** DI token for the lazily opened Drizzle client. */
export const PERSISTENCE_CLIENT = "BOS_PERSISTENCE_CLIENT";

export interface PersistenceClient {
  readonly dialect: DbDialect;
  /**
   * Opens the database connection on first use. Boot and `GET /health`
   * never call this, so the app starts without a database.
   */
  open(): DbClient;
}

/**
 * Selects the driver from DB_DIALECT: postgres (postgres.js + DATABASE_URL)
 * or sqlite (better-sqlite3, tests/dev only). The connection is created
 * lazily; constructing this client performs no I/O.
 */
export function createPersistenceClient(
  env: NodeJS.ProcessEnv = process.env,
): PersistenceClient {
  const dialect: DbDialect =
    env.DB_DIALECT === "sqlite" ? "sqlite" : "postgres";
  let opened: DbClient | undefined;
  return {
    dialect,
    open(): DbClient {
      if (!opened) {
        opened =
          dialect === "postgres"
            ? openPostgres(env.DATABASE_URL)
            : openSqlite(env.DATABASE_URL);
      }
      return opened;
    },
  };
}

function openPostgres(databaseUrl: string | undefined): PostgresDb {
  if (!databaseUrl) {
    throw new Error("DB_DIALECT=postgres requires DATABASE_URL");
  }
  return drizzlePostgres(postgres(databaseUrl));
}

function openSqlite(databaseUrl: string | undefined): SqliteDb {
  // better-sqlite3 takes a file path, not a URL; accept the `file:` form.
  const path = databaseUrl?.replace(/^file:/, "") ?? ":memory:";
  return drizzleSqlite(new DatabaseConstructor(path));
}
