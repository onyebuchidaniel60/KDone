import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { bookProjects } from "@kdone/db/schema";
import { getDb } from "@/lib/db";
import { getApp } from "@/server/container";
import { requireUser } from "@/lib/session";

/** Service layer, not a self-HTTP call: server components carry no cookies. */
async function fetchPlan(bookId: string, userId: string) {
  return getApp().getPlan(bookId, userId);
}

export default async function OutlinePage({
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

  const planData = await fetchPlan(bookId, user.id);
  const plan = planData?.plan;
  const chapters = planData?.chapters ?? [];

  return (
    <div style={{ maxWidth: 900, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}>
      <p>
        <Link href={`/books/${book.id}`} style={{ color: "#2563eb", textDecoration: "none" }}>
          ← Back to {book.workingTitle ?? "Untitled"}
        </Link>
      </p>
      <h1>Outline</h1>
      <p style={{ opacity: 0.7 }}>Status: {book.status}</p>

      {!plan ? (
        <form
          action={`/api/books/${book.id}/plan`}
          method="post"
          style={{ marginTop: "1rem" }}
        >
          <button
            type="submit"
            data-testid="start-plan"
            style={{ padding: "0.6rem 1.2rem", cursor: "pointer" }}
          >
            Start plan
          </button>
        </form>
      ) : (
        <>
          <section style={{ marginTop: "1.5rem" }}>
            <h2>{plan.title || "Untitled"}</h2>
            {plan.subtitle && <p style={{ opacity: 0.7 }}>{plan.subtitle}</p>}
            <p>{plan.positioning || ""}</p>
            <p>
              <strong>Book promise:</strong> {plan.bookPromise || ""}
            </p>
            <p>
              <strong>Target word count:</strong>{" "}
              {plan.targetWordCount?.toLocaleString() || "—"}
            </p>
          </section>
          <section style={{ marginTop: "1.5rem" }}>
            <h2>Chapters ({chapters.length})</h2>
            {chapters.length === 0 ? (
              <p>No chapters yet.</p>
            ) : (
              <ul>
                {chapters.map((chapter, i) => (
                  <li key={i}>
                    {chapter.ordinal ?? i + 1}. {chapter.title || "Untitled chapter"}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <form
            action={`/api/books/${book.id}/plan/approve`}
            method="post"
            style={{ marginTop: "1.5rem" }}
          >
            <button
              type="submit"
              data-testid="approve-plan"
              style={{ padding: "0.6rem 1.2rem", cursor: "pointer" }}
            >
              Approve plan
            </button>
          </form>
        </>
      )}
    </div>
  );
}
