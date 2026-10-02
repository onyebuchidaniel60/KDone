import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema.js";

export type TestDb = PgliteDatabase<typeof schema>;

/**
 * Resolves the drizzle-kit generated migrations.
 *
 * Tests apply the *same* SQL migrations production uses. There are no separate
 * test migrations and no forked schema (ADR-020).
 */
export function migrationsFolder(): string {
  return fileURLToPath(new URL("../drizzle", import.meta.url));
}

export interface TestDbHandle {
  db: TestDb;
  client: PGlite;
  /** Closes the in-memory instance. */
  close: () => Promise<void>;
}

/**
 * Creates a fresh in-memory PGlite Postgres and applies the real migrations.
 * Requires no Postgres, Redis or MinIO process (ADR-020).
 */
export async function createTestDb(): Promise<TestDbHandle> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: migrationsFolder() });
  return {
    db,
    client,
    close: async () => {
      await client.close();
    },
  };
}