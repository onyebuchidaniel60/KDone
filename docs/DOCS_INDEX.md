# KDone — Documentation Index

| Document | Authority / purpose |
|---|---|
| `PRD.md` | Product scope, user needs, requirements, acceptance |
| `IMPLEMENTATION_PLAN.md` | One-shot V1 implementation and iteration strategy |
| `ARCHITECTURE.md` | System boundaries, agents, jobs, providers, security |
| `DATA_MODEL.md` | Logical database/domain schema and invariants |
| `API.md` | Application API contract |
| `AI_HANDOFF.md` | Current implementation state and next-work handoff |
| `DECISIONS.md` | Durable architectural/product decisions |
| `external/KDP_SOURCES.md` | Official Amazon/KDP external requirements |
| `../AGENTS.md` | OpenCode project instructions and implementation guardrails |

## Update rules

When implementation changes:

- Update the relevant contract/source-of-truth document in the same change when the contract itself changes.
- Update `AI_HANDOFF.md` after meaningful iterations.
- Record durable architectural changes in `DECISIONS.md`.
- Never make a local code convention the hidden source of truth; document important conventions in `AGENTS.md` or the relevant docs.
