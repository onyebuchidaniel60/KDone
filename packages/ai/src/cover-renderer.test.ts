import { describe, expect, it } from "vitest";
import { coverBriefSchema } from "@kdone/validation";
import { MockImageProvider } from "./index.js";

/*
 * The cover image provider renders markup itself. The LLM only supplies the
 * brief, so these tests pin the properties the publishing pipeline relies on:
 * deterministic bytes, full KDP cover dimensions, escaped text, and no
 * external references.
 */

const BRIEF = coverBriefSchema.parse({
  palette: ["#102a43", "#f0f4f8", "#f0b429"],
  motif: "Practical AI for owner-operators",
  titleTreatment: "uppercase",
  rationale: "A sober, high-contrast cover with a single warm accent.",
});

const INPUT = {
  title: "AI Bookkeeping, One Robot at a Time",
  subtitle: "A practical guide for small service businesses",
  authorName: "Ada Lovelace",
  brief: BRIEF,
};

describe("MockImageProvider (deterministic SVG)", () => {
  it("renders a full-size servable SVG from the brief without a model", async () => {
    const provider = new MockImageProvider();
    const first = await provider.generateCover(INPUT);
    const second = await provider.generateCover(INPUT);

    expect(first.output.svg).toBe(second.output.svg);
    expect(first.output.svg).toContain('width="1600" height="2560"');
    expect(first.output.svg).toContain('viewBox="0 0 1600 2560"');
    expect(first.output.svg).toContain("<title>AI Bookkeeping, One Robot at a Time</title>");
    expect(first.output.svg).toContain(">AI BOOKKEEPING,<");
    expect(first.output.svg).toContain("Ada Lovelace");
    expect(first.output.svg).toContain(BRIEF.palette[0]);
    expect(first.output.svg).toContain(BRIEF.palette[2]);
    expect(first.output.svg).not.toMatch(/<image|<script|href=/i);
    expect(first.output.mimeType).toBe("image/svg+xml");
    expect(first.usage.estimatedCost).toBe(0);
    expect(first.usage.outputUnits).toBeGreaterThan(0);
  });

  it("escapes markup instead of embedding caller text as elements", async () => {
    const provider = new MockImageProvider();
    const rendered = await provider.generateCover({
      ...INPUT,
      title: 'A <B> & "C"',
      authorName: "O'Neil <script>",
    });

    expect(rendered.output.svg).toContain("A &lt;B&gt; &amp; &quot;C&quot;");
    expect(rendered.output.svg).toContain("O'Neil &lt;script&gt;");
    expect(rendered.output.svg).not.toContain("<B>");
    expect(rendered.output.svg).not.toContain("<script>");
  });

  it("rejects a brief with too many colors or a non-hex palette", () => {
    expect(() =>
      coverBriefSchema.parse({ ...BRIEF, palette: ["#000000", "#ffffff"] }),
    ).not.toThrow();
    expect(() =>
      coverBriefSchema.parse({
        ...BRIEF,
        palette: ["#000000", "#ffffff", "#ff0000", "#00ff00"],
      }),
    ).toThrow();
    expect(() => coverBriefSchema.parse({ ...BRIEF, palette: ["navy", "#ffffff"] })).toThrow();
  });
});
