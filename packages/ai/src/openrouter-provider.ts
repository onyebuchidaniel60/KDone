import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { createHash } from "node:crypto";
import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { researchOutputSchema } from "@kdone/validation";
import type { LLMGenerateInput, LLMProvider, LLMResult, ResearchProvider, Usage } from "./index.js";

/*
 * OpenRouter provider over the official OpenAI SDK. Providers live behind
 * interfaces (ARCHITECTURE section 4); only this file and select-llm.ts touch
 * the SDK or the network.
 *
 * - Structured outputs: response_format json_schema with strict:true plus
 *   provider.require_parameters, so OpenRouter only routes to endpoints that
 *   actually enforce the schema.
 * - Model routing is per agent task (LLM_MODEL_ROUTES); chapters/plan use the
 *   office writing model, QA and utility tasks use cheaper office models.
 * - Refusal and truncation are hard errors, never silently degraded.
 */

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export const OPENROUTER_DEFAULT_HEADERS: Record<string, string> = {
  "HTTP-Referer": "https://kdone-uhhh2.vercel.app",
  "X-Title": "KDone",
};

export const WRITING_MODEL = "openai/gpt-5.6-sol";
export const EDITORIAL_MODEL = "openai/gpt-5.4";
export const UTILITY_MODEL = "openai/gpt-5-mini";

/** Task -> model. Every LLM task used by the agents (packages/agents) has a row. */
export const LLM_MODEL_ROUTES: Record<string, string> = {
  research: UTILITY_MODEL,
  plan: WRITING_MODEL,
  chapter: WRITING_MODEL,
  editorial: EDITORIAL_MODEL,
  fact_check: UTILITY_MODEL,
  metadata: UTILITY_MODEL,
  cover: UTILITY_MODEL,
};

/** USD per 1M tokens. Single source of truth for cost estimates. */
export const OPENROUTER_MODEL_RATES_USD_PER_1M: Record<string, { input: number; output: number }> = {
  [WRITING_MODEL]: { input: 4.0, output: 20.0 },
  [EDITORIAL_MODEL]: { input: 2.5, output: 15.0 },
  [UTILITY_MODEL]: { input: 0.25, output: 2.0 },
};

const MAX_OUTPUT_TOKENS: Record<string, number> = {
  research: 4000,
  plan: 8000,
  chapter: 16000,
  editorial: 4000,
  fact_check: 4000,
  metadata: 2000,
  cover: 1000,
};

const SCHEMA_NAMES: Record<string, string> = {
  research: "research_output",
  plan: "plan_output",
  chapter: "chapter_content",
  editorial: "editorial_output",
  fact_check: "fact_check_output",
  metadata: "metadata_output",
  cover: "cover_brief",
};

export class LLMRefusalError extends Error {
  readonly refusal: string;
  constructor(refusal: string) {
    super(`LLM refused the request: ${refusal}`);
    this.name = "LLMRefusalError";
    this.refusal = refusal;
  }
}

export class LLMTruncatedError extends Error {
  readonly finishReason: string;
  constructor(finishReason: string) {
    super(`LLM output truncated before the response ended (finish_reason=${finishReason})`);
    this.name = "LLMTruncatedError";
    this.finishReason = finishReason;
  }
}

/** OpenRouter extension of the standard chat-completions request. */
export interface OpenRouterRequestExtension {
  provider?: { require_parameters?: boolean };
}

/**
 * Minimal structural client seam so tests can inject a fake without the SDK.
 * The real client is built with the official OpenAI SDK pointed at OpenRouter.
 */
export interface OpenRouterClientShape {
  chat: {
    completions: {
      create: (
        params: ChatCompletionCreateParamsNonStreaming & OpenRouterRequestExtension,
      ) => Promise<ChatCompletion>;
    };
  };
}

export interface OpenRouterOptions {
  /** Defaults to process.env.OPENROUTER_API_KEY. */
  apiKey?: string;
  /** Test seam: replaces the SDK client entirely. */
  client?: OpenRouterClientShape;
  /** Test seam: overrides retry backoff sleeping. */
  retryDelay?: (attempt: number) => Promise<void>;
  /** Test seam: overrides the base URL. */
  baseUrl?: string;
}

const MAX_ATTEMPTS = 3;

function defaultRetryDelay(attempt: number): Promise<void> {
  const jitter = Math.random() * 200;
  const ms = Math.min(4000, 250 * 2 ** (attempt - 1)) + jitter;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeClient(apiKey: string, baseUrl?: string): OpenRouterClientShape {
  const client = new OpenAI({
    apiKey,
    baseURL: baseUrl ?? OPENROUTER_BASE_URL,
    defaultHeaders: OPENROUTER_DEFAULT_HEADERS,
    maxRetries: 0,
  });
  return {
    chat: {
      completions: {
        create: (params) => client.chat.completions.create(params),
      },
    },
  };
}

function seedToInteger(seed: string): number {
  const n = Number.parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16);
  return n % 2 ** 31;
}

function isRetryableError(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  // No status -> network/connection error. 429 or 5xx -> retryable.
  return status === undefined || status === 429 || status >= 500;
}

type JsonSchemaNode = Record<string, unknown>;

const UNSUPPORTED_SCHEMA_KEYS = new Set([
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "definitions",
  "default",
  "examples",
  "format",
  "pattern",
  "title",
  "description",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
  "patternProperties",
  "contentEncoding",
  "contentMediaType",
]);

function isNullBranch(branch: unknown): boolean {
  return typeof branch === "object" && branch !== null && (branch as JsonSchemaNode).type === "null";
}

/**
 * Collapses [branches..., null] into a single branch with type union
 * `[T, "null"]` (OpenAI strict mode forbids bare `{"type":"null"}` branches).
 */
function collapseNullable(branches: unknown[]): JsonSchemaNode {
  const rest = branches.filter((b) => !isNullBranch(b)).map((b) => normalizeStrictSchema(b));
  const hasNull = branches.some(isNullBranch);
  let base: JsonSchemaNode;
  if (rest.length === 0) {
    base = { type: "null" };
  } else if (rest.length === 1) {
    base = rest[0] as JsonSchemaNode;
  } else {
    base = { anyOf: rest };
  }
  if (hasNull && rest.length > 0) {
    const t = base.type;
    base.type =
      t === undefined
        ? ["string", "null"]
        : Array.isArray(t)
          ? [...new Set([...t, "null"])]
          : [t, "null"];
  }
  return base;
}

/**
 * Converts a Zod-derived JSON Schema into the strict shape OpenAI-family
 * endpoints accept: unsupported keywords stripped, `additionalProperties:false`
 * on every object with all properties required, and nullable values
 * represented as `[type, "null"]` unions.
 */
export function normalizeStrictSchema(node: unknown): JsonSchemaNode {
  if (node === null || typeof node !== "object") {
    return node === undefined ? { type: "null" } : { const: node };
  }
  const input = node as JsonSchemaNode;
  const out: JsonSchemaNode = {};
  for (const [key, value] of Object.entries(input)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(key)) continue;
    out[key] = value;
  }

  if (Array.isArray(out.anyOf)) {
    return collapseNullable(out.anyOf as unknown[]);
  }
  if (Array.isArray(out.oneOf)) {
    return { anyOf: (out.oneOf as unknown[]).map((b) => normalizeStrictSchema(b)) };
  }
  if (Array.isArray(out.allOf) && out.allOf.length === 1) {
    return normalizeStrictSchema(out.allOf[0]);
  }

  if (out.type === "object") {
    out.additionalProperties = false;
    if (out.properties !== undefined && typeof out.properties === "object") {
      const props = out.properties as Record<string, unknown>;
      out.properties = Object.fromEntries(
        Object.entries(props).map(([key, value]) => [key, normalizeStrictSchema(value)]),
      );
      out.required = Object.keys(props).sort();
    }
  }
  if (out.type === "array" && out.items !== undefined) {
    out.items = normalizeStrictSchema(out.items);
  }
  return out;
}

/** Builds `{ type: "json_schema", json_schema: {...} }` with strict shape. */
export function buildResponseFormat(
  schema: z.ZodType<unknown, z.ZodTypeDef, unknown>,
  name: string,
): { type: "json_schema"; json_schema: { name: string; strict: true; schema: JsonSchemaNode } } {
  // The default "jsonSchema7" target keeps nullable fields expressible the way
  // zod parses them; the "openAi" target wraps default-valued fields in
  // anyOf-with-null, which zod would then reject at parse time.
  let raw = zodToJsonSchema(schema, {
    name,
    $refStrategy: "none",
  }) as JsonSchemaNode;
  if (typeof raw.$ref === "string" && raw.definitions) {
    const refName = raw.$ref.replace("#/definitions/", "");
    const resolved = (raw.definitions as Record<string, unknown>)[refName];
    if (resolved) raw = resolved as JsonSchemaNode;
  }
  delete raw.$schema;
  return { type: "json_schema", json_schema: { name, strict: true, schema: normalizeStrictSchema(raw) } };
}

const SYSTEM_PROMPT = [
  "You are KDone's publishing agent working on a real book that will be sold as an ebook through Amazon Kindle Direct Publishing.",
  "The user message contains task context and instructions; return output that matches the requested JSON schema exactly.",
  "Rules: never invent facts, sources, URLs, statistics, endorsements, credentials, or citations you are not certain of.",
  "If a real source cannot be named with confidence, prefer an empty or shorter list over fabrication.",
  "Write for a Kindle reader: clear, practical prose, short paragraphs, no filler.",
].join(" ");

function researchPrompt(ctx: Record<string, unknown>): string {
  return [
    `Produce market and reader-problem research notes for a how-to book about ${String(ctx.topic)} written for ${String(ctx.audience)} (research depth requested: ${String(ctx.depth)}).`,
    "marketSummary: the current landscape a publisher needs to know (what exists, what the gaps are, who else serves this reader).",
    "readerProblemSummary: the concrete problem the target reader faces and why existing material leaves them stuck.",
    `sources: 1-3 sources you are confident really exist - official documentation, major institutions, or well-known publications, each with a REAL url you know. NEVER fabricate a URL; include only sources you are sure of.`,
    "sourceName, sourceType and status ('retained') must reflect the actual entity.",
    "findings: 2-6 concrete findings grounded in your confident knowledge, with findingType, a specific statement, confidence, and sourceIndex pointing at the supporting source (null if none).",
    "angles: 1-4 book angles that could position a how-to book for this reader.",
  ].join(" ");
}

function planPrompt(ctx: Record<string, unknown>): string {
  return [
    `Design the book plan for "${String(ctx.title)}" - a practical guide about ${String(ctx.topic)} for ${String(ctx.audience)}.`,
    `Research summary: ${String(ctx.researchSummary)}`,
    `Angles: ${String(ctx.angles)}`,
    `Target the manuscript at roughly ${String(ctx.targetWordCount)} words; every chapter targetWordCount must be substantial and together should sum close to that total.`,
    "Provide a strong final title (you may improve the working title), a subtitle, a positioning statement, and a one-sentence bookPromise.",
    "Chapters must follow a logical process arc for the reader.",
  ].join(" ");
}

function chapterPrompt(ctx: Record<string, unknown>): string {
  return [
    `Write the complete chapter "${String(ctx.chapterTitle)}" for the book "${String(ctx.bookTitle)}" about ${String(ctx.topic)}.`,
    `Chapter objective: ${String(ctx.chapterObjective)}`,
    `Chapter number: ${String(ctx.ordinal)}. Audience: ${String(ctx.audience)}. Tone: ${String(ctx.tone)}.`,
    `Prior-chapter context (do not repeat these summaries verbatim): ${String(ctx.priorContext)}`,
    `Research findings you may build on (reference by index only if truly used): ${String(ctx.researchFindings)}`,
    "Return content in Markdown (headings plus paragraphs suitable for an e-reader), at least 800 words.",
    "summary must be a 2-3 sentence recap. supportedBy must list the indexes (0-based) of researchFindings entries you actually used, or an empty array if none apply.",
  ].join(" ");
}

function editorialPrompt(ctx: Record<string, unknown>): string {
  return [
    `You are doing an editorial pass over a manuscript. Each planned chapter is listed in the context with its title, its plan objective and its current draft content (full prose; empty when no draft exists yet).`,
    "Ground every issue in the supplied prose or plan text: quote or locate it (chapterOrdinal + what to change). Evaluate structure, readability, repetition and consistency for a Kindle reader.",
    "For every issue you report: issueType, severity (critical/warning/suggestion), a concrete message, and proposedFix when you can give a specific one.",
    "If a chapter has no draft content, do not invent issues from its absence. If no chapter gives you a concrete issue, return an empty issues array rather than inventing problems.",
  ].join(" ");
}

function factCheckPrompt(ctx: Record<string, unknown>): string {
  return [
    `You are fact-checking a manuscript. The context lists each chapter with its full draft content, plus the retained research sources (each with an id, url, title and sourceName) and the retained findings, where each finding carries the sourceId of the source that backs it (or null).`,
    "Extract specific factual claims from the chapter prose and verify them against the retained sources; sourceIndex must be the 0-based position of the supporting source in the retainedSources list, and null when nothing supports the claim.",
    "result must be verified, needs_revision, unsupported, or conflicting, with a rationale explaining why.",
    "Never invent a claim that is not stated in the prose and never invent a source; if no chapter prose contains a specific checkable claim, return an empty claims array.",
  ].join(" ");
}

function metadataPrompt(ctx: Record<string, unknown>): string {
  return [
    `Produce Amazon KDP-ready metadata for the book "${String(ctx.title)}" about ${String(ctx.topic)} for ${String(ctx.audience)}.`,
    `Author to credit: ${String(ctx.authorName)}. Disclosures on file: ${String(ctx.disclosures)}`,
    "description should be a compelling 2-4 sentence Kindle description that honestly describes the book.",
    "keywords: 5-7 real search phrases, each under 60 characters.",
    "categories: 1-3 Amazon book browse category paths like 'Books > Reference'.",
    "language must be an ISO 639-1 code (default 'en'). price must be a plain decimal string like '9.99'.",
    "aiDisclosure must be 'ai_generated' when any part of the manuscript is AI-generated; disclosure must stay truthful.",
  ].join(" ");
}

function coverPrompt(ctx: Record<string, unknown>): string {
  return [
    `Design an ebook cover brief for "${String(ctx.title)}" (${String(ctx.subtitle)}) about ${String(ctx.topic)} for ${String(ctx.audience)}.`,
    "palette: exactly 2-3 opaque hex colors in #rrggbb form, ordered background, foreground, accent. Pick a readable, high-contrast combination.",
    "motif: a short kicker phrase of at most 8 words that signals the book's angle.",
    "titleTreatment: one of uppercase, serif, sans-serif, display.",
    "rationale: one sentence explaining the visual direction.",
    "Do NOT write SVG, HTML, XML, or any markup. The cover is rendered deterministically from this brief by the image provider.",
  ].join(" ");
}

const PROMPTS: Record<string, (ctx: Record<string, unknown>) => string> = {
  research: researchPrompt,
  plan: planPrompt,
  chapter: chapterPrompt,
  editorial: editorialPrompt,
  fact_check: factCheckPrompt,
  metadata: metadataPrompt,
  cover: coverPrompt,
};

function promptFor(task: string, context: Record<string, unknown>): string {
  const builder = PROMPTS[task];
  if (!builder) throw new Error(`OpenRouterProvider has no prompt for task "${task}"`);
  return [
    `Task: ${task}.`,
    `Context: ${JSON.stringify(context, null, 2)}`,
    builder(context),
    "Return ONLY a JSON value matching the response format. No markdown fences, no commentary.",
  ].join("\n\n");
}

function extractJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = fenced ? (fenced[1] ?? "") : trimmed;
  try {
    return JSON.parse(candidate) as unknown;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`OpenRouter returned content that is not valid JSON: ${message}`);
  }
}

export class OpenRouterProvider implements LLMProvider {
  readonly name = "openrouter";
  /** Per-task routing means `model` names the office writing model. */
  readonly model = WRITING_MODEL;
  private readonly client: OpenRouterClientShape;
  private readonly retryDelay: (attempt: number) => Promise<void>;

  constructor(options: OpenRouterOptions = {}) {
    this.client = options.client ?? makeClient(options.apiKey ?? process.env.OPENROUTER_API_KEY ?? "", options.baseUrl);
    this.retryDelay = options.retryDelay ?? defaultRetryDelay;
  }

  async generate<T>(input: LLMGenerateInput<T>): Promise<LLMResult<T>> {
    const task = input.task;
    const schemaName = SCHEMA_NAMES[task];
    if (!schemaName) throw new Error(`OpenRouterProvider has no schema name registered for task "${task}"`);
    const model = LLM_MODEL_ROUTES[task];
    if (!model) throw new Error(`OpenRouterProvider has no model route registered for task "${task}"`);

    const responseFormat = buildResponseFormat(input.schema, schemaName);
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: promptFor(task, input.context) },
    ];
    const params: ChatCompletionCreateParamsNonStreaming & OpenRouterRequestExtension = {
      model,
      messages,
      response_format: responseFormat,
      max_tokens: MAX_OUTPUT_TOKENS[task] ?? 4000,
      seed: seedToInteger(input.seed),
      provider: { require_parameters: true },
    };

    let completion: ChatCompletion;
    let attempt = 1;
    for (;;) {
      try {
        completion = await this.client.chat.completions.create(params);
        break;
      } catch (err) {
        if (attempt >= MAX_ATTEMPTS || !isRetryableError(err)) throw err;
        await this.retryDelay(attempt);
        attempt = attempt + 1;
      }
    }

    const choice = completion.choices[0];
    if (!choice) throw new Error("OpenRouter returned no choices");

    const refusal = choice.message.refusal;
    if (typeof refusal === "string" && refusal.length > 0) throw new LLMRefusalError(refusal);

    if (choice.finish_reason === "length") throw new LLMTruncatedError(choice.finish_reason);

    const content = choice.message.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new Error("OpenRouter returned empty message content");
    }

    const output = input.schema.parse(extractJson(content));

    const usage: Usage = {
      provider: this.name,
      model,
      inputUnits: completion.usage?.prompt_tokens ?? 0,
      outputUnits: completion.usage?.completion_tokens ?? 0,
      estimatedCost: estimateCost(
        model,
        completion.usage?.prompt_tokens ?? 0,
        completion.usage?.completion_tokens ?? 0,
      ),
    };
    return { output, usage };
  }
}

export function estimateCost(model: string, inputUnits: number, outputUnits: number): number {
  const rate = OPENROUTER_MODEL_RATES_USD_PER_1M[model];
  if (!rate) {
    console.warn(`No cost rate registered for model "${model}"; recording estimatedCost 0`);
    return 0;
  }
  const cost = (inputUnits / 1_000_000) * rate.input + (outputUnits / 1_000_000) * rate.output;
  return Number(cost.toFixed(8));
}

/** Research agent adapter: runs the research task on the routed utility model. */
export class OpenRouterResearchProvider implements ResearchProvider {
  readonly name = "openrouter-research";
  constructor(private readonly llm: OpenRouterProvider) {}

  async search(input: { topic: string; audience: string; depth: "light" | "standard" | "deep" }) {
    const result = await this.llm.generate({
      task: "research",
      seed: `${input.topic}:${input.audience}:${input.depth}`,
      schema: researchOutputSchema,
      context: { topic: input.topic, audience: input.audience, depth: input.depth },
    });
    return { output: result.output, usage: result.usage };
  }
}
