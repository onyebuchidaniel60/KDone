import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "@kdone/db";
import { bookProjects, users } from "@kdone/db/schema";
import { InMemoryQueue } from "@kdone/jobs";
import { KDone } from "../../../../../apps/web/src/server/lifecycle.js";
import { researchOutputSchema } from "@kdone/validation";

/*
 * Focused repro: call persistResearch() directly against real Postgres.
 * No worker, no orchestrator, no BullMQ, no job execution.
 *
 * console.error immediately before and after every await, so the LAST line
 * printed before the stall names the exact statement that never settles.
 */

function requireRealPostgres(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for this repro.");
  if (url.startsWith("pglite://")) throw new Error("This repro must run against real Postgres.");
  return url;
}

let client: { end: () => Promise<void> };
let db: ReturnType<typeof createDb>["db"];
let app: KDone;
let bookId: string;
const runId = `repro-${crypto.randomUUID()}`;

const OUTPUT = researchOutputSchema.parse({
  marketSummary: "Market summary for the repro.",
  readerProblemSummary: "Reader problem summary for the repro.",
  sources: [
    { url: "https://example.test/a", title: "A", sourceName: "S", sourceType: "reference", status: "retained" },
    { url: "https://example.test/b", title: "B", sourceName: "S", sourceType: "practice", status: "retained" },
  ],
  findings: [
    { findingType: "gap", statement: "Gap statement.", confidence: "high", sourceIndex: 0 },
    { findingType: "demand", statement: "Demand statement.", confidence: "medium", sourceIndex: 1 },
  ],
  angles: ["An angle."],
});

beforeAll(async () => {
  requireRealPostgres();
  const created = createDb(process.env.DATABASE_URL, { prepare: false, max: 5 });
  db = created.db;
  client = created.client;

  app = new KDone({ db, queue: new InMemoryQueue() });

  await db.insert(users).values({ id: runId, email: `${runId}@example.test` });
  const [book] = await db
    .insert(bookProjects)
    .values({ userId: runId, workingTitle: "Repro Book", topic: "Repro" })
    .returning();
  bookId = book!.id;
  console.error("REPRO: setup done, bookId=" + bookId);
});

afterAll(async () => {
  await client.end();
});

describe("persistResearch repro", () => {
  it("persists research without stalling", async () => {
    console.error("REPRO: calling persistResearch");
    const result = await (app as unknown as {
      persistResearch: (b: string, u: string, o: unknown) => Promise<void>;
    }).persistResearch(bookId, runId, OUTPUT);
    console.error("REPRO: persistResearch returned", result);

    const [book] = await db.select().from(bookProjects).where(eq(bookProjects.id, bookId));
    expect(book?.currentResearchProjectId).toBeTruthy();
  }, 60_000);
});