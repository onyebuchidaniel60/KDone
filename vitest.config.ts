import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    // Repro suites require DATABASE_URL (real Postgres); run via `pnpm test:repro`.
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**", "**/*.repro.test.ts"],
  },
});