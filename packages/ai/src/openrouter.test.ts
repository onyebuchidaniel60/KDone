import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chapterContentSchema,
  coverBriefSchema,
  editorialOutputSchema,
  factCheckOutputSchema,
  metadataOutputSchema,
  planOutputSchema,
  researchOutputSchema,
} from "@kdone/validation";
import {
  EDITORIAL_MODEL,
  LLM_MODEL_ROUTES,
  LLMRefusalError,
  LLMTruncatedError,
  MockLLMProvider,
  OPENROUTER_MODEL_RATES_USD_PER_1M,
  OpenRouterProvider,
  OpenRouterResearchProvider,
  UTILITY_MODEL,
  WRITING_MODEL,
  defaultProviders,
  estimateCost,
  selectLLM,
} from "./index.js";
import type { OpenRouterClientShape, OpenRouterRequestExtension } from "./index.js";

type CreateParams = Parameters<OpenRouterClientShape["chat"]["completions"]["create"]>[0];
type ChatCompletionValue = Awaited<ReturnType<OpenRouterClientShape["chat"]["completions"]["create"]>>;

interface FakeCall {
  params: CreateParams;
}

function fakeCompletion(
  content: string,
  overrides: Partial<{
    refusal: string | null;
    finishReason: string;
    promptTokens: number;
    completionTokens: number;
    model: string;
  }> = {},
): unknown {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 1_700_000_000,
    model: overrides.model ?? "test",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content, refusal: overrides.refusal ?? null },
        finish_reason: overrides.finishReason ?? "stop",
      },
    ],
    usage: {
      prompt_tokens: overrides.promptTokens ?? 10,
      completion_tokens: overrides.completionTokens ?? 20,
      total_tokens: (overrides.promptTokens ?? 10) + (overrides.completionTokens ?? 20),
    },
  };
}

function fakeClient(
  handler: (params: CreateParams, call: number) => Promise<unknown>,
): { client: OpenRouterClientShape; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const client: OpenRouterClientShape = {
    chat: {
      completions: {
        create: async (params) => {
          calls.push({ params });
          return (await handler(params, calls.length)) as ChatCompletionValue;
        },
      },
    },
  };
  return { client, calls };
}

const RESEARCH_CTX = { topic: "home sourdough", audience: "beginner bakers", depth: "standard" as const };

/**
 * Builds schema-valid payloads for any task via the deterministic mock, so the
 * fake OpenRouter client echoes output that satisfies the exact same zod
 * schema the real provider validates against.
 */
async function taskPayload(task: string): Promise<string> {
  const mock = new MockLLMProvider();
  switch (task) {
    case "research": {
      const r = await mock.generate({
        task,
        seed: "payload",
        schema: researchOutputSchema,
        context: RESEARCH_CTX,
      });
      return JSON.stringify(r.output);
    }
    case "plan": {
      const r = await mock.generate({ task, seed: "payload", schema: planOutputSchema, context: {} });
      return JSON.stringify(r.output);
    }
    case "chapter": {
      const r = await mock.generate({ task, seed: "payload", schema: chapterContentSchema, context: {} });
      return JSON.stringify(r.output);
    }
    case "editorial": {
      const r = await mock.generate({ task, seed: "payload", schema: editorialOutputSchema, context: {} });
      return JSON.stringify(r.output);
    }
    case "fact_check": {
      const r = await mock.generate({ task, seed: "payload", schema: factCheckOutputSchema, context: {} });
      return JSON.stringify(r.output);
    }
    case "metadata": {
      const r = await mock.generate({ task, seed: "payload", schema: metadataOutputSchema, context: {} });
      return JSON.stringify(r.output);
    }
    case "cover": {
      const r = await mock.generate({ task, seed: "payload", schema: coverBriefSchema, context: {} });
      return JSON.stringify(r.output);
    }
  }
  throw new Error(`no payload variant for task "${task}"`);
}

const TASK_SAMPLES = new Map<string, z.ZodType<unknown, z.ZodTypeDef, unknown>>([
  ["research", researchOutputSchema],
  ["plan", planOutputSchema],
  ["chapter", chapterContentSchema],
  ["editorial", editorialOutputSchema],
  ["fact_check", factCheckOutputSchema],
  ["metadata", metadataOutputSchema],
  ["cover", coverBriefSchema],
]);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("OpenRouterProvider (mocked client)", () => {
  it("sends a strict json_schema response_format with require_parameters and the routed model", async () => {
    const body = await taskPayload("research");
    const { client, calls } = fakeClient(async () => fakeCompletion(body));
    const provider = new OpenRouterProvider({ apiKey: "k", client, retryDelay: async () => {} });

    await provider.generate({
      task: "research",
      seed: "seed",
      schema: researchOutputSchema,
      context: RESEARCH_CTX,
    });

    expect(calls).toHaveLength(1);
    const params = calls[0]!.params;
    expect(params.model).toBe(UTILITY_MODEL);
    expect(typeof params.seed).toBe("number");
    expect(params.response_format?.type).toBe("json_schema");
    const injected = params as OpenRouterRequestExtension;
    expect(injected.provider).toEqual({ require_parameters: true });

    const jsonSchema = (params.response_format as { json_schema: { name: string; strict: true; schema: unknown } })
      .json_schema;
    expect(jsonSchema.name).toBe("research_output");
    expect(jsonSchema.strict).toBe(true);

    const dumped = JSON.stringify(jsonSchema.schema);
    // OpenAI strict mode forbids these keywords anywhere in the schema.
    expect(dumped).not.toMatch(/"(default|minLength|maxLength|minItems|maxItems|minimum|maximum|format|pattern|\$schema)":/);
    // nullable z.number().int() survives as a [type, "null"] union, not anyOf
    expect(dumped).toContain('"sourceIndex":{"type":["integer","null"]}');
    const root = jsonSchema.schema as { additionalProperties?: boolean; required?: string[] };
    expect(root.additionalProperties).toBe(false);
    expect(root.required).toEqual(["angles", "findings", "marketSummary", "readerProblemSummary", "sources"]);
    // nullable z.number().int() must survive as a [type, "null"] union, not anyOf
    expect(dumped).not.toContain('"anyOf":[{"type":"null"}]');
  });

  it("passes the chapter target word count and +/- 10% instruction to the prompt", async () => {
    const body = await taskPayload("chapter");
    const { client, calls } = fakeClient(async () => fakeCompletion(body));
    const provider = new OpenRouterProvider({ apiKey: "k", client, retryDelay: async () => {} });

    await provider.generate({
      task: "chapter",
      seed: "seed",
      schema: chapterContentSchema,
      context: {
        chapterTitle: "Getting Started",
        chapterObjective: "Establish the problem.",
        bookTitle: "A Practical Guide",
        topic: "process design",
        audience: "small teams",
        tone: "practical",
        ordinal: 1,
        priorContext: "",
        researchFindings: "",
        targetWordCount: 2000,
      },
    });

    const prompt = String(calls[0]!.params.messages[1]!.content);
    expect(prompt).toContain("approximately 2000 words");
    expect(prompt).toContain("+/- 10%");
    expect(prompt).toContain("do not exceed the target by more than 10%");
  });

  it("passes an exact chapter count to the plan prompt", async () => {
    const body = await taskPayload("plan");
    const { client, calls } = fakeClient(async () => fakeCompletion(body));
    const provider = new OpenRouterProvider({ apiKey: "k", client, retryDelay: async () => {} });

    await provider.generate({
      task: "plan",
      seed: "seed",
      schema: planOutputSchema,
      context: {
        title: "A Practical Guide",
        topic: "process design",
        audience: "small teams",
        targetWordCount: 16000,
        chapterCount: 8,
        researchSummary: "A summary.",
        angles: "A practical angle.",
      },
    });

    const prompt = String(calls[0]!.params.messages[1]!.content);
    expect(prompt).toContain("exactly 8 chapters");
    expect(prompt).toContain("approximately 2000 words");
  });

  it("throws an LLMRefusalError when the model refuses", async () => {
    const { client } = fakeClient(async () =>
      fakeCompletion("", { refusal: "I cannot comply with this request." }),
    );
    const provider = new OpenRouterProvider({ apiKey: "k", client });
    await expect(
      provider.generate({ task: "research", seed: "s", schema: researchOutputSchema, context: RESEARCH_CTX }),
    ).rejects.toThrowError(LLMRefusalError);
  });

  it("throws an LLMTruncatedError on finish_reason length even when JSON parses", async () => {
    const body = await taskPayload("research");
    const { client, calls } = fakeClient(async () => fakeCompletion(body, { finishReason: "length" }));
    const provider = new OpenRouterProvider({ apiKey: "k", client });
    await expect(
      provider.generate({ task: "research", seed: "s", schema: researchOutputSchema, context: RESEARCH_CTX }),
    ).rejects.toThrowError(LLMTruncatedError);
    expect(calls).toHaveLength(1);
  });

  it("retries 429 and 5xx errors with backoff, up to 3 total attempts", async () => {
    const body = await taskPayload("research");
    const delays: number[] = [];
    const { client, calls } = fakeClient(async (_params, call) => {
      if (call === 1) throw { status: 429 };
      if (call === 2) throw { status: 503 };
      return fakeCompletion(body);
    });
    const provider = new OpenRouterProvider({
      apiKey: "k",
      client,
      retryDelay: async (attempt) => {
        delays.push(attempt);
      },
    });

    const result = await provider.generate({
      task: "research",
      seed: "s",
      schema: researchOutputSchema,
      context: RESEARCH_CTX,
    });

    expect(calls).toHaveLength(3);
    expect(delays).toEqual([1, 2]);
    expect(result.usage.model).toBe(UTILITY_MODEL);
  });

  it("retries connection errors, exhausts 3 attempts, and rethrows the last error", async () => {
    const { client, calls } = fakeClient(async () => {
      throw new Error("network down");
    });
    const provider = new OpenRouterProvider({ apiKey: "k", client, retryDelay: async () => {} });

    await expect(
      provider.generate({ task: "research", seed: "s", schema: researchOutputSchema, context: RESEARCH_CTX }),
    ).rejects.toThrow("network down");
    expect(calls).toHaveLength(3);
  });

  it("does not retry non-retryable 4xx errors", async () => {
    const { client, calls } = fakeClient(async () => {
      const err = new Error("bad request") as Error & { status?: number };
      err.status = 400;
      throw err;
    });
    const provider = new OpenRouterProvider({ apiKey: "k", client });

    await expect(
      provider.generate({ task: "research", seed: "s", schema: researchOutputSchema, context: RESEARCH_CTX }),
    ).rejects.toThrow("bad request");
    expect(calls).toHaveLength(1);
  });

  it("rejects non-JSON content without retrying", async () => {
    const { client, calls } = fakeClient(async () => fakeCompletion("not json at all"));
    const provider = new OpenRouterProvider({ apiKey: "k", client });

    await expect(
      provider.generate({ task: "research", seed: "s", schema: researchOutputSchema, context: RESEARCH_CTX }),
    ).rejects.toThrow(/not valid JSON/);
    expect(calls).toHaveLength(1);
  });

  it("rejects schema-invalid content non-retryably", async () => {
    const { client, calls } = fakeClient(async () => fakeCompletion(JSON.stringify({ marketSummary: "x" })));
    const provider = new OpenRouterProvider({ apiKey: "k", client });

    await expect(
      provider.generate({ task: "research", seed: "s", schema: researchOutputSchema, context: RESEARCH_CTX }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it("tolerates markdown-fenced JSON", async () => {
    const body = await taskPayload("research");
    const { client } = fakeClient(async () => fakeCompletion(`\`\`\`json\n${body}\n\`\`\``));
    const provider = new OpenRouterProvider({ apiKey: "k", client });

    const result = await provider.generate({
      task: "research",
      seed: "s",
      schema: researchOutputSchema,
      context: RESEARCH_CTX,
    });
    expect(result.output.marketSummary.length).toBeGreaterThan(0);
  });

  it("routes each task to its model and records usage cost from the rate table", async () => {
    for (const task of [...TASK_SAMPLES.keys()]) {
      const body = await taskPayload(task);
      const seenModels: string[] = [];
      const { client } = fakeClient(async (params) => {
        seenModels.push(params.model);
        return fakeCompletion(body);
      });
      const provider = new OpenRouterProvider({ apiKey: "k", client });
      const result = await provider.generate({
        task,
        seed: "s",
        schema: TASK_SAMPLES.get(task)!,
        context: {},
      });
      expect(seenModels).toEqual([LLM_MODEL_ROUTES[task]!]);
      expect(result.usage.provider).toBe("openrouter");
      expect(result.usage.model).toBe(LLM_MODEL_ROUTES[task]!);
    }

    expect(LLM_MODEL_ROUTES.plan).toBe(WRITING_MODEL);
    expect(LLM_MODEL_ROUTES.chapter).toBe(WRITING_MODEL);
    expect(LLM_MODEL_ROUTES.editorial).toBe(EDITORIAL_MODEL);
    expect(LLM_MODEL_ROUTES.research).toBe(UTILITY_MODEL);
    expect(LLM_MODEL_ROUTES.fact_check).toBe(UTILITY_MODEL);
    expect(LLM_MODEL_ROUTES.metadata).toBe(UTILITY_MODEL);
    expect(LLM_MODEL_ROUTES.cover).toBe(UTILITY_MODEL);
  });

  it("computes cost from the exported rate table", () => {
    expect(estimateCost(UTILITY_MODEL, 2_000_000, 1_000_000)).toBeCloseTo(2.5, 6);
    expect(estimateCost(WRITING_MODEL, 1_000_000, 1_000_000)).toBe(24);
    expect(estimateCost(EDITORIAL_MODEL, 1_000_000, 1_000_000)).toBe(17.5);
    expect(estimateCost("unknown/model", 100, 100)).toBe(0);
    const utilities = OPENROUTER_MODEL_RATES_USD_PER_1M[UTILITY_MODEL]!;
    expect(utilities.input).toBe(0.25);
    expect(utilities.output).toBe(2.0);
  });
});

const SCHEMAS: Record<string, z.ZodType<unknown, z.ZodTypeDef, unknown>> = {
  research: researchOutputSchema,
  plan: planOutputSchema,
  chapter: chapterContentSchema,
  editorial: editorialOutputSchema,
  fact_check: factCheckOutputSchema,
  metadata: metadataOutputSchema,
  cover: coverBriefSchema,
};

describe("provider selection", () => {
  it("selects OpenRouter when the key is present", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const llm = selectLLM();
    expect(llm).toBeInstanceOf(OpenRouterProvider);
    expect(llm.name).toBe("openrouter");
  });

  it("falls back to the mock without a key", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(selectLLM()).toBeInstanceOf(MockLLMProvider);
  });

  it("wires defaultProviders to the openrouter research adapter when the key is present", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const providers = defaultProviders();
    expect(providers.research).toBeInstanceOf(OpenRouterResearchProvider);
    const research = providers.research as OpenRouterResearchProvider;
    expect(research.name).toBe("openrouter-research");
  });
});

describe("LLM model routing drift", () => {
  it("has a routing row for every task literal in packages/agents", async () => {
    const agentsSource = await readFile(
      fileURLToPath(new URL("../../agents/src/index.ts", import.meta.url)),
      "utf8",
    );
    const tasks = [...agentsSource.matchAll(/task:\s*"([a-z_]+)"/g)].map((m) => m[1]!);
    expect(tasks).toContain("plan");
    expect(tasks).toContain("chapter");
    for (const task of tasks) {
      expect(LLM_MODEL_ROUTES[task], `task "${task}" has no model route`).toBeTruthy();
    }
  });

  it("covers the closed set of provider tasks (epub assembly is deterministic and needs no LLM)", () => {
    for (const task of ["research", "plan", "chapter", "editorial", "fact_check", "metadata", "cover"]) {
      expect(LLM_MODEL_ROUTES[task], `task "${task}" has no model route`).toBeTruthy();
    }
  });

  it("keeps the OpenAI SDK import behind the approved provider modules only", async () => {
    const srcDir = fileURLToPath(new URL(".", import.meta.url));
    const sources = (await readdir(srcDir)).filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts"),
    );
    for (const name of sources) {
      if (name === "openrouter-provider.ts" || name === "select-llm.ts") continue;
      const source = await readFile(new URL(name, import.meta.url), "utf8");
      expect(source, `${name} must not import the openai SDK directly`).not.toMatch(/from\s+"openai/);
    }
  });
});
