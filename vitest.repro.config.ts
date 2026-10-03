import { defineConfig } from "vitest/config";

// Focused repro runner. Requires DATABASE_URL (real Postgres).
export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.repro.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});