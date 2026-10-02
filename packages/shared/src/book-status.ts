/**
 * Book lifecycle states (PRD section 7).
 *
 * `QA` is the final preflight gate, not the editorial pass. Editorial,
 * fact-checking and consistency checks run while the book is in `EDITING`
 * (ADR-011).
 */
export const BOOK_STATUSES = [
  "DRAFT",
  "RESEARCHING",
  "RESEARCH_READY",
  "PLANNING",
  "PLAN_READY",
  "WRITING",
  "EDITING",
  "PRODUCTION",
  "QA",
  "READY_FOR_REVIEW",
  "USER_APPROVED",
  "PUBLISHING",
  "SUBMITTED",
  "LIVE",
  "FAILED",
  "NEEDS_REVISION",
  "BLOCKED",
  "CANCELLED",
] as const;

export type BookStatus = (typeof BOOK_STATUSES)[number];

/** Publishing modes. V1 ships Mode A (prepare) only. */
export const PUBLISHING_MODES = ["prepare", "assisted", "automated"] as const;
export type PublishingMode = (typeof PUBLISHING_MODES)[number];

export const JOB_STATUSES = [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "RETRYING",
  "CANCELLED",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const QUALITY_SEVERITIES = ["critical", "warning", "suggestion"] as const;
export type QualitySeverity = (typeof QUALITY_SEVERITIES)[number];

export const QUALITY_ISSUE_STATUSES = [
  "open",
  "accepted",
  "rejected",
  "resolved",
] as const;
export type QualityIssueStatus = (typeof QUALITY_ISSUE_STATUSES)[number];

export const PROVENANCE_METHODS = [
  "user_created",
  "ai_assisted",
  "ai_generated",
] as const;
export type ProvenanceMethod = (typeof PROVENANCE_METHODS)[number];

export const JOB_TYPES = [
  "research",
  "planning",
  "writing",
  "editorial",
  "fact_check",
  "consistency",
  "qa",
  "preflight",
  "cover",
  "metadata",
  "epub",
  "publishing",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const AGENT_TYPES = [
  "research",
  "planning",
  "writing",
  "editorial",
  "fact_check",
  "consistency",
  "metadata",
  "cover",
  "production",
  "qa",
] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

/** States from which the book can never move again. */
export const TERMINAL_STATUSES: readonly BookStatus[] = ["LIVE", "CANCELLED"];

/** States that indicate the pipeline stopped rather than finished. */
export const BLOCKING_STATUSES: readonly BookStatus[] = [
  "FAILED",
  "NEEDS_REVISION",
  "BLOCKED",
  "CANCELLED",
];

export function isBookStatus(value: unknown): value is BookStatus {
  return typeof value === "string" && (BOOK_STATUSES as readonly string[]).includes(value);
}