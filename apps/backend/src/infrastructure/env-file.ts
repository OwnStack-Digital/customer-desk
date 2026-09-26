import { existsSync } from "node:fs";
import { resolve } from "node:path";

export interface EnvFileRoots {
  /** `apps/backend`, whether the process is running from `src` or `dist`. */
  readonly backendRoot: string;
  /** Monorepo root that holds the documented `.env`. */
  readonly repoRoot: string;
}

/** `entryDir` is `apps/backend/src` or `apps/backend/dist` (`main.ts`). */
export function rootsFromBackendEntry(entryDir: string): EnvFileRoots {
  return {
    backendRoot: resolve(entryDir, ".."),
    repoRoot: resolve(entryDir, "..", "..", ".."),
  };
}

/**
 * `runnerDir` is `apps/backend/{src,dist}/infrastructure/database`
 * (`run-migrations.ts`).
 */
export function rootsFromMigrationRunner(runnerDir: string): EnvFileRoots {
  return {
    backendRoot: resolve(runnerDir, "..", "..", ".."),
    repoRoot: resolve(runnerDir, "..", "..", "..", "..", ".."),
  };
}

/**
 * Loads the first existing dotenv file. Already-set variables are left
 * alone (`process.loadEnvFile` does not override). Shell scripts started
 * with `bun run` do not receive Bun's automatic `.env` load, so Node
 * entrypoints (Nest, migrations) must load the file themselves.
 */
export function loadDotEnvIfPresent(roots: EnvFileRoots): string | undefined {
  const candidates = [
    resolve(roots.backendRoot, ".env"),
    resolve(roots.repoRoot, ".env"),
    resolve(process.cwd(), ".env"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return candidate;
    }
  }
  return undefined;
}
