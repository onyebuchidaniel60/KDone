import { createDb } from "@kdone/db";
import { selectQueue, Worker } from "@kdone/jobs";

/*
 * BullMQ worker process (ADR-016).
 *
 * Long-running work runs here, never inside a Next.js request handler.
 * The `generation_jobs` table is the durable source of truth: on startup this
 * process recovers jobs abandoned by a previous run (still RUNNING past the
 * stale threshold) and re-delivers them, so work survives a restart.
 *
 * Agent handlers (research, planning, writing, ...) are registered in the
 * later build phases; until then the worker starts, recovers, and idles.
 */

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

  // registerAgentHandlers(worker) is added per build phase.

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