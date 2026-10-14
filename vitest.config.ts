import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Tests must never inherit the developer's live-AI selection from .env.
    env: { AI_ADAPTER: "fake" },
    include: ["apps/backend/src/**/*.spec.ts", "apps/web/lib/**/*.spec.ts", "scripts/**/*.spec.ts"],
  },
});