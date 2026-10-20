import { describe, expect, it } from "vitest";
import { MockLLMProvider } from "@kdone/ai";
import { AgentContext, EditorialChapterInput, editorialAgent } from "./index.js";

const ctx: AgentContext = {
  bookProjectId: "8f1d2a3b-0000-4000-8000-000000000001",
  workingTitle: "Shipping Small",
  topic: "small-scale software delivery",
  targetReader: "solo founders",
  toneStyle: "practical",
  authorName: "Ada Author",
};

const REPEATED =
  "Consistent quality comes from small, repeatable release increments every week.";

const chapter = (content: string): EditorialChapterInput => ({
  ordinal: 1,
  title: "Small increments",
  content,
  objective: "Teach the weekly release cadence",
});

describe("editorialAgent prose threading", () => {
  it("flags an obviously repeated sentence in the draft prose", async () => {
    const draft = [
      "This method works for owners who keep their own books.",
      REPEATED,
      REPEATED,
      REPEATED,
      "Keep every receipt in one place.",
    ].join(" ");

    const result = await editorialAgent(new MockLLMProvider(), ctx, [chapter(draft)]);

    const repetition = result.output.issues.filter((i) => i.issueType === "repetition");
    expect(repetition.length).toBeGreaterThan(0);
    expect(repetition[0]!.message).toContain("repeats the sentence");
    expect(result.output.issues.length).toBeGreaterThanOrEqual(1);
  });

  it("returns zero issues when the chapter has no draft", async () => {
    const result = await editorialAgent(new MockLLMProvider(), ctx, [chapter("")]);
    expect(result.output.issues).toEqual([]);
  });

  it("returns zero issues when no chapter has a draft", async () => {
    const empty: EditorialChapterInput[] = [
      { ordinal: 1, title: "One", content: "", objective: "" },
      { ordinal: 2, title: "Two", content: "", objective: "" },
    ];
    const result = await editorialAgent(new MockLLMProvider(), ctx, empty);
    expect(result.output.issues).toEqual([]);
  });

  it("does not emit issues for a clean draft", async () => {
    const draft =
      "This method works for owners who keep their own books. Consistency beats intensity when shipping alone.";
    const result = await editorialAgent(new MockLLMProvider(), ctx, [chapter(draft)]);
    expect(result.output.issues).toEqual([]);
  });
});
