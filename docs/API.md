# KDone — API Contract

This is the application-level API contract for V1. Exact framework implementation is not prescribed, but behavior and validation must match this document.

## 1. Conventions

- JSON requests/responses unless a file upload is required.
- Authenticated routes require the active user session.
- Resource ownership is checked server-side.
- Validation failures return structured errors.
- Long-running operations return a job reference rather than holding the HTTP request open.

## 2. Standard error shape

```json
{
  "error": {
    "code": "BOOK_NOT_FOUND",
    "message": "Book not found",
    "details": {}
  }
}
```

## 3. Books

### Create book

`POST /api/books`

Request:

```json
{
  "workingTitle": "",
  "topic": "",
  "targetReader": "",
  "genre": "",
  "desiredLength": 70000,
  "toneStyle": "",
  "authorName": ""
}
```

Returns the created project in `DRAFT`.

### List books

`GET /api/books`

Returns only the authenticated user's projects.

### Get book

`GET /api/books/:bookId`

### Update book

`PATCH /api/books/:bookId`

### Delete/archive book

`DELETE /api/books/:bookId`

Implementation may use soft deletion/archive if needed for auditability.

## 4. Research

### Start research

`POST /api/books/:bookId/research`

Creates a durable research job.

### Get research

`GET /api/books/:bookId/research`

### Approve research

`POST /api/books/:bookId/research/approve`

Only valid when research is complete.

## 5. Planning

### Generate plan

`POST /api/books/:bookId/plan`

Creates a planning job.

### Get plan

`GET /api/books/:bookId/plan`

Returns the current plan version pointed to by `BookProject.current_plan_id`.

### Update plan

`PATCH /api/books/:bookId/plan`

User edits are preserved as a new plan version.

### Approve plan

`POST /api/books/:bookId/plan/approve`

## 6. Writing

### Start manuscript generation

`POST /api/books/:bookId/generate`

Creates chapter generation jobs or an orchestrated generation job.

### Get jobs

`GET /api/books/:bookId/jobs`

### Get chapter

`GET /api/chapters/:chapterId`

### Update chapter

`PATCH /api/chapters/:chapterId`

### Regenerate chapter

`POST /api/chapters/:chapterId/regenerate`

The existing version remains immutable.

## 7. Editorial/QA

Editorial, fact-checking, and consistency checks run while the book is in `EDITING`. The `QA` lifecycle state is the final preflight gate, not the editorial pass (ADR-011).

### Run QA suite

`POST /api/books/:bookId/qa`

Runs the editorial/QA suite and writes `QualityIssue` rows. Requires the book to be in `EDITING`. This endpoint does not perform the final readiness gate.

Returns a job reference. Critical open issues block the `QA → READY_FOR_REVIEW` transition.

### Get issues

`GET /api/books/:bookId/issues`

### Update issue

`PATCH /api/issues/:issueId`

## 8. Production

### Generate cover

`POST /api/books/:bookId/cover`

Creates a durable cover job. The resulting `BookAsset` is versioned and carries a `ProvenanceRecord`. On success, `BookProject.current_cover_asset_id` advances to the new version.

### Generate EPUB

`POST /api/books/:bookId/epub`

Returns a job reference.

The EPUB is built deterministically from the current manuscript snapshot. On success, `BookProject.current_epub_asset_id` advances.

### List assets

`GET /api/books/:bookId/assets`

## 9. Metadata

### Generate metadata

`POST /api/books/:bookId/metadata/generate`

### Update metadata

`PATCH /api/books/:bookId/metadata`

## 10. Preview

### Get preview manifest

`GET /api/books/:bookId/preview`

Returns the current manuscript snapshot, cover, metadata, and open quality issues for the current artifact set.

### Run final preflight

`POST /api/books/:bookId/preflight`

Runs the final readiness gate that governs the `QA → READY_FOR_REVIEW` transition (ADR-011). Requires the book to be in `QA`.

Verifies that a manuscript, cover, metadata, and EPUB exist; that no critical open quality issues remain; that required provenance exists for every generated artifact; and that the disclosure state is present. Returns the check results and whether the gate passed.

## 11. Approval

### Approve book for publishing

`POST /api/books/:bookId/approve`

Server must verify:

- current manuscript exists
- current cover exists
- current metadata exists
- current EPUB exists
- required provenance/disclosure state exists
- no critical open issues
- final preflight has passed
- user is authorized

On success the server writes an `ApprovalEvent` bound to the exact artifact versions reviewed (ADR-013), and returns it:

```json
{
  "approval": {
    "id": "...",
    "bookProjectId": "...",
    "manuscriptId": "...",
    "metadataId": "...",
    "coverAssetId": "...",
    "epubAssetId": "...",
    "provenanceFingerprint": "...",
    "approvedBy": "...",
    "approvedAt": "..."
  }
}
```

The book transitions to `USER_APPROVED`. For prepare-only mode this is the terminal state (ADR-012).

## 12. Publishing

### Prepare KDP package

`POST /api/books/:bookId/publish/prepare`

### Start publishing job

`POST /api/books/:bookId/publish/start`

Server must reject unless the book is `USER_APPROVED`.

Server must additionally refuse when the current approval no longer matches the current artifact set (ADR-013). It re-reads the most recent `ApprovalEvent` and compares it against `BookProject.current_manuscript_id`, `current_metadata_id`, `current_cover_asset_id`, `current_epub_asset_id`, and the recomputed `provenance_fingerprint`. Any difference is refused with `ARTIFACT_DRIFT` and the user must re-approve. This prevents a user from approving, editing a chapter, and still publishing the old approval.

```json
{
  "error": {
    "code": "ARTIFACT_DRIFT",
    "message": "Artifacts changed after approval; re-approval required",
    "details": {
      "changed": ["manuscriptId"]
    }
  }
}
```

In prepare-only mode this endpoint performs preparation only. `PUBLISHING`, `SUBMITTED`, and `LIVE` are entered only when a publishing job is actually started (ADR-012).

### Get publishing status

`GET /api/books/:bookId/publish/status`

## 13. Settings

### Get provider accounts

`GET /api/settings/providers`

Returns the authenticated user's configured provider accounts. Raw credentials are never returned.

### Update provider account

`PATCH /api/settings/providers`

Creates or updates a provider account for the authenticated user. Credentials are write-only, encrypted at rest, and never returned in responses or logged. Status is `unverified` until a provider reports a successful call.

### Get publishing settings

`GET /api/settings/publishing`

Returns publishing preferences, including the AI disclosure default preference. This default seeds new `BookMetadata` versions only; it is not canonical and never drives submission behavior (ADR-014).

### Update publishing settings

`PATCH /api/settings/publishing`

Updates publishing preferences. Does not change the canonical disclosure state on existing metadata versions.

## 14. Job status

All long-running operations expose:

```json
{
  "jobId": "...",
  "status": "QUEUED|RUNNING|SUCCEEDED|FAILED|RETRYING|CANCELLED",
  "progress": 0,
  "message": "..."
}
```

`progress` is informational and may be null when unavailable.
