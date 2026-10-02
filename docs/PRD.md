# KDone — Product Requirements Document

## 1. Product

**Name:** KDone

**Positioning:** AI publishing workspace for creating and preparing high-quality ebooks for Amazon KDP.

**Core promise:** Turn a book idea into a researched, structured, edited, production-ready Kindle book through one observable workflow, while keeping the author in control of final publication.

## 2. Problem

Independent publishers and subject-matter experts must coordinate research, outlining, writing, editing, fact checking, formatting, cover creation, metadata, previewing, and KDP setup across separate tools.

KDone consolidates that workflow into a single project-based system.

## 3. Primary users

### Independent publisher

Wants to build a catalogue efficiently without manually coordinating every production step.

### Subject-matter expert

Knows the subject but wants help turning expertise into a polished book.

### Content entrepreneur

Builds multiple books around one niche or reader problem.

## 4. Product principles

1. **AI does the work; the user owns the decision.**
2. **Quality over volume.**
3. **Research and provenance matter.**
4. **Every long-running operation is resumable and observable.**
5. **External publishing requirements are treated as constraints, not assumptions.**
6. **The first version should be end-to-end usable, then improved through real-world iteration.**

## 5. MVP goal

A user can:

1. Create a book project.
2. Define the topic, audience, genre, desired length, and style.
3. Generate research and review sources/findings.
4. Generate a book concept and chapter outline.
5. Approve/edit the outline.
6. Generate the manuscript chapter by chapter.
7. Edit the manuscript.
8. Run editorial, fact-checking, consistency, and quality checks.
9. Generate/upload a cover.
10. Generate/edit KDP metadata.
11. Produce a Kindle-ready EPUB.
12. Preview the assembled book.
13. Resolve critical issues.
14. Approve the final package.
15. Prepare the title for KDP submission.
16. Use a KDP publishing adapter when a validated/compliant automation path is available.

## 6. MVP scope

### Included

- Authentication
- Book project dashboard
- Book workspace
- Research workflow
- Source collection and findings
- Outline/planning workflow
- Chapter-by-chapter manuscript generation
- Versioned manuscript editing
- Editorial checks
- Fact checks
- Consistency/quality checks
- Cover generation/upload
- Metadata generation/editing
- AI content provenance tracking
- EPUB generation and validation
- Book preview
- KDP preparation
- Publishing job tracking
- Audit log
- Provider abstractions
- Usage/cost tracking

### Explicitly out of V1

- Paperback publishing
- Hardcover publishing
- Audiobook generation
- Multi-user collaboration
- Team/workspace billing
- Automated ad management
- Amazon Ads integration
- Automatic book-series generation
- Fully autonomous publication without approval
- Multi-retailer distribution
- Mobile application
- Public book marketplace
- Advanced sales analytics

## 7. Core workflow

`DRAFT → RESEARCHING → RESEARCH_READY → PLANNING → PLAN_READY → WRITING → EDITING → PRODUCTION → QA → READY_FOR_REVIEW → USER_APPROVED → PUBLISHING → SUBMITTED → LIVE`

Failure/recovery states include `FAILED`, `NEEDS_REVISION`, `BLOCKED`, and `CANCELLED`.

## 8. Functional requirements

### 8.1 Book creation

User can create a project with:

- working title or book idea
- topic
- target reader
- genre/category
- desired length
- tone/style
- author/contributor information
- publishing preferences

### 8.2 Research

The research workflow produces:

- market/context summary
- reader problems/questions
- competitive topic/book research
- relevant sources
- research findings
- potential positioning/angles

Every retained source should preserve at least URL, title, publisher/source name when available, date accessed, and source status.

### 8.3 Planning

The planning workflow produces:

- title candidates
- subtitle
- reader/problem statement
- book promise
- target length
- chapter outline
- chapter objectives

User can edit and approve the plan.

### 8.4 Writing

Writing is chapter-oriented, not one-shot book generation.

Each chapter receives:

- approved book plan
- chapter objective
- relevant research
- style guidance
- relevant prior-chapter summaries/context

The system persists every meaningful generated version.

### 8.5 Editing and QA

Checks include:

- structure
- grammar/readability
- repetition
- contradictions
- unsupported factual claims
- citation/source support
- chapter completeness
- metadata consistency
- EPUB validity
- common Kindle formatting problems

Critical issues block the ready-for-review state.

### 8.6 Production

The system produces:

- front matter
- table of contents
- chapter content
- back matter where configured
- cover asset
- EPUB
- metadata package

### 8.7 Metadata

Metadata fields include, as applicable:

- title
- subtitle
- author/contributors
- description
- keywords
- categories
- language
- audience fields
- publishing preferences
- AI-generated content disclosure state
- rights
- price

All important metadata must remain user-editable.

### 8.8 Provenance

KDone tracks whether generated assets/content were:

- AI-generated
- AI-assisted
- user-created
- user-edited

The system must not attempt to conceal AI-generated content that must be disclosed to KDP.

### 8.9 Human approval

Publishing requires explicit user confirmation after manuscript, cover, metadata, provenance/disclosure state, and final QA have been reviewed.

## 9. Non-functional requirements

- Secure multi-user data isolation
- Durable jobs
- Retry/resume support
- Versioned generated content
- Structured logs
- Auditable publishing actions
- Provider abstraction
- Reasonable local development with mock providers
- Automated tests for core lifecycle and state transitions
- No raw provider secrets in logs or source

## 10. Success criteria for V1

V1 is successful when a real user can take one book idea through the complete workflow to a validated, reviewable KDP package without manually stitching together unrelated tools.

The first real-book run is expected to uncover quality and UX issues. Those become the iterative backlog rather than reasons to postpone V1.

## 11. Agile iteration rule

After V1, work is prioritized by observed impact:

- **P0:** blocked/unsafe/data-loss/publishing-critical issues
- **P1:** major quality or workflow failures
- **P2:** UX and productivity improvements
- **P3:** enhancements and future capabilities

No broad feature expansion while P0 issues remain unresolved.
