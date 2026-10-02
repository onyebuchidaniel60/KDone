import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Db = PostgresJsDatabase<typeof schema>;

/**
 * Production database client. Requires `DATABASE_URL`.
 *
 * Local development points at the docker-compose Postgres (ADR-020); a hosted
 * Postgres works identically by changing the URL.
 */
export function createDb(databaseUrl = process.env.DATABASE_URL): {
  db: Db;
  client: postgres.Sql;
} {
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required. Start local infrastructure with `docker compose up -d` (see README).",
    );
  }

  const client = postgres(databaseUrl, { max: 10 });
  return { db: drizzle(client, { schema }), client };
}

export type { PostgresJsDatabase };