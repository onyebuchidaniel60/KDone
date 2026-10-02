import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/*
 * KDone logical schema. Mirrors docs/DATA_MODEL.md.
 *
 * Encoded rules:
 * - Artifact versions are append-only; "current" is a pointer, never an overwrite (ADR-015, ADR-019).
 * - Approval is bound to exact artifact versions (ADR-013).
 * - `BookMetadata.ai_disclosure` is canonical; `BookSettings.ai_disclosure` is a default only (ADR-014).
 *
 * Ownership integrity: every domain table that belongs to a book carries a
 * real foreign key to `book_projects`, and `book_projects.user_id` references
 * `users`. Auth.js uses text ids, so user id columns are `text` to match.
 *
 * `book_projects.current_*` are intentionally NOT foreign keys: they point at
 * versioned artifact tables declared later in this file, and append-only
 * storage means a pointer target is never deleted out from under them.
 */

export const bookStatusEnum = pgEnum("book_status", [
  "DRAFT", "RESEARCHING", "RESEARCH_READY", "PLANNING", "PLAN_READY", "WRITING",
  "EDITING", "PRODUCTION", "QA", "READY_FOR_REVIEW", "USER_APPROVED", "PUBLISHING",
  "SUBMITTED", "LIVE", "FAILED", "NEEDS_REVISION", "BLOCKED", "CANCELLED",
]);

export const jobStatusEnum = pgEnum("job_status", [
  "QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "RETRYING", "CANCELLED",
]);

export const jobTypeEnum = pgEnum("job_type", [
  "research", "planning", "writing", "editorial", "fact_check", "consistency",
  "qa", "preflight", "cover", "metadata", "epub", "publishing",
]);

export const qualitySeverityEnum = pgEnum("quality_severity", ["critical", "warning", "suggestion"]);
export const qualityIssueStatusEnum = pgEnum("quality_issue_status", ["open", "accepted", "rejected", "resolved"]);
export const provenanceMethodEnum = pgEnum("provenance_method", ["user_created", "ai_assisted", "ai_generated"]);
export const assetTypeEnum = pgEnum("asset_type", ["cover", "manuscript", "epub", "preview", "other"]);
export const publishingModeEnum = pgEnum("publishing_mode", ["prepare", "assisted", "automated"]);
export const actorTypeEnum = pgEnum("actor_type", ["user", "system", "agent"]);
export const factCheckResultEnum = pgEnum("fact_check_result", ["verified", "needs_revision", "unsupported", "conflicting"]);

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/* ------------------------------------------------- Auth.js (ADR-017) */

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
  authProviderId: text("auth_provider_id"),
  displayName: text("display_name"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
    index("accounts_user_id_idx").on(table.userId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    sessionToken: text("session_token").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);

/* ------------------------------------------------- Book project */

export const bookProjects = pgTable(
  "book_projects",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    status: bookStatusEnum("status").notNull().default("DRAFT"),
    workingTitle: text("working_title"),
    topic: text("topic"),
    targetReader: text("target_reader"),
    genre: text("genre"),
    desiredLength: integer("desired_length"),
    toneStyle: text("tone_style"),
    authorName: text("author_name"),
    publisherName: text("publisher_name"),
    // Uniform, nullable current-artifact pointers (ADR-019).
    currentResearchProjectId: uuid("current_research_project_id"),
    currentPlanId: uuid("current_plan_id"),
    currentManuscriptId: uuid("current_manuscript_id"),
    currentMetadataId: uuid("current_metadata_id"),
    currentCoverAssetId: uuid("current_cover_asset_id"),
    currentEpubAssetId: uuid("current_epub_asset_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("book_projects_user_id_idx").on(table.userId)],
);

export const bookSettings = pgTable("book_settings", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }).unique(),
  language: text("language"),
  primaryMarketplace: text("primary_marketplace"),
  rightsChoice: text("rights_choice"),
  price: text("price"),
  currency: text("currency"),
  kdpSelectPreference: boolean("kdp_select_preference"),
  drmPreference: text("drm_preference"),
  // Default preference only; never drives publishing behaviour (ADR-014).
  aiDisclosure: text("ai_disclosure").default("ai_assisted"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ------------------------------------------------- Research */

export const researchProjects = pgTable(
  "research_projects",
  {
    id: id(),
    bookProjectId: uuid("book_project_id").notNull().references(() => bookProjects.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("RUNNING"),
    researchBrief: text("research_brief"),
    marketSummary: text("market_summary"),
    readerProblemSummary: text("reader_problem_summary"),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("research_projects_book_idx").on(table.bookProjectId)],
);

export const researchSources = pgTable(
  "research_sources",
  {
    id: id(),
    researchProjectId: uuid("research_project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
    url: text("url"),
    title: text("title"),
    sourceName: text("source_name"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    accessedAt: timestamp("accessed_at", { withTimezone: true }).notNull().defaultNow(),
    sourceType: text("source_type"),
    status: text("status"),
    extractedContent: text("extracted_content"),
    createdAt: createdAt(),
  },
  (table) => [index("research_sources_project_idx").on(table.researchProjectId)],
);

export const researchFindings = pgTable(
  "research_findings",
  {
    id: id(),
    researchProjectId: uuid("research_project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").references(() => researchSources.id, { onDelete: "set null" }),
    findingType: text("finding_type"),
    statement: text("statement").notNull(),
    confidence: text("confidence"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (table) => [index("research_findings_project_idx").on(table.researchProjectId)],
);

/* ------------------------------------------------- Planning and writing */

export const bookPlans = pgTable(
  "book_plans",
  {
    id: id(),
    bookProjectId: uuid("book_project_id").notNull().references(() => bookProjects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    title: text("title"),
    subtitle: text("subtitle"),
    positioning: text("positioning"),
    bookPromise: text("book_promise"),
    targetWordCount: integer("target_word_count"),
    status: text("status").notNull().default("DRAFT"),
    outline: jsonb("outline"),
    createdAt: createdAt(),
  },
  (table) => [
    index("book_plans_book_idx").on(table.bookProjectId),
    uniqueIndex("book_plans_book_version_idx").on(table.bookProjectId, table.version),
  ],
);

export const chapters = pgTable(
  "chapters",
  {
    id: id(),
    bookProjectId: uuid("book_project_id").notNull().references(() => bookProjects.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    title: text("title"),
    objective: text("objective"),
    targetWordCount: integer("target_word_count"),
    currentDraftId: uuid("current_draft_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("chapters_book_ordinal_idx").on(table.bookProjectId, table.ordinal),
    index("chapters_book_idx").on(table.bookProjectId),
  ],
);

export const chapterDrafts = pgTable(
  "chapter_drafts",
  {
    id: id(),
    chapterId: uuid("chapter_id").notNull().references(() => chapters.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    generationSource: text("generation_source"),
    provenanceId: uuid("provenance_id").references((): AnyPgColumn => provenanceRecords.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (table) => [
    index("chapter_drafts_chapter_idx").on(table.chapterId),
    uniqueIndex("chapter_drafts_chapter_version_idx").on(table.chapterId, table.version),
  ],
);

/* ------------------------------------------------- Manuscript (ADR-015) */

export const manuscripts = pgTable(
  "manuscripts",
  {
    id: id(),
    bookProjectId: uuid("book_project_id").notNull().references(() => bookProjects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    // Immutable assembled snapshot. Never a reference to live drafts (ADR-015).
    assembledContent: jsonb("assembled_content").notNull(),
    wordCount: integer("word_count").notNull().default(0),
    status: text("status").notNull().default("ASSEMBLED"),
    createdAt: createdAt(),
  },
  (table) => [
    index("manuscripts_book_idx").on(table.bookProjectId),
    uniqueIndex("manuscripts_book_version_idx").on(table.bookProjectId, table.version),
  ],
);

/* ------------------------------------------------- Editorial / QA */

export const editorialReviews = pgTable(
  "editorial_reviews",
  {
    id: id(),
    bookProjectId: uuid("book_project_id").notNull().references(() => bookProjects.id, { onDelete: "cascade" }),
    chapterId: uuid("chapter_id").references(() => chapters.id, { onDelete: "cascade" }),
    reviewType: text("review_type").notNull(),
    status: text("status").notNull().default("COMPLETE"),
    summary: text("summary"),
    createdAt: createdAt(),
  },
  (table) => [index("editorial_reviews_book_idx").on(table.bookProjectId)],
);

export const qualityIssues = pgTable(
  "quality_issues",
  {
    id: id(),
    bookProjectId: uuid("book_project_id").notNull().references(() => bookProjects.id, { onDelete: "cascade" }),
    chapterId: uuid("chapter_id").references(() => chapters.id, { onDelete: "cascade" }),
    severity: qualitySeverityEnum("severity").notNull(),
    issueType: text("issue_type").notNull(),
    message: text("message").notNull(),
    location: text("location"),
    proposedFix: text("proposed_fix"),
    status: qualityIssueStatusEnum("status").notNull().default("open"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("quality_issues_book_idx").on(table.bookProjectId),
    index("quality_issues_book_status_idx").on(table.bookProjectId, table.status),
  ],
);

export const factChecks = pgTable(
  "fact_checks",
  {
    id: id(),
    bookProjectId: uuid("book_project_id").notNull().references(() => bookProjects.id, { onDelete: "cascade" }),
    chapterId: uuid("chapter_id").references(() => chapters.id, { onDelete: "cascade" }),
    claim: text("claim").notNull(),
    sourceId: uuid("source_id").references(() => researchSources.id, { onDelete: "set null" }),
    result: factCheckResultEnum("result").notNull(),
    rationale: text("rationale"),
    createdAt: createdAt(),
  },
  (table) => [index("fact_checks_book_idx").on(table.bookProjectId)],
);

/* ------------------------------------------------- Metadata (ADR-014) */

export const bookMetadata = pgTable(
  "book_metadata",
  {
    id: id(),
    bookProjectId: uuid("book_project_id").notNull().references(() => bookProjects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    title: text("title"),
    subtitle: text("subtitle"),
    description: text("description"),
    authorNames: jsonb("author_names"),
    publisherName: text("publisher_name"),
    keywords: jsonb("keywords"),
    categories: jsonb("categories"),
    language: text("language"),
    audience: jsonb("audience"),
    rights: text("rights"),
    price: text("price"),
    // Canonical disclosure state for this metadata version (ADR-014).
    aiDisclosure: text("ai_disclosure"),
    createdAt: createdAt(),
  },
  (table) => [
    index("book_metadata_book_idx").on(table.bookProjectId),
    uniqueIndex("book_metadata_book_version_idx").on(table.bookProjectId, table.version),
  ],
);

/* ------------------------------------------------- Jobs and agent runs */

export const generationJobs = pgTable(
  "generation_jobs",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    bookProjectId: uuid("book_project_id").notNull().references(() => bookProjects.id, { onDelete: "cascade" }),
    jobType: jobTypeEnum("job_type").notNull(),
    status: jobStatusEnum("status").notNull().default("QUEUED"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    input: jsonb("input"),
    output: jsonb("output"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    progress: integer("progress"),
    queuedAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("generation_jobs_book_idx").on(table.bookProjectId),
    index("generation_jobs_status_idx").on(table.status),
  ],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: id(),
    generationJobId: uuid("generation_job_id").notNull().references(() => generationJobs.id, { onDelete: "cascade" }),
    agentType: text("agent_type").notNull(),
    provider: text("provider"),
    model: text("model"),
    inputUnits: integer("input_units"),
    outputUnits: integer("output_units"),
    estimatedCost: text("estimated_cost"),
    durationMs: integer("duration_ms"),
    status: text("status").notNull(),
    errorDetails: jsonb("error_details"),
    createdAt: createdAt(),
  },
  (table) => [index("agent_runs_job_idx").on(table.generationJobId)],
);

/* ------------------------------------------------- Provenance and assets */

export const provenanceRecords = pgTable(
  "provenance_records",
  {
    id: id(),
    method: provenanceMethodEnum("method").notNull(),
    provider: text("provider"),
    model: text("model"),
    agentRunId: uuid("agent_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    sourceAssetId: uuid("source_asset_id").references((): AnyPgColumn => bookAssets.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (table) => [index("provenance_records_agent_run_idx").on(table.agentRunId)],
);

export const bookAssets = pgTable(
  "book_assets",
  {
    id: id(),
    bookProjectId: uuid("book_project_id").notNull().references(() => bookProjects.id, { onDelete: "cascade" }),
    assetType: assetTypeEnum("asset_type").notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    version: integer("version").notNull().default(1),
    provenanceId: uuid("provenance_id").references(() => provenanceRecords.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (table) => [
    index("book_assets_book_idx").on(table.bookProjectId),
    uniqueIndex("book_assets_book_type_version_idx").on(table.bookProjectId, table.assetType, table.version),
  ],
);

/* ------------------------------------------------- State transition log */

export const bookStateTransitions = pgTable(
  "book_state_transitions",
  {
    id: id(),
    bookProjectId: uuid("book_project_id").notNull().references(() => bookProjects.id, { onDelete: "cascade" }),
    fromState: bookStatusEnum("from_state").notNull(),
    toState: bookStatusEnum("to_state").notNull(),
    event: text("event").notNull(),
    actorType: actorTypeEnum("actor_type").notNull(),
    actorId: text("actor_id"),
    reason: text("reason"),
    jobId: uuid("job_id").references(() => generationJobs.id, { onDelete: "set null" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("book_state_transitions_book_idx").on(table.bookProjectId),
    index("book_state_transitions_job_idx").on(table.jobId),
  ],
);

/* ------------------------------------------------- Approval (ADR-013) */

export const approvalEvents = pgTable(
  "approval_events",
  {
    id: id(),
    bookProjectId: uuid("book_project_id").notNull().references(() => bookProjects.id, { onDelete: "cascade" }),
    manuscriptId: uuid("manuscript_id").notNull().references(() => manuscripts.id),
    metadataId: uuid("metadata_id").notNull().references(() => bookMetadata.id),
    coverAssetId: uuid("cover_asset_id").notNull().references(() => bookAssets.id),
    epubAssetId: uuid("epub_asset_id").notNull().references(() => bookAssets.id),
    provenanceFingerprint: text("provenance_fingerprint").notNull(),
    approvedBy: text("approved_by").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("approval_events_book_idx").on(table.bookProjectId)],
);

/* ------------------------------------------------- Publishing */

export const publishingJobs = pgTable(
  "publishing_jobs",
  {
    id: id(),
    bookProjectId: uuid("book_project_id").notNull().references(() => bookProjects.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    mode: publishingModeEnum("mode").notNull().default("prepare"),
    status: text("status").notNull().default("QUEUED"),
    externalReference: text("external_reference"),
    packageStorageKey: text("package_storage_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("publishing_jobs_book_idx").on(table.bookProjectId)],
);

export const publishingEvents = pgTable(
  "publishing_events",
  {
    id: id(),
    publishingJobId: uuid("publishing_job_id").notNull().references(() => publishingJobs.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    details: jsonb("details"),
    createdAt: createdAt(),
  },
  (table) => [index("publishing_events_job_idx").on(table.publishingJobId)],
);

/* ------------------------------------------------- Providers and audit */

export const providerAccounts = pgTable(
  "provider_accounts",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    // Reference to encrypted credentials at rest. Never plaintext (DATA_MODEL section 21).
    encryptedCredentials: text("encrypted_credentials"),
    status: text("status").notNull().default("unverified"),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("provider_accounts_user_idx").on(table.userId),
    uniqueIndex("provider_accounts_user_provider_idx").on(table.userId, table.provider),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    bookProjectId: uuid("book_project_id").references(() => bookProjects.id, { onDelete: "cascade" }),
    actorType: actorTypeEnum("actor_type").notNull(),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    metadata: jsonb("metadata"),
    createdAt: createdAt(),
  },
  (table) => [index("audit_events_book_idx").on(table.bookProjectId)],
);

export const preflightRuns = pgTable(
  "preflight_runs",
  {
    id: id(),
    bookProjectId: uuid("book_project_id").notNull().references(() => bookProjects.id, { onDelete: "cascade" }),
    passed: boolean("passed").notNull(),
    checks: jsonb("checks").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("preflight_runs_book_idx").on(table.bookProjectId)],
);

/* ------------------------------------------------- Row types */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type BookProject = typeof bookProjects.$inferSelect;
export type NewBookProject = typeof bookProjects.$inferInsert;
export type ApprovalEvent = typeof approvalEvents.$inferSelect;
export type NewApprovalEvent = typeof approvalEvents.$inferInsert;
export type QualityIssue = typeof qualityIssues.$inferSelect;
export type GenerationJob = typeof generationJobs.$inferSelect;
export type Manuscript = typeof manuscripts.$inferSelect;
export type BookMetadata = typeof bookMetadata.$inferSelect;
export type BookAsset = typeof bookAssets.$inferSelect;
export type ProvenanceRecord = typeof provenanceRecords.$inferSelect;
export type BookStateTransition = typeof bookStateTransitions.$inferSelect;
export type BookPlan = typeof bookPlans.$inferSelect;
export type Chapter = typeof chapters.$inferSelect;
export type ChapterDraft = typeof chapterDrafts.$inferSelect;
export type AgentRun = typeof agentRuns.$inferSelect;
export type ResearchProject = typeof researchProjects.$inferSelect;
export type PublishingJob = typeof publishingJobs.$inferSelect;