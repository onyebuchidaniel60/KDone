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

## Known blocking issue (E2E still red)

`pnpm test:e2e` **fails at step 2** (research). The book stays `RESEARCHING`
instead of reaching `RESEARCH_READY`. `drain()` still fails loudly and was not
weakened.

**What was fixed:** the diagnosed `db.query.*.findFirst` calls in
`lifecycle.ts` (9 sites, now a `loadBook()` helper using explicit
`select().from().where().limit()`) and the same bug class in
`books/[bookId]/page.tsx`. No `relations()` were added to the schema.

**Current symptom:** the research handler completes the agent call, inserts the
`research_projects` row, and inserts `research_sources`. It then **stalls on
the third sequential statement** (the `research_findings` insert). Batching the
sources loop into one `values([...])` statement moved the stall forward by one
statement, so the pattern is not the loop itself — **PGlite appears to stop
draining after roughly two sequential statements issued through drizzle.**

**Next investigation (do not guess):**
1. Confirm by isolating `persistResearch` in its own test against PGlite with no
   worker, inserting three statements in sequence.
2. If it reproduces, check whether the drizzle `pglite` driver requires
   `await client.waitReady` / drains the query promise between statements, or
   whether an in-flight statement from the previous step is never settled.
3. Compare against `packages/db` tests, which pass many sequential inserts -
   the difference is those use one statement per `it()` with `await`, while the
   handler issues several inside a single job execution.
4. Fall back to testcontainers for this suite only (per ADR-020) and document
   why, if PGlite cannot be made to work.

Also: `apps/web` uses the `x-kdone-user-id` header as a temporary identity
stand-in. It is **hard-disabled when `NODE_ENV === "production"`** in
`src/server/routes.ts`, so a deployed instance cannot accept a forged header.
**It must be removed entirely once the E2E authenticates via Auth.js.**

## Open items before V1 can be declared complete

1. **Fix the PGlite stall** so `pnpm test:e2e` passes end to end (blocker).
2. **Tighten E2E step 11** — it currently reaches `READY_FOR_REVIEW` via a
   direct DB write. It must go through the real API and state-machine path.
3. **Replace `x-kdone-user-id` with the real Auth.js session**, then delete the
   header path and the production guard.
4. **Rate limiting (phase K) — DEFERRED, open.** Not implemented. Needs a store
   decision: an in-process limiter is not correct across multiple web instances,
   so this requires choosing and documenting a shared store (Redis being the
   obvious candidate, since it is already a dependency for BullMQ). No ADR has
   been written for it yet.
5. **Storage is mocked only** — no S3/MinIO client is implemented, so
   `StorageProvider` has exactly one implementation.
6. **Worker UI and job polling** — `GET /api/books/:id/jobs` from API.md is not
   implemented.
7. **Settings endpoints** — `/api/settings/providers` and
   `/api/settings/publishing` (documented in API.md section 13) are not
   implemented; `/settings` is a placeholder page.

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