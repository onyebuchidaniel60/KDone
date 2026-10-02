import type { AnyDb } from "@kdone/db";
import type { JobEnvelope, Queue } from "./queue.js";
import { JobStore } from "./job-store.js";
import { Orchestrator } from "./orchestrator.js";

/**
 * A job type implementation. Returns the AgentRun outcome to record.
 */
export type JobHandlerFn = (job: JobEnvelope, ctx: WorkerContext) => Promise<WorkerHandlerResult>;

export interface WorkerHandlerResult {
  output?: Record<string, unknown>;
  result?: Record<string, unknown>;
  agentType: string;
  usage: { provider: string; model: string; inputUnits: number; outputUnits: number; estimatedCost: number; durationMs: number };
  /** Lifecycle event applied on success. */
  event?: Parameters<Orchestrator["transition"]>[0]["event"];
  actorId?: string | null;
}

export interface WorkerContext {
  db: AnyDb;
  orchestrator: Orchestrator;
  jobs: JobStore;
}

export interface WorkerOptions {
  db: AnyDb;
  queue: Queue;
  /** Jobs RUNNING longer than this are considered abandoned. Default 5 minutes. */
  staleAfterMs?: number;
}

/**
 * Long-lived job consumer (apps/worker).
 *
 * Durability contract: the `generation_jobs` row is the source of truth. On
 * startup the worker recovers jobs abandoned by a previous process (still
 * RUNNING past the stale threshold) by returning them to QUEUED and
 * re-delivering them, so a crash mid-job does not lose the work.
 */
export class Worker {
  private readonly db: AnyDb;
  private readonly queue: Queue;
  private readonly jobs: JobStore;
  private readonly orchestrator: Orchestrator;
  private readonly handlers = new Map<string, JobHandlerFn>();
  private readonly staleAfterMs: number;

  constructor(options: WorkerOptions) {
    this.db = options.db;
    this.queue = options.queue;
    this.staleAfterMs = options.staleAfterMs ?? 5 * 60 * 1000;
    this.jobs = new JobStore(options.db);
    this.orchestrator = new Orchestrator({ db: options.db, queue: options.queue });
  }

  handle(jobType: string, handler: JobHandlerFn): this {
    this.handlers.set(jobType, handler);
    this.queue.registerWorker(jobType, (job) => this.execute(job));
    return this;
  }

  /**
   * Re-queues jobs abandoned by a dead worker. Returns the recovered job ids.
   */
  async recoverStaleJobs(now: Date = new Date()): Promise<string[]> {
    const staleBefore = new Date(now.getTime() - this.staleAfterMs);
    const stale = await this.jobs.findStaleRunning(staleBefore);
    const recovered: string[] = [];

    for (const job of stale) {
      await this.jobs.markQueued(job.id);
      await this.queue.enqueue(job.jobType, { jobId: job.id });
      recovered.push(job.id);
    }

    return recovered;
  }

  async start(): Promise<void> {
    await this.recoverStaleJobs();
    await this.queue.start?.();
  }

  async stop(): Promise<void> {
    await this.queue.close();
  }

  /** Exposed for the E2E test to drain a single job deterministically. */
  async runOnce(jobId: string): Promise<void> {
    const job = await this.jobs.findById(jobId);
    if (!job) throw new Error(`unknown job ${jobId}`);
    await this.execute({
      id: job.id,
      type: job.jobType,
      payload: (job.input ?? {}) as Record<string, unknown>,
      attemptsMade: job.attempts,
    });
  }

  private async execute(job: JobEnvelope): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) throw new Error(`no handler registered for job type ${job.type}`);

    await this.jobs.markRunning(job.id);
    const started = Date.now();

    try {
      const result = await handler(job, {
        db: this.db,
        orchestrator: this.orchestrator,
        jobs: this.jobs,
      });

      // Real measured duration, not the agent's self-report.
      const durationMs = result.usage.durationMs || Date.now() - started;

      await this.orchestrator.recordAgentRun(job.id, {
        agentType: result.agentType,
        usage: { ...result.usage, durationMs },
        result: result.result,
        output: result.output,
      });

      await this.jobs.markSucceeded(job.id, result.output ?? {});

      if (result.event) {
        const record = await this.jobs.findById(job.id);
        if (record) {
          await this.orchestrator.transition({
            bookProjectId: record.bookProjectId,
            event: result.event,
            actorType: "agent",
            jobId: job.id,
            reason: `${job.type} completed`,
          });
        }
      }
    } catch (error) {
      const code = error instanceof Error ? error.name : "PROVIDER_ERROR";
      const message = error instanceof Error ? error.message : String(error);

      const outcome = await this.jobs.markFailed(job.id, { code, message });

      if (outcome === "RETRYING") {
        // Re-deliver so the next attempt actually happens.
        await this.queue.enqueue(job.type, { jobId: job.id });
      }

      // Never report success on failure.
      if (outcome === "FAILED") {
        const record = await this.jobs.findById(job.id);
        if (record) {
          await this.orchestrator.audit({
            userId: record.userId,
            bookProjectId: record.bookProjectId,
            actorType: "system",
            eventType: "job.failed",
            entityType: "generation_job",
            entityId: job.id,
            metadata: { jobType: job.type, code, message },
          });
        }
      }
    }
  }
}