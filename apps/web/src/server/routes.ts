import type { NextRequest } from "next/server";
import { z } from "zod";
import { AppError, errors } from "@kdone/shared";
import { KDone } from "./lifecycle.js";
import {
  createBookSchema,
  startPublishingSchema,
  updateIssueSchema,
  updateMetadataSchema,
} from "@kdone/validation";

/*
 * HTTP layer. Handlers own validation and status codes only; all domain rules
 * live in the services. Errors are mapped to the shape in API.md section 2.
 */

let override: KDone | null = null;
let shared: KDone | null = null;

/** Test seam: the E2E smoke test injects a PGlite-backed instance. */
export function setAppForTesting(instance: KDone | null): void {
  override = instance;
}

export function app(): KDone {
  if (override) return override;
  if (!shared) {
    throw new AppError("INTERNAL", "Application services are not configured");
  }
  return shared;
}

export function setApp(instance: KDone): void {
  shared = instance;
}

export async function parseBody<T>(
  request: NextRequest | Request,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw errors.validation("Request body must be valid JSON");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw errors.validation("Request body failed validation", {
      issues: result.error.issues.map((i: z.ZodIssue) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }
  return result.data;
}

/**
 * Reads a required route parameter. The project enables
 * `noUncheckedIndexedAccess`, so a missing parameter must be handled explicitly
 * rather than silently typed as `undefined`.
 */
function requireParam(params: Record<string, string | undefined>, key: string): string {
  const value = params[key];
  if (!value) throw errors.validation(`Missing route parameter: ${key}`);
  return value;
}

export function toErrorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    return Response.json(error.toJSON(), { status: error.status });
  }
  // Never leak internal details or credentials to the client.
  return Response.json(
    { error: { code: "INTERNAL", message: "Internal server error", details: {} } },
    { status: 500 },
  );
}

export type Handler = (request: NextRequest, ctx: { params: Promise<Record<string, string | undefined>> }) => Promise<Response>;

export function route(handler: Handler) {
  return async (request: NextRequest, ctx: { params: Promise<Record<string, string | undefined>> }) => {
    try {
      return await handler(request, ctx);
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

/**
 * Identity for V1.
 *
 * SECURITY: `x-kdone-user-id` is a test/dev harness only. It is hard-disabled
 * when NODE_ENV === "production" so a deployed instance can never accept a
 * forged header as identity. When enabled it MUST be replaced by the real
 * Auth.js session before V1 ships (see docs/AI_HANDOFF.md).
 */
async function currentUserId(request: NextRequest): Promise<string> {
  if (process.env.NODE_ENV !== "production") {
    const header = request.headers.get("x-kdone-user-id");
    if (header) return header;
  }
  throw errors.unauthenticated("No authenticated session");
}

const j = (data: unknown, status = 200) => Response.json(data, { status });

/** Optional body; a missing or empty body means "generate every chapter". */
async function readOptionalOrdinals(request: Request): Promise<number[] | undefined> {
  try {
    const raw = (await request.json()) as { chapterOrdinals?: unknown };
    return Array.isArray(raw.chapterOrdinals) ? (raw.chapterOrdinals as number[]) : undefined;
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------ Books */

export const createBook = route(async (request) => {
  const userId = await currentUserId(request);
  const body = await parseBody(request, createBookSchema);
  const book = await app().createBook(userId, body);
  return j({ book }, 201);
});

export const listBooks = route(async (request) => {
  const userId = await currentUserId(request);
  const { db } = app();
  const { bookProjects } = await import("@kdone/db/schema");
  const { eq } = await import("drizzle-orm");
  const books = await db.select().from(bookProjects).where(eq(bookProjects.userId, userId));
  return j({ books });
});

export const getBook = route(async (request, { params }) => {
  const userId = await currentUserId(request);
  const bookId = requireParam(await params, "bookId");
  return j({ book: await app().requireBook(bookId, userId) });
});

/* ------------------------------------------------------------------ Research */

export const startResearch = route(async (request, { params }) => {
  const userId = await currentUserId(request);
  const bookId = requireParam(await params, "bookId");
  return j(await app().startResearch(bookId, userId), 202);
});

export const getResearch = route(async (request, { params }) => {
  const userId = await currentUserId(request);
  const bookId = requireParam(await params, "bookId");
  return j({ research: await app().getResearch(bookId, userId) });
});

export const approveResearch = route(async (request, { params }) => {
  const userId = await currentUserId(request);
  const bookId = requireParam(await params, "bookId");
  return j(await app().approveResearch(bookId, userId));
});

/* ------------------------------------------------------------------ Planning */

export const startPlan = route(async (request, { params }) => {
  const userId = await currentUserId(request);
  const bookId = requireParam(await params, "bookId");
  return j(await app().startPlanning(bookId, userId), 202);
});

export const getPlan = route(async (request, { params }) => {
  const userId = await currentUserId(request);
  const bookId = requireParam(await params, "bookId");
  return j({ plan: await app().getPlan(bookId, userId) });
});

export const approvePlan = route(async (request, { params }) => {
  const userId = await currentUserId(request);
  const bookId = requireParam(await params, "bookId");
  return j(await app().approvePlan(bookId, userId));
});

/* ------------------------------------------------------------------ Writing */

export const startGeneration = route(async (request, { params }) => {
  const userId = await currentUserId(request);
  const bookId = requireParam(await params, "bookId");
  const ordinals = await readOptionalOrdinals(request);
  return j(await app().startWriting(bookId, userId, ordinals), 202);
});

export const getManuscript = route(async (request, { params }) => {
  const userId = await currentUserId(request);
  const bookId = requireParam(await params, "bookId");
  return j({ manuscript: await app().getManuscript(bookId, userId) });
});

/* ------------------------------------------------------------------ Editorial / QA */

export const runQa = route(async (request, { params }) => {
  const userId = await currentUserId(request);
  const bookId = requireParam(await params, "bookId");
  return j(await app().runQa(bookId, userId), 202);
});

export const getIssues = route(async (request, { params }) => {
  const userId = await currentUserId(request);
  const bookId = requireParam(await params, "bookId");
  return j({ issues: await app().listIssues(bookId, userId) });
});

export const updateIssue = route(async (request, { params }) => {
  const userId = await currentUserId(request);
  const issueId = requireParam(await params, "issueId");
  const body = await parseBody(request, updateIssueSchema);
  return j({ issue: await app().updateIssue(issueId, userId, body) });
});

/* ------------------------------------------------------------------ Production */

export const generateCover = route(async (request, { params }) => {
  const userId = await currentUserId(request);
  const bookId = requireParam(await params, "bookId");
  return j(await app().generateCover(bookId, userId), 202);
});

export const generateMetadata = route(async (request, { params }) => {
  const userId = await currentUserId(request);
  const bookId = requireParam(await params, "bookId");
  return j(await app().generateMetadata(bookId, userId), 202);
});

export const patchMetadata = route(async (request, { params }) => {
  const userId = await currentUserId(request);
  const bookId = requireParam(await params, "bookId");
  const body = await parseBody(request, updateMetadataSchema);
  return j({ metadata: await app().updateMetadata(bookId, userId, body) });
});

export const generateEpub = route(async (request, { params }) => {
  const userId = await currentUserId(request);
  const bookId = requireParam(await params, "bookId");
  return j(await app().generateEpub(bookId, userId), 202);
});

export const listAssets = route(async (request, { params }) => {
  const userId = await currentUserId(request);
  const bookId = requireParam(await params, "bookId");
  return j({ assets: await app().listAssets(bookId, userId) });
});

/* ------------------------------------------------------------------ Preview / approval */

export const getPreview = route(async (request, { params }) => {
  const userId = await currentUserId(request);
  const bookId = requireParam(await params, "bookId");
  return j(await app().previewManifest(bookId, userId));
});

export const runPreflight = route(async (request, { params }) => {
  const userId = await currentUserId(request);
  const bookId = requireParam(await params, "bookId");
  return j(await app().preflight(bookId, userId));
});

export const approveBook = route(async (request, { params }) => {
  const userId = await currentUserId(request);
  const bookId = requireParam(await params, "bookId");
  const approval = await app().approve(bookId, userId);
  return j({ approval });
});

/* ------------------------------------------------------------------ Publishing */

export const startPublishing = route(async (request, { params }) => {
  const userId = await currentUserId(request);
  const bookId = requireParam(await params, "bookId");
  const body = await parseBody(request, startPublishingSchema.extend({
    checklist: z.array(z.string()).optional(),
  })).catch(() => ({ mode: "prepare" as const, checklist: [] }));

  const checklist = Array.isArray((body as { checklist?: string[] }).checklist)
    ? (body as { checklist: string[] }).checklist
    : [];

  const result = await app().publishStart(bookId, userId, checklist);
  return j(result, 202);
});

export const publishingStatus = route(async (request, { params }) => {
  const userId = await currentUserId(request);
  const bookId = requireParam(await params, "bookId");
  return j(await app().publishStatus(bookId, userId));
});

/** Chapter edit / regeneration. Appends a new draft version. */
export const patchChapter = route(async (request, { params }) => {
  const userId = await currentUserId(request);
  const chapterId = requireParam(await params, "chapterId");
  let content: string | undefined;
  try {
    const raw = (await request.json()) as { content?: unknown };
    if (typeof raw.content === "string") content = raw.content;
  } catch {
    // Empty body means "regenerate this chapter's content".
  }
  return j(await app().editChapter(chapterId, userId, content));
});

/* ------------------------------------------------------------------ Jobs */

export const listJobs = route(async (request, { params }) => {
  const userId = await currentUserId(request);
  const bookId = requireParam(await params, "bookId");
  return j({ jobs: await app().listJobs(bookId, userId) });
});

/* ------------------------------------------------------------------ Settings */

/** Provider accounts. Raw credentials are never returned (API.md section 13). */
export const getProviders = route(async (request) => {
  const userId = await currentUserId(request);
  const { db } = app();
  const { providerAccounts } = await import("@kdone/db/schema");
  const { eq } = await import("drizzle-orm");
  const rows = await db
    .select({
      id: providerAccounts.id,
      provider: providerAccounts.provider,
      status: providerAccounts.status,
      lastValidatedAt: providerAccounts.lastValidatedAt,
      createdAt: providerAccounts.createdAt,
      // encryptedCredentials is intentionally omitted.
    })
    .from(providerAccounts)
    .where(eq(providerAccounts.userId, userId));
  return j({ providers: rows });
});

/**
 * Publishing settings. `aiDisclosure` here is a default preference only; the
 * canonical disclosure state lives on each metadata version (ADR-014).
 */
export const getPublishingSettings = route(async (request) => {
  const userId = await currentUserId(request);
  return j({ settings: await app().getPublishingSettings(userId) });
});

