import { describe, expect, it } from "vitest";
import { createTestDb } from "@kdone/db/test-db";
import { InMemoryQueue } from "@kdone/jobs";
import { KDone } from "./index.js";

/**
 * Handler-registration drift guard.
 *
 * The bug this prevents: agent handlers lived only inside the web app's
 * container, so the worker started, consumed nothing, and every job sat at
 * QUEUED forever - which misdiagnosed itself as a Redis mismatch.
 *
 * This asserts the shared runtime registers handlers for every job type the
 * product can enqueue. If a job type is added to an enqueue call site without a
 * matching handler, this fails.
 */
describe("agent handler registration", () => {
  /** Every job type the API layer is able to enqueue. */
  const ENQUEUEABLE_JOB_TYPES = [
    "research",
    "planning",
    "writing",
    "qa",
    "cover",
    "metadata",
    "epub",
  ] as const;

  it("registers a handler for every enqueueable job type", async () => {
    const handle = await createTestDb();
    try {
      const app = new KDone({
        db: handle.db,
        queue: new InMemoryQueue({ autoDeliver: false }),
      });

      const registered = app.registeredJobTypes();

      for (const jobType of ENQUEUEABLE_JOB_TYPES) {
        expect(registered, `missing handler for "${jobType}"`).toContain(jobType);
      }
    } finally {
      await handle.close();
    }
  });

  it("registers no job types beyond the known set", async () => {
    const handle = await createTestDb();
    try {
      const app = new KDone({
        db: handle.db,
        queue: new InMemoryQueue({ autoDeliver: false }),
      });

      const extra = app.registeredJobTypes().filter(
        (t) => !(ENQUEUEABLE_JOB_TYPES as readonly string[]).includes(t),
      );
      expect(extra).toEqual([]);
    } finally {
      await handle.close();
    }
  });

  it("has no Next-only imports, so apps/worker can import it", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

    expect(source).not.toMatch(/from ["']@\/lib\//);
    expect(source).not.toMatch(/from ["']@\/auth["']/);
    expect(source).not.toMatch(/from ["']next\//);
  });
});