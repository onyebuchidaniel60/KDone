import { describe, expect, it } from "vitest";
import { countWords, truncateToTarget } from "./index.js";

const paragraph = (n: number, words: number) =>
  `${Array.from({ length: words }, (_, i) => `p${n}w${i + 1}`).join(" ")}.`;

describe("chapter sizing guardrail", () => {
  it("keeps a draft that is within 15% of the target unchanged", () => {
    const draft = [paragraph(1, 1000), paragraph(2, 1000)].join("\n\n");
    expect(countWords(draft)).toBe(2000);
    expect(truncateToTarget(draft, 2000)).toBe(draft);
  });

  it("truncates an overlong draft at a paragraph boundary near the target", () => {
    const draft = [paragraph(1, 1000), paragraph(2, 1000), paragraph(3, 1000)].join("\n\n");
    const result = truncateToTarget(draft, 2000);
    const words = countWords(result);

    expect(words).toBeGreaterThanOrEqual(1700);
    expect(words).toBeLessThanOrEqual(2300);
    expect(result).toBe([paragraph(1, 1000), paragraph(2, 1000)].join("\n\n"));
    expect(result.endsWith("p2w1000.")).toBe(true);
    expect(result).not.toContain("p3w1");
  });

  it("keeps one oversized paragraph rather than cutting mid-sentence", () => {
    const draft = paragraph(1, 2500);
    const result = truncateToTarget(draft, 2000);
    expect(result).toBe(draft);
  });
});
