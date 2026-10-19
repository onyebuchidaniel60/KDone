import {
  HandlerRegistry,
  selectQueue,
  selectQueueDriver,
  type EnqueueOptions,
  type JobHandler,
  type Queue,
} from "@kdone/jobs";

/*
 * The web container's queue: lazy and produce-only (ADR-016).
 *
 * Two constraints that a bare `selectQueue()` call cannot satisfy:
 *
 * 1. LAZY: `selectQueue()` is async, while the container exposes a sync
 *    `getApp()` with ~30 plain call sites (`await app().method(...)`, and
 *    sync `const { db } = app()` destructures). Awaiting a promise at every
 *    call site, or making the import eager (which would statically bundle
 *    bullmq/ioredis into the Next bundle), are both worse than resolving the
 *    driver on first use here.
 *
 * 2. PRODUCE-ONLY: `BullMQQueue.registerWorker()` constructs real BullMQ
 *    consumers. KDone's constructor registers handlers, so a web process
 *    holding a plain BullMQQueue would start consuming jobs inside serverless
 *    invocations and race the worker process - the exact failure ADR-016
 *    prohibits. Handler registration is therefore recorded locally but never
 *    forwarded; only the producer side (`enqueue`) reaches the real driver.
 *
 * The driver decision (REDIS_URL set -> BullMQ, unset -> InMemoryQueue,
 * QUEUE_DRIVER=memory override) stays in `@kdone/jobs`; see selectQueueDriver().
 * With no Redis the resolved fallback is `InMemoryQueue` with delivery
 * disabled (its default `autoDeliver: false`), which is what the container
 * used to hardcode by hand.
 */

export class LazyEnqueueQueue implements Queue {
  /** Mirrors selectQueue()'s decision synchronously; env is the truth here. */
  get driver(): "bullmq" | "memory" {
    return selectQueueDriver();
  }

  private inner: Promise<Queue> | null = null;
  private readonly registrations = new HandlerRegistry();

  /** The underlying driver queue, constructed at most once per instance. */
  resolved(): Promise<Queue> {
    this.inner ??= selectQueue();
    return this.inner;
  }

  /** Job types whose handler registration passed through from KDone. */
  registeredWorkerTypes(): string[] {
    return this.registrations.types();
  }

  enqueue(jobType: string, payload: unknown, opts?: EnqueueOptions): Promise<string> {
    return this.resolved().then((queue) => queue.enqueue(jobType, payload, opts));
  }

  /** Deliberately NOT forwarded - see the produce-only note above. */
  registerWorker(jobType: string, handler: JobHandler): void {
    this.registrations.register(jobType, handler);
  }

  /** Deliberately not implemented - the web process never starts consuming. */
  async close(): Promise<void> {
    await (await this.resolved()).close();
  }
}

/** Selector the container uses, mirroring `selectStorage()`'s role there. */
export function selectWebQueue(): LazyEnqueueQueue {
  return new LazyEnqueueQueue();
}
