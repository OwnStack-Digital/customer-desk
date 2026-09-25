import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type MigrationJournal, readJournal } from "./run-migrations";

// src/infrastructure/database -> apps/backend/drizzle/migrations.
const MIGRATIONS_ROOT = join(
  __dirname,
  "..",
  "..",
  "..",
  "drizzle",
  "migrations",
);

function readRawJournal(dialect: "postgresql" | "sqlite"): MigrationJournal {
  return JSON.parse(
    readFileSync(
      join(MIGRATIONS_ROOT, dialect, "meta", "_journal.json"),
      "utf8",
    ),
  ) as MigrationJournal;
}

/**
 * Journal dialect must match the folder the runner picks; a mismatch is a
 * hard error instead of silently mis-running (carried review note 2).
 */
describe("migration journals", () => {
  it("each dialect folder holds a journal with the matching dialect", () => {
    expect(readRawJournal("postgresql").dialect).toBe("postgresql");
    expect(readRawJournal("sqlite").dialect).toBe("sqlite");
  });

  it("every journal entry has its SQL file next to the journal", () => {
    for (const dialect of ["postgresql", "sqlite"] as const) {
      const journal = readRawJournal(dialect);
      for (const entry of journal.entries) {
        expect(
          existsSync(join(MIGRATIONS_ROOT, dialect, `${entry.tag}.sql`)),
        ).toBe(true);
      }
    }
  });

  it("readJournal rejects a journal whose dialect does not match the folder", () => {
    const dir = join(tmpdir(), `bos-journal-mismatch-${process.pid}`);
    mkdirSync(join(dir, "meta"), { recursive: true });
    writeFileSync(
      join(dir, "meta", "_journal.json"),
      JSON.stringify({ dialect: "sqlite", entries: [] }),
    );
    try {
      expect(() => readJournal(dir, "postgresql")).toThrow(
        /journal dialect mismatch/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
