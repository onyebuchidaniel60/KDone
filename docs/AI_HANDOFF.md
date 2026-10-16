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

## Current phase

**V1 complete.** Deploy gate cleared: pnpm test:browser passes against
production-mode 
ext start with a real Auth.js session.

## Test suites

| Command | Needs | Result |
|---|---|---|
| pnpm test | nothing (PGlite) | 31/31 |
| pnpm test:e2e | DATABASE_URL (real Postgres) | 1/1 |
| pnpm test:browser | DATABASE_URL + Chromium cache | 2/2 |

## Known blocking issue (RESOLVED — historical)

`pnpm test:e2e` requires a **real Postgres** via `DATABASE_URL`. It now refuses
to run on PGlite and fails loudly with instructions if the variable is unset or
points at PGlite.

**Why PGlite was dropped for E2E:** the agent call completed, the
`research_projects` and `research_sources` inserts succeeded, then the *third*
sequential statement in `persistResearch` stalled forever. Batching the sources
loop moved the stall forward by exactly one statement, so the loop was not the
cause — PGlite's single-connection WASM model cannot drain sequential statements
the way a job handler issues them. Unit tests keep using PGlite and still pass
(28/28); they were not changed.

The E2E now applies the **same** drizzle-kit generated migrations production
uses, and creates a unique user per run so repeated runs never collide. Nothing
is ever deleted.

**Awaiting a Neon (or local Postgres) connection string to run it.**

## Open items before V1 can be declared complete

1. **Run `pnpm test:e2e` against real Postgres** and fix whatever surfaces next
   (blocker).
2. **Tighten E2E step 11** — still reaches `READY_FOR_REVIEW` via a direct DB
   write. Doing it through the real path exposes a genuine state-machine gap:
   once a book is `USER_APPROVED`, the only permitted events are `PUBLISH_START`
   and `CANCEL`. There is **no path back to `READY_FOR_REVIEW` after artifact
   drift**, so a user who approves, edits chapter 7, and is refused at
   `publish/start` cannot re-approve. ADR-013 requires re-approval to be
   possible. **This needs a `USER_APPROVED → NEEDS_REVISION` transition added to
   the state machine, which is a change beyond what the docs currently specify —
   flagging rather than making it unilaterally.**
3. **Replace `x-kdone-user-id`** with the real Auth.js session. It stays as the
   E2E harness for now and is **hard-disabled when `NODE_ENV === "production"`**
   in `src/server/routes.ts`, so a deployed instance cannot accept a forged
   header. It must be deleted entirely once the E2E authenticates via Auth.js.
4. **Rate limiting (phase K) — DEFERRED, open.** Not implemented. Needs a
   shared-store decision: an in-process limiter is incorrect across multiple web
   instances, so a store must be chosen and documented (Redis is the obvious
   candidate, already required for BullMQ). No ADR written yet.
5. **Storage is mocked only** — no S3/MinIO client implemented, so
   `StorageProvider` has a single implementation.
6. **Job polling UI** — `GET /api/books/:bookId/jobs` now exists, but no UI
   consumes it.
7. **Settings PATCH endpoints** — `GET /api/settings/providers` and
   `GET /api/settings/publishing` are implemented; the `PATCH` variants from
   API.md section 13 are not.

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
## Open items after deploy

1. **S3 StorageProvider is NOT implemented — FIRST POST-DEPLOY TASK.**
   Only `MockStorageProvider` exists, holding bytes in process memory. On
   Vercel serverless, covers and EPUBs do **not** survive between invocations.
   The `StorageProvider` interface and `S3_*` env placeholders are ready; the
   implementation is not. Asset persistence is broken in hosted environments
   until this lands.
2. **Rate limiting deferred.** Needs a shared-store decision. An in-process
   limiter is incorrect across multiple web instances; Redis is the obvious
   candidate since BullMQ already requires it. No ADR written yet.
3. **Settings PATCH not implemented.** `GET /api/settings/providers` and
   `GET /api/settings/publishing` exist (API.md §13); the `PATCH` variants do
   not, so provider credentials cannot be set through the app.
4. **`x-kdone-user-id` must be deleted** once the HTTP E2E authenticates via
   Auth.js. It remains as the E2E harness and is hard-disabled when
   `NODE_ENV === "production"`.
5. **First real-book run never performed.** All agents run against mock
   providers, so research/writing/editorial quality is unproven. This is the
   largest remaining risk to KDone being useful.

## Security notes

- Auth: Credentials provider with bcrypt verification. No auto-provisioning;
  `POST /api/register` is the only way to create an account.
- `AUTH_DEV_LOGIN` cannot activate in production.
- No plaintext secrets. Provider credentials are write-only and never returned.
- BullMQ is never statically bundled into the web app (verified: 0 references
  in the Next build output).
## Deployment status (2026 round)

- **Deployed URL:** https://kdone-uhhh2.vercel.app (Vercel project `uhhh2/kdone`)
- **Migrations applied** to Neon (production DB).
- **Env vars set (production scope, names only):** DATABASE_URL, AUTH_SECRET,
  AUTH_TRUST_HOST, QUEUE_DRIVER, NODE_ENV, AUTH_URL, NEXT_PUBLIC_APP_URL.
  `REDIS_URL` was NOT set (no Upstash URL was ever supplied) - see deviations.
- **AUTH_DEV_LOGIN is not set in Vercel** (verified via `vercel env ls production`).

### Render worker NOT provisioned

Jobs enqueue but are never processed. On Vercel the queue falls back to
InMemoryQueue, so jobs sit in-process. **This is expected, not a bug.**
When Render is provisioned, add the SAME Upstash URL to BOTH Vercel and Render -
byte-identical, or jobs enqueue to one Redis while the worker listens to
another, and nothing fails loudly.

### BLOCKER: Vercel Deployment Protection is enabled

The live app returns, for `GET /api/books`:
`302 text/plain` with body `Protected by Vercel Authentication`.
`POST /api/register` returns `401`.

Deployment Protection intercepts `/api/*` at the edge before the app runs, so
the app is NOT usable in production yet. Nothing in the repository causes this:
`vercel.json` and `next.config.ts` have no rewrites/redirects, there is no
middleware, and no catch-all route. Fix: Vercel dashboard -> project ->
Settings -> Deployment Protection -> disable (or add a bypass rule).

### Deviations from the original deploy prompt

1. `REDIS_URL` omitted - no Upstash URL was ever provided in the session.
2. `next` added to ROOT devDependencies. Vercel detects the framework from the
   root package.json where `next` is not a direct dependency; without it the
   deploy fails with "No Next.js version detected". Documented in root
   package.json `_comment` so it is not removed.

### Auth incident (resolved)

An earlier iteration gated the Credentials provider behind `AUTH_DEV_LOGIN`,
which would have disabled sign-in in production. The gate was removed; the
provider is always registered and always verifies the stored bcrypt hash.
`playwright.config.ts` pins `AUTH_DEV_LOGIN=""` so the browser suite proves the
real credential path with no dev bypass. The login page no longer tells users
to set a dev flag.