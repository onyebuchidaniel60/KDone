import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client.js";

/**
 * Applies the generated migrations to whatever DATABASE_URL points at.
 * Used identically for docker-compose Postgres and hosted Postgres (ADR-020).
 */
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error(
    "DATABASE_URL is not set.\n" +
      "  Local:  docker compose up -d  then  $env:DATABASE_URL='postgres://kdone:kdone@localhost:5432/kdone'\n" +
      "  Hosted: set DATABASE_URL to your Postgres connection string.",
  );
  process.exit(1);
}

// Never print the connection string; it may contain credentials.
console.log("Applying migrations to the configured DATABASE_URL...");

const { db, client } = createDb(databaseUrl);
try {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  console.log("Migrations applied.");
} finally {
  await client.end();
}