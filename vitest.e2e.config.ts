import { defineConfig } from "vitest/config";

// E2E smoke test. Runs with zero external services (ADR-020):
// PGlite in-process Postgres + InMemoryQueue + MockStorageProvider.
export default defineConfig({
  test: {
    environment: "node",
    include: ["e2e/**/*.e2e.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    env: {
      QUEUE_DRIVER: "memory",
      NODE_ENV: "test",
    },
  },
});