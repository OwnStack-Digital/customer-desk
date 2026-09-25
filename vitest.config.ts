import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/backend/src/**/*.spec.ts", "scripts/**/*.spec.ts"],
  },
});