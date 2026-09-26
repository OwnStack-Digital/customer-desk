import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadDotEnvIfPresent,
  rootsFromBackendEntry,
  rootsFromMigrationRunner,
} from "./env-file";

const VAR = "BOS_ENV_FILE_SPEC";

describe("loadDotEnvIfPresent", () => {
  const dirs: string[] = [];

  afterEach(() => {
    delete process.env[VAR];
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "bos-env-"));
    dirs.push(dir);
    return dir;
  }

  it("loads the repo-root .env when the backend has none", () => {
    const repoRoot = tempDir();
    const backendRoot = tempDir();
    writeFileSync(join(repoRoot, ".env"), `${VAR}=from-repo\n`);

    const loaded = loadDotEnvIfPresent({ backendRoot, repoRoot });

    expect(loaded).toBe(join(repoRoot, ".env"));
    expect(process.env[VAR]).toBe("from-repo");
  });

  it("prefers apps/backend/.env over the repo root", () => {
    const repoRoot = tempDir();
    const backendRoot = tempDir();
    writeFileSync(join(repoRoot, ".env"), `${VAR}=from-repo\n`);
    writeFileSync(join(backendRoot, ".env"), `${VAR}=from-backend\n`);

    const loaded = loadDotEnvIfPresent({ backendRoot, repoRoot });

    expect(loaded).toBe(join(backendRoot, ".env"));
    expect(process.env[VAR]).toBe("from-backend");
  });

  it("resolves repo root from both backend entry layouts", () => {
    expect(rootsFromBackendEntry("/repo/apps/backend/src")).toEqual({
      backendRoot: "/repo/apps/backend",
      repoRoot: "/repo",
    });
    expect(rootsFromBackendEntry("/repo/apps/backend/dist")).toEqual({
      backendRoot: "/repo/apps/backend",
      repoRoot: "/repo",
    });
    expect(
      rootsFromMigrationRunner(
        "/repo/apps/backend/src/infrastructure/database",
      ),
    ).toEqual({
      backendRoot: "/repo/apps/backend",
      repoRoot: "/repo",
    });
  });

  it("does not override variables already in the environment", () => {
    const repoRoot = tempDir();
    writeFileSync(join(repoRoot, ".env"), `${VAR}=from-file\n`);
    process.env[VAR] = "already-set";

    loadDotEnvIfPresent({ backendRoot: tempDir(), repoRoot });

    expect(process.env[VAR]).toBe("already-set");
  });
});
