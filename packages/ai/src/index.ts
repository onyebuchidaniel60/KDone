import { createHash } from "node:crypto";
import {
  aiDisclosureSchema,
  chapterContentSchema,
  coverOutputSchema,
  editorialOutputSchema,
  factCheckOutputSchema,
  metadataOutputSchema,
  planOutputSchema,
  researchOutputSchema,
  type ChapterContent,
  type CoverOutput,
  type MetadataOutput,
  type PlanOutput,
  type ResearchOutput,
} from "@kdone/validation";
import type { z } from "zod";

/*
 * Provider interfaces (ARCHITECTURE section 4). Real providers and mocks
 * implement the same interfaces. UI components must never call these directly;
 * only agents do.
 */

export interface Usage {
  provider: string;
  model: string;
  inputUnits: number;
  outputUnits: number;
  estimatedCost: number;
}

export interface LLMResult<T> {
  output: T;
  usage: Usage;
}

/** Schema-constrained structured generation. */
export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  /** Generates a value validated against `schema`. Throws on invalid output. */
  generate<T>(input: LLMGenerateInput<T>): Promise<LLMResult<T>>;
}

export interface LLMGenerateInput<TOut> {
  task: string;
  /** Deterministic seed so mocks produce stable, reproducible output. */
  seed: string;
  /**
   * Output type is inferred from the schema. The input type is widened to
   * `unknown` so schemas using `.default()` still resolve to their output type
   * rather than a partially-optional input type.
   */
  schema: z.ZodType<TOut, z.ZodTypeDef, unknown>;
  context: Record<string, unknown>;
}

export interface ResearchProvider {
  readonly name: string;
  search(input: { topic: string; audience: string; depth: "light" | "standard" | "deep" }): Promise<{
    output: ResearchOutput;
    usage: Usage;
  }>;
}

export interface ImageProvider {
  readonly name: string;
  generateCover(input: { title: string; subtitle: string; palette: string[] }): Promise<{
    output: CoverOutput;
    usage: Usage;
  }>;
}

/* ------------------------------------------------------------------ Mocks */

const MOCK_MODEL = "mock-1";
const MOCK_COST_PER_UNIT = 0.000002;

function usage(name: string, inputUnits: number, outputUnits: number): Usage {
  return {
    provider: name,
    model: MOCK_MODEL,
    inputUnits,
    outputUnits,
    estimatedCost: Number(((inputUnits + outputUnits) * MOCK_COST_PER_UNIT).toFixed(8)),
  };
}

function hashInt(seed: string): number {
  return Number.parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16);
}

/**
 * Deterministic mock LLM. Produces plausible, schema-valid output derived from
 * the input so the entire lifecycle runs locally with no API keys, and so
 * tests are reproducible.
 *
 * Deliberately avoids inventing citations: source URLs are derived from the
 * seed and are obviously synthetic.
 */
export class MockLLMProvider implements LLMProvider {
  readonly name = "mock";
  readonly model = MOCK_MODEL;

  async generate<T>(input: LLMGenerateInput<T>): Promise<LLMResult<T>> {
    const ctx = input.context as Record<string, string | number | string[] | undefined>;
    const out = this.build(input.task, ctx, input.seed);
    const parsed = input.schema.parse(out);
    return { output: parsed, usage: usage(this.name, 120, 400) };
  }

  private build(task: string, ctx: Record<string, string | number | string[] | undefined>, seed: string): unknown {
    const title = String(ctx.title ?? ctx.workingTitle ?? "Untitled");
    const topic = String(ctx.topic ?? "the topic");
    const audience = String(ctx.audience ?? ctx.targetReader ?? "the target reader");
    const n = hashInt(`${task}:${seed}`);
    const para = (label: string, body: string) => `${label}: ${body}`;

    switch (task) {
      case "research":
        return researchOutputSchema.parse({
          marketSummary: para(
            "Market context",
            `Readers interested in ${topic} currently rely on scattered, unverified material. ${audience} needs a single structured guide.`,
          ),
          readerProblemSummary: para(
            "Reader problem",
            `${audience} struggles to move from general interest in ${topic} to an applied, trustworthy routine.`,
          ),
          sources: [
            {
              url: `https://example.test/source/${n % 97}`,
              title: `Primary overview of ${topic}`,
              sourceName: "Example Reference Library",
              sourceType: "reference",
              status: "retained",
            },
            {
              url: `https://example.test/source/${(n % 97) + 1}`,
              title: `Applied practice for ${topic}`,
              sourceName: "Example Practice Archive",
              sourceType: "practice",
              status: "retained",
            },
          ],
          findings: [
            {
              findingType: "gap",
              statement: `Most material on ${topic} stops at description without a repeatable process.`,
              confidence: "high",
              sourceIndex: 0,
            },
            {
              findingType: "demand",
              statement: `${audience} wants step-by-step application rather than theory.`,
              confidence: "medium",
              sourceIndex: 1,
            },
          ],
          angles: [`A practical, process-first treatment of ${topic} for ${audience}.`],
        });

      case "plan":
        return planOutputSchema.parse({
          title,
          subtitle: `A practical guide for ${audience}`,
          positioning: `A process-first ${topic} guide written for ${audience}.`,
          bookPromise: `Give ${audience} a repeatable way to apply ${topic}.`,
          targetWordCount: Number(ctx.targetWordCount ?? 30_000),
          chapters: [
            {
              ordinal: 1,
              title: "Why this matters",
              objective: `Establish the reader's problem around ${topic}.`,
              targetWordCount: 3000,
            },
            {
              ordinal: 2,
              title: "The core process",
              objective: "Teach the repeatable process step by step.",
              targetWordCount: 5000,
            },
            {
              ordinal: 3,
              title: "Putting it to work",
              objective: "Apply the process to realistic scenarios.",
              targetWordCount: 4000,
            },
          ],
        });

      case "chapter": {
        const body = Array.from(
          { length: 6 },
          (_, i) =>
            `${String(ctx.chapterTitle ?? "This chapter")} builds on the previous idea. Point ${i + 1} explains how ${topic} applies to ${audience} in practice, and what to watch for.`,
        ).join("\n\n");
        return chapterContentSchema.parse({
          title: String(ctx.chapterTitle ?? "Chapter"),
          content: `${body}\n\nIn summary, the process for ${topic} is repeatable once the reader has the criteria in place.`,
          summary: `Covers ${String(ctx.chapterObjective ?? "the chapter objective")}.`,
          supportedBy: [0],
        });
      }

      case "editorial":
        return editorialOutputSchema.parse({
          issues: [
            {
              severity: "warning" as const,
              issueType: "readability",
              message: "Some sentences are long; consider splitting for mobile reading.",
              chapterOrdinal: 1,
              location: null,
              proposedFix: "Split sentences over 25 words.",
            },
            {
              severity: "suggestion" as const,
              issueType: "structure",
              message: "Consider a short transition paragraph between sections.",
              chapterOrdinal: null,
              location: null,
              proposedFix: null,
            },
          ],
        });

      case "fact_check":
        return factCheckOutputSchema.parse({
          claims: [
            {
              claim: `${audience} currently lacks a structured approach to ${topic}.`,
              result: "verified" as const,
              rationale: "Supported by the retained reference source.",
              sourceIndex: 0,
              chapterOrdinal: 1,
            },
            {
              claim: `Adoption of ${topic} practices has grown sharply in recent years.`,
              result: "unsupported" as const,
              rationale: "No retained source establishes this trend.",
              sourceIndex: null,
              chapterOrdinal: 2,
            },
          ],
        });

      case "metadata":
        return metadataOutputSchema.parse({
          title,
          subtitle: `A practical guide for ${audience}`,
          description: `A structured, process-first guide to ${topic} written for ${audience}.`,
          authorNames: [String(ctx.authorName ?? "The Author")],
          keywords: [topic.slice(0, 40), "guide", "how-to", "practice"].slice(0, 7),
          categories: ["Books > Reference", "Books > Self-Help"].slice(0, 3),
          language: String(ctx.language ?? "en"),
          rights: String(ctx.rights ?? "Standard commercial rights"),
          price: String(ctx.price ?? "9.99"),
          // The manuscript is AI-generated, so disclosure must be truthful.
          aiDisclosure: aiDisclosureSchema.parse("ai_generated"),
        });

      case "cover":
        return coverOutputSchema.parse({
          brief: {
            concept: `A clean, high-contrast cover signalling a practical guide to ${topic}.`,
            palette: ["#1f2937", "#f9fafb", "#b45309"],
            typographyNote: "Large serif title, generous margins.",
          },
          svg: coverSvg(title, String(ctx.subtitle ?? ""), ["#1f2937", "#f9fafb", "#b45309"], seed),
          mimeType: "image/svg+xml",
        });

      default:
        throw new Error(`MockLLMProvider has no builder for task "${task}"`);
    }
  }
}

function coverSvg(title: string, subtitle: string, palette: string[], seed: string): string {
  const [bg = "#1f2937", fg = "#f9fafb", accent = "#b45309"] = palette;
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="2560" viewBox="0 0 1600 2560" data-seed="${esc(seed)}">`,
    `<rect width="1600" height="2560" fill="${esc(bg)}"/>`,
    `<rect x="80" y="80" width="1440" height="2400" fill="none" stroke="${esc(accent)}" stroke-width="8"/>`,
    `<text x="800" y="1100" font-family="Georgia, serif" font-size="120" fill="${esc(fg)}" text-anchor="middle">${esc(title.slice(0, 28))}</text>`,
    `<text x="800" y="1280" font-family="Georgia, serif" font-size="52" fill="${esc(accent)}" text-anchor="middle">${esc(subtitle.slice(0, 52))}</text>`,
    `</svg>`,
  ].join("");
}

export class MockResearchProvider implements ResearchProvider {
  readonly name = "mock-research";

  async search(input: { topic: string; audience: string; depth: "light" | "standard" | "deep" }) {
    const result = await new MockLLMProvider().generate({
      task: "research",
      seed: `${input.topic}:${input.audience}:${input.depth}`,
      schema: researchOutputSchema,
      context: { topic: input.topic, audience: input.audience },
    });
    return { output: result.output, usage: result.usage };
  }
}

export class MockImageProvider implements ImageProvider {
  readonly name = "mock-image";

  async generateCover(input: { title: string; subtitle: string; palette: string[] }) {
    const result = await new MockLLMProvider().generate({
      task: "cover",
      seed: `${input.title}:${input.subtitle}`,
      schema: coverOutputSchema,
      context: { title: input.title, subtitle: input.subtitle },
    });
    return { output: result.output, usage: result.usage };
  }
}

export type { ChapterContent, CoverOutput, MetadataOutput, PlanOutput, ResearchOutput };

/** Default provider set used when no real credentials are configured. */
export function defaultProviders() {
  const llm = new MockLLMProvider();
  return {
    llm,
    research: new MockResearchProvider(),
    image: new MockImageProvider(),
  };
}