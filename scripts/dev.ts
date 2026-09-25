/**
 * Development runner: starts the backend (Nest) and web (Next) dev servers
 * together. Exit with Ctrl-C stops both.
 */
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const children = [
  spawn("bun", ["run", "dev:api"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env },
  }),
  spawn("bun", ["run", "dev:web"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, PORT: process.env.WEB_PORT ?? "3000" },
  }),
];

for (const child of children) {
  child.on("error", (error) => {
    console.error(`dev: failed to start (${String(error)})`);
    process.exit(1);
  });
}

function shutdown() {
  for (const child of children) {
    child.kill("SIGINT");
  }
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});
