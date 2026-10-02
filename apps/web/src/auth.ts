import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import type { Adapter } from "next-auth/adapters";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
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
 * Credentials are only accepted when AUTH_DEV_LOGIN=true, so production can
 * never fall back to a local dev account.
 */

const devLoginEnabled = process.env.AUTH_DEV_LOGIN === "true";

export const isDevLoginEnabled = devLoginEnabled;

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
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
      id: "dev-credentials",
      name: "Local development",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        if (!devLoginEnabled) return null;

        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { email } = parsed.data;
        try {
          const db = getDb();
          const existing = await db.query.users.findFirst({
            where: (users, { eq }) => eq(users.email, email),
          });

          const user =
            existing ??
            (await db
              .insert(schema.users)
              .values({ id: crypto.randomUUID(), email, displayName: email.split("@")[0] ?? email })
              .returning())[0];

          return user ? { id: user.id, email: user.email, name: user.displayName } : null;
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