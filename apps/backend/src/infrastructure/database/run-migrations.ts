import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPersistenceClient,
  type PostgresDb,
  type SqliteDb,
} from "../../adapters/outbound/persistence/client";

// src/infrastructure/database -> apps/backend/drizzle/migrations (dist
// mirrors src, so the same depth holds for compiled output).
const MIGRATIONS_DIR = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "drizzle",
  "migrations",
);

interface MigrationJournal {
  entries: Array<{ idx: number; when: number; tag: string }>;
}

/**
 * Migration runner for the dialect selected by DB_DIALECT. Slice 0 ships no
 * migrations; an empty journal succeeds as a no-op without touching any
 * database.
 */
async function main(): Promise<number> {
  const journalPath = resolve(MIGRATIONS_DIR, "meta", "_journal.json");
  if (!existsSync(journalPath)) {
    console.error(`db:migrate: migrations journal not found: ${journalPath}`);
    return 1;
  }
  let journal: MigrationJournal;
  try {
    journal = JSON.parse(readFileSync(journalPath, "utf8")) as MigrationJournal;
  } catch (error) {
    console.error(`db:migrate: cannot parse ${journalPath}`, error);
    return 1;
  }
  if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
    console.log(`db:migrate: no migrations to apply (${MIGRATIONS_DIR})`);
    return 0;
  }

  console.log(`db:migrate: applying ${journal.entries.length} migration(s)`);
  const client = createPersistenceClient();
  const db = client.open();
  if (client.dialect === "postgres") {
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(db as PostgresDb, { migrationsFolder: MIGRATIONS_DIR });
  } else {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    await migrate(db as SqliteDb, { migrationsFolder: MIGRATIONS_DIR });
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error("db:migrate failed:", error);
    process.exit(1);
  },
);
