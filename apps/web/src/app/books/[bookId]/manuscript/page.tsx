import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { bookProjects } from "@kdone/db/schema";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/session";

async function fetchManuscript(bookId: string) {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_BASE_URL ?? ""}/api/books/${bookId}/manuscript`,
    { cache: "no-store" },
  );
  if (!response.ok) return null;
  return (await response.json()) as { chapters?: any[] };
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

  const manuscript = await fetchManuscript(bookId);
  const chapters = manuscript?.chapters ?? [];
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
