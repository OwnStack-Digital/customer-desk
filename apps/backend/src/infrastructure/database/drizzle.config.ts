import { resolve } from "node:path";
import { defineConfig } from "drizzle-kit";

// Config file lives in src/infrastructure/database so that every Drizzle
// import stays inside the persistence adapter or infrastructure
// (ground rules). Anchored to this file: holds for src and dist alike.
const backendRoot = resolve(__dirname, "..", "..", "..");

const dialect = process.env.DB_DIALECT === "sqlite" ? "sqlite" : "postgresql";

// Slice 0 has no tables yet; `schema.ts` is empty on purpose. Tables land in
// the slice that first writes them (see docs/PLAN.md "Tables").
export default defineConfig(
  dialect === "sqlite"
    ? {
        dialect: "sqlite",
        schema: resolve(
          backendRoot,
          "src/adapters/outbound/persistence/schema.ts",
        ),
        out: resolve(backendRoot, "drizzle/migrations"),
        dbCredentials: {
          url: process.env.DATABASE_URL ?? "file:./bos.dev.db",
        },
      }
    : {
        dialect: "postgresql",
        schema: resolve(
          backendRoot,
          "src/adapters/outbound/persistence/schema.ts",
        ),
        out: resolve(backendRoot, "drizzle/migrations"),
        dbCredentials: {
          url:
            process.env.DATABASE_URL ?? "postgres://bos:bos@127.0.0.1:5432/bos",
        },
      },
);
