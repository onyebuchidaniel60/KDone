# KDone — V1 Implementation Plan

## 1. Delivery strategy

KDone will be built with a **one-shot end-to-end V1** followed by iterative refinement.

The goal is not to predict every future detail. The goal is to establish a complete, observable product loop that can be exercised with a real book.

### Delivery loop

`PRD → implementation → end-to-end V1 → real book run → observed problems → prioritized backlog → fix → regression test → repeat`

## 2. Recommended implementation stack

- Web: Next.js + TypeScript + Tailwind CSS + shadcn/ui
- Server: Next.js server-side application/services for V1
- Database: PostgreSQL
- ORM: Drizzle ORM
- Authentication: Auth.js (NextAuth v5) with the Drizzle adapter (ADR-017)
- Jobs: BullMQ against Redis, executed by a dedicated `apps/worker` process (ADR-016)
- Monorepo: pnpm workspaces with Turborepo (ADR-018)
- Object storage: S3-compatible storage
- AI/search/image providers: behind interfaces

Provider choices may be changed during implementation only when the underlying interfaces and product behavior remain stable.

## 3. Repository shape

```text
kdone/
├── apps/
│   ├── web/          Next.js app: UI, API routes, server services
│   └── worker/       BullMQ worker process (ADR-016)
├── packages/
│   ├── db/           Drizzle schema, migrations, client
│   ├── ai/           LLMProvider, ResearchProvider, ImageProvider + mocks
│   ├── agents/       Research, Planning, Writing, Editorial, FactCheck,
│   │                 Metadata, Cover, Production, QA agents
│   ├── jobs/         Queue producer + worker entrypoint + job schemas
│   ├── publishing/   PublishingProvider + KDPProvider (prepare mode)
│   ├── epub/         Deterministic EPUB builder + validator
│   ├── validation/   Shared Zod schemas for API + agent I/O
│   ├── storage/      StorageProvider (S3-compatible + local mock)
│   └── shared/       State machine, types, errors, audit helpers
├── docs/
│   ├── PRD.md
│   ├── IMPLEMENTATION_PLAN.md
│   ├── ARCHITECTURE.md
│   ├── DATA_MODEL.md
│   ├── API.md
│   ├── AI_HANDOFF.md
│   ├── DECISIONS.md
│   └── external/
│       └── KDP_SOURCES.md
├── AGENTS.md
└── turbo.json, pnpm-workspace.yaml, package.json, tsconfig.base.json
```

## 4. One-shot build sequence

The coding agent may build these in order internally, but the acceptance target is the whole end-to-end product, not completion of isolated subsystems.

### A. Foundation

- repository/configuration
- application shell
- authentication
- database connection/migrations
- shared types and validation
- base UI

### B. Book domain

- project CRUD
- book state machine
- dashboard
- book workspace
- ownership/authorization

### C. Agent infrastructure

- provider interfaces
- orchestrator
- job queue
- job persistence
- agent run tracking
- usage/cost recording

### D. Research

- research jobs
- source persistence
- findings
- research UI
- research approval

### E. Planning

- book plan
- outline generation
- editing
- approval

### F. Writing

- chapter generation
- chapter versioning
- manuscript assembly
- editor UX

### G. Editorial/QA

- structural review
- copy editing checks
- fact-checking
- consistency checks
- quality issue model
- blocking rules

### H. Production

- cover pipeline
- EPUB generation
- EPUB validation
- metadata generation
- AI provenance

### I. Preview/review

- book preview
- metadata preview
- final preflight
- approval checklist

### J. Publishing boundary

- PublishingProvider interface
- KDP preparation package
- KDP-specific field mapping
- publishing job/events
- automation adapter only where validated and permitted

### K. Hardening

- retries
- resume behavior
- error states
- security review
- audit logs
- E2E smoke test

## 5. Definition of done for the one-shot V1

A fresh authenticated user can:

`Create → Research → Approve → Plan → Approve → Write → Edit → QA → Cover → Metadata → EPUB → Preview → Resolve issues → Approve → KDP prepare`

All major operations are persisted and recoverable.

## 6. Real-book validation

Immediately after the initial build, run one representative real book through the whole workflow.

Observe:

- research relevance
- outline usefulness
- writing depth/consistency
- editorial quality
- factual support
- EPUB/Kindle formatting
- cover quality
- metadata accuracy
- workflow clarity
- job reliability
- publishing preparation

Document every material issue in the backlog.

## 7. Iteration policy

### P0

Security, data loss, broken lifecycle, critical KDP/package failures, unrecoverable jobs.

### P1

Poor research, poor writing quality, serious UX friction, unreliable production.

### P2

Usability refinements, faster workflows, better editor interactions, visual polish.

### P3

Nonessential features.

Each fix should include a regression test when practical.

## 8. Non-goals during V1

Do not add billing, teams, mobile, paperback, audiobook, ads, multi-retailer publishing, complex analytics, or unrelated automation until the core lifecycle is reliable.

## 9. External-system boundary

KDP is an external system and therefore must not become a hidden assumption in the core domain.

KDone guarantees a validated KDP-ready package as a V1 capability. Actual browser submission automation is an adapter capability that must be validated against current KDP behavior and applicable terms before enabling it.
