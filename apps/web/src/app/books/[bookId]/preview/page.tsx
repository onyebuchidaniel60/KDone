import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { bookProjects } from "@kdone/db/schema";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/session";

async function fetchPreview(bookId: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? ""}/api/books/${bookId}/preview`, {
    cache: "no-store",
  });
  if (!response.ok) return null;
  return (await response.json()) as { url?: string; assetId?: string; bookId?: string };
}

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

  const preview = await fetchPreview(bookId);

  return (
    <div style={{ maxWidth: 900, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}>
      <p>
        <Link href={`/books/${book.id}`} style={{ color: "#2563eb", textDecoration: "none" }}>
          ← Back to {book.workingTitle ?? "Untitled"}
        </Link>
      </p>
      <h1>Preview</h1>
      <p style={{ opacity: 0.7 }}>Status: {book.status}</p>

      {preview?.url ? (
        <>
          <p>Preview available:</p>
          <a href={preview.url} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb" }}>
            Open preview
          </a>
          <p style={{ marginTop: "1rem", opacity: 0.7 }}>Asset id: {preview.assetId}</p>
        </>
      ) : (
        <>
          <p>No preview available yet. Generate the EPUB first, then return here.</p>
        </>
      )}
    </div>
  );
}
