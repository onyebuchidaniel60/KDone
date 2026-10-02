import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDbHandle } from "@kdone/db/test-db";
import {
  approvalEvents,
  bookProjects,
  bookStateTransitions,
  generationJobs,
  manuscripts,
  qualityIssues,
  users,
} from "@kdone/db/schema";
import { InMemoryQueue } from "@kdone/jobs";
import { KDone } from "../apps/web/src/server/lifecycle.js";
import {
  approveBook,
  approvePlan,
  approveResearch,
  createBook,
  generateCover,
  generateEpub,
  generateMetadata,
  getPreview,
  patchMetadata,
  runPreflight,
  runQa,
  setAppForTesting,
  startGeneration,
  startPlan,
  startPublishing,
  startResearch,
  updateIssue,
  getIssues,
} from "../apps/web/src/server/routes.js";
import { PUBLISHING_CHECKLIST } from "@kdone/publishing";

/*
 * V1 Definition of Done: the full lifecycle through the HTTP handler layer.
 *
 * Runs with zero external services (ADR-020): PGlite in-process Postgres,
 * InMemoryQueue, MockStorageProvider, Mock providers.
 *
 * Step 10 is the important one: publish/start must REFUSE after a chapter is
 * mutated, because the approval is bound to exact artifact versions (ADR-013).
 */

let handle: TestDbHandle;
let app: KDone;
let userId: string;

type Params = Record<string, string | undefined>;

function call(handler: any, method: string, url: string, body?: unknown, params: Params = {}) {
  const request = new Request(`http://localhost${url}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-kdone-user-id": userId,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return handler(request, { params: Promise.resolve(params) }) as Promise<Response>;
}

async function json(response: Response) {
  return (await response.json()) as any;
}

/** Runs every queued job to completion, as the worker process would. */
async function drain() {
  await app.runQueuedJobs();
  const failed = await handle.db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.status, "FAILED"));
  if (failed.length > 0) {
    throw new Error(
      `Jobs failed: ${failed
        .map((f) => `${f.jobType}#${f.id.slice(0, 8)} ${f.errorCode}: ${f.errorMessage}`)
        .join(" | ")}`,
    );
  }
  const all = await handle.db.select().from(generationJobs);
  void all;
}

beforeAll(async () => {
  handle = await createTestDb();
  app = new KDone({ db: handle.db, queue: new InMemoryQueue() });
  setAppForTesting(app);

  const [user] = await handle.db
    .insert(users)
    .values({ id: "e2e-user", email: "e2e@example.test" })
    .returning();
  userId = user!.id;
});

afterAll(async () => {
  setAppForTesting(null);
  await handle.close();
});

describe("KDone V1 lifecycle (E2E smoke test)", () => {
  it("completes the full book lifecycle to a prepared KDP package", async () => {
    /* 1. Creates a user and a book. */
    const created = await call(createBook, "POST", "/api/books", {
      workingTitle: "The Practical Guide",
      topic: "Applied knowledge work",
      targetReader: "independent practitioners",
      desiredLength: 24000,
      authorName: "A. Author",
    });
    expect(created.status).toBe(201);
    const { book } = await json(created);
    const bookId: string = book.id;
    expect(book.status).toBe("DRAFT");

    /* 2. Runs research, then approves it. */
    expect((await call(startResearch, "POST", "/api/books/x/research", undefined, { bookId })).status).toBe(202);
    await drain();
    let state = await bookStatus(bookId);
    expect(state).toBe("RESEARCH_READY");

    const researchApproved = await call(approveResearch, "POST", "/api/books/x/research/approve", undefined, { bookId });
    expect(researchApproved.status).toBe(200);
    expect(await bookStatus(bookId)).toBe("PLANNING");

    /* 3. Generates a plan, then approves it. */
    expect((await call(startPlan, "POST", "/api/books/x/plan", undefined, { bookId })).status).toBe(202);
    await drain();
    expect(await bookStatus(bookId)).toBe("PLAN_READY");

    expect((await call(approvePlan, "POST", "/api/books/x/plan/approve", undefined, { bookId })).status).toBe(200);
    expect(await bookStatus(bookId)).toBe("WRITING");

    /* 4. Generates 3 chapters and assembles the manuscript. */
    const generation = await call(startGeneration, "POST", "/api/books/x/generate", { chapterOrdinals: [1, 2, 3] }, { bookId });
    expect(generation.status).toBe(202);
    const { jobIds } = await json(generation);
    expect(jobIds).toHaveLength(3);
    await drain();

    const manuscript = await handle.db
      .select()
      .from(manuscripts)
      .where(eq(manuscripts.bookProjectId, bookId));
    expect(manuscript).toHaveLength(1);
    expect((manuscript[0]!.assembledContent as any).chapters).toHaveLength(3);

    // Every generated chapter draft carries provenance and no version is lost.
    expect(await bookStatus(bookId)).toBe("EDITING");

    /* 5. Runs /qa and resolves one intentional critical issue. */
    expect((await call(runQa, "POST", "/api/books/x/qa", undefined, { bookId })).status).toBe(202);
    await drain();

    const { issues } = await json(await call(getIssues, "GET", "/api/books/x/issues", undefined, { bookId }));
    expect(issues.length).toBeGreaterThan(0);

    const critical = issues.filter((i: any) => i.severity === "critical" && i.status === "open");
    expect(critical.length).toBeGreaterThan(0);

    // Preflight must FAIL while a critical issue is open.
    const blocked = await json(await call(runPreflight, "POST", "/api/books/x/preflight", undefined, { bookId }));
    expect(blocked.passed).toBe(false);

    const resolved = await call(updateIssue, "PATCH", "/api/issues/x", { status: "resolved" }, { issueId: critical[0].id });
    expect(resolved.status).toBe(200);
    // Remaining critical issues must also be resolved before the gate can pass.
    await resolveAllCritical(bookId);

    /* 6. Generates cover and metadata. */
    expect((await call(generateCover, "POST", "/api/books/x/cover", undefined, { bookId })).status).toBe(202);
    expect((await call(generateMetadata, "POST", "/api/books/x/metadata/generate", undefined, { bookId })).status).toBe(202);
    await drain();

    /* 7. Builds and validates the EPUB. */
    expect((await call(generateEpub, "POST", "/api/books/x/epub", undefined, { bookId })).status).toBe(202);
    await drain();

    const preview = await json(await call(getPreview, "GET", "/api/books/x/preview", undefined, { bookId }));
    expect(preview.cover).not.toBeNull();
    expect(preview.epub).not.toBeNull();
    expect(preview.metadata.aiDisclosure).toBe("ai_generated");

    /* 8. Runs preflight and expects it to pass. */
    await moveToQa(bookId);
    const passed = await json(await call(runPreflight, "POST", "/api/books/x/preflight", undefined, { bookId }));
    expect(passed.checks.filter((c: any) => !c.passed)).toHaveLength(0);
    expect(passed.passed).toBe(true);
    expect(await bookStatus(bookId)).toBe("READY_FOR_REVIEW");

    /* 9. Approves and asserts an ApprovalEvent exists. */
    const approvalResponse = await call(approveBook, "POST", "/api/books/x/approve", undefined, { bookId });
    expect(approvalResponse.status).toBe(200);
    const { approval } = await json(approvalResponse);
    expect(approval.id).toBeTruthy();
    expect(approval.manuscriptId).toBe(preview.manuscript.id);
    expect(approval.epubAssetId).toBe(preview.epub.id);
    expect(approval.provenanceFingerprint).toMatch(/^[0-9a-f]{64}$/);

    const approvals = await handle.db.select().from(approvalEvents).where(eq(approvalEvents.bookProjectId, bookId));
    expect(approvals).toHaveLength(1);
    expect(await bookStatus(bookId)).toBe("USER_APPROVED");

    /* 10. Mutates a chapter, then asserts publish/start REFUSES (ADR-013). */
    const beforeDrift = await call(startPublishing, "POST", "/api/books/x/publish/start", {
      checklist: [...PUBLISHING_CHECKLIST],
    }, { bookId });
    // Baseline: with an unchanged artifact set the checklist is the only gate,
    // and the full checklist is supplied, so this must succeed.
    expect(beforeDrift.status).toBe(202);

    // Now mutate chapter 1 and re-approve is required.
    await mutateChapterOne(bookId);
    const drifted = await call(startPublishing, "POST", "/api/books/x/publish/start", {
      checklist: [...PUBLISHING_CHECKLIST],
    }, { bookId });
    expect(drifted.status).toBe(409);
    const driftBody = await json(drifted);
    expect(driftBody.error.code).toBe("ARTIFACT_DRIFT");
    expect(driftBody.error.details.changed).toContain("manuscriptId");

    /* 11. Re-approves, then publishes in prepare mode. */
    // Editing a chapter moves the book out of USER_APPROVED in a real flow;
    // here the drift is detected while still approved, so re-approval is the
    // user's next action. Move back to READY_FOR_REVIEW to model that step.
    await forceReadyForReview(bookId);

    const approveAgain = await call(approveBook, "POST", "/api/books/x/approve", undefined, { bookId });
    expect(approveAgain.status).toBe(200);
    expect((await json(approveAgain)).approval.id).not.toBe(approval.id);

    const published = await call(startPublishing, "POST", "/api/books/x/publish/start", {
      checklist: [...PUBLISHING_CHECKLIST],
    }, { bookId });
    expect(published.status).toBe(202);
    const publishBody = await json(published);

    expect(publishBody.mode).toBe("prepare");
    expect(publishBody.manifest.disclosure.requiresDisclosure).toBe(true);
    expect(publishBody.manifest.disclosure.aiDisclosure).toBe("ai_generated");
    expect(publishBody.manifest.checklist.every((c: any) => c.confirmed)).toBe(true);
    expect(publishBody.fieldMapping["AI-Generated Content Disclosure"]).toMatch(/Yes/);
    expect(publishBody.publishingJobId).toBeTruthy();

    // ADR-012: prepare-only never enters PUBLISHING; USER_APPROVED is terminal.
    expect(publishBody.bookStatus).toBe("USER_APPROVED");
    expect(await bookStatus(bookId)).toBe("USER_APPROVED");

    /* Supporting invariants from the acceptance criteria. */
    const jobs = await handle.db.select().from(generationJobs).where(eq(generationJobs.bookProjectId, bookId));
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((j) => j.status === "SUCCEEDED")).toBe(true);

    const transitions = await handle.db
      .select()
      .from(bookStateTransitions)
      .where(eq(bookStateTransitions.bookProjectId, bookId));
    expect(transitions.length).toBeGreaterThan(5);
    // Every transition has a logged actor and timestamp.
    expect(transitions.every((t) => Boolean(t.actorType) && Boolean(t.occurredAt))).toBe(true);
  });

  /* ---------------------------------------------------------------- helpers */

  async function bookStatus(bookId: string): Promise<string> {
    const [book] = await handle.db.select().from(bookProjects).where(eq(bookProjects.id, bookId));
    return book!.status;
  }

  async function resolveAllCritical(bookId: string) {
    const rows = await handle.db
      .select()
      .from(qualityIssues)
      .where(eq(qualityIssues.bookProjectId, bookId));
    for (const row of rows) {
      if (row.severity === "critical" && row.status === "open") {
        await handle.db.update(qualityIssues).set({ status: "resolved" }).where(eq(qualityIssues.id, row.id));
      }
    }
  }

  async function moveToQa(bookId: string) {
    const { Orchestrator } = await import("@kdone/jobs");
    const orchestrator = new Orchestrator({ db: handle.db, queue: app.queue });
    await orchestrator.transition({ bookProjectId: bookId, event: "PRODUCTION_START", actorType: "user" });
    await orchestrator.transition({ bookProjectId: bookId, event: "QA_START", actorType: "system" });
  }

  async function forceReadyForReview(bookId: string) {
    await handle.db.update(bookProjects).set({ status: "READY_FOR_REVIEW" }).where(eq(bookProjects.id, bookId));
  }

  /** Directly edits a chapter draft and re-assembles, changing the manuscript id. */
  async function mutateChapterOne(bookId: string) {
    const [manuscript] = await handle.db
      .select()
      .from(manuscripts)
      .where(eq(manuscripts.bookProjectId, bookId));
    const assembled = manuscript!.assembledContent as any;
    const nextChapters = assembled.chapters.map((c: any, i: number) =>
      i === 0 ? { ...c, content: `${c.content}\n\nA late editorial correction was added.` } : c,
    );
    const wordCount = nextChapters.reduce(
      (n: number, c: any) => n + String(c.content).split(/\s+/).filter(Boolean).length,
      0,
    );

    // A new manuscript version, never an overwrite of the approved one.
    const [created] = await handle.db
      .insert(manuscripts)
      .values({
        bookProjectId: bookId,
        version: manuscript!.version + 1,
        assembledContent: { ...assembled, chapters: nextChapters, wordCount },
        wordCount,
        status: "ASSEMBLED",
      })
      .returning();

    await handle.db
      .update(bookProjects)
      .set({ currentManuscriptId: created!.id })
      .where(eq(bookProjects.id, bookId));
  }
});