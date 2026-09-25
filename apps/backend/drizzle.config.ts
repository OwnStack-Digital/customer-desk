import { defineConfig } from "drizzle-kit";

const dialect = process.env.DB_DIALECT === "sqlite" ? "sqlite" : "postgresql";

// Slice 0 has no tables yet; `schema.ts` is empty on purpose. Tables land in
// the slice that first writes them (see docs/PLAN.md "Tables").
export default defineConfig(
  dialect === "sqlite"
    ? {
        dialect: "sqlite",
        schema: "./src/adapters/outbound/persistence/schema.ts",
        out: "./drizzle/migrations",
        dbCredentials: {
          url: process.env.DATABASE_URL ?? "file:./bos.dev.db",
        },
      }
    : {
        dialect: "postgresql",
        schema: "./src/adapters/outbound/persistence/schema.ts",
        out: "./drizzle/migrations",
        dbCredentials: {
          url:
            process.env.DATABASE_URL ?? "postgres://bos:bos@127.0.0.1:5432/bos",
        },
      },
);
