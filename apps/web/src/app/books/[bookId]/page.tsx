import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { bookProjects } from "@kdone/db/schema";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/session";

/** Workspace navigation. Availability is decided by lifecycle state. */
const WORKSPACE_NAV = [
  { href: "research", label: "Research" },
  { href: "outline", label: "Outline" },
  { href: "manuscript", label: "Manuscript" },
  { href: "editor", label: "Editor" },
  { href: "qa", label: "QA" },
  { href: "preview", label: "Preview" },
  { href: "publish", label: "Publish" },
] as const;

export default async function BookWorkspacePage({
  params,
}: {
  params: Promise<{ bookId: string }>;
}) {
  const { bookId } = await params;

  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");

  const db = getDb();
  // Ownership check in the query itself: a book owned by someone else is not
  // found. Uses an explicit select; the relational API needs relations().
  const rows = await db
    .select()
    .from(bookProjects)
    .where(and(eq(bookProjects.id, bookId), eq(bookProjects.userId, user.id)))
    .limit(1);
  const book = rows[0];

  if (!book) notFound();

  return (
    <div>
      <p>
        <Link href="/dashboard">← Dashboard</Link>
      </p>
      <h1>{book.workingTitle ?? "Untitled"}</h1>
      <p style={{ opacity: 0.7 }}>Status: {book.status}</p>
      <nav style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        {WORKSPACE_NAV.map((item) => (
          <Link key={item.href} href={`/books/${book.id}/${item.href}`}>
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}