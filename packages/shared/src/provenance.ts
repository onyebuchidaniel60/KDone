import { createHash } from "node:crypto";
import type { ProvenanceMethod } from "./book-status.js";

/** One provenance entry contributing to an approval snapshot. */
export interface ProvenanceInput {
  provenanceId: string;
  method: ProvenanceMethod;
  provider?: string | null;
  model?: string | null;
}

/** The artifact set an approval is bound to (ADR-013). */
export interface ApprovalSnapshotInput {
  manuscriptId: string;
  metadataId: string;
  coverAssetId: string;
  epubAssetId: string;
  provenance: ProvenanceInput[];
}

/** Stable stringify: object keys and array order are normalised. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * Deterministic digest of the provenance state of an approved artifact set.
 *
 * Any change to the referenced artifacts or their provenance produces a
 * different fingerprint, which is what lets `publish/start` detect drift
 * (ADR-013). Deliberately excludes timestamps and ids that are not part of
 * the reviewable content, so re-running the same inputs is stable.
 */
export function provenanceFingerprint(input: ApprovalSnapshotInput): string {
  const provenance = [...input.provenance]
    .map((p) => ({
      provenanceId: p.provenanceId,
      method: p.method,
      provider: p.provider ?? null,
      model: p.model ?? null,
    }))
    .sort((a, b) => (a.provenanceId < b.provenanceId ? -1 : a.provenanceId > b.provenanceId ? 1 : 0));

  const canonical = stableStringify({
    manuscriptId: input.manuscriptId,
    metadataId: input.metadataId,
    coverAssetId: input.coverAssetId,
    epubAssetId: input.epubAssetId,
    provenance,
  });

  return createHash("sha256").update(canonical).digest("hex");
}

/** Compares a stored approval against the current artifact set. */
export interface DriftInput {
  manuscriptId: string | null;
  metadataId: string | null;
  coverAssetId: string | null;
  epubAssetId: string | null;
  currentFingerprint: string;
}

export interface DriftResult {
  hasDrift: boolean;
  changed: string[];
}

/** Returns the list of artifact fields that no longer match the approval. */
export function detectArtifactDrift(
  approval: {
    manuscriptId: string;
    metadataId: string;
    coverAssetId: string;
    epubAssetId: string;
    provenanceFingerprint: string;
  },
  current: DriftInput,
): DriftResult {
  const changed: string[] = [];

  if (approval.manuscriptId !== current.manuscriptId) changed.push("manuscriptId");
  if (approval.metadataId !== current.metadataId) changed.push("metadataId");
  if (approval.coverAssetId !== current.coverAssetId) changed.push("coverAssetId");
  if (approval.epubAssetId !== current.epubAssetId) changed.push("epubAssetId");
  if (approval.provenanceFingerprint !== current.currentFingerprint) changed.push("provenanceFingerprint");

  return { hasDrift: changed.length > 0, changed };
}