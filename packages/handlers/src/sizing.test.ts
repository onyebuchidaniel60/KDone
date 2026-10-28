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

  it("does not leave a section heading as the final line", () => {
    const body = paragraph(1, 1900);
    const draft = [body, "## Next Section", paragraph(2, 500)].join("\n\n");
    const result = truncateToTarget(draft, 2000);

    expect(result).toBe(body);
    expect(result.endsWith("p1w1900.")).toBe(true);
    expect(result).not.toContain("Next Section");
  });

  it("does not leave a lead-in whose list was dropped", () => {
    const body = paragraph(1, 2290);
    const leadIn = "Your response plan should name who will:";
    const list = ["- who calls", "- who decides", "- who reviews", "- who speaks to customers"].join("\n");
    const draft = [body, leadIn, list, paragraph(9, 400)].join("\n\n");
    const result = truncateToTarget(draft, 2000);

    expect(result).toBe(body);
    expect(result).not.toContain("who will:");
    expect(result).not.toContain("who calls");
  });

  it("does not split a list across the cut", () => {
    const body = paragraph(1, 2250);
    const first = Array.from({ length: 15 }, (_, i) => `- first${i + 1}`).join("\n");
    const second = Array.from({ length: 15 }, (_, i) => `- second${i + 1}`).join("\n");
    const draft = [body, first, second].join("\n\n");
    const result = truncateToTarget(draft, 2000);

    expect(result).toBe(body);
    expect(result).not.toContain("- first1");
    expect(result).not.toContain("- second1");
  });
});
