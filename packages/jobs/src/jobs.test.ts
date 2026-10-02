import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDbHandle } from "@kdone/db/test-db";
import { agentRuns, bookProjects, bookStateTransitions, generationJobs, users } from "@kdone/db/schema";
import { InMemoryQueue } from "./in-memory-queue.js";
import { Orchestrator } from "./orchestrator.js";
import { Worker } from "./worker.js";

let handle: TestDbHandle;
let db: TestDbHandle["db"];
let userId: string;
let bookId: string;

beforeEach(async () => {
  handle = await createTestDb();
  db = handle.db;

  const [user] = await db
    .insert(users)
    .values({ id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` })
    .returning();
  const [book] = await db
    .insert(bookProjects)
    .values({ userId: user!.id, workingTitle: "Lifecycle Book", topic: "Durability" })
    .returning();

  userId = user!.id;
  bookId = book!.id;
});

afterEach(async () => {
  await handle.close();
});

function usage() {
  return { provider: "mock", model: "mock-1", inputUnits: 10, outputUnits: 20, estimatedCost: 0, durationMs: 5 };
}

describe("orchestrator", () => {
  it("creates a durable job row and enqueues delivery", async () => {
    const queue = new InMemoryQueue({ autoDeliver: false });
    const orchestrator = new Orchestrator({ db, queue });

    const { jobId, status } = await orchestrator.enqueue({
      userId,
      bookProjectId: bookId,
      jobType: "research",
      input: { topic: "durability" },
    });

    expect(status).toBe("QUEUED");

    const [row] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId));
    expect(row?.status).toBe("QUEUED");
    expect(row?.jobType).toBe("research");
  });

  it("refuses jobs for a book owned by another user", async () => {
    const queue = new InMemoryQueue({ autoDeliver: false });
    const orchestrator = new Orchestrator({ db, queue });

    await expect(
      orchestrator.enqueue({ userId: "someone-else", bookProjectId: bookId, jobType: "research" }),
    ).rejects.toThrow(/not found/i);
  });

  it("logs every state transition", async () => {
    const queue = new InMemoryQueue({ autoDeliver: false });
    const orchestrator = new Orchestrator({ db, queue });

    await orchestrator.transition({
      bookProjectId: bookId,
      event: "RESEARCH_START",
      actorType: "user",
      actorId: userId,
      reason: "user requested research",
    });

    const log = await db.select().from(bookStateTransitions).where(eq(bookStateTransitions.bookProjectId, bookId));
    expect(log).toHaveLength(1);
    expect(log[0]?.fromState).toBe("DRAFT");
    expect(log[0]?.toState).toBe("RESEARCHING");

    const [book] = await db.select().from(bookProjects).where(eq(bookProjects.id, bookId));
    expect(book?.status).toBe("RESEARCHING");
  });

  it("rejects an illegal transition", async () => {
    const queue = new InMemoryQueue({ autoDeliver: false });
    const orchestrator = new Orchestrator({ db, queue });

    await expect(
      orchestrator.transition({ bookProjectId: bookId, event: "APPROVE", actorType: "user" }),
    ).rejects.toThrow(/Cannot move book/);
  });
});

describe("worker execution", () => {
  it("records an AgentRun with provider, model and usage on success", async () => {
    const queue = new InMemoryQueue({ autoDeliver: false });
    const orchestrator = new Orchestrator({ db, queue });
    const worker = new Worker({ db, queue }).handle("research", async () => ({
      agentType: "research",
      usage: usage(),
      output: { sources: 3 },
      event: "RESEARCH_COMPLETE",
    }));

    const { jobId } = await orchestrator.enqueue({ userId, bookProjectId: bookId, jobType: "research", event: "RESEARCH_START" });
    await queue.deliverAll();

    const runs = await db.select().from(agentRuns).where(eq(agentRuns.generationJobId, jobId));
    expect(runs).toHaveLength(1);
    expect(runs[0]?.provider).toBe("mock");
    expect(runs[0]?.model).toBe("mock-1");
    expect(runs[0]?.inputUnits).toBe(10);

    const [book] = await db.select().from(bookProjects).where(eq(bookProjects.id, bookId));
    expect(book?.status).toBe("RESEARCH_READY");
  });

  it("retries a failing job up to maxAttempts, then marks FAILED", async () => {
    const queue = new InMemoryQueue({ autoDeliver: false });
    const orchestrator = new Orchestrator({ db, queue });
    let calls = 0;

    const worker = new Worker({ db, queue }).handle("planning", async () => {
      calls += 1;
      throw new Error("provider exploded");
    });

    const { jobId } = await orchestrator.enqueue({
      userId,
      bookProjectId: bookId,
      jobType: "planning",
      maxAttempts: 2,
    });

    await queue.deliverAll();
    let [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId));
    expect(job?.status).toBe("RETRYING");
    expect(calls).toBe(1);

    await queue.deliverAll();
    [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId));
    expect(job?.status).toBe("FAILED");
    expect(calls).toBe(2);

    // A failed job must not be reported as success and must not create an AgentRun.
    const runs = await db.select().from(agentRuns).where(eq(agentRuns.generationJobId, jobId));
    expect(runs).toHaveLength(0);
  });
});

describe("durability across a worker restart", () => {
  it("recovers a job abandoned mid-flight by a dead worker", async () => {
    const queue = new InMemoryQueue({ autoDeliver: false });
    const orchestrator = new Orchestrator({ db, queue });

    const { jobId } = await orchestrator.enqueue({
      userId,
      bookProjectId: bookId,
      jobType: "writing",
      event: "RESEARCH_START",
    });

    // Worker A claims the job and dies before finishing (job left RUNNING).
    const dyingWorker = new Worker({ db, queue, staleAfterMs: 0 }).handle("writing", async () => {
      throw new Error("worker process killed");
    });
    await dyingWorker.runOnce(jobId);

    // The failure is recorded; simulate the process vanishing while RUNNING.
    await db
      .update(generationJobs)
      .set({ status: "RUNNING" })
      .where(eq(generationJobs.id, jobId));

    const [before] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId));
    expect(before?.status).toBe("RUNNING");

    // Worker B starts fresh. It must find and re-queue the abandoned job.
    const recovered: string[] = [];
    const survivingWorker = new Worker({ db, queue, staleAfterMs: 0 }).handle("writing", async () => {
      recovered.push(jobId);
      return { agentType: "writing", usage: usage(), output: { words: 1200 } };
    });

    const found = await survivingWorker.recoverStaleJobs();
    expect(found).toContain(jobId);

    await survivingWorker.runOnce(jobId);

    expect(recovered).toContain(jobId);
    const [after] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId));
    expect(after?.status).toBe("SUCCEEDED");
  });

  it("does not recover jobs that are not stale", async () => {
    const queue = new InMemoryQueue({ autoDeliver: false });
    const orchestrator = new Orchestrator({ db, queue });
    const { jobId } = await orchestrator.enqueue({ userId, bookProjectId: bookId, jobType: "epub" });

    await db.update(generationJobs).set({ status: "RUNNING" }).where(eq(generationJobs.id, jobId));

    // staleAfterMs large => recently started job is still legitimately in flight.
    const freshWorker = new Worker({ db, queue, staleAfterMs: 10 * 60 * 1000 }).handle("epub", async () => ({
      agentType: "production",
      usage: usage(),
    }));

    const found = await freshWorker.recoverStaleJobs();
    expect(found).not.toContain(jobId);
  });
});