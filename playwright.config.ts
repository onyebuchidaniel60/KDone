import { defineConfig, devices } from "@playwright/test";

/*
 * Browser tests run against PRODUCTION-mode `next start`.
 * The app must be built and running before these execute (see DEPLOYMENT notes);
 * `pnpm test:browser` starts it via the webServer block below.
 *
 * Chromium binaries come from the machine cache at
 * %LOCALAPPDATA%\ms-playwright, so `playwright install` is not required.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.browser.test.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  reporter: [["list"]],
  use: {
    baseURL,
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm --filter web start --port 3100",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
