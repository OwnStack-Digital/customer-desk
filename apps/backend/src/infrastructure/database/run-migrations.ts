import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  createPersistenceClient,
  type PostgresDb,
  type SqliteDb,
} from "../../adapters/outbound/persistence/client";
import { loadDotEnvIfPresent, rootsFromMigrationRunner } from "../env-file";
import { migrationDialect, migrationsOutDir } from "./drizzle.config";

/**
 * Expected journal "dialect" value per runner dialect. Used to detect a
 * journal/dialect mismatch instead of silently mis-running migrations.
 */
export const JOURNAL_DIALECT = {
  postgresql: "postgresql",
  sqlite: "sqlite",
} as const;

export interface MigrationJournal {
  dialect: string;
  entries: Array<{ idx: number; when: number; tag: string }>;
}

/** Loads the journal for a dialect and fails on a dialect mismatch. */
export function readJournal(
  migrationsFolder: string,
  dialect: "postgresql" | "sqlite",
): MigrationJournal {
  const journalPath = resolve(migrationsFolder, "meta", "_journal.json");
  if (!existsSync(journalPath)) {
    throw new Error(`migrations journal not found: ${journalPath}`);
  }
  let journal: MigrationJournal;
  try {
    journal = JSON.parse(readFileSync(journalPath, "utf8")) as MigrationJournal;
  } catch (error) {
    throw new Error(`cannot parse ${journalPath}: ${String(error)}`);
  }
  if (journal.dialect !== JOURNAL_DIALECT[dialect]) {
    throw new Error(
      `journal dialect mismatch: ${journalPath} declares "${journal.dialect}" but the runner is ${dialect}`,
    );
  }
  return journal;
}

/**
 * Migration runner for the dialect selected by DB_DIALECT. Each dialect owns
 * its migration folder and journal; a mismatch between them is a hard error.
 */
async function main(): Promise<number> {
  loadDotEnvIfPresent(rootsFromMigrationRunner(__dirname));
  const dialect = migrationDialect(process.env);
  const migrationsFolder = migrationsOutDir(dialect);
  let journal: MigrationJournal;
  try {
    journal = readJournal(migrationsFolder, dialect);
  } catch (error) {
    console.error(`db:migrate: ${String(error)}`);
    return 1;
  }
  if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
    console.log(`db:migrate: no migrations to apply (${migrationsFolder})`);
    return 0;
  }

  console.log(
    `db:migrate: applying ${journal.entries.length} migration(s) as ${dialect}`,
  );
  const client = createPersistenceClient();
  const db = client.open();
  if (client.dialect === "postgres") {
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(db as PostgresDb, { migrationsFolder });
  } else {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    await migrate(db as SqliteDb, { migrationsFolder });
  }
  console.log("db:migrate: done");
  return 0;
}

function isCliEntry(): boolean {
  return (
    basename(process.argv[1] ?? "").replace(/\.(ts|js)$/, "") ===
    "run-migrations"
  );
}

if (isCliEntry()) {
  void main().then(
    (code) => process.exit(code),
    (error) => {
      console.error("db:migrate failed:", error);
      process.exit(1);
    },
  );
}
