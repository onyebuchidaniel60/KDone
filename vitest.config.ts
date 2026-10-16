import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Mirrors the `@/*` -> `apps/web/src/*` alias from apps/web/tsconfig.json so
// server modules that import "@/auth" resolve under plain vitest.
const alias = { "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    // Repro suites require DATABASE_URL (real Postgres); run via `pnpm test:repro`.
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**", "**/*.repro.test.ts", "**/*.integration.test.ts"],
  },
});