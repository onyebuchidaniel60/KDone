import { getDb } from "@/lib/db";
import { InMemoryQueue } from "@kdone/jobs";
import { selectStorage } from "@kdone/storage";
import { KDone } from "./lifecycle";

/*
 * Production application container.
 *
 * A lazy singleton: the first `getApp()` builds the container from the
 * environment and caches it in module scope. The route layer resolves the
 * instance through here, so no route needs anything wired up at import time.
 *
 * Tests can inject their own instance with `setAppForTesting()` (PGlite +
 * InMemoryQueue), which takes precedence.
 *
 * The web process only enqueues work; the separate worker process consumes it
 * (ADR-016). With no REDIS_URL the web app falls back to InMemoryQueue so local
 * dev works, but jobs then only run in-process.
 */

let cached: KDone | null = null;
let override: KDone | null = null;

function buildFromEnv(): KDone {
  // autoDeliver:false - the web app must never execute a job handler itself.
  // S3/R2 when configured, in-process mock otherwise (ADR-016 pattern).
  return new KDone({
    db: getDb(),
    queue: new InMemoryQueue({ autoDeliver: false }),
    storage: selectStorage(),
  });
}

export function getApp(): KDone {
  if (override) return override;
  if (!cached) cached = buildFromEnv();
  return cached;
}

/** Test seam: inject an instance (PGlite + InMemoryQueue). */
export function setAppForTesting(instance: KDone | null): void {
  override = instance;
}
