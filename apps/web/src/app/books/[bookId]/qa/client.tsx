"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

type Issue = {
  id: string;
  severity: string;
  issueType: string;
  message: string;
  chapterOrdinal: number | null;
  location: string | null;
  proposedFix: string | null;
  status: string;
};

export function QAClient({ bookId }: { bookId: string }) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ passed?: boolean; checks?: any[] } | null>(null);

  async function loadIssues() {
    setLoading(true);
    try {
      const response = await fetch(`/api/books/${bookId}/issues`, { cache: "no-store" });
      if (!response.ok) throw new Error("Failed to load issues");
      const body = (await response.json()) as { issues?: Issue[] };
      setIssues(body.issues ?? []);
    } catch {
      setError("Failed to load issues.");
    } finally {
      setLoading(false);
    }
  }

  async function runQa() {
    setError(null);
    setResult(null);
    try {
      const response = await fetch(`/api/books/${bookId}/qa`, {
        method: "POST",
      });
      if (!response.ok) throw new Error("QA run failed");
      const body = (await response.json()) as { passed?: boolean; checks?: any[] };
      setResult(body);
      await loadIssues();
    } catch {
      setError("Failed to run QA.");
    }
  }

  async function updateIssue(issueId: string, patch: { status?: string; proposedFix?: string }) {
    try {
      const response = await fetch(`/api/issues/${issueId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error("Failed to update issue");
      await loadIssues();
    } catch {
      setError("Failed to update issue.");
    }
  }

  useEffect(() => {
    loadIssues();
  }, [bookId]);

  return (
    <div style={{ maxWidth: 900, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}>
      <p>
        <Link
          href={`/books/${bookId}`}
          style={{ color: "#2563eb", textDecoration: "none" }}
        >
          ← Back to book
        </Link>
      </p>
      <h1>QA</h1>
      {error ? <p style={{ color: "crimson" }} data-testid="qa-error">{error}</p> : null}
      {result && (
        <p style={{ marginBottom: "1rem" }}>
          QA {result.passed ? "passed" : "found issues"} ({result.checks?.length ?? 0} check(s)).
        </p>
      )}
      <button
        type="button"
        data-testid="run-qa"
        onClick={runQa}
        disabled={loading}
        style={{ padding: "0.6rem 1.2rem", cursor: loading ? "not-allowed" : "pointer", marginBottom: "1rem" }}
      >
        {loading ? "Running QA…" : "Run QA"}
      </button>

      <h2>Issues ({issues.length})</h2>
      {issues.length === 0 ? (
        <p>No issues recorded.</p>
      ) : (
        <ul>
          {issues.map((issue) => (
            <li key={issue.id} style={{ marginBottom: "0.75rem", borderBottom: "1px solid #eee", paddingBottom: "0.5rem" }}>
              <strong>{issue.severity}</strong> — {issue.issueType}: {issue.message}
              {issue.chapterOrdinal != null && (
                <span style={{ opacity: 0.6 }}>{` (chapter ${issue.chapterOrdinal})`}</span>
              )}
              <br />
              <span style={{ opacity: 0.7 }}>{issue.status}</span>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const formData = new FormData(e.currentTarget);
                  updateIssue(issue.id, {
                    status: formData.get("status") as string,
                    proposedFix: formData.get("proposedFix") as string || undefined,
                  });
                }}
                style={{ marginTop: "0.5rem", display: "grid", gap: "0.35rem" }}
              >
                <label>
                  Status
                  <select
                    name="status"
                    defaultValue={issue.status}
                    style={{ width: "100%", padding: "0.25rem" }}
                  >
                    <option value="open">open</option>
                    <option value="accepted">accepted</option>
                    <option value="rejected">rejected</option>
                    <option value="resolved">resolved</option>
                  </select>
                </label>
                <label>
                  Proposed fix
                  <textarea
                    name="proposedFix"
                    defaultValue={issue.proposedFix ?? ""}
                    rows={2}
                    style={{ width: "100%", padding: "0.25rem" }}
                  />
                </label>
                <button
                  type="submit"
                  data-testid={`update-issue-${issue.id}`}
                  style={{ padding: "0.35rem 0.75rem", cursor: "pointer" }}
                >
                  Save
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
