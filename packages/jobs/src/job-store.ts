import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { generationJobs, type GenerationJob } from "@kdone/db/schema";
import type { AnyDb } from "@kdone/db";
import type { JobStatus, JobType } from "@kdone/shared";

/**
 * The `generation_jobs` table is the durable source of truth for long-running
 * work. The queue only delivers; it is never trusted to hold state.
 */
export interface JobRecordInput {
  userId: string;
  bookProjectId: string;
  jobType: JobType;
  input?: Record<string, unknown>;
  maxAttempts?: number;
}

export interface ClaimedJob extends GenerationJob {
  input: Record<string, unknown>;
}

export class JobStore {
  constructor(private readonly db: AnyDb) {}

  async create(input: JobRecordInput): Promise<GenerationJob> {
    const [job] = await this.db
      .insert(generationJobs)
      .values({
        userId: input.userId,
        bookProjectId: input.bookProjectId,
        jobType: input.jobType,
        status: "QUEUED",
        input: input.input ?? {},
        maxAttempts: input.maxAttempts ?? 3,
      })
      .returning();

    if (!job) throw new Error("failed to create generation job");
    return job;
  }

  async markRunning(jobId: string): Promise<void> {
    await this.db
      .update(generationJobs)
      .set({ status: "RUNNING", startedAt: new Date(), attempts: sql`${generationJobs.attempts} + 1` })
      .where(eq(generationJobs.id, jobId));
  }

  async markSucceeded(jobId: string, output?: Record<string, unknown>): Promise<void> {
    await this.db
      .update(generationJobs)
      .set({ status: "SUCCEEDED", output: output ?? {}, completedAt: new Date(), errorCode: null, errorMessage: null })
      .where(eq(generationJobs.id, jobId));
  }

  /** Records a failure and decides whether the job may be retried. */
  async markFailed(jobId: string, error: { code: string; message: string }): Promise<"RETRYING" | "FAILED"> {
    const [row] = await this.db
      .update(generationJobs)
      .set({ errorCode: error.code, errorMessage: error.message.slice(0, 2000) })
      .where(eq(generationJobs.id, jobId))
      .returning({ attempts: generationJobs.attempts, maxAttempts: generationJobs.maxAttempts });

    const attempts = row?.attempts ?? 0;
    const maxAttempts = row?.maxAttempts ?? 1;

    if (attempts < maxAttempts) {
      await this.db
        .update(generationJobs)
        .set({ status: "RETRYING" })
        .where(eq(generationJobs.id, jobId));
      return "RETRYING";
    }

    await this.db
      .update(generationJobs)
      .set({ status: "FAILED", completedAt: new Date() })
      .where(eq(generationJobs.id, jobId));
    return "FAILED";
  }

  async markQueued(jobId: string): Promise<void> {
    await this.db
      .update(generationJobs)
      .set({ status: "QUEUED", startedAt: null })
      .where(eq(generationJobs.id, jobId));
  }

  async findById(jobId: string): Promise<GenerationJob | undefined> {
    const [job] = await this.db.select().from(generationJobs).where(eq(generationJobs.id, jobId));
    return job;
  }

  async listForBook(bookProjectId: string): Promise<GenerationJob[]> {
    return this.db.select().from(generationJobs).where(eq(generationJobs.bookProjectId, bookProjectId));
  }

  /**
   * Jobs left RUNNING by a worker that died. Re-queued on worker startup so
   * work survives a restart instead of being silently lost.
   */
  async findStaleRunning(olderThan: Date): Promise<GenerationJob[]> {
    return this.db
      .select()
      .from(generationJobs)
      .where(
        and(
          eq(generationJobs.status, "RUNNING"),
          lt(sql`coalesce(${generationJobs.startedAt}, ${generationJobs.queuedAt})`, olderThan),
        ),
      );
  }

  async listByStatus(status: JobStatus[]): Promise<GenerationJob[]> {
    return this.db.select().from(generationJobs).where(inArray(generationJobs.status, status));
  }
}