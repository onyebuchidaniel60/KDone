# KDone — Source of Truth Documentation

KDone is an AI-powered publishing workspace that researches, plans, writes, edits, produces, validates, and prepares ebooks for Amazon KDP, with explicit human approval before publishing.

## Documentation hierarchy

1. `docs/PRD.md` — product truth: what KDone is and what V1 must do.
2. `docs/IMPLEMENTATION_PLAN.md` — implementation truth: how V1 is built and how the one-shot + iterative workflow works.
3. `docs/ARCHITECTURE.md` — system architecture and boundaries.
4. `docs/DATA_MODEL.md` — database/domain model.
5. `docs/API.md` — API contracts and state-changing operations.
6. `docs/AI_HANDOFF.md` — current build state and the latest work for the next coding session.
7. `docs/DECISIONS.md` — durable architectural/product decisions and their rationale.
8. `docs/external/KDP_SOURCES.md` — official Amazon/KDP sources that define external requirements.
9. `AGENTS.md` — OpenCode project instructions and coding-agent guardrails.

## Authority rules

- Product behavior and scope: `PRD.md` wins.
- Implementation approach: `IMPLEMENTATION_PLAN.md` wins unless it would violate the PRD.
- Technical system boundaries: `ARCHITECTURE.md`.
- Persisted data: `DATA_MODEL.md`.
- HTTP/application contracts: `API.md`.
- External KDP rules: official Amazon sources listed in `external/KDP_SOURCES.md` outrank internal assumptions.
- Current status: `AI_HANDOFF.md`.
- Historical decisions: `DECISIONS.md`.
- Agent behavior: `AGENTS.md`.

## Development model

KDone uses a one-shot V1 followed by iterative Agile-style refinement:

`PRD → implementation spec → end-to-end V1 → real book run → backlog → prioritized fix → regression test → repeat`

The first build aims for a complete, usable product loop rather than production perfection.

## Running locally

Docker is optional. Use managed Postgres (e.g. Neon) and Redis (e.g. Upstash), or
`docker compose up -d` for local Postgres/Redis/MinIO.

```bash
pnpm install

# Apply the real drizzle-kit migrations to DATABASE_URL
pnpm --filter @kdone/db migrate

# Web app (apps/web, port 3000)
DATABASE_URL=postgres://... AUTH_SECRET=dev-secret AUTH_DEV_LOGIN=true REDIS_URL=rediss://... \
  pnpm --filter web dev

# Worker process (separate, ADR-016)
DATABASE_URL=postgres://... REDIS_URL=rediss://... pnpm --filter worker dev
```

Without `REDIS_URL` the worker falls back to the in-memory queue, so jobs only
run inside the web process.

## Tests

```bash
pnpm test
```
Unit and integration tests. **Uses PGlite (in-process Postgres) with the real
schema and the real generated migrations. No services required.** Currently 28
passing.

```bash
pnpm test:e2e
```
The E2E smoke test (the V1 Definition of Done). **Requires `DATABASE_URL`
pointing at a real Postgres** — it refuses to run against PGlite, because
PGlite's single-connection WASM model cannot sustain the sequential-statement
pattern a job handler uses. It applies the same migrations production uses.

```bash
DATABASE_URL=postgres://... pnpm test:e2e
```

## Running the worker locally (laptop-hosted architecture)

There is **no Render**. The worker runs on your machine and consumes from the
**same Redis that Vercel enqueues to**. Both point at the same Neon database.

### One-time setup

Create `.env.worker` at the repo root (gitignored — `.env.*` is ignored):

```
DATABASE_URL=postgresql://USER:PASSWORD@HOST/neondb?sslmode=require
REDIS_URL=rediss://default:TOKEN@HOST:6379
QUEUE_DRIVER=bullmq
```

The value of `REDIS_URL` **must be byte-identical** to the one set in Vercel
production env vars. If they differ, Vercel enqueues to one Redis and this
worker listens to another; jobs sit at `QUEUED` forever and nothing errors.

Do not put `channel_binding=require` in `DATABASE_URL`; `postgres-js` cannot
negotiate it and the connection ends with `CONNECTION_ENDED`.

### Start it

```powershell
pnpm --filter worker dev
```

`dotenv` loads `.env.worker` automatically. To override inline instead:

```powershell
$env:QUEUE_DRIVER="bullmq"; $env:REDIS_URL="rediss://..."; $env:DATABASE_URL="postgresql://..."; pnpm --filter worker dev
```

**The worker must be running for jobs to process.** Render (or any always-on
host) is the future unattended option.

> **Known blocker:** agent handlers are currently registered only inside the web
> app's `KDone` container, which the worker cannot import. Until they are
> extracted to a worker-safe module, this process starts and consumes nothing,
> so jobs remain `QUEUED`. See `docs/AI_HANDOFF.md`.