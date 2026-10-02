import { describe, expect, it } from "vitest";
import {
  AppError,
  allowedEvents,
  detectArtifactDrift,
  isTransitionAllowed,
  nextStatus,
  provenanceFingerprint,
  type BookStatus,
} from "./index.js";

describe("book state machine", () => {
  it("walks the happy path from DRAFT to LIVE", () => {
    const path: Array<[BookStatus, Parameters<typeof nextStatus>[1]]> = [
      ["DRAFT", "RESEARCH_START"],
      ["RESEARCHING", "RESEARCH_COMPLETE"],
      ["RESEARCH_READY", "PLAN_START"],
      ["PLANNING", "PLAN_COMPLETE"],
      ["PLAN_READY", "WRITE_START"],
      ["WRITING", "EDITING_START"],
      ["EDITING", "PRODUCTION_START"],
      ["PRODUCTION", "QA_START"],
      ["QA", "PREFLIGHT_PASSED"],
      ["READY_FOR_REVIEW", "APPROVE"],
      ["USER_APPROVED", "PUBLISH_START"],
      ["PUBLISHING", "SUBMIT_SUCCEEDED"],
      ["SUBMITTED", "GO_LIVE"],
    ];

    let status: BookStatus = "DRAFT";
    for (const [from, event] of path) {
      expect(status).toBe(from);
      status = nextStatus(status, event, { publishingMode: "automated" });
    }
    expect(status).toBe("LIVE");
  });

  // ADR-011: only the final preflight gate leaves QA.
  it("does not allow QA to reach READY_FOR_REVIEW without preflight", () => {
    expect(isTransitionAllowed("QA", "PREFLIGHT_PASSED")).toBe(true);
    expect(allowedEvents("QA")).not.toContain("APPROVE");
    expect(allowedEvents("QA")).not.toContain("RESEARCH_START");

    let caught: unknown;
    try {
      nextStatus("QA", "APPROVE");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe("INVALID_TRANSITION");
    expect((caught as AppError).status).toBe(409);
  });

  // ADR-012: prepare-only never leaves USER_APPROVED.
  it("treats USER_APPROVED as terminal in prepare-only mode", () => {
    let caught: unknown;
    try {
      nextStatus("USER_APPROVED", "PUBLISH_START", { publishingMode: "prepare" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe("INVALID_TRANSITION");
    expect((caught as AppError).details.reason).toMatch(/Prepare-only mode/);

    expect(nextStatus("USER_APPROVED", "PUBLISH_START", { publishingMode: "automated" })).toBe("PUBLISHING");
  });

  it("refuses to skip lifecycle phases", () => {
    expect(() => nextStatus("DRAFT", "WRITE_START")).toThrowError();
    expect(() => nextStatus("DRAFT", "APPROVE")).toThrowError();
    expect(() => nextStatus("WRITING", "APPROVE")).toThrowError();
  });

  it("keeps LIVE and CANCELLED terminal", () => {
    expect(allowedEvents("LIVE")).toHaveLength(0);
    expect(allowedEvents("CANCELLED")).toHaveLength(0);
  });

  it("allows recovery from blocking states", () => {
    expect(nextStatus("NEEDS_REVISION", "RESUME_FROM_REVISION")).toBe("EDITING");
    expect(nextStatus("BLOCKED", "UNBLOCK")).toBe("EDITING");
    expect(nextStatus("FAILED", "RESUME_AFTER_FAILURE")).toBe("RESEARCHING");
  });
});

describe("provenance fingerprint and drift detection", () => {
  const snapshot = {
    manuscriptId: "m1",
    metadataId: "md1",
    coverAssetId: "c1",
    epubAssetId: "e1",
    provenance: [
      { provenanceId: "p2", method: "ai_generated" as const, provider: "mock", model: "mock-1" },
      { provenanceId: "p1", method: "user_created" as const, provider: null, model: null },
    ],
  };

  it("is stable regardless of provenance ordering", () => {
    const a = provenanceFingerprint(snapshot);
    const b = provenanceFingerprint({ ...snapshot, provenance: [...snapshot.provenance].reverse() });
    expect(a).toBe(b);
  });

  it("changes when provenance changes", () => {
    const a = provenanceFingerprint(snapshot);
    const b = provenanceFingerprint({
      ...snapshot,
      provenance: [{ provenanceId: "p1", method: "ai_assisted" as const, provider: null, model: null }],
    });
    expect(a).not.toBe(b);
  });

  it("detects manuscript drift after a chapter edit", () => {
    const fp = provenanceFingerprint(snapshot);
    const result = detectArtifactDrift(
      { manuscriptId: "m1", metadataId: "md1", coverAssetId: "c1", epubAssetId: "e1", provenanceFingerprint: fp },
      { manuscriptId: "m2", metadataId: "md1", coverAssetId: "c1", epubAssetId: "e1", currentFingerprint: fp },
    );
    expect(result.hasDrift).toBe(true);
    expect(result.changed).toEqual(["manuscriptId"]);
  });

  it("reports no drift when the artifact set is unchanged", () => {
    const fp = provenanceFingerprint(snapshot);
    const result = detectArtifactDrift(
      { manuscriptId: "m1", metadataId: "md1", coverAssetId: "c1", epubAssetId: "e1", provenanceFingerprint: fp },
      { manuscriptId: "m1", metadataId: "md1", coverAssetId: "c1", epubAssetId: "e1", currentFingerprint: fp },
    );
    expect(result.hasDrift).toBe(false);
    expect(result.changed).toHaveLength(0);
  });
});