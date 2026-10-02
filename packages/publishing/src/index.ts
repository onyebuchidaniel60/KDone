import { errors } from "@kdone/shared";
import type { MetadataOutput } from "@kdone/validation";

/*
 * Publishing boundary (ARCHITECTURE section 14).
 *
 * The core domain knows a book can be prepared for KDP; it does not depend on
 * any browser-automation technique. V1 ships Mode A (prepare) only. Modes B/C
 * are disabled and `submit()` refuses rather than pretending to automate a
 * flow that has not been validated against current KDP behaviour and terms.
 *
 * See docs/external/KDP_SOURCES.md for the authoritative requirements.
 */

export interface PublishingArtifact {
  manuscriptId: string;
  metadataId: string;
  coverAssetId: string;
  epubAssetId: string;
  approvalId: string;
}

export interface PrepareResult {
  /** Field-by-field mapping for manual KDP entry. */
  fieldMapping: Record<string, string>;
  /** Machine-readable package manifest. */
  manifest: {
    schemaVersion: 1;
    provider: string;
    mode: "prepare";
    preparedAt: string;
    artifacts: PublishingArtifact;
    disclosure: {
      aiDisclosure: MetadataOutput["aiDisclosure"];
      /** KDP requires disclosure for AI-generated content; AI-assisted does not. */
      requiresDisclosure: boolean;
      statement: string;
    };
    checklist: Array<{ item: string; confirmed: boolean }>;
  };
  /** Bytes of the assembled package (metadata + mapping + checklist). */
  package: Uint8Array;
  externalReference: string | null;
}

export type PublishingMode = "prepare" | "assisted" | "automated";

export interface PublishingProvider {
  readonly name: string;
  readonly supportedModes: readonly PublishingMode[];
  prepare(input: {
    title: string;
    subtitle: string;
    metadata: MetadataOutput;
    artifacts: PublishingArtifact;
    checklistConfirmed: string[];
  }): Promise<PrepareResult>;
  validate(packageBytes: Uint8Array): { valid: boolean; errors: string[] };
  getStatus(): { mode: PublishingMode; state: string };
  submit(): Promise<never>;
}

/** The human confirmation list required before any publication attempt. */
export const PUBLISHING_CHECKLIST = [
  "reviewed manuscript",
  "reviewed cover",
  "reviewed metadata",
  "confirmed AI-content disclosure",
  "authorize KDP submission",
] as const;

export type ChecklistItem = (typeof PUBLISHING_CHECKLIST)[number];

export class KDPProvider implements PublishingProvider {
  readonly name = "kdp";
  /** V1 is prepare-only. Modes B and C are deliberately unavailable. */
  readonly supportedModes: readonly PublishingMode[] = ["prepare"];

  async prepare(input: {
    title: string;
    subtitle: string;
    metadata: MetadataOutput;
    artifacts: PublishingArtifact;
    checklistConfirmed: string[];
  }): Promise<PrepareResult> {
    const { metadata, artifacts } = input;

    // Amazon distinguishes AI-generated from AI-assisted. Only the former
    // must be disclosed at submission time.
    const requiresDisclosure = metadata.aiDisclosure === "ai_generated";

    const fieldMapping: Record<string, string> = {
      "Kindle Book Title": metadata.title,
      "Kindle Book Subtitle": metadata.subtitle,
      "Book Description": metadata.description,
      "Author(s)": metadata.authorNames.join(", "),
      "Keywords (max 7)": metadata.keywords.join(", "),
      "Categories (max 3)": metadata.categories.join(", "),
      "Language": metadata.language,
      "Rights": metadata.rights,
      "List Price": `${metadata.price} USD`,
      "AI-Generated Content Disclosure": requiresDisclosure
        ? "Yes - AI-generated text and/or images"
        : "No - AI-assisted only",
      "Manuscript (EPUB)": `storage key for asset ${artifacts.epubAssetId}`,
      "Cover Image": `storage key for asset ${artifacts.coverAssetId}`,
    };

    const manifest = {
      schemaVersion: 1 as const,
      provider: this.name,
      mode: "prepare" as const,
      preparedAt: new Date().toISOString(),
      artifacts,
      disclosure: {
        aiDisclosure: metadata.aiDisclosure,
        requiresDisclosure,
        statement: requiresDisclosure
          ? "This book contains AI-generated content and is disclosed accordingly to KDP."
          : "This book is AI-assisted only; no AI-generated disclosure is required to KDP.",
      },
      checklist: PUBLISHING_CHECKLIST.map((item) => ({
        item,
        confirmed: input.checklistConfirmed.includes(item),
      })),
    };

    const packageJson = `${JSON.stringify(manifest, null, 2)}\n`;

    return {
      fieldMapping,
      manifest,
      package: new TextEncoder().encode(
        [
          "# KDone KDP prepare package",
          "",
          "This package is prepared for manual entry in Amazon KDP.",
          "KDone has not submitted this book and makes no claim that it will be accepted by KDP.",
          "",
          "## Field mapping",
          ...Object.entries(fieldMapping).map(([k, v]) => `- ${k}: ${v}`),
          "",
          "## Manifest",
          packageJson,
        ].join("\n"),
      ),
      externalReference: null,
    };
  }

  validate(packageBytes: Uint8Array): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const text = new TextDecoder().decode(packageBytes);

    if (!text.includes("## Field mapping")) errors.push("Package is missing the field mapping section");
    if (!text.includes("AI-Generated Content Disclosure")) errors.push("Package is missing the AI disclosure field");
    if (!text.includes('"mode": "prepare"')) errors.push("Package manifest must declare prepare mode");

    const confirmedAll = PUBLISHING_CHECKLIST.every((item) =>
      new RegExp(`"item": "${item}",\\s*"confirmed": true`).test(text),
    );
    if (!confirmedAll) errors.push("Not every required human confirmation is recorded");

    return { valid: errors.length === 0, errors };
  }

  getStatus(): { mode: PublishingMode; state: string } {
    return { mode: "prepare", state: "ready" };
  }

  /** V1 cannot submit. Modes B/C require a validated, permitted mechanism. */
  async submit(): Promise<never> {
    throw errors.precondition(
      "Automated KDP submission is not enabled in V1. Submit the prepared package manually in Amazon KDP.",
      { supportedModes: [...this.supportedModes] },
    );
  }
}