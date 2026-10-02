import type { JobType } from "@kdone/shared";

/**
 * A unit of work as it travels through the queue.
 *
 * `id` is the GenerationJob id, which is also the durable source of truth.
 * Queue delivery is deliberately *not* the source of truth: the job row in
 * Postgres is what makes work survive a worker restart.
 */
export interface JobEnvelope<P = unknown> {
  id: string;
  type: string;
  payload: P;
  attemptsMade: number;
}

export interface EnqueueOptions {
  /** Delay before the job becomes available, in milliseconds. */
  delayMs?: number;
  /** Overrides the persisted maxAttempts for this delivery attempt. */
  attempts?: number;
}

export type JobHandler = (job: JobEnvelope) => Promise<void>;

/**
 * The only queue surface the application depends on (ADR-016 amendment).
 *
 * Production uses `BullMQQueue` (BullMQ over Redis). Tests and single-process
 * local dev use `InMemoryQueue`. Orchestrators, agents, routes and tests must
 * depend on this interface; only `bullmq-queue.ts` may import bullmq.
 */
export interface Queue {
  readonly driver: "bullmq" | "memory";

  /** Publishes a job. Resolves to the job id. */
  enqueue(jobType: JobType | string, payload: unknown, opts?: EnqueueOptions): Promise<string>;

  /** Registers the handler for a job type. Handlers run in this process. */
  registerWorker(jobType: JobType | string, handler: JobHandler): void;

  /** Starts consuming. Optional for queues that deliver on enqueue. */
  start?(): Promise<void>;

  /** Stops consuming and releases connections. */
  close(): Promise<void>;
}

/** Handler registry, shared by both queue implementations. */
export class HandlerRegistry {
  private readonly handlers = new Map<string, JobHandler>();

  register(jobType: string, handler: JobHandler): void {
    this.handlers.set(jobType, handler);
  }

  get(jobType: string): JobHandler | undefined {
    return this.handlers.get(jobType);
  }

  has(jobType: string): boolean {
    return this.handlers.has(jobType);
  }

  types(): string[] {
    return [...this.handlers.keys()];
  }
}