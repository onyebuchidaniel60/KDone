import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Mirrors the `@/*` -> `apps/web/src/*` alias from apps/web/tsconfig.json so
// server modules that import "@/auth" resolve under plain vitest.
const alias = {
  "@/auth": fileURLToPath(new URL("./e2e/stubs/auth.ts", import.meta.url)),
  "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
};

// E2E smoke test. Runs with zero external services (ADR-020):
// PGlite in-process Postgres + InMemoryQueue + MockStorageProvider.
export default defineConfig({
  resolve: { alias },
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