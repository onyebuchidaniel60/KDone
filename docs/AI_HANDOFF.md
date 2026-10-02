# KDone — AI Handoff

## Current phase

**Phase K (hardening) — INCOMPLETE.** Phases A–E are complete and verified.
Phases F–K have been implemented but the E2E smoke test is **failing at step 2**
(research). V1 is **not** complete.

## Definition of Done status

| Criterion | Status |
|---|---|
| Lifecycle Create → KDP prepare | **Not verified** (E2E fails at research step) |
| Jobs survive worker restart | **Verified** (`packages/jobs` tests) |
| Artifacts versioned, no destructive overwrite | **Verified** (unit tests + schema) |
| Provenance on every generated output | **Implemented**, partially verified |
| Every state transition logged | **Verified** (unit test) |
| Critical issues block READY_FOR_REVIEW | **Verified** (unit test + preflight code) |
| publish/start rejects artifact drift | **Implemented, NOT verified through HTTP** |
| Mock providers run everything locally | **Verified** |

## What is built

- **Packages**: `shared` (state machine, errors, provenance fingerprint/drift),
  `db` (24 entities, 41 FKs, migrations, PGlite harness), `jobs` (Queue interface,
  BullMQQueue, InMemoryQueue, JobStore, Orchestrator, Worker),
  `validation` (Zod contracts), `ai` (LLM/Research/Image providers + mocks),
  `storage` (StorageProvider + Mock), `agents` (research/planning/writing/
  editorial/fact-check/consistency/metadata/cover/production/preflight),
  `epub` (deterministic EPUB 3 builder + validator), `publishing`
  (PublishingProvider + KDPProvider Mode A).
- **apps/web**: Next.js 15, Auth.js (NextAuth v5) + Drizzle adapter,
  `/`, `/login`, `/dashboard`, `/settings`, `/books/[bookId]` workspace nav,
  21 API routes, `lifecycle.ts` domain services.
- **apps/worker**: BullMQ worker entrypoint with stale-job recovery.
- **docs**: ADR-011..020 applied to DATA_MODEL/API/ARCHITECTURE/IMPLEMENTATION_PLAN.

## What is mocked vs real

| Area | State |
|---|---|
| Database | Real Postgres schema/migrations. Dev needs Postgres; tests use PGlite. |
| LLM / research / image | **Mocked.** Deterministic, schema-valid, seed-based. |
| Storage | **Mocked** in-memory. No S3/MinIO client yet. |
| Queue | **Real BullMQ in prod**; in-memory in tests. |
| Auth | Credentials + JWT for local dev. OAuth not configured. |
| KDP submission | **Not implemented by design.** Mode A prepare only. |
| EPUB | Real deterministic builder + structural validator. |

## Known blocking issue

`e2e/lifecycle.e2e.test.ts` hangs inside the research job handler: the
`generation_jobs` row stays `RUNNING` with `attempts=1` and never completes.
Most likely the Drizzle relational query API (`db.query.bookProjects.findFirst`)
in `apps/web/src/server/lifecycle.ts` — no `relations()` are defined in the
schema, and PGlite appears to stall on it. Every handler in `registerHandlers()`
uses this pattern, so fixing it should unblock the whole E2E. Replace those calls
with explicit `select().from(...).where(...)`.

Also: `apps/web` uses `x-kdone-user-id` as a temporary auth stand-in in
`src/server/routes.ts`; this must be replaced by the real Auth.js session
before V1 is shippable.

## How to run locally

Docker is not required to be installed; use managed services.

```bash
# 1. Managed Postgres (e.g. Neon) and Redis (e.g. Upstash) - set URLs below.
#    Local docker also works: docker compose up -d

pnpm install
pnpm --filter @kdone/db migrate        # requires DATABASE_URL

# Web (apps/web on :3000)
DATABASE_URL=... AUTH_SECRET=dev-secret AUTH_DEV_LOGIN=true REDIS_URL=... \
  pnpm --filter web dev

# Worker (separate process, ADR-016)
DATABASE_URL=... REDIS_URL=... pnpm --filter worker dev
```

Without Redis the worker falls back to `InMemoryQueue` (jobs then only run
in-process).

## How to run tests

```bash
pnpm test         # 28 unit/integration tests, PGlite only, no services needed
pnpm test:e2e     # E2E smoke test - CURRENTLY FAILING at step 2
```

## Decisions taken without asking

1. **Auth without an adapter at build time** — Auth.js reads the adapter during
   `next build`, and it detects the drizzle flavour from the instance, so a lazy
   `Proxy` silently broke it. The Drizzle adapter is attached only when
   `DATABASE_URL` is set. V1 uses Credentials + JWT.
2. **`AnyDb` type alias** — production (`postgres-js`) and tests (PGlite) share
   one code path; `PgDatabase<never, ...>` was wrong (nothing is assignable to
   `never`).
3. **Durability lives in `generation_jobs`, not the queue** — a queue is only a
   delivery mechanism, so worker recovery re-queues abandoned `RUNNING` jobs.
4. **Rate limiting not implemented** — deferred; needs a real store decision.
5. **`User` id is `text`** to match Auth.js; all `user_id` columns are `text`.