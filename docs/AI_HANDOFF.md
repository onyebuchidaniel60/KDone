# KDone — AI Handoff

## Purpose

This document is the current-state handoff for OpenCode and future coding sessions. It should describe **where the implementation actually is**, not re-state the product requirements.

## Current phase

**Planning / source-of-truth preparation**

## Current product state

- Product name: KDone
- PRD defined: yes
- One-shot V1 strategy: yes
- Implementation plan defined: yes
- OpenCode-native project instructions: yes
- KDP external source registry: yes
- Codebase implementation: not started in this handoff package

## Agreed development model

Build one end-to-end V1, run a real book through it, capture real failures, then iterate based on a prioritized backlog.

## Current implementation target

The first implementation should cover:

`Create → Research → Approve → Plan → Approve → Write → Edit → QA → Cover → Metadata → EPUB → Preview → Approve → KDP prepare`

## Known external dependency

KDP is the external publishing system. The core app must not assume a public, general-purpose KDP book-publishing API. KDP preparation is a guaranteed V1 capability; actual submission automation is an adapter that must be validated before activation.

## Current blockers

None at the documentation stage.

## First implementation tasks

1. Scaffold repository and application.
2. Implement database/domain model.
3. Implement authentication and ownership.
4. Implement book dashboard/workspace.
5. Implement durable jobs and provider interfaces.
6. Implement research/planning/writing workflow.
7. Implement editorial/QA.
8. Implement production/metadata/provenance.
9. Implement preview and approval.
10. Implement KDP preparation boundary.
11. Run full E2E test.
12. Run one real book and create the iteration backlog.

## Iteration log

Add entries here after each meaningful iteration:

```text
### Iteration YYYY-MM-DD
Goal:
Observed problems:
Fixes shipped:
Regression tests added:
Known remaining issues:
Next priority:
```
