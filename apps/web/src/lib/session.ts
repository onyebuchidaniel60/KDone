import { cache } from "react";
import { auth } from "@/auth";
import { errors } from "@kdone/shared";

/**
 * Returns the authenticated user or throws UNAUTHENTICATED.
 * Every user-scoped service must go through this (DATA_MODEL section 24).
 */
export const requireUser = cache(async () => {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) throw errors.unauthenticated();
  return { id: user.id, email: user.email ?? null, name: user.name ?? null };
});