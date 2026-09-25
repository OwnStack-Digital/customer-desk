import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { collectViolations } from "./architecture-check";

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeCoreDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bos-arch-check-"));
  tempDirs.push(dir);
  const coreDir = join(dir, "core");
  mkdirSync(coreDir, { recursive: true });
  return coreDir;
}

describe("collectViolations", () => {
  it("reports an @nestjs/common import under a core-shaped directory", () => {
    const coreDir = makeCoreDir();
    writeFileSync(
      join(coreDir, "use-case.ts"),
      'import { Injectable } from "@nestjs/common";\n',
    );

    const violations = collectViolations(coreDir);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("@nestjs/common");
    expect(violations[0]).toContain("use-case.ts");
  });

  it("reports zod, drizzle-orm, fs, and escaping relative imports", () => {
    const coreDir = makeCoreDir();
    mkdirSync(join(coreDir, "ports"));
    writeFileSync(
      join(coreDir, "ports", "zod.ts"),
      'import { z } from "zod";\n',
    );
    writeFileSync(
      join(coreDir, "ports", "drizzle.ts"),
      'import { eq } from "drizzle-orm";\n',
    );
    writeFileSync(join(coreDir, "fs-bare.ts"), 'import "fs";\n');
    writeFileSync(
      join(coreDir, "node-fs.ts"),
      'import { readFile } from "node:fs";\n',
    );
    writeFileSync(
      join(coreDir, "node-fs-promises.ts"),
      'import { readFile } from "node:fs/promises";\n',
    );
    mkdirSync(join(coreDir, "deep"));
    writeFileSync(
      join(coreDir, "deep", "escape.ts"),
      'import { adapter } from "../../adapters/thing";\n',
    );
    writeFileSync(
      join(coreDir, "web.ts"),
      'import { page } from "../../../apps/web/lib/bos-api";\n',
    );

    const violations = collectViolations(coreDir);
    expect(violations).toHaveLength(7);
    expect(violations.join("\n")).toContain("zod");
    expect(violations.join("\n")).toContain("drizzle-orm");
    expect(violations.join("\n")).toContain('"fs"');
    expect(violations.join("\n")).toContain("node:fs");
    expect(violations.join("\n")).toContain("node:fs/promises");
    expect(violations.join("\n")).toContain("escapes core");
  });

  it("allows relative imports inside core and node: stdlib (except fs)", () => {
    const coreDir = makeCoreDir();
    writeFileSync(
      join(coreDir, "ports.ts"),
      "export interface Clock { now(): Date }\n",
    );
    writeFileSync(
      join(coreDir, "use-case.ts"),
      [
        'import type { Clock } from "./ports";',
        'import { randomUUID } from "node:crypto";',
        'import { setTimeout } from "node:timers/promises";',
        "export async function wait(clock: Clock) { await setTimeout(1); return clock.now(); }",
        "",
      ].join("\n"),
    );
    mkdirSync(join(coreDir, "domain"));
    writeFileSync(
      join(coreDir, "domain", "re-export.ts"),
      'export type { Clock } from "../ports";\n',
    );

    expect(collectViolations(coreDir)).toEqual([]);
  });

  it("finds zero violations in the real backend core tree", () => {
    const realCoreDir = join(
      import.meta.dirname ?? ".",
      "../apps/backend/src/core",
    );
    expect(collectViolations(realCoreDir)).toEqual([]);
  });
});
