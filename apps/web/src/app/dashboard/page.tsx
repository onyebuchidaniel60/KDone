import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { bookProjects } from "@kdone/db/schema";
import { desc, eq } from "drizzle-orm";

export default async function DashboardPage() {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");

  const db = getDb();

  // Ownership is enforced server-side: only this user's projects are read.
  const books = await db
    .select({
      id: bookProjects.id,
      workingTitle: bookProjects.workingTitle,
      topic: bookProjects.topic,
      status: bookProjects.status,
      updatedAt: bookProjects.updatedAt,
    })
    .from(bookProjects)
    .where(eq(bookProjects.userId, user.id))
    .orderBy(desc(bookProjects.updatedAt));

  return (
    <div>
      <h1>Your books</h1>
      {books.length === 0 ? (
        <p>No book projects yet.</p>
      ) : (
        <ul>
          {books.map((book) => (
            <li key={book.id}>
              <Link href={`/books/${book.id}`}>{book.workingTitle ?? "Untitled"}</Link>{" "}
              <span style={{ opacity: 0.7 }}>{book.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}