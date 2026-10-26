"use client";

import { useState } from "react";
import Link from "next/link";

export function PublishClient({ bookId }: { bookId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  async function post(action: string, body?: any) {
    setError(null);
    setLoading(true);
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
      const data = await response.json();
      setResult(data);
      return data;
    } catch (e: any) {
      setError(e.message || "Request failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}>
      <p>
        <Link href={`/books/${bookId}`} style={{ color: "#2563eb", textDecoration: "none" }}>
          ← Back to book
        </Link>
      </p>
      <h1>Publish</h1>
      {error ? <p style={{ color: "crimson" }} data-testid="publish-error">{error}</p> : null}

      <section style={{ marginTop: "1rem" }}>
        <h2>Preflight</h2>
        <button
          type="button"
          data-testid="run-preflight"
          onClick={() => post("preflight")}
          disabled={loading}
          style={{ padding: "0.6rem 1.2rem", cursor: loading ? "not-allowed" : "pointer" }}
        >
          {loading ? "Running preflight…" : "Run preflight"}
        </button>
      </section>

      {result && result.checks && (
        <section style={{ marginTop: "1rem" }}>
          <h2>Preflight checks ({result.checks.length})</h2>
          <ul>
            {result.checks.map((check: any, i: number) => (
              <li key={i}>
                {check.name}: {check.passed ? "passed" : "failed"}
                {check.message ? ` — ${check.message}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Approval</h2>
        <button
          type="button"
          data-testid="approve-book"
          onClick={() => post("approve")}
          disabled={loading || (result && result.bookStatus === "USER_APPROVED")}
          style={{ padding: "0.6rem 1.2rem", cursor: loading ? "not-allowed" : "pointer" }}
        >
          {result && result.bookStatus === "USER_APPROVED" ? "Already approved" : "Approve book"}
        </button>
        {result && result.approval && (
          <p data-testid="approval-id">Approval id: {result.approval.id}</p>
        )}
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Publish</h2>
        <label>
          Mode
          <select
            defaultValue="prepare"
            style={{ marginLeft: "0.5rem", padding: "0.25rem" }}
          >
            <option value="prepare">prepare</option>
            <option value="assisted">assisted</option>
            <option value="automated">automated</option>
          </select>
        </label>
        <button
          type="button"
          data-testid="start-publishing"
          onClick={() => {
            const mode = (document.querySelector("select") as HTMLSelectElement)?.value || "prepare";
            post("publish/start", { mode, checklist: [] });
          }}
          disabled={loading || !(result && result.bookStatus === "USER_APPROVED")}
          style={{ marginLeft: "0.5rem", padding: "0.6rem 1.2rem", cursor: loading ? "not-allowed" : "pointer" }}
        >
          {loading ? "Publishing…" : "Start publishing (prepare)"}
        </button>
        {result && result.publishingJobId && (
          <p data-testid="publish-job-id">Publishing job id: {result.publishingJobId}</p>
        )}
        {result && result.bookStatus && (
          <p data-testid="publish-book-status">Book status: {result.bookStatus}</p>
        )}
      </section>
    </div>
  );
}
