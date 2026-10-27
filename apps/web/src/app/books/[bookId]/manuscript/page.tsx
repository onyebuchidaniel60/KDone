import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { bookProjects } from "@kdone/db/schema";
import { getDb } from "@/lib/db";
import { getApp } from "@/server/container";
import { requireUser } from "@/lib/session";

/**
 * Reads through the application service layer, not over HTTP. A server
 * component has no browser cookie jar, so fetching its own API would be
 * unauthenticated (and a relative URL has no base to resolve against).
 */
async function fetchManuscript(bookId: string, userId: string) {
  const app = getApp();
  const manuscript = await app.getManuscript(bookId, userId);
  const plan = await app.getPlan(bookId, userId);
  return { manuscript, chapters: plan?.chapters ?? [] };
}

export default async function ManuscriptPage({
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

  const { manuscript, chapters } = await fetchManuscript(bookId, user.id);
  const hasChapters = chapters.length > 0;

  return (
    <div style={{ maxWidth: 900, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}>
      <p>
        <Link href={`/books/${book.id}`} style={{ color: "#2563eb", textDecoration: "none" }}>
          ← Back to {book.workingTitle ?? "Untitled"}
        </Link>
      </p>
      <h1>Manuscript</h1>
      <p style={{ opacity: 0.7 }}>Status: {book.status}</p>

      {!hasChapters ? (
        <>
          <p>No chapters generated yet.</p>
          <form
            action={`/api/books/${book.id}/generate`}
            method="post"
            style={{ marginTop: "1rem" }}
          >
            <button
              type="submit"
              data-testid="start-generation"
              style={{ padding: "0.6rem 1.2rem", cursor: "pointer" }}
            >
            Start generation
            </button>
          </form>
        </>
      ) : (
        <>
          <p>{chapters.length} chapter(s) generated.</p>
          {manuscript ? (
            <p style={{ opacity: 0.7 }}>
              Manuscript v{manuscript.version} · {manuscript.wordCount ?? 0} words ·
              status {manuscript.status}
            </p>
          ) : (
            <p>No manuscript assembled yet.</p>
          )}
          <ul>
            {chapters.map((chapter, i) => (
              <li key={i} style={{ marginBottom: "0.75rem" }}>
                {chapter.ordinal ?? i + 1}. {chapter.title || "Untitled chapter"}
              </li>
            ))}
          </ul>
          <p>
            <Link
              href={`/books/${book.id}/editor`}
              style={{ color: "#2563eb", textDecoration: "none" }}
            >
              Open editor
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
