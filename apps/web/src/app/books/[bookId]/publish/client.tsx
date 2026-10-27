"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

const CHECKLIST = [
  "reviewed manuscript",
  "reviewed cover",
  "reviewed metadata",
  "confirmed AI-content disclosure",
  "authorize KDP submission",
] as const;

type Artifacts = {
  book?: { status?: string };
  manuscript?: { id: string; version: number; wordCount: number | null } | null;
  metadata?: { id: string; version: number; title: string | null; description: string | null; keywords: string[] | null } | null;
  cover?: { id: string } | null;
  epub?: { id: string; sizeBytes: number | null } | null;
  openCritical?: number;
};

export function PublishClient({ bookId }: { bookId: string }) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobNote, setJobNote] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<Artifacts | null>(null);
  const [preflight, setPreflight] = useState<any>(null);
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<any>(null);
  const [checklist, setChecklist] = useState<string[]>([]);

  const loadArtifacts = useCallback(async () => {
    try {
      const response = await fetch(`/api/books/${bookId}/preview`, { cache: "no-store" });
      if (!response.ok) return;
      setArtifacts((await response.json()) as Artifacts);
    } catch {
      // Status panel is informational; a failure must not break the actions.
    }
  }, [bookId]);

  useEffect(() => {
    void loadArtifacts();
  }, [loadArtifacts]);

  async function post(action: string, body?: any, label?: string) {
    setError(null);
    setLoading(label ?? action);
    try {
      const response = await fetch(`/api/books/${bookId}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        const errBody = (await response.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(errBody.error?.message || `Request failed (${response.status})`);
      }
      return await response.json();
    } catch (e: any) {
      setError(e.message || "Request failed.");
      return null;
    } finally {
      setLoading(null);
    }
  }

  /** Polls the job row until it leaves QUEUED/RUNNING, then refreshes artifacts. */
  async function runJob(action: string, label: string) {
    setJobNote(`${label}: queueing…`);
    const started = await post(action, undefined, label);
    const jobId = started?.jobId ?? started?.jobIds?.[0];
    if (!jobId) {
      setJobNote(null);
      return;
    }
    for (let i = 0; i < 180; i += 1) {
      const response = await fetch(`/api/books/${bookId}/jobs`, { cache: "no-store" });
      if (response.ok) {
        const body = (await response.json()) as { jobs?: any[] };
        const job = body.jobs?.find((j) => j.jobId === jobId);
        if (job) {
          setJobNote(`${label}: ${job.status}`);
          if (job.status === "SUCCEEDED" || job.status === "FAILED" || job.status === "CANCELLED") {
            if (job.status === "FAILED" && job.message) setError(`${label} failed: ${job.message}`);
            break;
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    await loadArtifacts();
  }

  async function runPreflight() {
    const data = await post("preflight", undefined, "preflight");
    if (data) {
      setPreflight(data);
      await loadArtifacts();
    }
  }

  async function approve() {
    const data = await post("approve", undefined, "approve");
    if (data?.approval?.id) {
      setApprovalId(data.approval.id);
      await loadArtifacts();
    }
  }

  async function startPublishing() {
    const data = await post("publish/start", { mode: "prepare", checklist }, "publish");
    if (data) {
      setPublishing(data);
      await loadArtifacts();
    }
  }

  const status = artifacts?.book?.status;
  const missing = [
    !artifacts?.manuscript ? "manuscript" : null,
    !artifacts?.metadata ? "metadata" : null,
    !artifacts?.cover ? "cover" : null,
    !artifacts?.epub ? "EPUB" : null,
  ].filter(Boolean) as string[];

  return (
    <div style={{ maxWidth: 900, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}>
      <p>
        <Link href={`/books/${bookId}`} style={{ color: "#2563eb", textDecoration: "none" }}>
          ← Back to book
        </Link>
      </p>
      <h1>Publish</h1>
      <p style={{ opacity: 0.7 }} data-testid="publish-book-status">
        Book status: {status ?? "…"}
      </p>
      {error ? <p style={{ color: "crimson" }} data-testid="publish-error">{error}</p> : null}
      {jobNote ? <p data-testid="job-note">{jobNote}</p> : null}

      <section style={{ marginTop: "1rem" }}>
        <h2>Production artifacts</h2>
        <ul data-testid="artifact-status">
          <li>Manuscript: {artifacts?.manuscript ? `v${artifacts.manuscript.version}` : "missing"}</li>
          <li>Metadata: {artifacts?.metadata ? `v${artifacts.metadata.version}` : "missing"}</li>
          <li>Cover: {artifacts?.cover ? artifacts.cover.id : "missing"}</li>
          <li>EPUB: {artifacts?.epub ? `${artifacts.epub.id} (${artifacts.epub.sizeBytes ?? 0} bytes)` : "missing"}</li>
        </ul>
        {missing.length > 0 ? (
          <p style={{ color: "#b45309" }}>Missing: {missing.join(", ")}</p>
        ) : null}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button
            type="button"
            data-testid="generate-metadata"
            onClick={() => runJob("metadata/generate", "Generate metadata")}
            disabled={loading !== null}
            style={{ padding: "0.6rem 1.2rem", cursor: loading ? "not-allowed" : "pointer" }}
          >
            Generate metadata
          </button>
          <button
            type="button"
            data-testid="generate-cover"
            onClick={() => runJob("cover", "Generate cover")}
            disabled={loading !== null}
            style={{ padding: "0.6rem 1.2rem", cursor: loading ? "not-allowed" : "pointer" }}
          >
            Generate cover
          </button>
          <button
            type="button"
            data-testid="generate-epub"
            onClick={() => runJob("epub", "Generate EPUB")}
            disabled={loading !== null}
            style={{ padding: "0.6rem 1.2rem", cursor: loading ? "not-allowed" : "pointer" }}
          >
            Generate EPUB
          </button>
          <button
            type="button"
            data-testid="refresh-artifacts"
            onClick={() => void loadArtifacts()}
            disabled={loading !== null}
            style={{ padding: "0.6rem 1.2rem", cursor: loading ? "not-allowed" : "pointer" }}
          >
            Refresh
          </button>
        </div>
        {artifacts?.metadata ? (
          <div style={{ marginTop: "0.75rem" }} data-testid="metadata-summary">
            <p><strong>Title:</strong> {artifacts.metadata.title}</p>
            <p><strong>Description:</strong> {artifacts.metadata.description}</p>
            <p><strong>Keywords:</strong> {(artifacts.metadata.keywords ?? []).join(", ")}</p>
          </div>
        ) : null}
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Preflight</h2>
        <button
          type="button"
          data-testid="run-preflight"
          onClick={runPreflight}
          disabled={loading !== null}
          style={{ padding: "0.6rem 1.2rem", cursor: loading ? "not-allowed" : "pointer" }}
        >
          {loading === "preflight" ? "Running preflight…" : "Run preflight"}
        </button>
        {preflight ? (
          <p data-testid="preflight-result">
            Preflight: {preflight.passed ? "PASSED" : "FAILED"} ({preflight.checks?.length ?? 0} checks)
          </p>
        ) : null}
        {preflight?.checks ? (
          <ul>
            {preflight.checks.map((check: any, i: number) => (
              <li key={i}>
                {check.name}: {check.passed ? "passed" : "failed"}
                {check.message ? ` — ${check.message}` : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Approval</h2>
        <button
          type="button"
          data-testid="approve-book"
          onClick={approve}
          disabled={loading !== null || status !== "READY_FOR_REVIEW" || Boolean(approvalId)}
          style={{ padding: "0.6rem 1.2rem", cursor: loading ? "not-allowed" : "pointer" }}
        >
          {status === "USER_APPROVED" || approvalId ? "Already approved" : "Approve book"}
        </button>
        {approvalId ? <p data-testid="approval-id">Approval id: {approvalId}</p> : null}
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Publish</h2>
        <p style={{ opacity: 0.7 }}>Mode: prepare (V1 is prepare-only; ADR-012)</p>
        <fieldset style={{ border: "1px solid #ddd", padding: "0.75rem" }}>
          <legend>Human confirmation</legend>
          {CHECKLIST.map((item) => (
            <label key={item} style={{ display: "block", marginBottom: "0.25rem" }}>
              <input
                type="checkbox"
                data-testid={`checklist-${item.replace(/[^a-z]+/gi, "-").toLowerCase()}`}
                checked={checklist.includes(item)}
                onChange={(event) =>
                  setChecklist((current) =>
                    event.target.checked ? [...current, item] : current.filter((value) => value !== item),
                  )
                }
              />{" "}
              {item}
            </label>
          ))}
        </fieldset>
        <button
          type="button"
          data-testid="start-publishing"
          onClick={startPublishing}
          disabled={loading !== null || status !== "USER_APPROVED" || checklist.length !== CHECKLIST.length}
          style={{ marginTop: "0.75rem", padding: "0.6rem 1.2rem", cursor: loading ? "not-allowed" : "pointer" }}
        >
          {loading === "publish" ? "Publishing…" : "Start publishing (prepare)"}
        </button>
        {publishing?.publishingJobId ? (
          <p data-testid="publish-job-id">Publishing job id: {publishing.publishingJobId}</p>
        ) : null}
        {publishing?.fieldMapping ? (
          <div data-testid="publish-manifest" style={{ marginTop: "0.75rem" }}>
            <h3>KDP package fields</h3>
            <ul>
              {Object.entries(publishing.fieldMapping as Record<string, string>).map(([key, value]) => (
                <li key={key}>
                  <strong>{key}:</strong> {value}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}
