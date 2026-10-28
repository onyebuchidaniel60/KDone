import { describe, expect, it } from "vitest";
import type { AssembledManuscript, MetadataOutput } from "@kdone/validation";
import { buildEpub, buildZip, renderChapterBody, validateEpub } from "./index.js";

const METADATA: MetadataOutput = {
  title: "A Practical Guide",
  subtitle: "For small teams",
  description: "A practical guide.",
  authorNames: ["A. Author"],
  keywords: ["guide"],
  categories: ["Books > Reference"],
  language: "en",
  rights: "All rights reserved",
  price: "9.99",
  aiDisclosure: "ai_generated",
};

function manuscript(content: string): AssembledManuscript {
  return {
    title: "A Practical Guide",
    version: 1,
    chapters: [
      {
        ordinal: 1,
        title: "Getting Started",
        content,
        sourceDraftId: crypto.randomUUID(),
        sourceDraftVersion: 1,
      },
    ],
    wordCount: 100,
    assembledAt: "2026-10-28T00:00:00.000Z",
  };
}

function readEntry(epub: Uint8Array, wanted: string): string {
  const view = new DataView(epub.buffer, epub.byteOffset, epub.byteLength);
  const eocd = epub.byteLength - 22;
  const count = view.getUint16(eocd + 10, true);
  let position = 0;
  for (let i = 0; i < count; i += 1) {
    const nameLength = view.getUint16(position + 26, true);
    const extraLength = view.getUint16(position + 28, true);
    const size = view.getUint32(position + 18, true);
    const name = new TextDecoder().decode(epub.slice(position + 30, position + 30 + nameLength));
    const dataStart = position + 30 + nameLength + extraLength;
    if (name === wanted) {
      return new TextDecoder().decode(epub.slice(dataStart, dataStart + size));
    }
    position = dataStart + size;
  }
  throw new Error(`entry not found: ${wanted}`);
}

describe("EPUB chapter rendering", () => {
  it("renders Markdown as XHTML with one H1 and no literal Markdown leaks", () => {
    const content = [
      "# Getting Started",
      "",
      "Intro with **bold** and *italic* text.",
      "",
      "## First Steps",
      "",
      "- one",
      "- two",
      "",
      "> A quoted warning.",
      "",
      "| Step | Detail |",
      "| --- | --- |",
      "| 1 | Start |",
      "",
      "Use `npm test` and see [the docs](https://example.test/docs).",
    ].join("\n");

    const epub = buildEpub({ manuscript: manuscript(content), metadata: METADATA });
    const xhtml = readEntry(epub, "OEBPS/chapter1.xhtml");

    expect(xhtml).toContain("<h1>Getting Started</h1>");
    expect(xhtml).toContain("<h2>First Steps</h2>");
    expect(xhtml).toContain("<strong>bold</strong>");
    expect(xhtml).toContain("<em>italic</em>");
    expect(xhtml).toContain("<ul>");
    expect(xhtml).toContain("<li>one</li>");
    expect(xhtml).toContain("<blockquote>");
    expect(xhtml).toContain("<table>");
    expect(xhtml).toContain("<code>npm test</code>");
    expect(xhtml).toContain('<a href="https://example.test/docs">the docs</a>');

    expect((xhtml.match(/<h1[\s>]/g) ?? []).length).toBe(1);
    expect(xhtml).not.toContain("**");
    expect(xhtml).not.toMatch(/<p>\s*#/);
    expect(xhtml).not.toMatch(/<p>\s*-\s/);
    expect(xhtml).not.toMatch(/<p>\s*\|/);

    const result = validateEpub(epub);
    expect(result.valid, result.errors.join("; ")).toBe(true);
  });

  it("uses the chapter title once even when the content starts with a different H1", () => {
    const rendered = renderChapterBody("# Wrong Heading\n\nBody text.", "Correct Title");
    expect(rendered).toContain("<h1>Correct Title</h1>");
    expect(rendered).not.toContain("Wrong Heading");
    expect((rendered.match(/<h1[\s>]/g) ?? []).length).toBe(1);
  });

  it("rejects literal Markdown and duplicate H1s during validation", () => {
    const entries = [
      { name: "mimetype", data: new TextEncoder().encode("application/epub+zip") },
      { name: "META-INF/container.xml", data: new TextEncoder().encode("<container/>") },
      { name: "OEBPS/content.opf", data: new TextEncoder().encode("<package/>") },
      { name: "OEBPS/nav.xhtml", data: new TextEncoder().encode("<html xmlns=\"http://www.w3.org/1999/xhtml\"><body><h1>Contents</h1></body></html>") },
      {
        name: "OEBPS/chapter1.xhtml",
        data: new TextEncoder().encode(
          "<html xmlns=\"http://www.w3.org/1999/xhtml\"><body><h1>Title</h1><h1>Again</h1><p># Heading</p><p>- item</p><p>**bold**</p><p>| cell |</p></body></html>",
        ),
      },
    ];
    const epub = buildZip(entries, new Date("2000-01-01T00:00:00.000Z"));
    const result = validateEpub(epub);

    expect(result.valid).toBe(false);
    expect(result.errors.join("; ")).toContain("exactly one <h1>");
    expect(result.errors.join("; ")).toContain("literal Markdown heading");
    expect(result.errors.join("; ")).toContain("literal Markdown list item");
    expect(result.errors.join("; ")).toContain("literal Markdown bold marker");
    expect(result.errors.join("; ")).toContain("literal Markdown table row");
  });
});
