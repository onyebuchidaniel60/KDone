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
