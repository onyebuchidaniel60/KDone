# KDone — OpenCode Project Instructions

## Read first

Before making meaningful changes, read:

- `docs/PRD.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/ARCHITECTURE.md`
- `docs/AI_HANDOFF.md`

Read `docs/DATA_MODEL.md` before changing persistence/schema and `docs/API.md` before changing application contracts.

## Product rules

- KDone is an AI publishing workspace, not a generic AI writer.
- V1 must support the full end-to-end book lifecycle described in the PRD.
- Do not add out-of-scope features just because they are technically convenient.
- Do not silently change product behavior defined in the PRD.
- Keep a human approval gate before KDP publication.

## Architecture rules

- Keep external providers behind interfaces/adapters.
- Do not make direct provider calls from UI components.
- Long-running AI, research, production, and publishing work must run as durable jobs.
- Centralize book lifecycle state transitions; do not mutate status ad hoc.
- Persist intermediate outputs so failed jobs can resume without restarting the entire book.
- Do not introduce microservices unless a documented decision explicitly requires them.

## AI/agent rules

- Do not implement one giant prompt for the whole book.
- Generate and persist chapters independently, using shared book context and relevant research.
- Preserve provenance for AI-generated text, images, and translations.
- Never invent citations, credentials, endorsements, sources, or factual claims.
- Prefer structured outputs with schemas over free-form orchestration.
- Record provider, model, usage, duration, status, and estimated cost for each agent run.

## KDP rules

- Do not invent or assume an undocumented KDP publishing API.
- Treat official Amazon/KDP documentation in `docs/external/KDP_SOURCES.md` as the external source of truth.
- Do not attempt to hide or misrepresent AI-generated content.
- Do not bypass the explicit user approval step before publishing.
- Never state that internal preflight guarantees Amazon acceptance.

## Data/versioning rules

- Never destructively overwrite important generated content.
- Generated manuscript chapters, metadata, covers, and production artifacts must be versionable.
- User-authored edits must remain distinguishable from generated revisions where practical.

## Security rules

- Never hardcode secrets.
- Never log raw credentials, provider secrets, or session tokens.
- Enforce ownership/authorization on every user-scoped resource.
- Treat uploaded book assets and provider credentials as sensitive inputs.

## Testing rules

- Run relevant unit/integration tests after changes.
- Add regression tests for bugs found during iterations when practical.
- Before declaring V1 complete, run the end-to-end smoke test covering the full book lifecycle.
- Do not mark a job or book successful when critical validation has failed.

## Completion rule

A task is complete only when the implementation, tests, and documentation are consistent with the source-of-truth files.

When a discovered requirement conflicts with an existing source of truth, stop and document the conflict in `docs/DECISIONS.md` or `docs/AI_HANDOFF.md`; do not silently rewrite the product.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
