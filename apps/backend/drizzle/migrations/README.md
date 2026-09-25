# Migration notes

All migrations in `postgresql/` and `sqlite/` from `0002_*` onward are **hand-written**
(in the drizzle migration style) because `drizzle-kit generate` cannot run
non-interactively against the combined dual-dialect schema in this repo.

Consequences:

- The `meta/` snapshots cover only migrations `0000`/`0001` (generated originally).
  Journals are hand-maintained; the migration runner (`src/infrastructure/database/run-migrations.ts`)
  reads the journal + SQL files, so `bun run db:migrate` is unaffected.
- Do **not** run `drizzle-kit generate` later without first regenerating snapshots
  (it would diff against the stale `0001` snapshot and try to re-create existing tables).
- Every new migration must be written for **both** dialects, appended to **both**
  journals, and covered by the pg/sqlite parity spec and the migrations spec
  (`schema.spec.ts`, `migrations.spec.ts`).