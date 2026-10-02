import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  approvalEvents,
  bookAssets,
  bookMetadata,
  bookProjects,
  chapters,
  manuscripts,
  qualityIssues,
  users,
} from "./schema.js";
import { createTestDb, type TestDbHandle } from "./test-db.js";

let handle: TestDbHandle;
let db: TestDbHandle["db"];

beforeAll(async () => {
  handle = await createTestDb();
  db = handle.db;
});

afterAll(async () => {
  await handle.close();
});

async function seedUser() {
  const [user] = await db
    .insert(users)
    .values({ id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` })
    .returning();
  if (!user) throw new Error("failed to seed user");
  return user;
}

async function seedBook() {
  const user = await seedUser();
  const [book] = await db
    .insert(bookProjects)
    .values({ userId: user.id, workingTitle: "Test Book", topic: "Testing" })
    .returning();
  if (!book) throw new Error("failed to seed book");
  return book;
}

describe("test database (PGlite, real migrations)", () => {
  it("applies the generated migrations and creates every table", async () => {
    const result = await db.execute<{ table_name: string }>(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const names = result.rows.map((r) => r.table_name);

    expect(names).toContain("book_projects");
    expect(names).toContain("approval_events");
    expect(names).toContain("book_state_transitions");
    expect(names).toContain("manuscripts");
    expect(names).toContain("generation_jobs");
    // Auth.js adapter tables (ADR-017).
    expect(names).toContain("accounts");
    expect(names).toContain("sessions");
  });

  it("creates the uniform current-artifact pointers on BookProject (ADR-019)", async () => {
    const result = await db.execute<{ column_name: string }>(
      sql`SELECT column_name FROM information_schema.columns
          WHERE table_name = 'book_projects' AND column_name LIKE 'current_%'
          ORDER BY column_name`,
    );
    expect(result.rows.map((r) => r.column_name)).toEqual([
      "current_cover_asset_id",
      "current_epub_asset_id",
      "current_manuscript_id",
      "current_metadata_id",
      "current_plan_id",
      "current_research_project_id",
    ]);
  });

  it("defaults a new book to DRAFT with null pointers", async () => {
    const book = await seedBook();
    expect(book.status).toBe("DRAFT");
    expect(book.currentManuscriptId).toBeNull();
    expect(book.currentEpubAssetId).toBeNull();
  });

  it("enforces book ownership via a real foreign key", async () => {
    await expect(
      db.insert(bookProjects).values({ userId: "no-such-user", workingTitle: "Orphan" }),
    ).rejects.toThrow(/foreign key/i);
  });

  it("enforces foreign keys on child resources", async () => {
    await expect(
      db.insert(chapters).values({ bookProjectId: crypto.randomUUID(), ordinal: 1 }),
    ).rejects.toThrow(/foreign key/i);
  });

  it("enforces the unique (book_project_id, ordinal) constraint on chapters", async () => {
    const book = await seedBook();
    await db.insert(chapters).values({ bookProjectId: book.id, ordinal: 1, title: "One" });
    await expect(
      db.insert(chapters).values({ bookProjectId: book.id, ordinal: 1, title: "Duplicate" }),
    ).rejects.toThrow(/unique/i);
  });

  it("rejects a status outside the book_status enum", async () => {
    const book = await seedBook();
    await expect(
      db.execute(sql`UPDATE book_projects SET status = 'NOT_A_STATE' WHERE id = ${book.id}`),
    ).rejects.toThrow();
  });

  it("binds ApprovalEvent artifacts with real foreign keys (ADR-013)", async () => {
    const book = await seedBook();
    const ids = Array.from({ length: 4 }, () => crypto.randomUUID());

    // No matching manuscripts/metadata/assets exist, so the FK must reject.
    await expect(
      db.insert(approvalEvents).values({
        bookProjectId: book.id,
        manuscriptId: ids[0]!,
        metadataId: ids[1]!,
        coverAssetId: ids[2]!,
        epubAssetId: ids[3]!,
        provenanceFingerprint: "abc",
        approvedBy: "user-1",
      }),
    ).rejects.toThrow(/foreign key/i);
  });

  it("requires every artifact binding column on ApprovalEvent", async () => {
    const book = await seedBook();
    const [manuscript] = await db
      .insert(manuscripts)
      .values({ bookProjectId: book.id, version: 1, assembledContent: { chapters: [] }, wordCount: 0 })
      .returning();
    const [metadata] = await db.insert(bookMetadata).values({ bookProjectId: book.id, version: 1 }).returning();
    if (!manuscript || !metadata) throw new Error("seed failed");

    const [cover] = await db
      .insert(bookAssets)
      .values({ bookProjectId: book.id, assetType: "cover", storageKey: "covers/a.png" })
      .returning();
    const [epub] = await db
      .insert(bookAssets)
      .values({ bookProjectId: book.id, assetType: "epub", storageKey: "books/a.epub" })
      .returning();
    if (!cover || !epub) throw new Error("seed failed");

    // Valid approval is accepted.
    const [approval] = await db
      .insert(approvalEvents)
      .values({
        bookProjectId: book.id,
        manuscriptId: manuscript.id,
        metadataId: metadata.id,
        coverAssetId: cover.id,
        epubAssetId: epub.id,
        provenanceFingerprint: "abc",
        approvedBy: "user-1",
      })
      .returning();
    expect(approval?.provenanceFingerprint).toBe("abc");

    // Omitting a binding column violates NOT NULL at the database level.
    await expect(
      db.execute(sql`
        INSERT INTO approval_events
          (book_project_id, manuscript_id, metadata_id, cover_asset_id, provenance_fingerprint, approved_by)
        VALUES (${book.id}, ${manuscript.id}, ${metadata.id}, ${cover.id}, 'abc', 'user-1')
      `),
    ).rejects.toThrow(/not-null|null value/i);
  });

  it("stores critical quality issues and supports status filtering", async () => {
    const book = await seedBook();
    await db.insert(qualityIssues).values([
      { bookProjectId: book.id, severity: "critical", issueType: "structure", message: "No chapter" },
      { bookProjectId: book.id, severity: "suggestion", issueType: "style", message: "Consider" },
    ]);

    const openCritical = await db
      .select()
      .from(qualityIssues)
      .where(
        sql`${qualityIssues.bookProjectId} = ${book.id} AND ${qualityIssues.severity} = 'critical' AND ${qualityIssues.status} = 'open'`,
      );

    expect(openCritical).toHaveLength(1);
  });
});