import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createDb } from "@kdone/db";
import { selectQueue, Worker } from "@kdone/jobs";

/*
 * BullMQ worker process (ADR-016).
 *
 * Local (laptop) architecture: this process runs on the developer's machine and
 * consumes from the SAME Redis that Vercel enqueues to. No Render.
 *
 * Environment:
 *   - Real environment variables always win.
 *   - Otherwise a gitignored `.env.worker` at the repo root is loaded, so the
 *     worker picks up DATABASE_URL / REDIS_URL / QUEUE_DRIVER without inline
 *     PowerShell env setup every time.
 *
 * Agent handlers (research, planning, writing, ...) are registered in the
 * later build phases; until then the worker starts, recovers, and idles.
 */

// Repo root = apps/worker/src -> ../../..
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const workerEnvPath = join(repoRoot, ".env.worker");

if (existsSync(workerEnvPath)) {
  loadEnv({ path: workerEnvPath });
  console.log(`Loaded environment from ${workerEnvPath}`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is not set.\n" +
        "  Local: docker compose up -d, then set DATABASE_URL=postgres://kdone:kdone@localhost:5432/kdone",
    );
    process.exit(1);
  }

  const { db } = createDb();
  const queue = await selectQueue();
  const worker = new Worker({ db, queue });

  // TODO(architecture): agent handlers live on the `KDone` container in
  // apps/web/src/server/lifecycle.ts (private registerHandlers). The worker
  // cannot import it because that module depends on the Next-only `@/lib/db`
  // and `@/auth` aliases. Until those handlers are extracted into a
  // worker-safe module, this process consumes nothing and every job stays
  // QUEUED. See docs/AI_HANDOFF.md.

  const recovered = await worker.recoverStaleJobs();
  if (recovered.length > 0) {
    console.log(`Recovered ${recovered.length} abandoned job(s): ${recovered.join(", ")}`);
  }

  await worker.start();
  console.log(`Worker started with queue driver "${queue.driver}".`);

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}; shutting down worker.`);
    await worker.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error("Worker failed to start:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});