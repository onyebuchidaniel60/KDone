export * from "./queue.js";
export * from "./in-memory-queue.js";
export * from "./job-store.js";
export * from "./orchestrator.js";
export * from "./worker.js";
export * from "./select-queue.js";

// NOTE: `bullmq-queue.ts` is deliberately NOT re-exported here.
// A static re-export would pull `bullmq` and `ioredis` into every consumer
// bundle, including the Next.js web app. BullMQ stays reachable only through
// the dynamic `import()` inside select-queue(), which is itself lazy, so
// BullMQQueue is resolved at runtime only when REDIS_URL is present.
export type { BullMQQueueOptions } from "./bullmq-queue.js";
