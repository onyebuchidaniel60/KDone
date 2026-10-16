import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import type { Adapter } from "next-auth/adapters";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { eq } from "drizzle-orm";
import * as schema from "@kdone/db/schema";
import { createDb } from "@kdone/db";
import { getDb } from "@/lib/db";

/*
 * Auth.js (NextAuth v5) with the Drizzle adapter (ADR-017).
 *
 * V1 uses a Credentials provider so the whole flow runs locally with no
 * external identity provider. Credentials sessions must use the JWT strategy,
 * because Auth.js cannot persist credential logins to the database sessions
 * table. The adapter is still attached so user records live in `users` and
 * OAuth providers can be added later without a schema change.
 *
 * Credentials are always available and always verify the stored bcrypt hash.
 */

// The credentials provider is a real provider: it verifies the stored bcrypt
// hash and never creates users. Registration is the only way to create an
// account (POST /api/auth/register).
const devLoginEnabled = process.env.AUTH_DEV_LOGIN === "true";

export const isDevLoginEnabled = devLoginEnabled;

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10).max(200),
});

/**
 * Auth.js reads the adapter when the module is first imported, which happens
 * during `next build` before any DATABASE_URL is guaranteed. The adapter also
 * detects the drizzle flavour from the instance itself, so it cannot be
 * wrapped in a lazy proxy.
 *
 * V1 authenticates with a Credentials provider and JWT sessions, which needs
 * no database session table. The Drizzle adapter is therefore attached only
 * when DATABASE_URL is present, keeping `next build` independent of a live
 * database while still using the adapter everywhere it matters (ADR-017).
 */
const adapter: Adapter | undefined = process.env.DATABASE_URL
  ? (DrizzleAdapter(createDb().db as never, {
      usersTable: schema.users,
      accountsTable: schema.accounts,
      sessionsTable: schema.sessions,
      verificationTokensTable: schema.verificationTokens,
    } as never) as Adapter)
  : undefined;

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...(adapter ? { adapter } : {}),
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  trustHost: true,
  providers: [
    Credentials({
      id: "credentials",
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;
        try {
          const db = getDb();
// Explicit select: the relational query API (db.query.*) requires relations()
// and does not work here.
const rows = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      passwordHash: schema.users.passwordHash,
    })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  const found = rows[0];
  if (!found) return null;

          // Real password verification. Dev login still requires the password to
          // match the stored hash; it never auto-creates a user.
          if (!found.passwordHash) return null;
          const bcrypt = await import("bcryptjs");
          const valid = await bcrypt.compare(password, found.passwordHash);
          if (!valid) return null;

          return { id: found.id, email: found.email, name: found.displayName };
        } catch {
          return null;
        }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});