# KDone — Data Model

This document describes the logical schema. Concrete column types, naming conventions, and migration syntax are implementation details, but must preserve these entities and invariants.

## 1. User

Fields:

- id
- auth_provider_id
- display_name
- email
- created_at
- updated_at

## 2. BookProject

Fields:

- id
- user_id
- status
- working_title
- topic
- target_reader
- genre
- desired_length
- tone_style
- author_name
- publisher_name
- current_research_project_id
- current_plan_id
- current_manuscript_id
- current_metadata_id
- current_cover_asset_id
- current_epub_asset_id
- created_at
- updated_at

Rules:

- user owns the project
- status transitions are centralized
- current artifacts reference immutable/versioned records
- current-artifact pointers are uniform and nullable across artifact kinds (ADR-019)
- every current-artifact pointer targets an immutable versioned record; advancing a pointer never mutates the previous record

## 3. BookSettings

Stores publishing preferences and generation settings that are intentionally separate from metadata visible to readers.

Examples:

- language
- primary_marketplace
- rights choice
- price
- currency
- KDP Select preference
- DRM preference
- AI disclosure default preference

Rules:

- `ai_disclosure` here is only the user's default preference applied to newly created metadata versions.
- It is not canonical and never drives publishing or submission behavior. `BookMetadata.ai_disclosure` is the single source of truth (ADR-014).

## 4. ResearchProject

Fields:

- id
- book_project_id
- status
- research_brief
- market_summary
- reader_problem_summary
- created_at
- completed_at

## 5. ResearchSource

Fields:

- id
- research_project_id
- url
- title
- source_name
- published_at nullable
- accessed_at
- source_type
- status
- extracted_content/reference
- created_at

## 6. ResearchFinding

Fields:

- id
- research_project_id
- source_id nullable
- finding_type
- statement
- confidence
- notes
- created_at

## 7. BookPlan

Fields:

- id
- book_project_id
- version
- title
- subtitle
- positioning
- book_promise
- target_word_count
- status
- created_at

## 8. Chapter

Fields:

- id
- book_project_id
- ordinal
- title
- objective
- target_word_count
- current_draft_id
- created_at
- updated_at

Unique constraint: `(book_project_id, ordinal)`.

## 9. ChapterDraft

Fields:

- id
- chapter_id
- version
- content
- generation_source
- provenance_id nullable
- created_at

## 10. Manuscript

Fields:

- id
- book_project_id
- version
- assembled_content (immutable assembled snapshot of chapter content at time of assembly)
- word_count
- status
- created_at

Rules:

- `assembled_content` stores an immutable copy of the chapter content taken at assembly time.
- It does not reference live chapter drafts. Regenerating or editing a chapter never silently changes an existing manuscript version (ADR-015).
- Assembling again creates a new manuscript version rather than overwriting this one.

## 11. EditorialReview

Fields:

- id
- book_project_id
- chapter_id nullable
- review_type
- status
- summary
- created_at

## 12. QualityIssue

Fields:

- id
- book_project_id
- chapter_id nullable
- severity: critical | warning | suggestion
- issue_type
- message
- location/reference nullable
- proposed_fix nullable
- status: open | accepted | rejected | resolved
- created_at
- updated_at

## 13. FactCheck

Fields:

- id
- book_project_id
- chapter_id nullable
- claim
- source_id nullable
- result: verified | needs_revision | unsupported | conflicting
- rationale
- created_at

## 14. BookMetadata

Fields:

- id
- book_project_id
- version
- title
- subtitle
- description
- author_names
- publisher_name nullable
- keywords
- categories
- language
- audience fields
- rights
- price
- ai_disclosure
- created_at

Rules:

- `ai_disclosure` is canonical for this metadata version and is the disclosure state used at submission time (ADR-014).
- It remains user-editable. A user edit creates a new metadata version rather than overwriting the previous version.
- The disclosure state must reflect actual AI involvement and must not be used to misrepresent AI-generated content.

## 15. BookAsset

Fields:

- id
- book_project_id
- asset_type: cover | manuscript | epub | preview | other
- storage_key
- mime_type
- size_bytes
- version
- provenance_id nullable
- created_at

## 16. ProvenanceRecord

Fields:

- id
- method: user_created | ai_assisted | ai_generated
- provider nullable
- model nullable
- agent_run_id nullable
- source_asset_id nullable
- created_at

## 17. GenerationJob

Fields:

- id
- user_id
- book_project_id
- job_type
- status
- attempts
- input_reference
- output_reference nullable
- error_code nullable
- error_message nullable
- queued_at
- started_at
- completed_at

## 18. AgentRun

Fields:

- id
- generation_job_id
- agent_type
- provider
- model
- input_units
- output_units
- estimated_cost
- duration_ms
- status
- error_details nullable
- created_at

## 19. PublishingJob

Fields:

- id
- book_project_id
- provider
- mode: prepare | assisted | automated
- status
- external_reference nullable
- created_at
- updated_at

## 20. PublishingEvent

Fields:

- id
- publishing_job_id
- event_type
- payload_reference/details
- created_at

## 21. ProviderAccount

Fields:

- id
- user_id
- provider
- encrypted_credentials_reference
- status
- last_validated_at
- created_at
- updated_at

Never store raw secrets in plaintext fields.

## 22. AuditEvent

Fields:

- id
- user_id
- book_project_id nullable
- actor_type: user | system | agent
- event_type
- entity_type
- entity_id
- metadata
- created_at

## 23. ApprovalEvent

An approval binds the human decision to the exact artifact versions reviewed, so it does not silently survive later edits (ADR-013).

Fields:

- id
- book_project_id
- manuscript_id
- metadata_id
- cover_asset_id
- epub_asset_id
- provenance_fingerprint
- approved_by
- approved_at

Rules:

- written only by explicit user approval after preflight passes
- `provenance_fingerprint` is a deterministic digest of the provenance state of the approved artifact set
- approvals are append-only and never mutated or deleted
- the current approval for a book is the most recent `ApprovalEvent` by `approved_at`
- a newer approval supersedes an older one but does not delete it

## 24. Key invariants

- Users cannot access another user's book/project/resources.
- Critical quality issues prevent `READY_FOR_REVIEW`.
- `USER_APPROVED` requires explicit approval event after the current reviewable artifact set exists.
- A publishing job cannot start without an approval event.
- Artifact versions are immutable once created.
- Every AI-generated output has provenance.
- Every long-running operation has a durable job record.
- `Manuscript.assembled_content` is an immutable snapshot taken at assembly time and never references live chapter drafts (ADR-015).
- `BookMetadata.ai_disclosure` is the canonical disclosure state for a metadata version. `BookSettings.ai_disclosure` is a default preference only and never drives publishing behavior (ADR-014).
- A publishing job requires a current `ApprovalEvent` whose `manuscript_id`, `metadata_id`, `cover_asset_id`, and `epub_asset_id` equal the current artifact pointers on `BookProject`, and whose `provenance_fingerprint` still matches the current provenance state (ADR-013).
- Publishing is refused when any current artifact pointer has drifted from the approval snapshot. Re-approval is required after manuscript, cover, metadata, or EPUB changes.
- For prepare-only mode, `USER_APPROVED` is terminal. `PUBLISHING`, `SUBMITTED`, and `LIVE` are entered only when a publishing job is actually started (ADR-012).
