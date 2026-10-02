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
  const driver = (process.env.QUEUE_DRIVER ?? "").toLowerCase();
  const redisUrl = process.env.REDIS_URL;

  if (driver === "memory") return new InMemoryQueue();
  if (!redisUrl) return new InMemoryQueue();

  const { BullMQQueue } = await import("./bullmq-queue.js");
  return new BullMQQueue({ connection: redisUrl });
}