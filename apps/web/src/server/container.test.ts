import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryQueue } from "@kdone/jobs";
import { KDone } from "./lifecycle";
import { getApp, resetAppForTest, setAppForTesting } from "./container";
import { LazyEnqueueQueue, selectWebQueue } from "./queue";

/**
 * Queue-selection drift guard.
 *
 * The bug this prevents: the container hardcoded `new InMemoryQueue({...})`
 * and never consulted `selectQueue()`, so with REDIS_URL set in production the
 * web app kept enqueueing into an in-process queue that dies with the
 * serverless invocation - jobs never reached Redis and the worker never saw
 * them. If a driver is hardcoded here again, these tests fail.
 */
describe("container queue selection", () => {
  beforeEach(() => {
    resetAppForTest();
  });

  afterEach(() => {
    setAppForTesting(null);
    resetAppForTest();
    vi.unstubAllEnvs();
  });

  function stubDbEnv(): void {
    // postgres.js objects are connection-free until first query; the container
    // build never queries, so a synthetic URL keeps this hermetic.
    vi.stubEnv("DATABASE_URL", "postgres://kdone:kdone@localhost:5432/kdone");
  }

  it("with REDIS_URL set, the container's queue selects BullMQ", () => {
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
    stubDbEnv();

    const app = getApp();

    expect(app).toBeInstanceOf(KDone);
    expect(app.queue).toBeInstanceOf(LazyEnqueueQueue);
    expect(app.queue.driver).toBe("bullmq");
    // All 7 agent handler registrations flow through the wrapper (recorded
    // locally, never forwarded - see the next test).
    expect((app.queue as LazyEnqueueQueue).registeredWorkerTypes().sort()).toEqual(
      ["cover", "epub", "metadata", "planning", "qa", "research", "writing"],
    );
  });

  it("with REDIS_URL unset, the container's queue selects InMemoryQueue", async () => {
    vi.stubEnv("REDIS_URL", "");
    stubDbEnv();

    const app = getApp();

    expect(app).toBeInstanceOf(KDone);
    expect(app.queue).toBeInstanceOf(LazyEnqueueQueue);
    expect(app.queue.driver).toBe("memory");
    // Resolving is a real, side-effect-free InMemoryQueue construction.
    expect((await (app.queue as LazyEnqueueQueue).resolved()).driver).toBe("memory");
  });

  it("QUEUE_DRIVER=memory forces memory even with REDIS_URL set", () => {
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
    vi.stubEnv("QUEUE_DRIVER", "memory");
    stubDbEnv();

    expect(getApp().queue.driver).toBe("memory");
  });

  it("resolves only on first use", () => {
    vi.stubEnv("REDIS_URL", "");
    const queue = selectWebQueue();

    // No awaiting yet - driver must be derivable synchronously from env.
    expect(queue.driver).toBe("memory");
  });

  it("does not forward handler registration into the driver queue", async () => {
    vi.stubEnv("REDIS_URL", "");

    const queue = selectWebQueue();
    const inner = await queue.resolved();
    queue.registerWorker("research", async () => {});
    queue.registerWorker("cover", async () => {});

    expect(inner).toBeInstanceOf(InMemoryQueue);
    expect(queue.registeredWorkerTypes()).toEqual(["research", "cover"]);
    // The real driver queue's own consumer registry stays empty: nothing in
    // the web process was installed as a consumer (ADR-016). The inner
    // InMemoryQueue only delivers from it via deliverAll(), which the web
    // never calls; a BullMQQueue would have created real consumers.
    expect((inner as InMemoryQueue).registeredTypes).toEqual([]);
  });

  it("container.ts has no hardcoded queue driver (structural guard)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const source = readFileSync(fileURLToPath(new URL("./container.ts", import.meta.url)), "utf8");

    expect(source).not.toMatch(/new InMemoryQueue/);
    expect(source).not.toMatch(/new BullMQQueue/);
    expect(source).toContain("selectWebQueue()");
  });
});
