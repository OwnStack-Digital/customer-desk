import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/backend/src/**/*.spec.ts", "apps/web/lib/**/*.spec.ts", "scripts/**/*.spec.ts"],
  },
});