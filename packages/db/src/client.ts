import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { PgDatabase } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Db = PostgresJsDatabase<typeof schema>;

/**
 * Any Postgres-compatible drizzle instance.
 *
 * Production uses `postgres-js` (`Db`); tests use PGlite. Application code
 * that is driver-agnostic (job store, orchestrator, worker) depends on this
 * type so the real schema is exercised in both, without casting at call sites.
 */
export type AnyDb = PgDatabase<any, typeof schema>;

export interface CreateDbOptions {
  /**
   * Use server-side prepared statements. Must be `false` for pooled endpoints
   * such as Neon's `-pooler` (PgBouncer transaction pooling), which is not
   * compatible with prepared statements and ends the connection with
   * CONNECTION_ENDED.
   */
  prepare?: boolean;
  max?: number;
}

/**
 * Production database client. Requires `DATABASE_URL`.
 *
 * Local development points at the docker-compose Postgres (ADR-020); a hosted
 * Postgres works identically by changing the URL.
 */
export function createDb(
  databaseUrl = process.env.DATABASE_URL,
  options: CreateDbOptions = {},
): {
  db: Db;
  client: postgres.Sql;
} {
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required. Start local infrastructure with `docker compose up -d` (see README).",
    );
  }

  const isPooled = /-pooler\./.test(databaseUrl) || /pgbouncer/i.test(databaseUrl);
  //
  // Prepared statements are OFF by default for every caller (web, worker, tests).
  // postgres.js 3.x fails binding a Date parameter on this Neon host, and every
  // suite that passes (E2E, browser) uses prepare:false. Making it the default
  // forces the web app and the worker to agree instead of deriving it per host.
  // Opt in per-call or with DATABASE_PREPARE_STATEMENTS=true.
  const prepare = options.prepare ?? process.env.DATABASE_PREPARE_STATEMENTS === "true";

  const client = postgres(databaseUrl, {
    max: options.max ?? (isPooled ? 5 : 10),
    prepare,
  });

  return { db: drizzle(client, { schema }), client };
}

export type { PostgresJsDatabase };