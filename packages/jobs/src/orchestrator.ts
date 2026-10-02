import { eq } from "drizzle-orm";
import { agentRuns, auditEvents, bookProjects, bookStateTransitions } from "@kdone/db/schema";
import type { AnyDb } from "@kdone/db";
import { errors, nextStatus, type BookEvent, type JobType } from "@kdone/shared";
import { JobStore } from "./job-store.js";
import type { Queue } from "./queue.js";

export interface ProviderUsage {
  provider: string;
  model: string;
  inputUnits: number;
  outputUnits: number;
  estimatedCost: number;
  durationMs: number;
}

export interface OrchestratorDeps {
  db: AnyDb;
  queue: Queue;
}

export interface EnqueueRequest {
  userId: string;
  bookProjectId: string;
  jobType: JobType;
  input?: Record<string, unknown>;
  /** Lifecycle event applied when the job is created, e.g. RESEARCH_START. */
  event?: BookEvent;
  reason?: string;
  maxAttempts?: number;
}

export interface EnqueuedJob {
  jobId: string;
  status: "QUEUED";
}

export interface AgentRunOutcome {
  agentType: string;
  usage: ProviderUsage;
  result?: Record<string, unknown>;
  output?: Record<string, unknown>;
  /** Lifecycle event applied after the job succeeds, e.g. RESEARCH_COMPLETE. */
  event?: BookEvent;
  actorId?: string | null;
}

/**
 * Central orchestrator (ARCHITECTURE section 5).
 *
 * Responsibilities:
 * 1. validate preconditions and ownership
 * 2. create a durable GenerationJob row
 * 3. transition book state through the centralized state machine
 * 4. enqueue delivery
 *
 * Job execution and AgentRun recording happen in the worker.
 */
export class Orchestrator {
  readonly jobs: JobStore;
  private readonly db: AnyDb;
  private readonly queue: Queue;

  constructor(deps: OrchestratorDeps) {
    this.db = deps.db;
    this.queue = deps.queue;
    this.jobs = new JobStore(deps.db);
  }

  /** Validates ownership and that the book exists. */
  async assertOwnership(bookProjectId: string, userId: string): Promise<void> {
    const [book] = await this.db
      .select({ id: bookProjects.id, userId: bookProjects.userId })
      .from(bookProjects)
      .where(eq(bookProjects.id, bookProjectId));

    if (!book) throw errors.bookNotFound(bookProjectId);
    if (book.userId !== userId) {
      // Deliberately indistinguishable from "not found" to avoid leaking existence.
      throw errors.bookNotFound(bookProjectId);
    }
  }

  async enqueue(request: EnqueueRequest): Promise<EnqueuedJob> {
    await this.assertOwnership(request.bookProjectId, request.userId);

    const job = await this.jobs.create({
      userId: request.userId,
      bookProjectId: request.bookProjectId,
      jobType: request.jobType,
      input: request.input,
      maxAttempts: request.maxAttempts,
    });

    if (request.event) {
      await this.transition({
        bookProjectId: request.bookProjectId,
        event: request.event,
        actorType: "user",
        actorId: request.userId,
        jobId: job.id,
        reason: request.reason ?? `enqueue ${request.jobType}`,
      });
    }

    await this.queue.enqueue(request.jobType, { jobId: job.id, ...(request.input ?? {}) });

    return { jobId: job.id, status: "QUEUED" };
  }

  /** Applies a lifecycle event and appends to the transition log. */
  async transition(input: {
    bookProjectId: string;
    event: BookEvent;
    actorType: "user" | "system" | "agent";
    actorId?: string | null;
    jobId?: string | null;
    reason?: string;
    publishingMode?: "prepare" | "assisted" | "automated";
  }): Promise<{ from: string; to: string }> {
    const [book] = await this.db
      .select({ status: bookProjects.status })
      .from(bookProjects)
      .where(eq(bookProjects.id, input.bookProjectId));

    if (!book) throw errors.bookNotFound(input.bookProjectId);

    const to = nextStatus(book.status, input.event, { publishingMode: input.publishingMode });
    const occurredAt = new Date();

    await this.db.insert(bookStateTransitions).values({
      bookProjectId: input.bookProjectId,
      fromState: book.status,
      toState: to,
      event: input.event,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      jobId: input.jobId ?? null,
      reason: input.reason ?? null,
      occurredAt,
    });

    await this.db.update(bookProjects).set({ status: to, updatedAt: occurredAt }).where(eq(bookProjects.id, input.bookProjectId));

    return { from: book.status, to };
  }

  /** Records provider usage, duration and cost for an agent run. */
  async recordAgentRun(jobId: string, outcome: AgentRunOutcome): Promise<string> {
    const [run] = await this.db
      .insert(agentRuns)
      .values({
        generationJobId: jobId,
        agentType: outcome.agentType,
        provider: outcome.usage.provider,
        model: outcome.usage.model,
        inputUnits: outcome.usage.inputUnits,
        outputUnits: outcome.usage.outputUnits,
        estimatedCost: String(outcome.usage.estimatedCost),
        durationMs: outcome.usage.durationMs,
        status: "SUCCEEDED",
      })
      .returning({ id: agentRuns.id });

    return run?.id ?? "";
  }

  async audit(entry: {
    userId?: string | null;
    bookProjectId?: string | null;
    actorType: "user" | "system" | "agent";
    eventType: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.insert(auditEvents).values({
      userId: entry.userId ?? null,
      bookProjectId: entry.bookProjectId ?? null,
      actorType: entry.actorType,
      eventType: entry.eventType,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata ?? {},
    });
  }
}