import { describe, expect, it } from "vitest";
import { researchOutputSchema } from "@kdone/validation";
import { OpenRouterProvider } from "./index.js";

/*
 * Opt-in only, real OpenRouter API:
 *   OPENROUTER_INTEGRATION=1 pnpm vitest run packages/ai
 * (vitest.config.ts excludes *.integration.test.ts from the default suite.)
 */
const enabled = process.env.OPENROUTER_INTEGRATION === "1";

describe.skipIf(!enabled)("OpenRouterProvider against the real OpenRouter API", () => {
  it(
    "runs a real research task end to end with strict structured outputs",
    async () => {
      const provider = new OpenRouterProvider();
      const result = await provider.generate({
        task: "research",
        seed: "integration:research",
        schema: researchOutputSchema,
        context: {
          topic: "sourdough baking at home",
          audience: "beginners who want a repeatable process",
          depth: "standard",
        },
      });

      console.log(`[integration] model=${result.usage.model}`);
      console.log(`[integration] usage=${JSON.stringify(result.usage)}`);
      console.log(`[integration] sources=${result.output.sources.length} findings=${result.output.findings.length}`);
      console.log(`[integration] first source: ${JSON.stringify(result.output.sources[0] ?? null)}`);

      expect(result.usage.provider).toBe("openrouter");
      expect(result.usage.inputUnits).toBeGreaterThan(0);
      expect(result.usage.outputUnits).toBeGreaterThan(0);
      expect(result.usage.estimatedCost).toBeGreaterThan(0);
      expect(result.output.marketSummary.length).toBeGreaterThan(0);
      expect(result.output.readerProblemSummary.length).toBeGreaterThan(0);
      expect(result.output.angles.length).toBeGreaterThan(0);
    },
    120_000,
  );
});
