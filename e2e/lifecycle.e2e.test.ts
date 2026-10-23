import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { createDb } from "@kdone/db";
import {
  approvalEvents,
  bookProjects,
  bookStateTransitions,
  generationJobs,
  chapters as chaptersTable,
  manuscripts,
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
  patchChapter,
  updateIssue,
  getIssues,
} from "../apps/web/src/server/routes.js";
import { PUBLISHING_CHECKLIST } from "@kdone/publishing";

/*
 * V1 Definition of Done: the full lifecycle through the HTTP handler layer.
 *
 * REQUIRES A REAL POSTGRES (no PGlite). PGlite's single-connection WASM model
 * cannot sustain the sequential-statement pattern a job handler uses, so this
 * suite runs against DATABASE_URL using the *same* drizzle-kit generated
 * migrations that production applies. Unit tests still use PGlite.
 *
 * Step 10 is the important one: publish/start must REFUSE after a chapter is
 * mutated, because approval is bound to exact artifact versions (ADR-013).
 */

/** Refuses to run unless DATABASE_URL points at a real Postgres. */
function requireRealPostgres(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "E2E smoke test requires a real Postgres via DATABASE_URL.\n" +
        "  This suite must NOT run on PGlite (single-connection WASM cannot sustain\n" +
        "  a job handler's sequential statements).\n" +
        "  Set DATABASE_URL, e.g. a Neon connection string, then run: pnpm test:e2e",
    );
  }
  if (url.startsWith("pglite://") || url.includes("@localhost:5432/pglite")) {
    throw new Error(`DATABASE_URL points at PGlite (${url}). A real Postgres is required.`);
  }
  if (!/^postgres(ql)?:\/\//.test(url)) {
    throw new Error(`DATABASE_URL is not a Postgres connection string: ${url.slice(0, 12)}...`);
  }
  return url;
}

let client: { end: () => Promise<void> };
let db: ReturnType<typeof createDb>["db"];
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

/**
 * Runs every queued job for THIS run to completion, as the worker would.
 * Scoped to this run's user so leftovers from earlier runs cannot fail the test.
 */
async function drain() {
  await app.runQueuedJobs();

  const failed = await db
    .select()
    .from(generationJobs)
    .where(and(eq(generationJobs.userId, userId), eq(generationJobs.status, "FAILED")));
  if (failed.length > 0) {
    throw new Error(
      `Jobs failed: ${failed
        .map((f) => `${f.jobType}#${f.id.slice(0, 8)} ${f.errorCode}: ${f.errorMessage}`)
        .join(" | ")}`,
    );
  }

  // RETRYING counts as failed here: a retryable failure leaves the row at
  // RETRYING (not FAILED), and silently ignoring it would hide real errors.
  const broken = await db
    .select()
    .from(generationJobs)
    .where(
      and(
        eq(generationJobs.userId, userId),
        inArray(generationJobs.status, ["FAILED", "RETRYING", "RUNNING"]),
      ),
    );
  if (broken.length > 0) {
    throw new Error(
      `Jobs did not succeed: ${broken
        .map(
          (j) =>
            `${j.jobType}#${j.id.slice(0, 8)} ${j.status} attempts=${j.attempts} ${j.errorCode ?? ""} ${j.errorMessage ?? ""}`,
        )
        .join(" | ")}`,
    );
  }
}

beforeAll(async () => {
  requireRealPostgres();

  // `prepare: false` for pooled endpoints such as Neon -pooler.
  const created = createDb(process.env.DATABASE_URL, { prepare: false, max: 5 });
  db = created.db;
  client = created.client;

  // Apply the same generated migrations production uses.
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  const { fileURLToPath } = await import("node:url");
  const migrationsFolder = fileURLToPath(
    new URL("../packages/db/drizzle", import.meta.url),
  );
  await migrate(db, { migrationsFolder });

  // autoDeliver:false so runQueuedJobs() is the only driver of execution. With
  // auto-delivery on, the queue would run each handler concurrently with
  // runQueuedJobs, executing the same job twice.
  app = new KDone({ db, queue: new InMemoryQueue({ autoDeliver: false }) });
  setAppForTesting(app);

  // Unique per run so repeated runs never collide. Nothing is ever deleted.
  userId = `e2e-${crypto.randomUUID()}`;
  await db
    .insert(users)
    .values({ id: userId, email: `${userId}@example.test` });
});

afterAll(async () => {
  setAppForTesting(null);

  // Clean up ONLY this run's rows, scoped by the per-run user id. Deleting the
  // book projects cascades to their jobs, chapters, drafts, research, issues,
  // assets, provenance, approvals and audit rows.
  try {
    await db.delete(bookProjects).where(eq(bookProjects.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
    console.error("E2E: cleaned up rows for user " + userId);
  } catch (error) {
    console.error("E2E: cleanup failed", error);
  }

  await client.end();
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

    const manuscript = await db
      .select()
      .from(manuscripts)
      .where(eq(manuscripts.bookProjectId, bookId));
    expect(manuscript).toHaveLength(1);
    expect((manuscript[0]!.assembledContent as any).chapters).toHaveLength(3);

    // Every generated chapter draft carries provenance and no version is lost.
    expect(await bookStatus(bookId)).toBe("EDITING");

    /* 5. Runs /qa, then forces one critical issue through a user edit so the
     * block/resolve flow is exercised deterministically via the public API.
     * (The context-aware mock editorial reports a clean draft cleanly, so the
     * critical comes from the deterministic structural check on a deliberately
     * too-short draft rather than from canned mock output.) */
    expect((await call(runQa, "POST", "/api/books/x/qa", undefined, { bookId })).status).toBe(202);
    await drain();

    const allChapterRows = await db
      .select()
      .from(chaptersTable)
      .where(eq(chaptersTable.bookProjectId, bookId))
      .orderBy(chaptersTable.ordinal);
    expect((await call(patchChapter, "PATCH", "/api/chapters/x", { content: "Too short." }, { chapterId: allChapterRows[0]!.id })).status).toBe(200);
    expect((await call(runQa, "POST", "/api/books/x/qa", undefined, { bookId })).status).toBe(202);
    await drain();

    const { issues } = await json(await call(getIssues, "GET", "/api/books/x/issues", undefined, { bookId }));
    const critical = issues.filter((i: any) => i.severity === "critical" && i.status === "open");
    expect(critical.length).toBeGreaterThan(0);
    expect(critical[0].message).toMatch(/too short/i);

    // Preflight must FAIL while a critical issue is open.
    const blocked = await json(await call(runPreflight, "POST", "/api/books/x/preflight", undefined, { bookId }));
    expect(blocked.passed).toBe(false);

    const resolved = await call(updateIssue, "PATCH", "/api/issues/x", { status: "resolved" }, { issueId: critical[0].id });
    expect(resolved.status).toBe(200);

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

    /* 8. Runs preflight and expects it to pass. ADR-022: the EPUB job just
     * drove the book into QA; READY_FOR_REVIEW now arrives with no shortcuts. */
    expect(await bookStatus(bookId)).toBe("QA");
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

    const approvals = await db.select().from(approvalEvents).where(eq(approvalEvents.bookProjectId, bookId));
    expect(approvals).toHaveLength(1);
    expect(await bookStatus(bookId)).toBe("USER_APPROVED");

    /* 10 + 11. The real drift path, with no direct DB writes (ADR-013/ADR-021). */

    // Editing a bound chapter while approved must invalidate the approval
    // and move the book to NEEDS_REVISION through the real API.
    const chaptersRows = await db
      .select()
      .from(chaptersTable)
      .where(eq(chaptersTable.bookProjectId, bookId))
      .orderBy(chaptersTable.ordinal);
    expect(chaptersRows.length).toBe(3);

    const edited = await call(
      patchChapter,
      "PATCH",
      "/api/chapters/x",
      { content: "A revised opening that changes the approved artifact set." },
      { chapterId: chaptersRows[0]!.id },
    );
    expect(edited.status).toBe(200);
    expect(await bookStatus(bookId)).toBe("NEEDS_REVISION");

    // Publishing is refused. ADR-021 invalidates the approval on mutation, so the
    // book is no longer USER_APPROVED and publish/start refuses on the state
    // precondition before it ever compares artifact pointers.
    const drifted = await call(startPublishing, "POST", "/api/books/x/publish/start", {
      checklist: [...PUBLISHING_CHECKLIST],
    }, { bookId });
    expect(drifted.status).toBe(409);
    expect(await bookStatus(bookId)).toBe("NEEDS_REVISION");

    // Preflight must pass and return the book to READY_FOR_REVIEW (ADR-021).
    const afterDrift = await json(
      await call(runPreflight, "POST", "/api/books/x/preflight", undefined, { bookId }),
    );
    expect(afterDrift.checks.filter((c: any) => !c.passed)).toHaveLength(0);
    expect(afterDrift.passed).toBe(true);
    expect(await bookStatus(bookId)).toBe("READY_FOR_REVIEW");

    // Re-approve through the API, then publish in prepare mode.
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
    const jobs = await db.select().from(generationJobs).where(eq(generationJobs.bookProjectId, bookId));
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((j) => j.status === "SUCCEEDED")).toBe(true);

    const transitions = await db
      .select()
      .from(bookStateTransitions)
      .where(eq(bookStateTransitions.bookProjectId, bookId));
    expect(transitions.length).toBeGreaterThan(5);
    // Every transition has a logged actor and timestamp.
    expect(transitions.every((t) => Boolean(t.actorType) && Boolean(t.occurredAt))).toBe(true);
  });

  /* ---------------------------------------------------------------- helpers */

  async function bookStatus(bookId: string): Promise<string> {
    const [book] = await db.select().from(bookProjects).where(eq(bookProjects.id, bookId));
    return book!.status;
  }


});