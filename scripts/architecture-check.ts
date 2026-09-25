/**
 * Architecture dependency check (PLAN.md task 0.4).
 *
 * Enforces that `apps/backend/src/core/` depends only on itself and the
 * Node/TS standard library: no adapters, infrastructure, apps/web,
 * NestJS, Drizzle, zod, fs, or any other bare package import.
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

/**
 * Matches `... from "x"`, `import "x"`, `import("x")`, and `require("x")`
 * specifiers. Conservative by design: a false positive only flags a file
 * that mentions an import-like shape in a string, which still deserves a
 * human look.
 */
const IMPORT_SPECIFIER_PATTERN =
  /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;

export function collectViolations(coreDir: string): string[] {
  const violations: string[] = [];
  for (const file of listSourceFiles(coreDir).sort()) {
    for (const specifier of extractImportSpecifiers(
      readFileSync(file, "utf8"),
    )) {
      const violation = violationFor(specifier, file, coreDir);
      if (violation) {
        violations.push(violation);
      }
    }
  }
  return violations;
}

function violationFor(
  specifier: string,
  file: string,
  coreRoot: string,
): string | null {
  if (specifier.startsWith(".")) {
    const target = resolve(dirname(file), specifier);
    const rel = relative(coreRoot, target);
    if (rel.startsWith("..") || rel === "") {
      return `${relativize(file, coreRoot)}: relative import "${specifier}" escapes core`;
    }
    return null;
  }
  if (specifier.startsWith("node:")) {
    if (specifier === "node:fs" || specifier.startsWith("node:fs/")) {
      return `${relativize(file, coreRoot)}: core must not read the filesystem (imported "${specifier}")`;
    }
    return null;
  }
  return `${relativize(file, coreRoot)}: core may not import "${specifier}"`;
}

function relativize(file: string, coreRoot: string): string {
  return relative(coreRoot, file) || basename(file);
}

function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(IMPORT_SPECIFIER_PATTERN)) {
    specifiers.push(match[1] as string);
  }
  return specifiers;
}

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Dependencies and build output are never part of the boundary.
      if (entry.name === "node_modules" || entry.name === ".next") {
        continue;
      }
      files.push(...listSourceFiles(path));
    } else if (/\.spec\.ts$/.test(entry.name)) {
    } else if (/\.(ts|tsx|mts|cts)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

/**
 * Web-boundary check (PLAN.md slice 2 acceptance): `apps/web` never
 * imports Drizzle, a database driver, or backend source; it talks to the
 * API over HTTP only via `lib/bos-api.ts`.
 */
const WEB_FORBIDDEN_SPECIFIERS = ["drizzle-orm", "better-sqlite3", "postgres"];

const WEB_FORBIDDEN_PATTERN = /(^|\/)backend\/(src|dist)\//;

export function collectWebViolations(webDir: string): string[] {
  const violations: string[] = [];
  for (const file of listSourceFiles(webDir).sort()) {
    for (const specifier of extractImportSpecifiers(
      readFileSync(file, "utf8"),
    )) {
      let violation: string | null = null;
      if (WEB_FORBIDDEN_SPECIFIERS.includes(specifier)) {
        violation = `imports "${specifier}"`;
      } else if (
        (specifier.startsWith(".") || specifier.startsWith("@/")) &&
        WEB_FORBIDDEN_PATTERN.test(specifier)
      ) {
        violation = `imports backend source "${specifier}"`;
      }
      if (violation) {
        violations.push(`${relativize(file, webDir)}: ${violation}`);
      }
    }
  }
  return violations;
}

/** CLI entry: checks the real repo's core tree and web app. */
export function main(): number {
  const coreDir = resolve(
    dirname(process.argv[1] ?? process.cwd()),
    "../apps/backend/src/core",
  );
  const violations = collectViolations(coreDir);
  const webDir = resolve(
    dirname(process.argv[1] ?? process.cwd()),
    "../apps/web",
  );
  violations.push(...collectWebViolations(webDir));
  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`architecture violation: ${violation}`);
    }
    console.error(
      `architecture check failed: ${violations.length} violation(s)`,
    );
    return 1;
  }
  console.log(`architecture check passed: ${coreDir}, ${webDir}`);
  return 0;
}

if (basename(process.argv[1] ?? "") === "architecture-check.ts") {
  process.exit(main());
}
