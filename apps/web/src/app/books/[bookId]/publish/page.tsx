import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { bookProjects } from "@kdone/db/schema";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { PublishClient } from "./client";

export default async function PublishPage({
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

  return <PublishClient bookId={bookId} />;
}

