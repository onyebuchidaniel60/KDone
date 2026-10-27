import { Queue as BullQueue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { HandlerRegistry, deliveryJobId, type EnqueueOptions, type JobEnvelope, type JobHandler, type Queue } from "./queue.js";

/**
 * Production queue: BullMQ over Redis (ADR-016).
 *
 * This is the ONLY file permitted to import `bullmq` or `ioredis`.
 */
export interface BullMQQueueOptions {
  connection: string;
  prefix?: string;
  defaultAttempts?: number;
}

export class BullMQQueue implements Queue {
  readonly driver = "bullmq" as const;

  private readonly connection: IORedis;
  private readonly registry = new HandlerRegistry();
  private readonly workers: Worker[] = [];
  private readonly producers = new Map<string, BullQueue>();
  private readonly defaultAttempts: number;
  private readonly prefix: string;

  constructor(options: BullMQQueueOptions) {
    this.connection = new IORedis(options.connection, { maxRetriesPerRequest: null });
    this.defaultAttempts = options.defaultAttempts ?? 3;
    this.prefix = options.prefix ?? "kdone";
  }

  private producer(jobType: string): BullQueue {
    let producer = this.producers.get(jobType);
    if (!producer) {
      producer = new BullQueue(jobType, { connection: this.connection, prefix: this.prefix });
      this.producers.set(jobType, producer);
    }
    return producer;
  }

  async enqueue(jobType: string, payload: unknown, opts: EnqueueOptions = {}): Promise<string> {
    const durableJobId = (payload as { jobId?: string } | null)?.jobId ?? crypto.randomUUID();
    const attempt = opts.attempt ?? 0;
    // One BullMQ job per durable attempt. Re-adding the previous id (or a
    // stable id with removeOnComplete:false) is deduped, which is how retries
    // used to get stuck in RETRYING. The durable row remains the source of truth.
    const id = deliveryJobId(durableJobId, attempt);
    await this.producer(jobType).add(
      jobType,
      { id: durableJobId, type: jobType, payload, attemptsMade: attempt },
      {
        jobId: id,
        delay: opts.delayMs ?? 0,
        attempts: opts.attempts ?? this.defaultAttempts,
        removeOnComplete: false,
      },
    );
    return durableJobId;
  }

  registerWorker(jobType: string, handler: JobHandler): void {
    this.registry.register(jobType, handler);

    const worker = new Worker(
      jobType,
      async (bullJob: Job) => {
        const envelope = bullJob.data as JobEnvelope;
        await handler({ ...envelope, attemptsMade: bullJob.attemptsMade + 1 });
      },
      { connection: this.connection, prefix: this.prefix },
    );
    this.workers.push(worker);
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()));
    await this.connection.quit();
  }

  get registeredTypes(): string[] {
    return this.registry.types();
  }
}