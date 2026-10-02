# KDone — Architecture

## 1. Architectural goal

Build a modular monolith that can support the complete V1 workflow while keeping AI providers, search providers, storage, image generation, and publishing providers replaceable.

Avoid premature microservices.

## 2. High-level architecture

```text
Web UI
  │
  ▼
Application/API layer
  │
  ├── Book domain
  ├── Research domain
  ├── Writing domain
  ├── Editorial/QA domain
  ├── Production domain
  └── Publishing domain
  │
  ├── PostgreSQL
  ├── Job queue (Redis / BullMQ)
  └── Object storage
  │
  ▼
Worker process (apps/worker)
  │
  ▼
Agent orchestrator
  │
  ├── Research Agent
  ├── Planning Agent
  ├── Writing Agent
  ├── Editorial Agent
  ├── Fact Check Agent
  ├── Metadata Agent
  ├── Cover Agent
  ├── Production Agent
  └── QA Agent
  │
  ▼
Provider interfaces
```

## 3. Application boundaries

### Web

Owns presentation, interaction, optimistic UI where safe, and polling/subscription for job status. It must not own provider credentials or direct external model calls.

### Application services

Own orchestration requests, authorization, state transitions, and domain rules.

### Agents

Own reasoning/generation workflows and return structured outputs.

### Jobs

Own durable execution of long-running operations.

Jobs run in a dedicated `apps/worker` process using BullMQ against Redis (ADR-016). The Next.js web app enqueues through `packages/jobs` and must never execute long-running work inside a request handler. BullMQ inside a Next.js request lifecycle is unreliable; durable jobs require a long-lived process.

The worker is a separate process in the same repository and deployment, not a microservice boundary.

### Production

Own deterministic conversion of structured manuscript content to output artifacts.

### Publishing

Own provider-specific preparation and automation behind an interface.

## 4. Provider interfaces

At minimum:

```ts
interface LLMProvider { ... }
interface ResearchProvider { ... }
interface ImageProvider { ... }
interface StorageProvider { ... }
interface PublishingProvider { ... }
```

Real providers and mock providers implement the same interfaces.

## 5. Agent orchestration

Use a central orchestrator that:

1. validates preconditions
2. creates a durable job
3. selects the correct agent
4. records execution metadata
5. stores outputs
6. runs post-validation
7. transitions book/job state
8. records failures

No UI component should decide book state directly.

## 6. Agent design

Agents are specialized and composable.

### Research Agent

Inputs: topic, audience, goals, research depth.

Outputs: structured sources, findings, market summary, reader problems, possible angles.

### Planning Agent

Inputs: approved research, audience, target length, style.

Outputs: title/subtitle candidates, positioning, book promise, chapter outline and objectives.

### Writing Agent

Inputs: approved plan, chapter specification, relevant research, style guide, prior context.

Outputs: chapter draft and structured source/claim references where applicable.

### Editorial Agent

Outputs structured issues for structure, repetition, clarity, grammar, and readability.

### Fact Check Agent

Maps claims to sources and statuses.

### Metadata Agent

Generates editable KDP metadata and runs consistency checks.

### Cover Agent

Generates a cover brief and cover asset, preserving provenance.

### Production Agent/service

Builds deterministic EPUB/manuscript artifacts from structured content. Use an agent only where creative assistance is required.

### QA Agent/service

The `QA` lifecycle state is the final preflight gate. Editorial, fact-checking, and consistency checks are separate and run while the book is in `EDITING`, writing `QualityIssue` rows.

`POST /api/books/:id/qa` runs the editorial/QA suite. `POST /api/books/:id/preflight` runs the final readiness gate that governs the `QA → READY_FOR_REVIEW` transition. These two are deliberately distinct and must not be conflated (ADR-011).

## 7. Job model

All long-running operations use durable jobs.

Job states:

`QUEUED → RUNNING → SUCCEEDED`

Failure/recovery:

`FAILED`, `RETRYING`, `CANCELLED`

Every job stores:

- owner
- book/project context
- job type
- status
- attempts
- timestamps
- error details
- result reference

## 8. Book state machine

Allowed lifecycle:

`DRAFT → RESEARCHING → RESEARCH_READY → PLANNING → PLAN_READY → WRITING → EDITING → PRODUCTION → QA → READY_FOR_REVIEW → USER_APPROVED → PUBLISHING → SUBMITTED → LIVE`

Blocking states:

`FAILED`, `NEEDS_REVISION`, `BLOCKED`, `CANCELLED`

State transitions are validated centrally.

For prepare-only mode, `USER_APPROVED` is the terminal lifecycle state. `PUBLISHING`, `SUBMITTED`, and `LIVE` are entered only when a publishing job is actually started (ADR-012).

Entering `USER_APPROVED` writes an `ApprovalEvent` bound to the exact artifact versions reviewed. Publishing is refused if the current artifact pointers later drift from that approval (ADR-013).

## 9. Versioning

Generated content is append-oriented.

Minimum versioned resources:

- chapter drafts
- manuscript assembly
- metadata
- covers
- EPUBs

Current versions are pointers, not destructive overwrites.

## 10. Provenance

Track asset/content provenance:

- method: user-created / AI-assisted / AI-generated
- provider
- model
- agent run
- timestamp
- parent/version relation

## 11. Security architecture

- authenticated requests
- object ownership checks
- encrypted secrets
- no raw secrets in logs
- signed storage URLs where appropriate
- input/file validation
- rate limiting on expensive operations
- publishing approval authorization

## 12. Observability

Use structured logs and error tracking.

Every meaningful operation should be traceable through:

`book_id → job_id → agent_run_id → outputs/events`

## 13. Cost tracking

Persist provider usage for every agent run:

- provider
- model
- input units/tokens
- output units/tokens
- estimated cost
- duration

Cost estimates are informational, not accounting records.

## 14. KDP boundary

The core domain knows a book can be prepared for KDP. It does not depend on a particular browser automation library.

The publishing package should expose capabilities such as:

```text
prepare()
validate()
getStatus()
submit()
```

Specific UI/browser operations remain inside the KDP adapter.

Do not claim an official KDP API unless confirmed by current Amazon documentation.
