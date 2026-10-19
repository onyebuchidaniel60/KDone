import type { Queue } from "./queue.js";
import { InMemoryQueue } from "./in-memory-queue.js";

export type QueueDriver = "bullmq" | "memory";

/**
 * Queue selection (ADR-016 amendment).
 *
 * `QUEUE_DRIVER=memory` forces the in-memory queue. `NODE_ENV=test` without
 * `REDIS_URL` also defaults to it. `REDIS_URL` selects BullMQ/Redis.
 *
 * BullMQQueue is loaded lazily so a run without Redis never imports the
 * Redis client.
 */
export async function selectQueue(): Promise<Queue> {
  switch (selectQueueDriver()) {
    case "memory":
      return new InMemoryQueue();
    case "bullmq": {
      const { BullMQQueue } = await import("./bullmq-queue.js");
      return new BullMQQueue({ connection: process.env.REDIS_URL! });
    }
  }
}

/**
 * The same decision `selectQueue()` makes, resolved synchronously.
 *
 * Synchronous consumers (the web container exposes a sync `getApp()`) need the
 * driver without awaiting a queue. Kept in one place with `selectQueue()` so
 * the decision can never drift between the async and sync forms.
 */
export function selectQueueDriver(): QueueDriver {
  const driver = (process.env.QUEUE_DRIVER ?? "").toLowerCase();
  if (driver === "memory") return "memory";
  return process.env.REDIS_URL ? "bullmq" : "memory";
}