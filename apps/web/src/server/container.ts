import { getDb } from "@/lib/db";
import { selectStorage } from "@kdone/storage";
import { selectWebQueue } from "./queue";
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
 * The queue comes from `selectWebQueue()` (ADR-016), the same way storage
 * comes from `selectStorage()`: with REDIS_URL set the web app enqueues to
 * BullMQ/Redis, and falls back to the InMemoryQueue (delivery disabled) when
 * it is unset - exactly as `selectQueue()` in `@kdone/jobs` decides.
 * The web process only enqueues and never consumes; see ./queue.ts.
 */

let cached: KDone | null = null;
let override: KDone | null = null;

function buildFromEnv(): KDone {
  // S3/R2 when configured, in-process mock otherwise (ADR-016 pattern).
  return new KDone({
    db: getDb(),
    queue: selectWebQueue(),
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

/** Test seam: forget the cached container so a test can rebuild with fresh env. */
export function resetAppForTest(): void {
  cached = null;
  override = null;
}
