import { describe, expect, it } from "vitest";
import { createTestDb } from "@kdone/db/test-db";
import { InMemoryQueue } from "@kdone/jobs";
import { assembleManuscript } from "@kdone/agents";
import {
  bookAssets,
  bookMetadata,
  bookProjects,
  manuscripts,
  provenanceRecords,
  users,
} from "@kdone/db/schema";
import { eq } from "drizzle-orm";
import { KDone } from "./index.js";

/**
 * ADR-022 regression: the EPUB job is the trigger that advances a book from
 * EDITING through PRODUCTION into QA (the final preflight gate), so the
 * lifecycle can complete through the public API. Asserts both the arrival in
 * QA and the preflight promotion to READY_FOR_REVIEW, plus the guard that a
 * missing cover artifact leaves the book in EDITING instead.
 */
describe("epub completion drives EDITING -> PRODUCTION -> QA (ADR-022)", () => {
  const chapterBody =
    "Seed criteria keep a small process repeatable. " +
    "Each chapter builds one practical step for the reader. ".repeat(6);

  async function seedEditingBook(handle: Awaited<ReturnType<typeof createTestDb>>, withCover: boolean) {
    const { db } = handle;
    const userId = "u-epub-state";
    await db.insert(users).values({ id: userId, email: `${userId}@example.test` });

    const [book] = await db
      .insert(bookProjects)
      .values({ userId, status: "EDITING", workingTitle: "Practical Guide", topic: "process design" })
      .returning();

    const assembled = assembleManuscript({
      title: "Practical Guide",
      version: 1,
      chapters: [
        { ordinal: 1, title: "Foundations", content: `# Foundations\n\n${chapterBody}`, sourceDraftId: crypto.randomUUID(), sourceDraftVersion: 1 },
        { ordinal: 2, title: "Practice", content: `# Practice\n\n${chapterBody}`, sourceDraftId: crypto.randomUUID(), sourceDraftVersion: 1 },
      ],
    });

    const [manuscript] = await db
      .insert(manuscripts)
      .values({ bookProjectId: book!.id, version: 1, assembledContent: assembled, wordCount: assembled.wordCount, status: "ASSEMBLED" })
      .returning();

    const [metadata] = await db
      .insert(bookMetadata)
      .values({
        bookProjectId: book!.id,
        version: 1,
        title: "Practical Guide",
        subtitle: "Process design for practitioners",
        description: "A structured guide.",
        authorNames: ["A. Author"],
        keywords: ["guide"],
        categories: ["Books > Reference"],
        language: "en",
        rights: "All rights reserved",
        price: "9.99",
        aiDisclosure: "ai_generated",
      })
      .returning();

    let coverAssetId: string | null = null;
    if (withCover) {
      const [provenance] = await db
        .insert(provenanceRecords)
        .values({ method: "user_created" })
        .returning();
      const [cover] = await db
        .insert(bookAssets)
        .values({ bookProjectId: book!.id, assetType: "cover", storageKey: `books/${book!.id}/cover/v1.svg`, mimeType: "image/svg+xml", sizeBytes: 100, version: 1, provenanceId: provenance!.id })
        .returning();
      coverAssetId = cover!.id;
    }

    await db
      .update(bookProjects)
      .set({
        currentManuscriptId: manuscript!.id,
        currentMetadataId: metadata!.id,
        currentCoverAssetId: coverAssetId,
      })
      .where(eq(bookProjects.id, book!.id));

    return { bookId: book!.id, userId };
  }

  it("after the EPUB job succeeds with the full artifact set: EDITING -> QA, then preflight -> READY_FOR_REVIEW", async () => {
    const handle = await createTestDb();
    try {
      const app = new KDone({
        db: handle.db,
        queue: new InMemoryQueue({ autoDeliver: false }),
      });
      const { bookId, userId } = await seedEditingBook(handle, true);

      await app.generateEpub(bookId, userId);
      await app.runQueuedJobs();

      let [row] = await handle.db.select().from(bookProjects).where(eq(bookProjects.id, bookId));
      expect(row!.status).toBe("QA");
      expect(row!.currentEpubAssetId).toBeTruthy();

      const preflight = await app.preflight(bookId, userId);
      expect(preflight.passed).toBe(true);

      [row] = await handle.db.select().from(bookProjects).where(eq(bookProjects.id, bookId));
      expect(row!.status).toBe("READY_FOR_REVIEW");
    } finally {
      await handle.close();
    }
  });

  it("without a cover artifact the EPUB still stores but the book stays EDITING", async () => {
    const handle = await createTestDb();
    try {
      const app = new KDone({
        db: handle.db,
        queue: new InMemoryQueue({ autoDeliver: false }),
      });
      const { bookId, userId } = await seedEditingBook(handle, false);

      await app.generateEpub(bookId, userId);
      await app.runQueuedJobs();

      const [row] = await handle.db.select().from(bookProjects).where(eq(bookProjects.id, bookId));
      expect(row!.status).toBe("EDITING");
      expect(row!.currentEpubAssetId).toBeTruthy();
    } finally {
      await handle.close();
    }
  });
});
