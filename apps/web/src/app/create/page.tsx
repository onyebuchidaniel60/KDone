"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type FormData = {
  workingTitle: string;
  topic: string;
  targetReader: string;
  genre: string;
  desiredLength: string;
  toneStyle: string;
  authorName: string;
};

const EMPTY: FormData = {
  workingTitle: "",
  topic: "",
  targetReader: "",
  genre: "",
  desiredLength: "",
  toneStyle: "",
  authorName: "",
};

export default function CreateBookPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormData>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/books", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workingTitle: form.workingTitle,
          topic: form.topic,
          ...(form.targetReader ? { targetReader: form.targetReader } : {}),
          ...(form.genre ? { genre: form.genre } : {}),
          ...(form.desiredLength ? { desiredLength: Number(form.desiredLength) } : {}),
          ...(form.toneStyle ? { toneStyle: form.toneStyle } : {}),
          ...(form.authorName ? { authorName: form.authorName } : {}),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        setError(body.error?.message || "Failed to create book.");
        setPending(false);
        return;
      }
      const created = (await response.json()) as { project?: { id?: string } };
      const bookId = created.project?.id;
      if (!bookId) {
        setError("Book was created but no id was returned.");
        setPending(false);
        return;
      }
      router.push(`/books/${bookId}`);
    } catch {
      setError("Failed to create book. Try again.");
      setPending(false);
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>Create a new book</h1>
      {error ? (
        <p style={{ color: "crimson" }} data-testid="create-error">
          {error}
        </p>
      ) : null}
      <form onSubmit={onSubmit} style={{ display: "grid", gap: "0.75rem", marginTop: "1rem" }}>
        <label>
          Working title <span style={{ opacity: 0.7 }}>(required)</span>
          <br />
          <input
            data-testid="working-title"
            name="workingTitle"
            value={form.workingTitle}
            onChange={(e) => setForm({ ...form, workingTitle: e.target.value })}
            required
            maxLength={300}
            style={{ width: "100%", boxSizing: "border-box", padding: "0.35rem 0.5rem" }}
          />
        </label>
        <label>
          Topic <span style={{ opacity: 0.7 }}>(required — what the book is about)</span>
          <br />
          <textarea
            data-testid="topic"
            name="topic"
            value={form.topic}
            onChange={(e) => setForm({ ...form, topic: e.target.value })}
            required
            maxLength={2000}
            rows={4}
            style={{ width: "100%", boxSizing: "border-box", padding: "0.35rem 0.5rem" }}
          />
        </label>
        <label>
          Target reader
          <br />
          <input
            data-testid="target-reader"
            name="targetReader"
            value={form.targetReader}
            onChange={(e) => setForm({ ...form, targetReader: e.target.value })}
            maxLength={2000}
            style={{ width: "100%", boxSizing: "border-box", padding: "0.35rem 0.5rem" }}
          />
        </label>
        <label>
          Genre
          <br />
          <input
            data-testid="genre"
            name="genre"
            value={form.genre}
            onChange={(e) => setForm({ ...form, genre: e.target.value })}
            maxLength={200}
            style={{ width: "100%", boxSizing: "border-box", padding: "0.35rem 0.5rem" }}
          />
        </label>
        <label>
          Desired length (words)
          <br />
          <input
            data-testid="desired-length"
            name="desiredLength"
            type="number"
            value={form.desiredLength}
            onChange={(e) => setForm({ ...form, desiredLength: e.target.value })}
            min="1"
            style={{ width: "100%", boxSizing: "border-box", padding: "0.35rem 0.5rem" }}
          />
        </label>
        <label>
          Tone / style
          <br />
          <input
            data-testid="tone-style"
            name="toneStyle"
            value={form.toneStyle}
            onChange={(e) => setForm({ ...form, toneStyle: e.target.value })}
            maxLength={500}
            style={{ width: "100%", boxSizing: "border-box", padding: "0.35rem 0.5rem" }}
          />
        </label>
        <label>
          Author name
          <br />
          <input
            data-testid="author-name"
            name="authorName"
            value={form.authorName}
            onChange={(e) => setForm({ ...form, authorName: e.target.value })}
            maxLength={300}
            style={{ width: "100%", boxSizing: "border-box", padding: "0.35rem 0.5rem" }}
          />
        </label>
        <button
          type="submit"
          data-testid="create-submit"
          disabled={pending}
          style={{ padding: "0.6rem 1.2rem", cursor: pending ? "not-allowed" : "pointer" }}
        >
          {pending ? "Creating…" : "Create book"}
        </button>
        <p>
          Already have a book?{" "}
          <a href="/dashboard" style={{ color: "#2563eb", textDecoration: "none" }}>
            Go to dashboard
          </a>
        </p>
      </form>
    </div>
  );
}
