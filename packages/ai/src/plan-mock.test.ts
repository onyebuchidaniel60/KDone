import { describe, expect, it } from "vitest";
import { planOutputSchema } from "@kdone/validation";
import { MockLLMProvider } from "./index.js";

describe("MockLLMProvider plan sizing", () => {
  it("honors an explicit chapter count and distributes the word target", async () => {
    const result = await new MockLLMProvider().generate({
      task: "plan",
      seed: "chapter-count",
      schema: planOutputSchema,
      context: {
        title: "A Practical Guide",
        topic: "process design",
        audience: "small teams",
        targetWordCount: 16000,
        chapterCount: 8,
      },
    });

    expect(result.output.chapters).toHaveLength(8);
    expect(result.output.chapters.map((c) => c.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result.output.chapters.reduce((sum, c) => sum + c.targetWordCount, 0)).toBe(16000);
  });
});
