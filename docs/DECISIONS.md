# KDone — Architecture Decision Record Log

This document records durable decisions. Do not remove an old decision merely because it later changes; supersede it with a new entry.

## ADR-001 — Product name

**Decision:** Product is called `KDone`.

**Reason:** User-selected product name.

## ADR-002 — One-shot V1, then iterative development

**Decision:** Build the whole end-to-end V1 first, then improve it using observed real-world issues.

**Reason:** The product spans AI generation, deterministic production, UX, and an external publishing workflow. Real end-to-end usage is expected to reveal issues that are difficult to predict from the PRD alone.

## ADR-003 — OpenCode-native agent instructions

**Decision:** Use `AGENTS.md` for repository instructions. Do not include Cline-specific `.clinerules/` files.

**Reason:** OpenCode documents `AGENTS.md` as the project instruction mechanism.

## ADR-004 — Modular monolith for V1

**Decision:** Build a modular monolith first and keep provider/domain boundaries explicit.

**Reason:** The initial product does not need microservice operational complexity. Clean interfaces preserve the option to split services later.

## ADR-005 — Durable jobs for long-running operations

**Decision:** Research, generation, QA, production, and publishing operations are represented as durable jobs.

**Reason:** These operations can exceed normal request lifetimes and must support retries/resume.

## ADR-006 — Chapter-by-chapter writing

**Decision:** The writing system generates chapters independently using shared book context rather than one giant prompt.

**Reason:** Better consistency, resumability, versioning, and targeted regeneration.

## ADR-007 — Human approval before publication

**Decision:** KDP submission cannot start until the user explicitly approves the current book package.

**Reason:** Protects user control and provides a compliance/quality gate.

## ADR-008 — KDP as provider boundary

**Decision:** KDP is implemented behind a publishing provider/adapter abstraction.

**Reason:** KDP behavior is external and can change; the application must not hardwire its core domain to one automation technique.

## ADR-009 — Provenance is first-class

**Decision:** Track whether assets/content are user-created, AI-assisted, or AI-generated.

**Reason:** Amazon currently requires disclosure of AI-generated text, images, and translations when publishing through KDP and distinguishes that from AI-assisted content.

## ADR-010 — KDP-ready output is a V1 guarantee; automated submission is conditional

**Decision:** V1 must reliably produce a validated KDP-ready package. Actual browser submission automation is enabled only after the mechanism is verified against current KDP behavior and applicable terms.

**Reason:** Prevents the core product from depending on an undocumented or unstable external interface.

## ADR-011 — `QA` state means final preflight

**Decision:** The lifecycle state `QA` is the final preflight gate. Editorial, fact-checking, and consistency checks run while the book is in `EDITING`. `POST /api/books/:id/qa` runs the editorial/QA suite and writes `QualityIssue` rows. `POST /api/books/:id/preflight` runs the final readiness gate that governs the `QA → READY_FOR_REVIEW` transition.

**Reason:** The original docs used "QA" for both the editorial pass and the final gate, creating ambiguity in state transitions and endpoint semantics.

## ADR-012 — `USER_APPROVED` is terminal for prepare-only mode

**Decision:** For Mode A (prepare-only), `USER_APPROVED` is the terminal lifecycle state. `PUBLISHING`, `SUBMITTED`, and `LIVE` are only entered when a publishing job is actually started via `POST /api/books/:id/publish/start`.

**Reason:** The original state machine assumed submission always happens, which is false for prepare-only users.

## ADR-013 — Approval binds to specific artifact versions

**Decision:** Introduce an `ApprovalEvent` entity. `POST /api/books/:id/approve` writes an `ApprovalEvent` capturing `manuscript_id`, `metadata_id`, `cover_asset_id`, `epub_asset_id`, `provenance_fingerprint`, `approved_by`, `approved_at`. `POST /api/books/:id/publish/start` refuses if any current artifact pointer differs from the approval snapshot or if the provenance fingerprint no longer matches.

**Reason:** `USER_APPROVED` alone does not survive subsequent edits. Without binding, a user could approve, edit chapter 7, and still publish.

## ADR-014 — `ai_disclosure` canonical location

**Decision:** `BookMetadata.ai_disclosure` is canonical per metadata version. `BookSettings` stores only the user's default disclosure preference and does not drive publishing behavior.

**Reason:** Two sources of truth for a compliance-sensitive field risks inconsistency at submission time.

## ADR-015 — Manuscript is an immutable snapshot

**Decision:** `Manuscript.assembled_content` stores an immutable assembled copy of chapter content at time of assembly. It does not reference live chapter drafts.

**Reason:** A referenced manuscript would silently change when chapters are regenerated, violating the artifact-immutability invariant.

## ADR-016 — Separate worker process for jobs

**Decision:** Background jobs run in a dedicated `apps/worker` process using BullMQ against Redis. The Next.js web app enqueues via `packages/jobs` and does not execute long-running work inside request handlers.

**Reason:** BullMQ inside a Next.js request lifecycle is unreliable; durable jobs require a long-lived process.

**Amendment:** The queue is accessed through a `Queue` interface in `packages/jobs`, with a BullMQ/Redis production implementation (`BullMQQueue`) and an in-memory implementation (`InMemoryQueue`) for tests and single-process local dev. Orchestrators, agents, routes, and tests depend only on the `Queue` interface; only `BullMQQueue` imports `bullmq`/`ioredis`. ADR-016 governs the production implementation only.

## ADR-017 — Authentication provider

**Decision:** Use Auth.js (NextAuth v5) with the Drizzle adapter as the V1 authentication provider.

**Reason:** Established provider; avoids building auth from scratch; integrates with the Drizzle schema.

## ADR-018 — Monorepo tooling

**Decision:** pnpm workspaces with Turborepo.

**Reason:** Matches the `apps/` + `packages/` layout in `IMPLEMENTATION_PLAN.md` and keeps build/test orchestration simple.

## ADR-019 — Uniform current-artifact pointers on `BookProject`

**Decision:** `BookProject` carries uniform nullable current-artifact pointers: `current_research_project_id`, `current_plan_id`, `current_manuscript_id`, `current_metadata_id`, `current_cover_asset_id`, `current_epub_asset_id`. All point to immutable versioned records.

**Reason:** The original schema was inconsistent about which artifacts had current pointers.

## ADR-020 — Local development and test infrastructure topology

**Decision:** Production remains PostgreSQL + Redis + S3-compatible storage. Infrastructure is provisioned per-environment rather than forked in code.

- **Local development:** `docker-compose.yml` at the repository root provides `postgres:16`, `redis:7`, and `minio`. `DATABASE_URL` points at `localhost:5432`. `docker compose up -d` plus `pnpm --filter @kdone/db migrate` is the normal path. Where Docker is unavailable, a developer may instead point `DATABASE_URL` at a free hosted Postgres (for example Neon) with identical commands. No custom local database is built.
- **Tests:** use PGlite, an in-process Postgres build, via the official `drizzle-orm/pglite` driver. `packages/db/src/test-db.ts` creates a fresh in-memory instance and applies the *same* drizzle-kit generated SQL migrations that production uses. Tests exercise the real Drizzle schema and the real migrations; there are no separate test migrations and no forked schema.
- **Test queue:** `InMemoryQueue` (per the ADR-016 amendment). The E2E smoke test runs with `QUEUE_DRIVER=memory` and `NODE_ENV=test`, with `MockStorageProvider`, and requires no Redis, Postgres, or MinIO process.

**Reason:** Keeps production infrastructure decisions intact while allowing the entire lifecycle to be exercised locally and in CI with zero external services. PGlite executes real Postgres semantics (constraints, foreign keys, transactions), so test fidelity is preserved. Any genuine PGlite feature gap falls back to testcontainers for that test only and must be documented with the reason.
