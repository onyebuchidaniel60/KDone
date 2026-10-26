# KDone — AI Handoff

## Current state (2026 iteration — queue fix verified; real LLM researching live)

All V1 phases A—K are implemented. All suites green:

- `pnpm test` — **74/74** (PGlite, no services needed; includes the 6 container
  queue-selection drift tests and the 17 new OpenRouter provider tests)
- `pnpm test:e2e` — 1/1 (against Neon via `DATABASE_URL`)
- `pnpm test:browser` — 8/8

Deployed: https://kdone-uhhh2.vercel.app (deployment
`dpl_ERzBvQTTBXTwFLpgnPtS137BjcE1`, 2026-10-20). `OPENROUTER_API_KEY` **is
configured** in `.env.worker` and in Vercel production, so the local worker
and the web app select the real provider. **Real LLM research is verified
end-to-end live** (research task only — see the OpenRouter section below).
Writing/QA/metadata/cover run through the same provider code but have only
unit-test coverage so far.

### OpenRouter LLM provider implemented and verified on research (round 2026-10-20)

- `packages/ai/src/openrouter-provider.ts` — `OpenRouterProvider` over the
  official OpenAI SDK with `baseURL: https://openrouter.ai/api/v1`,
  `defaultHeaders` (HTTP-Referer `https://kdone-uhhh2.vercel.app`,
  `X-Title: KDone`), `maxRetries: 0` (the provider owns its retry/backoff):
  response_format `json_schema` with `strict: true` + OpenRouter
  `provider.require_parameters`, so generation only routes to endpoints that
  enforce the schema. Hard errors: `LLMRefusalError` on server refusal,
  `LLMTruncatedError` on `finish_reason=length`. Retries: 429/5xx/network
  errors with exponential backoff (250ms→…, jitter), max 3 total attempts;
  other 4xx fail instantly.
- `packages/ai/src/select-llm.ts` — `selectLLM()`: OPENROUTER_API_KEY set →
  OpenRouterProvider, else the deterministic `MockLLMProvider`.
  `defaultProviders()` picks `OpenRouterResearchProvider` (research task →
  routed utility model) as the ResearchProvider when OpenRouter is active;
  the image provider stays mock.
- **Per-task model routing** (`LLM_MODEL_ROUTES`, explicit model IDs, no
  aliases): `openai/gpt-5.6-sol` for plan+chapter (WRITING_MODEL),
  `openai/gpt-5.4` for editorial (EDITORIAL_MODEL), `openai/gpt-5-mini` for
  research/fact_check/metadata/cover (UTILITY_MODEL). Drift test scans
  `packages/agents` task literals so a new agent cannot ship without a route.
- **max_output per task**: chapter 16000, plan 8000, research/fact_check/
  editorial 4000, metadata/cover 2000.
- **Cost rates** (`OPENROUTER_MODEL_RATES_USD_PER_1M`, $/1M tokens): 5.6-sol
  4.00/20.00, 5.4 2.50/15.00, 5-mini 0.25/2.00 (input/out). Provenance records
  `provider=openrouter`, routed `model`, prompt/completion tokens, and the
  rate-table cost; an unregistered model records cost 0 plus a console.warn
  (never silently invented).
- **Strict schema derivation**: zod-to-json-schema (default target) + a
  normalizer that strips OpenAI-forbidden keywords (default/min-max/format/
  $schema/$ref…), forces `additionalProperties:false` + all-required on every
  object, and collapses nullable into `[type, "null"]` unions. NOTE: the
  `"openAi"` target of zod-to-json-schema was rejected on purpose — it wraps
  default-valued fields in anyOf-with-null, which zod itself would then fail
  to parse at `schema.parse()`.
- **Unit tests (17)** in `packages/ai/src/openrouter.test.ts` (mocked client):
  strict request shape (response_format/strict/require_parameters/routed
  model/max_tokens/seed), refusal, truncation, 429+5xx retry with backoff
  then success, connection-error exhaust, non-retryable 4xx, non-JSON and
  schema-invalid content (no retry), fenced-JSON tolerance, per-task model
  routing + usage, cost math, `selectLLM()`/`defaultProviders()` wiring, and
  3 drift guards (agent-task → route coverage; closed task universe; nobody
  but openrouter-provider.ts/select-llm.ts imports the openai SDK).
- **Integration test** `packages/ai/src/openrouter.integration.test.ts`
  (excluded from the default suite). Working command:
  `pnpm test:integration` (root alias added 2026-10-22) or
  `pnpm test:repro packages/ai/src/openrouter.integration.test.ts`; the
  `@kdone/ai`-scoped `pnpm --filter @kdone/ai test:integration` also works.
  The gate is `OPENROUTER_INTEGRATION=1` with `OPENROUTER_API_KEY` sourced
  from `.env.worker` — without the gate the suite is collected and skipped
  (exit 0), so it is safe in plain `pnpm test` checkouts. Do NOT rewrite this
  to a bare `vitest run <file>` — the repro config's include paths are
  repo-root-relative and the default config excludes `*.integration.test.ts`.
  **PASSED against the real API (2026-10-20 and again 2026-10-22 via the
  alias):** routed model `openai/gpt-5-mini`, strict structured outputs
  enforced — the response was constrained JSON that validated against
  `researchOutputSchema` on the first pass with zero repair (no fenced-JSON
  unwrap needed, no retry); 2026-10-22 run: 2 sources / 5 findings, 22.7 s,
  526 input / 1987 output tokens, estimated cost **$0.0041055**.
- **Live research job verified end-to-end (2026-10-20, real provider).**
  Register → sign-in at the live URL → book "AI for Small Business Accounting"
  (`75975c87-2d8c-4354-9e3b-914179b6306f`) → `POST /api/books/:id/research`
  202 QUEUED (job `05bc63ec-ab87-4fc5-8feb-ed85b706561e`) → local worker
  pickup → SUCCEEDED on attempt 1 → RESEARCH_READY visible on the live URL in
  **~36 s wall** (202 at ~2 s, RESEARCHING by ~10 s, READY by ~36 s; the Neon
  `started_at`/`completed_at` columns write ~30 s of execution and show small
  negative queue offsets because Vercel writes `created_at` and the laptop
  worker writes `started_at` from different clocks — trust the wall times).
  `agent_runs` row: `provider=openrouter`, `model=openai/gpt-5-mini`,
  533 input / 1881 output tokens, estimated cost **$0.00389525**,
  `duration_ms=28099`, SUCCEEDED. Research persisted: 3 sources (sba.gov,
  aicpa.org, intuit.com — real entities, not example.test), 5 findings (3
  source-backed, 2 unbacked gap/barrier findings honestly kept without a
  source), market + reader-problem summaries, status COMPLETE.
- **Key handling (RESOLVED)**: `.env.example` documents `OPENROUTER_API_KEY=`.
  The real key is in `.env.worker` (worker restarted, so it selected the
  provider) and was added to Vercel production via
  `vercel env add OPENROUTER_API_KEY production --scope uhhh2` (piped from
  `.env.worker`, value never echoed or logged). The value was never printed
  to any log, terminal, or commit. If the key rotates:
  1. replace it in `.env.worker`, restart `pnpm --filter worker dev`;
  2. `vercel env add OPENROUTER_API_KEY production --scope uhhh2` (CLI
     prompt, paste key);
  3. `vercel deploy --prod --scope uhhh2` **from the repo root** (deploying
     from `apps/web` links a fresh per-directory upload with no lockfile and
     Vercel falls back to npm, which fails with
     `EUNSUPPORTEDPROTOCOL workspace:*`; transient `fetch failed` mid-build
     is a known retry case).
- **P1 RESOLVED — editorial/fact-check now receive chapter prose.**
  `editorialAgent(llm, ctx, chapters: EditorialChapterInput[])` sends, per
  chapter, `ordinal` + `title` + the current draft's **full `content`** +
  the **plan `objective`** (handler threads objectives from the approved
  plan; empty string when the plan row lacks one). `factCheckAgent(llm, ctx,
  chapters, evidence: FactCheckEvidenceInput)` sends each chapter's
  `ordinal` + `title` + full draft `content`, plus the **retained research
  sources with their database `id`s** (url/title/sourceName) and every
  **retained finding tagged with the `sourceId`** of the source backing it
  (`null` when sourceless) — so claims map to real source rows, not just a
  count. Chapters without a draft are still present with empty `content`
  (handler loads all planned chapters via a LEFT JOIN on `chapter_drafts`),
  and both agent prompts keep the empty-list instruction for anything not
  evidenced in the supplied prose — no fabrication from absence. Output
  schemas unchanged. Mock provider is now context-aware for tests
  (`packages/agents/src/editorial.test.ts`: repeated-sentence draft → ≥1
  `repetition` issue; no draft → zero issues; clean draft → zero issues),
  so the whole suite is 72/72. The OpenRouter prompt text for the two tasks
  was updated to match the new input contract (selection/routing/schema
  derivation untouched). Do not start the first real-book run before a
  live QA/agent pass on real prose.
- **First real-model QA pass verified end-to-end (2026-10-22).**
  Book "AI Bookkeeping, One Robot at a Time"
  (`7c8a5446-9f5f-4f58-b351-f63f81a400bf`, topic "AI for small business
  accounting", desiredLength 1200): DRAFT → RESEARCHING (37 s) → PLANNING
  (12 s; 6 chapters with ~200-target-word objectives summing to 1200) →
  WRITING (six jobs, 48–58 s each) → EDITING via `EDITING_START` on
  assembly → QA job `b548fa99-80a7-4fb1-a348-b381283872a7` (64 s). All 11
  transitions logged through the central state machine; canonical memory
  costs: research $0.00541525 (gpt-5-mini 533/2641), planning $0.013552
  (gpt-5.6-sol 808/516), six writing jobs $0.417520 total
  (gpt-5.6-sol, 915–1402 in / 2857–3535 out per chapter).
  Editorial on the real prose returned **16 issues (0 critical, 4 warning,
  12 suggestion)** — the warnings are concrete and quotable (a literal
  capitalization defect "6. verify the accounts again.", missing
  "Chapter 2:/3:" prefixes, TOC-consistency from the merged title list).
  Fact-check (gpt-5-mini) extracted **7 claims from the chapter prose** and
  marked all 7 "verified" with rationales naming the retained sources
  (IRS, QuickBooks, Xero) — zero unsupported. **Prose is flowing into both
  agents — GO for the full real-book run.** Recorded QA AgentRun:
  `openai/gpt-5-mini` 18,885 in / 3,046 out, **$0.01081325**, 63.2 s.
  - **State-machine finding (needs a product decision):** `runQa` requires
    status `EDITING`, and `EDITING_START` fires only when ALL planned
    chapters assemble — QA on a single chapter of a multi-chapter plan is
    unreachable through the public API. The "generate ONE chapter" step was
    honored (chapter 1 via `chapterOrdinals: [1]`), but to run the QA pass
    canonically the remaining five tiny chapters of the deliberately
    1200-word plan were generated (disclosed deviation; ~$0.42). No ad-hoc
    status mutation. If one-chapter QA is a product need, add a documented
    transition (per-chapter QA scoping or a WRITING→EDITING user event);
    do not hack status.
  - **P2 — `fact_checks.source_id` is never populated.** The fact-check
    output carries `sourceIndex` (position in retainedSources) but the QA
    handler inserts `factChecks` rows without translating it to
    `source_id` (stored null). Rationales name the sources in text, so the
    verification stays auditable, but the DB link is missing. Fix: map
    `claim.sourceIndex` → the evidence sources array id on insert.
  - **P2 — the QA job records only one AgentRun.** The handler returns
    fact-check's usage with `agentType: "editorial"`; the editorial call's
    (gpt-5.4) usage is dropped, so recorded QA cost understates the pass
    and the AgentRun's model does not match the editorial agent. Fix:
    record one AgentRun per agent call inside a multi-agent job.
  - **Planner sizing note:** with desiredLength 1200 the planner produced
    6 × ~200-word chapter targets (sums to 1200 — the prompt works), but
    the chapter prompt floors draft content at "at least 800 words", so
    actual chapters (~800–1,100 words) run 4–5× their target. Harmless for
    small plans; watch the target-vs-floor tension during the first real
    30k-word run.

### What changed since commit `940db1e` (handler extraction)

1. **Handler extraction is DONE.** Agent handlers moved into
   `packages/handlers` (`@kdone/handlers`), which both `apps/web` and
   `apps/worker` import. The handler drift test lives in
   `packages/handlers/src/handlers.test.ts` (3 tests: one handler for every
   enqueueable job type, no job types beyond the known set, no Next-only
   imports). Committed as `940db1e`.
2. **Worker startup expectation.** `pnpm --filter worker dev` loads a
   gitignored `.env.worker` at the repo root (`DATABASE_URL`, `REDIS_URL`,
   `QUEUE_DRIVER=bullmq`), connects to Upstash Redis, calls
   `recoverStaleJobs()`, starts, and logs: `Connected to Upstash Redis and
   registered 7 handlers: cover, epub, metadata, planning, qa, research,
   writing`. 7 handlers = research · planning · writing · qa · metadata ·
   cover · epub — the full enqueueable set, verified by the drift test.
3. **`prepare: false` standardized** in `packages/db/src/client.ts`.
   All postgres-js connections default to `prepare: false` (overridable via
   `DATABASE_PREPARE_STATEMENTS=true`) because pooled Neon endpoints reject
   prepared statements; previously only the passing suites (E2E/browser) set
   it, silently diverging from other callers.
4. **`JobStore.findStaleRunning()` Date binding fixed** in
   `packages/jobs/src/job-store.ts`: it previously bound a raw `Date` to a
   SQL `lt()` comparison; it now binds `olderThan.toISOString()` so the
   comparison is a string the driver serializes correctly.
5. **RESOLVED: the web container now selects its queue via
   `selectQueue()` (ADR-016).** It previously hardcoded
   `new InMemoryQueue({ autoDeliver: false })`, so with `REDIS_URL` set in
   Vercel the web app kept enqueueing into an in-process queue that dies
   with the serverless invocation — jobs never reached Upstash and sat
   `QUEUED` forever. Implemented as **option (d), the produce-only lazy
   queue** (smallest call-site churn of a/b/c/d):

   - `apps/web/src/server/queue.ts` — `LazyEnqueueQueue` resolves
     `selectQueue()` on first use, so sync `getApp()` and all 30 route call
     sites stay unchanged; an eager import (option c) was rejected because it
     would statically bundle bullmq/ioredis into the Next bundle. It is
     **produce-only**: `registerWorker()` records handlers locally and never
     forwards them, because `BullMQQueue.registerWorker()` constructs real
     consumers and the web process must never execute job handlers in
     serverless invocations.
   - `packages/jobs/src/select-queue.ts` — `selectQueueDriver()` exposes
     selectQueue()'s env decision synchronously (single source of truth for
     both forms).
   - Drift tests in `apps/web/src/server/container.test.ts`: REDIS_URL set →
     BullMQ, unset → InMemoryQueue (`autoDeliver:false` default = the exact
     old hardcode semantics), `QUEUE_DRIVER=memory` override, registration is
     not forwarded into the driver queue, plus a structural guard asserting
     `container.ts` contains neither `new InMemoryQueue` nor
     `new BullMQQueue` and does contain `selectWebQueue()`.
   - Build verified separately: bullmq/ioredis compile into a lazy webpack
     chunk (`c.e(9001)`), and no API route bundle references that chunk
     eagerly.

6. **E2E verified against the live URL (2026-10-19):**
   register (201) → Auth.js sign-in (302, real session) → create book
   (DRAFT) → `POST /api/books/:id/research` → 202 `{jobId, status: QUEUED}` →
   `generation_jobs` row in Neon observed with status QUEUED → local worker
   picked it up via Upstash → SUCCEEDED on attempt 1 (mock research agent,
   2 sources / 2 findings) → live URL shows `RESEARCH_READY` after refresh.
   Job `8e0d5805-0325-4be2-950e-671e7ac9667f`, book
   `6037ebd2-d8a5-4c7f-860c-11616ea76a1f`. Superseded on 2026-10-20 by the
   same flow with the **real OpenRouter provider** (see "Live research job
   verified end-to-end" above): job `05bc63ec…`, book `75975c87…`, 3 real
   sources / 5 findings, $0.00389525.

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
| LLM / research | Real path selected whenever `OPENROUTER_API_KEY` is set (OpenRouterProvider + OpenRouterResearchProvider with strict structured outputs) — **verified live for research** (job `05bc63ec…`, 3 real sources / 5 findings, $0.00389525, 28 s exec). Writing/QA/metadata/cover go through the same provider + prompts with unit-test coverage only, no live run yet. Mock providers remain the fallback with no key. |
| Storage | **Mocked** in-memory. No S3/MinIO client yet. |
| Queue | **Real BullMQ in prod**; in-memory in tests. |
| Auth | Credentials + JWT for local dev. OAuth not configured. |
| KDP submission | **Not implemented by design.** Mode A prepare only. |
| EPUB | Real deterministic builder + structural validator. |

## Current phase

**Superseded by "Current state" at the top of this file.** The lifecycle is
implemented and all suites pass; the remaining gap is the container/queue
blocker plus the live end-to-end proof of the queue path.

## Test suites

| Command | Needs | Result |
|---|---|---|
| pnpm test | nothing (PGlite) | 68/68 |
| pnpm test:e2e | DATABASE_URL (real Postgres) | 1/1 |
| pnpm test:browser | DATABASE_URL + Chromium cache | 8/8 |

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

1. **S3 StorageProvider — DONE** (Cloudflare R2, verified; see the Storage
   section below). Kept here so the historical item is not silently lost.
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
6. **Replace the leftover `WX< N` debug `console.error` lines** in
   `packages/jobs/src/worker.ts` with structured per-job lifecycle logs
   (see "Known log noise" below).

## Security notes

- Auth: Credentials provider with bcrypt verification. No auto-provisioning;
  `POST /api/register` is the only way to create an account.
- `AUTH_DEV_LOGIN` cannot activate in production.
- No plaintext secrets. Provider credentials are write-only and never returned.
- BullMQ is never **statically** bundled into the web app: ioredis compiles
  into a lazy webpack chunk that only loads when `selectQueue()` resolves the
  BullMQ driver at first enqueue (verified: no API route bundle references
  the chunk eagerly; the only chunk reference is the dynamic `c.e(9001)`
  load inside the selection function).
## Deployment status (2026 round)

- **Deployed URL:** https://kdone-uhhh2.vercel.app (Vercel project `uhhh2/kdone`)
- **Latest production deployment:** `dpl_ERzBvQTTBXTwFLpgnPtS137BjcE1`
  (2026-10-20) — adds the OpenRouter provider with
  `OPENROUTER_API_KEY` set in production (real provider active). This
  deployment's live research job verified the real-LLM path end-to-end (see
  "Current state"). Earlier: `dpl_8GJrVNKprSQiPZXNgzPyUr4j6SGt` (2026-10-20,
  provider code without the key) and `dpl_8AxABh3KApt6V98W3BvRQky8LiKV`
  (2026-10-19) contained the container `selectQueue()` fix, the handler
  extraction, `prepare: false` standardization and the `findStaleRunning`
  Date-binding fix; queue path verified end-to-end.
  **Deploy must be run from the repo root** — a fresh link from `apps/web`
  uploads only that directory (no lockfile) and Vercel then installs with
  npm, failing on `workspace:*` (EUNSUPPORTEDPROTOCOL).
- **Migrations applied** to Neon (production DB).
- **Env vars set (production scope, names only):** DATABASE_URL, AUTH_SECRET,
  AUTH_TRUST_HOST, QUEUE_DRIVER, NODE_ENV, AUTH_URL, NEXT_PUBLIC_APP_URL,
  REDIS_URL (Upstash — set as of the laptop-worker round; drive byte-identical
  with `.env.worker`), OPENROUTER_API_KEY (added 2026-10-20, stored as Secret,
  value piped from `.env.worker`, never echoed), plus the S3_/R2 variables
  listed under Storage below.
- **AUTH_DEV_LOGIN is not set in Vercel** (verified via `vercel env ls production`).

### Worker: laptop-hosted (no Render)

Jobs enqueue to Upstash from Vercel and are consumed by the local worker
(`pnpm --filter worker dev`), which shares the SAME Upstash + Neon
credentials via the gitignored `.env.worker`. The worker must be running for
jobs to process; on a fresh machine it must be started manually. If a
deployment ever changes the Redis URL, BOTH Vercel and `.env.worker` must
change together - byte-identical, or jobs enqueue to one Redis while the
worker listens to another, and nothing fails loudly.

### RESOLVED: Vercel Deployment Protection (was blocking all live traffic)

Deployment Protection was enabled and intercepted /api/* at the Vercel edge,
returning 302 text/plain with body Protected by Vercel Authentication.
It has since been disabled in the Vercel dashboard. Live verification after the fix:

    GET  /login                  -> 200 text/html
    GET  /api/books (no session) -> 401 application/json  UNAUTHENTICATED
    POST /api/register (valid)   -> 201 application/json  { user: {...} }
    Browser: register -> sign in -> /dashboard, __Secure-authjs.session-token
            set, dashboard rendered, authenticated GET /api/books -> 200

Nothing in the repository caused this: no rewrites/redirects in vercel.json
or next.config.ts, no middleware, no catch-all. Regression coverage lives in
e2e/unauthenticated-api.browser.test.ts, which asserts these exact
status codes and content types.
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

## Storage: S3StorageProvider implemented (Cloudflare R2)

- `S3StorageProvider` in `packages/storage` implements the existing
  `StorageProvider` interface via `@aws-sdk/client-s3`, with the R2
  requirements: `forcePathStyle: true` and `region: "auto"`. Methods:
  `put`, `get`, `delete`, `exists`, plus `contentType`.
- **Selection mirrors the Queue pattern** (ADR-016): `selectStorage()` returns
  S3 when `S3_ENDPOINT` + `S3_BUCKET` + credentials are all set, otherwise the
  in-process `MockStorageProvider`. Only `select-storage.ts` and
  `s3-storage.ts` know about AWS; nothing else imports the SDK.
- The bucket is **private**. No long-lived signed URLs are issued -
  `S3StorageProvider.signedUrl()` deliberately throws and points at the API.
- **Assets are served through an authenticated, ownership-checked route:**
  `GET /api/books/:bookId/assets/:assetId`. It verifies the caller owns the
  book AND that the asset belongs to it, then streams from R2 with
  `cache-control: private, no-store`. Guessing a storage key is not enough.
- Tests: 11 unit tests against a mocked S3 client (no network) and one R2
  integration test gated behind `S3_INTEGRATION=1`, verified passing against
  real R2 (put -> exists -> get -> contentType -> delete -> gone).
- Vercel production env now has S3_ENDPOINT, S3_REGION, S3_BUCKET,
  S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY. Secrets were piped, never printed,
  and are not committed.
## Worker architecture: laptop-hosted, no Render

- The worker runs **on the developer's machine**. Vercel enqueues to Upstash
  Redis; the local worker consumes from the **same** Redis; both use the same
  Neon database. **Render is not used.**
- **`REDIS_URL` IS set in Vercel production** and drives the laptop worker
  through the gitignored `.env.worker`; the two must stay byte-identical.
  This round also verified the other half of the contract: the web container
  actually calls `selectQueue()` now (see "Current state"), so REDIS_URL is
  no longer ignored by the web app.
- **Start command:** `pnpm --filter worker dev` (dotenv loads a gitignored
  `.env.worker` from the repo root containing `DATABASE_URL`, `REDIS_URL`,
  `QUEUE_DRIVER=bullmq`). Inline override documented in README.md.
  Startup must log `Connected to Upstash Redis and registered 7 handlers`.
- **The worker must be running for jobs to process.** Render is the future
  unattended option.

### RESOLVED: handlers extracted to `@kdone/handlers`

Agent handlers used to be registered inside the web app's `KDone` container
(`apps/web/src/server/lifecycle.ts`, private `registerHandlers()`), which
issued the following warning - now historical:

> the worker starts and consumes nothing, and every enqueued job stays
> `QUEUED` indefinitely

Fix applied: handlers extracted into `packages/handlers` (`@kdone/handlers`),
the same module imported by both `apps/web` and `apps/worker`, guarded by the
handler drift test in `packages/handlers/src/handlers.test.ts`. The remaining
half of that failure was the container hardcoding `InMemoryQueue` instead of
calling `selectQueue()` — also fixed and verified; see "Current state" at the
top of this file.

### RESOLVED: stray `generation_jobs` row `0ed39846…` deleted (2026-10-20)

A pre-key-test research job (`0ed39846-3443-43c5-b0cb-62eb31b5d40c`, book
`2ab07578-ec15-46ae-b195-ba1cf3b641be`) sat in Neon as `QUEUED` (attempts 0)
since 2026-10-17 and never processed. The stale-job reaper cannot help here:
`Worker.recoverStaleJobs()` only re-queues jobs whose DB row is `RUNNING`
beyond the stale threshold (`JobStore.findStaleRunning` filters
`status = "RUNNING"`), so a QUEUED row whose BullMQ delivery was lost is dead
forever. Verified no Redis key anywhere referenced the id (full `SCAN` of the
queue, 26 keys, zero hits), so no lingering BullMQ delivery could later pick
it up, then deleted the row directly against Neon with a guard
(`status = 'QUEUED' AND attempts = 0`), and confirmed zero rows remain. The
book row itself was left untouched. Note for a future iteration: QUEUED rows
abandoned before BullMQ delivery could use a small max-age reaper if this
ever recurs.

### Known log noise (cleanup candidate)

RESOLVED (2026-10-22): the leftover debug lines in
`packages/jobs/src/worker.ts` (`WX< 1 done` … `WX< 3 done`) are removed and
replaced by nothing — job pickup/success evidence now comes from the normal
worker + job lifecycle logs. The worker was restarted after the fix and
still registered 7 handlers and processed a live research job end-to-end;
the full unit suite (72/72) passes. Future work should add structured
per-job lifecycle logs (pickup started, succeeded, transition applied).

## Phase 8 — Workspace UI for real-book validation (2026-10-26)

All V1 backend phases A—K are complete, but the book workspace shell
(`apps/web/src/app/books/[bookId]/page.tsx`) linked to 7 sub-routes that did not
exist, and there was no way to create a book through the UI. Phase 8 adds the
workspace UI so a real user can run a book through the full lifecycle:
Create → Research → Approve → Plan → Approve → Write → QA → Preview → Preflight → Approve → Publish (prepare).

### New pages

- `apps/web/src/app/create/page.tsx` — Create-book form (`POST /api/books`),
  then redirects to `/books/[id]`. Client component, inline styles,
  `data-testid` attributes.
- `apps/web/src/app/dashboard/page.tsx` — Added "+ Create book" button linking
  to `/create`.
- `apps/web/src/app/books/[bookId]/research/page.tsx` — Server component.
  `GET /api/books/:id/research` (sources/findings), `POST /api/books/:id/research`
  (start), `POST /api/books/:id/research/approve` (approve).
- `apps/web/src/app/books/[bookId]/outline/page.tsx` — Server component.
  `GET /api/books/:id/plan` (outline chapters), `POST /api/books/:id/plan`
  (start), `POST /api/books/:id/plan/approve` (approve).
- `apps/web/src/app/books/[bookId]/manuscript/page.tsx` — Server component.
  `GET /api/books/:id/manuscript` (chapters), `POST /api/books/:id/generate`
  (start generation), link to editor.
- `apps/web/src/app/books/[bookId]/qa/page.tsx` + `client.tsx` — Server wrapper
  + client component. `GET /api/books/:id/issues`, `POST /api/books/:id/qa`
  (run QA), `PATCH /api/issues/:id` (update issue status/proposed fix).
- `apps/web/src/app/books/[bookId]/preview/page.tsx` — Server component.
  `GET /api/books/:id/preview` (preview URL/asset).
- `apps/web/src/app/books/[bookId]/publish/page.tsx` + `client.tsx` — Server
  wrapper + client component. `POST /api/books/:id/preflight`, `POST
  /api/books/:id/approve`, `POST /api/books/:id/publish/start` (mode, checklist).
  Publishing is prepare-only per ADR-012; USER_APPROVED is terminal.

### Conventions followed

- Server components own auth (`requireUser()`), ownership queries
  (`eq(bookProjects.userId, user.id)`), and `notFound()`/`redirect()`.
- Client components own interactive state (loading, error, result) and `fetch()`
  calls to API routes.
- `data-testid` on all actionable elements for future Playwright/vitest coverage.
- No new dependencies; uses existing `@kdone/*` workspace packages and Next.js
  15 app router patterns already in the codebase.

### Verification

- `pnpm --filter web typecheck` — clean
- `pnpm --filter web build` — all routes compile, including new workspace pages
- `pnpm test` — 74/74 pass
- `next lint` — not applicable (no ESLint config / `lint` script in this repo)

### Remaining for V1 completion

- Real-book validation end-to-end through the UI requires a real Postgres
  (`DATABASE_URL`) for `pnpm test:e2e` (the handler-level lifecycle smoke test).
- Playwright browser tests (`pnpm test:browser`) cover UI interactions but were
  last run at 8/8 before these pages were added; consider adding coverage for
  the new workspace flows.
