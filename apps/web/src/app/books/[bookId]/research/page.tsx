import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { bookProjects } from "@kdone/db/schema";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/session";

async function fetchResearch(bookId: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? ""}/api/books/${bookId}/research`, {
    cache: "no-store",
  });
  if (!response.ok) return null;
  return (await response.json()) as { project?: any; sources?: any[]; findings?: any[] };
}

export default async function ResearchPage({
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

  const research = await fetchResearch(bookId);
  const hasResearch = Boolean(research?.project);
  const sources = research?.sources ?? [];
  const findings = research?.findings ?? [];

  return (
    <div style={{ maxWidth: 900, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}>
      <p>
        <Link href={`/books/${book.id}`} style={{ color: "#2563eb", textDecoration: "none" }}>
          ← Back to {book.workingTitle ?? "Untitled"}
        </Link>
      </p>
      <h1>Research</h1>
      <p style={{ opacity: 0.7 }}>Status: {book.status}</p>

      {!hasResearch ? (
        <form
          action={`/api/books/${book.id}/research`}
          method="post"
          style={{ marginTop: "1rem" }}
        >
          <button
            type="submit"
            data-testid="start-research"
            style={{ padding: "0.6rem 1.2rem", cursor: "pointer" }}
          >
            Start research
          </button>
        </form>
      ) : (
        <>
          <section style={{ marginTop: "1.5rem" }}>
            <h2>Sources ({sources.length})</h2>
            {sources.length === 0 ? (
              <p>No sources found.</p>
            ) : (
              <ul>
                {sources.map((source, i) => (
                  <li key={i}>
                    {source.title || source.url} — {source.sourceName}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section style={{ marginTop: "1.5rem" }}>
            <h2>Findings ({findings.length})</h2>
            {findings.length === 0 ? (
              <p>No findings yet.</p>
            ) : (
              <ul>
                {findings.map((finding, i) => (
                  <li key={i}>
                    <strong>{finding.findingType}</strong> ({finding.confidence}):{" "}
                    {finding.statement}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <form
            action={`/api/books/${book.id}/research/approve`}
            method="post"
            style={{ marginTop: "1.5rem" }}
          >
            <button
              type="submit"
              data-testid="approve-research"
              style={{ padding: "0.6rem 1.2rem", cursor: "pointer" }}
            >
              Approve research
            </button>
          </form>
        </>
      )}
    </div>
  );
}
