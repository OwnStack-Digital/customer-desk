import { resolve } from "node:path";
import { defineConfig } from "drizzle-kit";

// Config file lives in src/infrastructure/database so that every Drizzle
// import stays inside the persistence adapter or infrastructure
// (ground rules). Anchored to this file: holds for src and dist alike.
const backendRoot = resolve(__dirname, "..", "..", "..");

export type MigrationDialect = "postgresql" | "sqlite";

export function migrationDialect(env: NodeJS.ProcessEnv): MigrationDialect {
  return env.DB_DIALECT === "sqlite" ? "sqlite" : "postgresql";
}

/**
 * Postgres is the source of truth; SQLite mirrors it for tests. Each dialect
 * generates into its own folder with its own journal, and the runner fails
 * on a journal/dialect mismatch (carried review note 2).
 */
export function migrationsOutDir(dialect: MigrationDialect): string {
  return resolve(backendRoot, "drizzle", "migrations", dialect);
}

const dialect = migrationDialect(process.env);

const schema = resolve(
  backendRoot,
  "src/adapters/outbound/persistence/schema.ts",
);

export default defineConfig(
  dialect === "sqlite"
    ? {
        dialect: "sqlite",
        schema,
        out: migrationsOutDir("sqlite"),
        dbCredentials: {
          url: process.env.DATABASE_URL ?? "file:./bos.dev.db",
        },
      }
    : {
        dialect: "postgresql",
        schema,
        out: migrationsOutDir("postgresql"),
        dbCredentials: {
          url:
            process.env.DATABASE_URL ?? "postgres://bos:bos@127.0.0.1:5432/bos",
        },
      },
);
