import { HandlerRegistry, type EnqueueOptions, type JobEnvelope, type JobHandler, type Queue } from "./queue.js";

/**
 * In-memory queue for tests and single-process local development.
 *
 * It provides no cross-process durability by design. Durability comes from the
 * `generation_jobs` row plus the worker's stale-job recovery, so a job whose
 * delivery is lost is re-queued after a restart (see `recoverStaleJobs`).
 */
export interface InMemoryQueueOptions {
  /**
   * Deliver on enqueue (default). Set false to step delivery manually with
   * `deliverAll()`, which makes retry and crash-recovery tests deterministic.
   */
  autoDeliver?: boolean;
}

export class InMemoryQueue implements Queue {
  readonly driver = "memory" as const;

  private readonly registry = new HandlerRegistry();
  private readonly pending: JobEnvelope[] = [];
  private readonly autoDeliver: boolean;
  private closed = false;
  /** Resolves once the queue is empty and no handler is running. */
  private idleWaiters: Array<() => void> = [];
  private running = 0;

  constructor(options: InMemoryQueueOptions = {}) {
    this.autoDeliver = options.autoDeliver ?? true;
  }

  async enqueue(jobType: string, payload: unknown, opts: EnqueueOptions = {}): Promise<string> {
    if (this.closed) throw new Error("InMemoryQueue is closed");

    const job: JobEnvelope = {
      id: (payload as { jobId?: string } | null)?.jobId ?? crypto.randomUUID(),
      type: jobType,
      payload,
      attemptsMade: 0,
    };

    if (!this.autoDeliver) {
      this.pending.push(job);
    } else if (opts.delayMs && opts.delayMs > 0) {
      setTimeout(() => void this.deliver(job), opts.delayMs).unref?.();
    } else {
      // Delivery is asynchronous, mirroring real queue semantics.
      queueMicrotask(() => void this.deliver(job));
    }

    return job.id;
  }

  registerWorker(jobType: string, handler: JobHandler): void {
    this.registry.register(jobType, handler);
  }

  async start(): Promise<void> {
    this.closed = false;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.pending.length = 0;
  }

  /**
   * Test helper: delivers the jobs queued *at call time*, exactly once each.
   * Jobs re-enqueued by a retry during delivery are left for the next call, so
   * each call corresponds to one attempt.
   */
  async deliverAll(): Promise<void> {
    const batch = this.pending.splice(0, this.pending.length);
    for (const job of batch) {
      await this.deliver(job);
    }
  }

  private async deliver(job: JobEnvelope): Promise<void> {
    const handler = this.registry.get(job.type);
    if (!handler || this.closed) return;

    this.running += 1;
    try {
      await handler(job);
    } finally {
      this.running -= 1;
      if (this.running === 0 && this.pending.length === 0) {
        const waiters = this.idleWaiters;
        this.idleWaiters = [];
        for (const resolve of waiters) resolve();
      }
    }
  }

  /** Test helper: waits until every delivered job has finished. */
  async drain(): Promise<void> {
    if (this.running === 0) return;
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  get registeredTypes(): string[] {
    return this.registry.types();
  }
}