import { z } from "zod";

/*
 * Structured I/O contracts (AGENTS.md: prefer structured outputs with schemas
 * over free-form orchestration). Agent outputs are validated at the boundary so
 * a malformed provider response fails the job instead of corrupting artifacts.
 */

/* -------------------------------------------------------------- API inputs */

export const createBookSchema = z.object({
  workingTitle: z.string().min(1).max(300),
  topic: z.string().min(1).max(2000),
  targetReader: z.string().max(2000).optional(),
  genre: z.string().max(200).optional(),
  desiredLength: z.number().int().positive().max(1_000_000).optional(),
  toneStyle: z.string().max(500).optional(),
  authorName: z.string().max(300).optional(),
});

export const updateBookSchema = createBookSchema.partial();

/** Disclosure state. `user_created`/`ai_assisted` do not require disclosure. */
export const aiDisclosureSchema = z.enum(["user_created", "ai_assisted", "ai_generated"]);

export const updateMetadataSchema = z.object({
  title: z.string().max(300).optional(),
  subtitle: z.string().max(500).optional(),
  description: z.string().max(5000).optional(),
  authorNames: z.array(z.string().max(200)).max(10).optional(),
  publisherName: z.string().max(200).optional(),
  keywords: z.array(z.string().max(60)).max(7).optional(),
  categories: z.array(z.string().max(120)).max(3).optional(),
  language: z.string().max(20).optional(),
  rights: z.string().max(200).optional(),
  price: z.string().max(20).optional(),
  aiDisclosure: aiDisclosureSchema.optional(),
});

export const updatePublishingSettingsSchema = z.object({
  language: z.string().max(20).optional(),
  primaryMarketplace: z.string().max(60).optional(),
  rightsChoice: z.string().max(200).optional(),
  price: z.string().max(20).optional(),
  currency: z.string().max(10).optional(),
  kdpSelectPreference: z.boolean().optional(),
  drmPreference: z.string().max(50).optional(),
  aiDisclosure: aiDisclosureSchema.optional(),
});

export const updateProviderAccountSchema = z.object({
  provider: z.string().min(1).max(60),
  /** Write-only. Stored encrypted; never returned or logged. */
  credentials: z.record(z.string().max(200), z.string().max(4000)).optional(),
});

export const updateIssueSchema = z.object({
  status: z.enum(["open", "accepted", "rejected", "resolved"]).optional(),
  proposedFix: z.string().max(4000).optional(),
});

export const startPublishingSchema = z.object({
  mode: z.enum(["prepare", "assisted", "automated"]).default("prepare"),
});

export const generateSchema = z.object({
  /** Restrict to specific chapter ordinals; default is the whole outline. */
  chapterOrdinals: z.array(z.number().int().positive()).max(100).optional(),
});

/* -------------------------------------------------------------- Agent outputs */

export const researchSourceSchema = z.object({
  url: z.string().max(1000),
  title: z.string().min(1).max(500),
  sourceName: z.string().max(300),
  sourceType: z.string().max(60),
  status: z.string().max(40).default("retained"),
});

export const researchFindingSchema = z.object({
  findingType: z.string().min(1).max(60),
  statement: z.string().min(1).max(2000),
  confidence: z.enum(["low", "medium", "high"]),
  /** Index into the sources array. Null when the finding has no single source. */
  sourceIndex: z.number().int().nonnegative().nullable().default(null),
});

export const researchOutputSchema = z.object({
  marketSummary: z.string().min(1).max(20_000),
  readerProblemSummary: z.string().min(1).max(20_000),
  sources: z.array(researchSourceSchema).min(1).max(100),
  findings: z.array(researchFindingSchema).max(200),
  angles: z.array(z.string().max(500)).max(20).default([]),
});

export type ResearchOutput = z.infer<typeof researchOutputSchema>;

export const chapterOutlineSchema = z.object({
  ordinal: z.number().int().positive(),
  title: z.string().min(1).max(300),
  objective: z.string().min(1).max(2000),
  targetWordCount: z.number().int().positive().max(50_000),
});

export const planOutputSchema = z.object({
  title: z.string().min(1).max(300),
  subtitle: z.string().max(500),
  positioning: z.string().min(1).max(4000),
  bookPromise: z.string().min(1).max(2000),
  targetWordCount: z.number().int().positive().max(1_000_000),
  chapters: z.array(chapterOutlineSchema).min(1).max(100),
});

export type PlanOutput = z.infer<typeof planOutputSchema>;

export const chapterContentSchema = z.object({
  title: z.string().min(1).max(300),
  content: z.string().min(200).max(200_000),
  summary: z.string().min(1).max(4000),
  /** Research finding indices relied upon. Never invented citations. */
  supportedBy: z.array(z.number().int().nonnegative()).max(100).default([]),
});

export type ChapterContent = z.infer<typeof chapterContentSchema>;

export const issueSchema = z.object({
  severity: z.enum(["critical", "warning", "suggestion"]),
  issueType: z.string().min(1).max(60),
  message: z.string().min(1).max(2000),
  chapterOrdinal: z.number().int().positive().nullable().default(null),
  location: z.string().max(200).nullable().default(null),
  proposedFix: z.string().max(2000).nullable().default(null),
});

export const editorialOutputSchema = z.object({ issues: z.array(issueSchema).max(500) });

export type Issue = z.infer<typeof issueSchema>;

export const factCheckOutputSchema = z.object({
  claims: z
    .array(
      z.object({
        claim: z.string().min(1).max(1000),
        result: z.enum(["verified", "needs_revision", "unsupported", "conflicting"]),
        rationale: z.string().min(1).max(2000),
        sourceIndex: z.number().int().nonnegative().nullable().default(null),
        chapterOrdinal: z.number().int().positive().nullable().default(null),
      }),
    )
    .max(500),
});

export const metadataOutputSchema = z.object({
  title: z.string().min(1).max(300),
  subtitle: z.string().max(500),
  description: z.string().min(1).max(4000),
  authorNames: z.array(z.string().max(200)).min(1).max(10),
  keywords: z.array(z.string().max(60)).min(1).max(7),
  categories: z.array(z.string().max(120)).min(1).max(3),
  language: z.string().max(20),
  rights: z.string().max(200),
  price: z.string().max(20),
  aiDisclosure: aiDisclosureSchema,
});

export type MetadataOutput = z.infer<typeof metadataOutputSchema>;

export const coverOutputSchema = z.object({
  brief: z.object({
    concept: z.string().min(1).max(2000),
    palette: z.array(z.string().max(20)).min(1).max(8),
    typographyNote: z.string().max(500),
  }),
  /** Small deterministic SVG rendered by the mock image provider. */
  svg: z.string().min(1).max(400_000),
  mimeType: z.string().default("image/svg+xml"),
});

export type CoverOutput = z.infer<typeof coverOutputSchema>;

/** Deterministic assembled manuscript snapshot (ADR-015). */
export const assembledChapterSchema = z.object({
  ordinal: z.number().int().positive(),
  title: z.string(),
  content: z.string(),
  sourceDraftId: z.string().uuid(),
  sourceDraftVersion: z.number().int().positive(),
});

export const assembledManuscriptSchema = z.object({
  title: z.string(),
  version: z.number().int().positive(),
  chapters: z.array(assembledChapterSchema).min(1),
  wordCount: z.number().int().nonnegative(),
  assembledAt: z.string(),
});

export type AssembledManuscript = z.infer<typeof assembledManuscriptSchema>;