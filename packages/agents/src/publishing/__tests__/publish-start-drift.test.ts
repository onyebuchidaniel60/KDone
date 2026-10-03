import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDbHandle } from "@kdone/db/test-db";
import {
  approvalEvents,
  bookAssets,
  bookMetadata,
  bookProjects,
  manuscripts,
  provenanceRecords,
  users,
} from "@kdone/db/schema";
import { InMemoryQueue } from "@kdone/jobs";
import { PUBLISHING_CHECKLIST } from "@kdone/publishing";
import { AppError } from "@kdone/shared";
import { KDone } from "../../../../../apps/web/src/server/lifecycle.js";

/*
 * Covers the ARTIFACT_DRIFT guard in publishStart().
 *
 * ADR-021 invalidates the approval on any artifact mutation, so the HTTP path
 * can no longer reach the drift comparison. This test calls publishStart()
 * directly and creates the drift by writing the pointer or fingerprint
 * straight to the database, bypassing the invalidating mutation path.
 *
 * This is the only coverage of the guard; deleting it would otherwise fail
 * nothing.
 */

let handle: TestDbHandle;
let db: TestDbHandle["db"];
let app: KDone;

beforeEach(async () => {
  handle = await createTestDb();
  db = handle.db;
  app = new KDone({ db, queue: new InMemoryQueue({ autoDeliver: false }) });
});

afterEach(async () => {
  await handle.close();
});

interface Approved {
  bookId: string;
  userId: string;
  approvalId: string;
  currentManuscriptId: string;
  metadataId: string;
  coverAssetId: string;
  epubAssetId: string;
}

/** A book that is USER_APPROVED with a valid ApprovalEvent bound to its artifacts. */
async function seedApprovedBook(options: { approvalManuscriptId?: "other" } = {}): Promise<Approved> {
  const [user] = await db
    .insert(users)
    .values({ id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` })
    .returning();

  const [book] = await db
    .insert(bookProjects)
    .values({ userId: user!.id, workingTitle: "Drift Book", topic: "Drift" })
    .returning();

  const makeManuscript = async (version: number) =>
    (
      await db
        .insert(manuscripts)
        .values({
          bookProjectId: book!.id,
          version,
          assembledContent: { title: "Drift Book", version, chapters: [{ ordinal: 1, title: "C1", content: "x".repeat(300), sourceDraftId: crypto.randomUUID(), sourceDraftVersion: 1 }], wordCount: 300, assembledAt: new Date().toISOString() },
          wordCount: 300,
          status: "ASSEMBLED",
        })
        .returning()
    )[0]!;

  const current = await makeManuscript(1);
  const older = options.approvalManuscriptId === "other" ? await makeManuscript(2) : current;

  // Metadata must satisfy metadataOutputSchema: publishStart maps it into the
  // KDP field mapping, so a partial record cannot be published.
  const [metadata] = await db
    .insert(bookMetadata)
    .values({
      bookProjectId: book!.id,
      version: 1,
      title: "Drift Book",
      subtitle: "A subtitle",
      description: "A description of the book.",
      authorNames: ["A. Author"],
      keywords: ["one", "two"],
      categories: ["Books > Reference"],
      language: "en",
      rights: "Standard commercial rights",
      price: "9.99",
      aiDisclosure: "ai_generated",
    })
    .returning();

  const [coverProvenance] = await db
    .insert(provenanceRecords)
    .values({ method: "ai_generated", provider: "mock", model: "mock-1" })
    .returning();
  const [epubProvenance] = await db
    .insert(provenanceRecords)
    .values({ method: "ai_generated", provider: "deterministic", model: "epub-builder" })
    .returning();

  const [cover] = await db
    .insert(bookAssets)
    .values({ bookProjectId: book!.id, assetType: "cover", storageKey: "c.png", version: 1, provenanceId: coverProvenance!.id })
    .returning();
  const [epub] = await db
    .insert(bookAssets)
    .values({ bookProjectId: book!.id, assetType: "epub", storageKey: "b.epub", version: 1, provenanceId: epubProvenance!.id })
    .returning();

  await db
    .update(bookProjects)
    .set({
      status: "USER_APPROVED",
      currentManuscriptId: current.id,
      currentMetadataId: metadata!.id,
      currentCoverAssetId: cover!.id,
      currentEpubAssetId: epub!.id,
    })
    .where(eq(bookProjects.id, book!.id));

  const [approval] = await db
    .insert(approvalEvents)
    .values({
      bookProjectId: book!.id,
      manuscriptId: older.id,
      metadataId: metadata!.id,
      coverAssetId: cover!.id,
      epubAssetId: epub!.id,
      // Filled with the true fingerprint in the fingerprint test; placeholder
      // here because the pointer drift is expected to fire first.
      provenanceFingerprint: "0".repeat(64),
      approvedBy: user!.id,
    })
    .returning();

  return {
    bookId: book!.id,
    userId: user!.id,
    approvalId: approval!.id,
    currentManuscriptId: current.id,
    metadataId: metadata!.id,
    coverAssetId: cover!.id,
    epubAssetId: epub!.id,
  };
}

async function expectDrift(fn: () => Promise<unknown>): Promise<string[]> {
  let caught: unknown;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AppError);
  const error = caught as AppError;
  expect(error.code).toBe("ARTIFACT_DRIFT");
  const changed = error.details.changed as string[];
  expect(Array.isArray(changed)).toBe(true);
  expect(changed.length).toBeGreaterThan(0);
  return changed;
}

describe("publishStart drift guard (ADR-013)", () => {
  it("refuses with ARTIFACT_DRIFT and names the manuscript pointer that changed", async () => {
    const seeded = await seedApprovedBook({ approvalManuscriptId: "other" });

    const changed = await expectDrift(() =>
      app.publishStart(seeded.bookId, seeded.userId, [...PUBLISHING_CHECKLIST]),
    );

    // The approval points at a different manuscript than the book's current one.
    expect(changed).toContain("manuscriptId");
    // Only the manuscript drifted; the other three pointers still match.
    expect(changed).not.toContain("metadataId");
    expect(changed).not.toContain("coverAssetId");
    expect(changed).not.toContain("epubAssetId");
  });

  it("still refuses when only the provenance fingerprint drifted", async () => {
    const seeded = await seedApprovedBook();

    // Record the true fingerprint, then corrupt only that column.
    const snapshot = await app.buildApprovalSnapshot(seeded.bookId);
    await db
      .update(approvalEvents)
      .set({ provenanceFingerprint: snapshot.provenanceFingerprint })
      .where(eq(approvalEvents.id, seeded.approvalId));

    // Artifact pointers are left intact; only the fingerprint is corrupted below.
    await db
      .update(approvalEvents)
      .set({ provenanceFingerprint: "f".repeat(64) })
      .where(eq(approvalEvents.id, seeded.approvalId));

    const changed = await expectDrift(() =>
      app.publishStart(seeded.bookId, seeded.userId, [...PUBLISHING_CHECKLIST]),
    );

    expect(changed).toContain("provenanceFingerprint");
    // Artifact pointers are untouched, so they must NOT be reported.
    expect(changed).not.toContain("manuscriptId");
    expect(changed).not.toContain("metadataId");
    expect(changed).not.toContain("coverAssetId");
    expect(changed).not.toContain("epubAssetId");
  });

  it("publishes successfully when the approval matches the current artifacts", async () => {
    const seeded = await seedApprovedBook();
    const snapshot = await app.buildApprovalSnapshot(seeded.bookId);

    await db
      .update(approvalEvents)
      .set({ provenanceFingerprint: snapshot.provenanceFingerprint })
      .where(eq(approvalEvents.id, seeded.approvalId));

    const result = await app.publishStart(seeded.bookId, seeded.userId, [...PUBLISHING_CHECKLIST]);

    expect(result.mode).toBe("prepare");
    expect(result.manifest.disclosure.requiresDisclosure).toBe(true);
    // ADR-012: prepare-only leaves the book in USER_APPROVED.
    expect(result.bookStatus).toBe("USER_APPROVED");
  });
});