import { createDb, type Db } from "@kdone/db";

// Single connection pool per server process.
// The underlying client is intentionally never closed in a long-lived server.
const globalForDb = globalThis as unknown as { __kdoneDb?: { db: Db } };

export function getDb(): Db {
  if (!globalForDb.__kdoneDb) {
    globalForDb.__kdoneDb = { db: createDb().db };
  }
  return globalForDb.__kdoneDb.db;
}