import type { ImageProvider, LLMProvider, ResearchProvider, Usage } from "@kdone/ai";
import {
  assembledManuscriptSchema,
  chapterContentSchema,
  coverOutputSchema,
  editorialOutputSchema,
  factCheckOutputSchema,
  metadataOutputSchema,
  planOutputSchema,
  researchOutputSchema,
  type AssembledManuscript,
  type ChapterContent,
  type Issue,
  type CoverOutput,
  type MetadataOutput,
  type PlanOutput,
  type ResearchOutput,
} from "@kdone/validation";

/*
 * Agents own reasoning/generation workflows and return structured output
 * (ARCHITECTURE section 6). Every output is validated by a schema before it
 * can reach persistence.
 *
 * Writing is chapter-oriented: `writeChapter` handles exactly one chapter and
 * receives the approved plan, that chapter's objective, relevant research, and
 * prior-chapter context. The book is never generated in a single call.
 */

export interface AgentContext {
  bookProjectId: string;
  workingTitle: string;
  topic: string;
  targetReader: string;
  toneStyle: string;
  authorName: string;
}

export interface AgentResult<T> {
  output: T;
  usage: Usage;
  /** Whether the output required AI generation (drives provenance/disclosure). */
  generated: boolean;
}

/* -------------------------------------------------------------- Research */

export async function researchAgent(
  research: ResearchProvider,
  llm: LLMProvider,
  ctx: AgentContext,
  depth: "light" | "standard" | "deep" = "standard",
): Promise<AgentResult<ResearchOutput>> {
  const { output, usage } = await research.search({
    topic: ctx.topic,
    audience: ctx.targetReader,
    depth,
  });
  return { output, usage, generated: true };
}

/* -------------------------------------------------------------- Planning */

export async function planningAgent(
  llm: LLMProvider,
  ctx: AgentContext,
  research: ResearchOutput,
  targetWordCount: number,
): Promise<AgentResult<PlanOutput>> {
  const { output, usage } = await llm.generate({
    task: "plan",
    seed: `${ctx.bookProjectId}:plan`,
    schema: planOutputSchema,
    context: {
      title: ctx.workingTitle,
      topic: ctx.topic,
      audience: ctx.targetReader,
      targetWordCount,
      researchSummary: research.marketSummary,
      angles: research.angles.join("; "),
    },
  });
  return { output, usage, generated: true };
}

/* -------------------------------------------------------------- Writing */

export interface ChapterBrief {
  ordinal: number;
  title: string;
  objective: string;
}

/**
 * Generates exactly one chapter. Prior-chapter summaries provide continuity
 * without regenerating the whole manuscript.
 */
export async function writingAgent(
  llm: LLMProvider,
  ctx: AgentContext,
  brief: ChapterBrief,
  research: ResearchOutput,
  priorSummaries: Array<{ ordinal: number; summary: string }>,
): Promise<AgentResult<ChapterContent>> {
  const { output, usage } = await llm.generate({
    task: "chapter",
    seed: `${ctx.bookProjectId}:chapter:${brief.ordinal}`,
    schema: chapterContentSchema,
    context: {
      bookTitle: ctx.workingTitle,
      topic: ctx.topic,
      audience: ctx.targetReader,
      tone: ctx.toneStyle,
      chapterTitle: brief.title,
      chapterObjective: brief.objective,
      ordinal: brief.ordinal,
      priorContext: priorSummaries.map((p) => `Ch${p.ordinal}: ${p.summary}`).join(" | "),
      researchFindings: research.findings.map((f) => f.statement).join(" | "),
    },
  });
  return { output, usage, generated: true };
}

/* -------------------------------------------------------------- Editorial */

export async function editorialAgent(
  llm: LLMProvider,
  ctx: AgentContext,
  chapters: Array<{ ordinal: number; title: string; content: string }>,
): Promise<AgentResult<{ issues: Issue[] }>> {
  const { output, usage } = await llm.generate({
    task: "editorial",
    seed: `${ctx.bookProjectId}:editorial`,
    schema: editorialOutputSchema,
    context: { chapterCount: chapters.length, titles: chapters.map((c) => c.title).join(", ") },
  });
  return { output, usage, generated: true };
}

/** Deterministic structural checks that do not require an LLM. */
export function structuralChecks(
  chapters: Array<{ ordinal: number; title: string; content: string }>,
  expectedChapterCount: number,
): Issue[] {
  const issues: Issue[] = [];

  if (chapters.length === 0) {
    issues.push({
      severity: "critical",
      issueType: "chapter_completeness",
      message: "The manuscript has no chapters.",
      chapterOrdinal: null,
      location: null,
      proposedFix: "Generate the manuscript before approval.",
    });
    return issues;
  }

  if (chapters.length < expectedChapterCount) {
    issues.push({
      severity: "critical",
      issueType: "chapter_completeness",
      message: `Expected ${expectedChapterCount} chapters but only ${chapters.length} are present.`,
      chapterOrdinal: null,
      location: null,
      proposedFix: "Generate the missing chapters.",
    });
  }

  for (const chapter of chapters) {
    if (chapter.content.trim().length < 200) {
      issues.push({
        severity: "critical",
        issueType: "chapter_completeness",
        message: `Chapter ${chapter.ordinal} is too short to be publishable.`,
        chapterOrdinal: chapter.ordinal,
        location: null,
        proposedFix: "Regenerate or extend this chapter.",
      });
    }
    if (!/^#|\n/.test(chapter.content) && chapter.content.length > 1200) {
      issues.push({
        severity: "warning",
        issueType: "structure",
        message: `Chapter ${chapter.ordinal} has no visible paragraph breaks.`,
        chapterOrdinal: chapter.ordinal,
        location: null,
        proposedFix: "Break long blocks into paragraphs for mobile readability.",
      });
    }
  }

  return issues;
}

export async function factCheckAgent(
  llm: LLMProvider,
  ctx: AgentContext,
  chapters: Array<{ ordinal: number; content: string }>,
  sourceCount: number,
): Promise<AgentResult<ReturnType<typeof factCheckOutputSchema.parse>>> {
  const { output, usage } = await llm.generate({
    task: "fact_check",
    seed: `${ctx.bookProjectId}:factcheck:${sourceCount}`,
    schema: factCheckOutputSchema,
    context: { chapterCount: chapters.length, sourceCount },
  });
  return { output, usage, generated: true };
}

/** Cross-chapter consistency: duplicate titles and unresolved fact checks. */
export function consistencyChecks(
  chapters: Array<{ ordinal: number; title: string }>,
  unsupportedClaims: number,
): Issue[] {
  const issues: Issue[] = [];

  const seen = new Map<string, number>();
  for (const chapter of chapters) {
    const key = chapter.title.trim().toLowerCase();
    const prior = seen.get(key);
    if (prior !== undefined) {
      issues.push({
        severity: "warning",
        issueType: "consistency",
        message: `Chapters ${prior} and ${chapter.ordinal} share the same title.`,
        chapterOrdinal: chapter.ordinal,
        location: null,
        proposedFix: "Differentiate the chapter titles.",
      });
    } else {
      seen.set(key, chapter.ordinal);
    }
  }

  if (unsupportedClaims > 0) {
    issues.push({
      severity: "critical",
      issueType: "unsupported_claim",
      message: `${unsupportedClaims} factual claim(s) are not supported by a retained source.`,
      chapterOrdinal: null,
      location: null,
      proposedFix: "Add a supporting source or soften the claim.",
    });
  }

  return issues;
}

/* -------------------------------------------------------------- Metadata */

export async function metadataAgent(
  llm: LLMProvider,
  ctx: AgentContext,
  plan: PlanOutput,
  disclosures: string[],
): Promise<AgentResult<MetadataOutput>> {
  const { output, usage } = await llm.generate({
    task: "metadata",
    seed: `${ctx.bookProjectId}:metadata`,
    schema: metadataOutputSchema,
    context: {
      title: plan.title,
      topic: ctx.topic,
      audience: ctx.targetReader,
      authorName: ctx.authorName,
      // Truthful disclosure: any AI-generated part forces ai_generated.
      disclosures: disclosures.join(","),
    },
  });
  return { output, usage, generated: true };
}

/* -------------------------------------------------------------- Cover */

export async function coverAgent(
  image: ImageProvider,
  llm: LLMProvider,
  ctx: AgentContext,
  plan: PlanOutput,
): Promise<AgentResult<CoverOutput>> {
  // The brief is generated; the image itself comes from the image provider.
  const brief = await llm.generate({
    task: "cover",
    seed: `${ctx.bookProjectId}:cover`,
    schema: coverOutputSchema,
    context: { title: plan.title, subtitle: plan.subtitle },
  });

  const { output, usage } = await image.generateCover({
    title: plan.title,
    subtitle: plan.subtitle,
    palette: brief.output.brief.palette,
  });

  return { output: { ...output, brief: brief.output.brief }, usage, generated: true };
}

/* -------------------------------------------------------------- Production */

/**
 * Deterministic manuscript assembly (ADR-015).
 *
 * Produces an immutable snapshot from the supplied chapter contents. It does
 * not read live drafts, so regenerating a chapter cannot silently alter an
 * already-assembled manuscript.
 */
export function assembleManuscript(input: {
  title: string;
  version: number;
  chapters: Array<{ ordinal: number; title: string; content: string; sourceDraftId: string; sourceDraftVersion: number }>;
}): AssembledManuscript {
  const ordered = [...input.chapters].sort((a, b) => a.ordinal - b.ordinal);
  const wordCount = ordered.reduce((total, chapter) => total + chapter.content.split(/\s+/).filter(Boolean).length, 0);

  return assembledManuscriptSchema.parse({
    title: input.title,
    version: input.version,
    chapters: ordered.map((c) => ({
      ordinal: c.ordinal,
      title: c.title,
      content: c.content,
      sourceDraftId: c.sourceDraftId,
      sourceDraftVersion: c.sourceDraftVersion,
    })),
    wordCount,
    assembledAt: new Date().toISOString(),
  });
}

/* -------------------------------------------------------------- Preflight */

export interface PreflightCheck {
  name: string;
  passed: boolean;
  detail: string;
}

/**
 * Final readiness gate. ADR-011: this is the only thing that may promote a
 * book from QA to READY_FOR_REVIEW.
 */
export function preflightChecks(input: {
  manuscriptExists: boolean;
  coverExists: boolean;
  metadataExists: boolean;
  epubExists: boolean;
  openCriticalIssues: number;
  missingProvenance: number;
  disclosurePresent: boolean;
  aiGenerated: boolean;
}): PreflightCheck[] {
  return [
    {
      name: "manuscript_exists",
      passed: input.manuscriptExists,
      detail: input.manuscriptExists ? "Current manuscript present" : "No current manuscript",
    },
    {
      name: "cover_exists",
      passed: input.coverExists,
      detail: input.coverExists ? "Current cover present" : "No current cover",
    },
    {
      name: "metadata_exists",
      passed: input.metadataExists,
      detail: input.metadataExists ? "Current metadata present" : "No current metadata",
    },
    {
      name: "epub_exists",
      passed: input.epubExists,
      detail: input.epubExists ? "Current EPUB present" : "No current EPUB",
    },
    {
      name: "no_critical_issues",
      passed: input.openCriticalIssues === 0,
      detail:
        input.openCriticalIssues === 0
          ? "No critical quality issues"
          : `${input.openCriticalIssues} critical issue(s) open`,
    },
    {
      name: "provenance_complete",
      passed: input.missingProvenance === 0,
      detail:
        input.missingProvenance === 0
          ? "All generated artifacts have provenance"
          : `${input.missingProvenance} artifact(s) missing provenance`,
    },
    {
      name: "ai_disclosure_present",
      passed: input.disclosurePresent,
      detail: input.disclosurePresent
        ? "Disclosure state recorded on current metadata"
        : "No AI disclosure state recorded",
    },
    {
      name: "disclosure_truthful",
      // Never approve a package whose content is AI-generated but undisclosed.
      passed: !input.aiGenerated || input.disclosurePresent,
      detail: input.aiGenerated
        ? "AI-generated content must be disclosed to KDP"
        : "No AI-generated content in this package",
    },
  ];
}