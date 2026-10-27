import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { bookProjects } from "@kdone/db/schema";
import { getDb } from "@/lib/db";
import { getApp } from "@/server/container";
import { requireUser } from "@/lib/session";

export default async function PreviewPage({
  params,
}: {
  params: Promise<{ bookId: string }>;
}) {
  const { bookId } = await params;

  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");

  const db = getDb();
  const rows = await db
    .select()
    .from(bookProjects)
    .where(and(eq(bookProjects.id, bookId), eq(bookProjects.userId, user.id)))
    .limit(1);
  const book = rows[0];
  if (!book) notFound();

  // Service layer, not a self-HTTP call: server components carry no cookies,
  // so a fetch to /api would be unauthenticated (ADR-016 architecture).
  const preview = await getApp().previewManifest(bookId, user.id);

  const rowsToShow = [
    {
      label: "Manuscript",
      value: preview.manuscript
        ? `v${preview.manuscript.version} · ${preview.manuscript.wordCount ?? 0} words`
        : null,
      testId: "preview-manuscript",
    },
    {
      label: "Metadata",
      value: preview.metadata
        ? `${preview.metadata.title} (v${preview.metadata.version})`
        : null,
      testId: "preview-metadata",
    },
    { label: "Cover", value: preview.cover ? preview.cover.id : null, testId: "preview-cover" },
    {
      label: "EPUB",
      value: preview.epub ? `${preview.epub.id} · ${preview.epub.sizeBytes ?? 0} bytes` : null,
      testId: "preview-epub",
    },
  ];

  return (
    <div style={{ maxWidth: 900, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}>
      <p>
        <Link href={`/books/${book.id}`} style={{ color: "#2563eb", textDecoration: "none" }}>
          ← Back to {book.workingTitle ?? "Untitled"}
        </Link>
      </p>
      <h1>Preview</h1>
      <p style={{ opacity: 0.7 }}>Status: {book.status}</p>

      <ul style={{ marginTop: "1rem" }}>
        {rowsToShow.map((row) => (
          <li key={row.label} data-testid={row.testId} style={{ marginBottom: "0.4rem" }}>
            <strong>{row.label}:</strong>{" "}
            {row.value ? row.value : <span style={{ color: "crimson" }}>missing</span>}
          </li>
        ))}
      </ul>

      <p style={{ opacity: 0.7 }}>
        Open critical issues: {preview.openCritical} · total issues: {preview.issues.length}
      </p>

      {preview.epub ? (
        <p style={{ marginTop: "1rem" }}>
          <a
            href={`/api/books/${book.id}/assets/${preview.epub.id}`}
            style={{ color: "#2563eb" }}
            data-testid="open-epub"
          >
            Download EPUB
          </a>
        </p>
      ) : (
        <p>No preview available yet. Generate the EPUB first, then return here.</p>
      )}
    </div>
  );
}
