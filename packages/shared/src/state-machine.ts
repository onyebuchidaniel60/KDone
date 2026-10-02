import { errors } from "./errors.js";
import type { BookStatus, PublishingMode } from "./book-status.js";

/**
 * Lifecycle events. Transitions are expressed as `status + event -> status`
 * so that intent is explicit and validated centrally (AGENTS.md: centralize
 * book lifecycle state transitions; never mutate status ad hoc).
 */
export const BOOK_EVENTS = [
  "RESEARCH_START",
  "RESEARCH_COMPLETE",
  "PLAN_START",
  "PLAN_COMPLETE",
  "WRITE_START",
  "EDITING_START",
  "PRODUCTION_START",
  "QA_START",
  "PREFLIGHT_PASSED",
  "PREFLIGHT_NEEDS_REVISION",
  "APPROVE",
  "PUBLISH_START",
  "SUBMIT_SUCCEEDED",
  "GO_LIVE",
  "JOB_FAILED",
  "BLOCK",
  "RESUME_FROM_REVISION",
  "RESUME_AFTER_FAILURE",
  "UNBLOCK",
  "CANCEL",
] as const;

export type BookEvent = (typeof BOOK_EVENTS)[number];

type TransitionTable = {
  readonly [K in BookStatus]?: Partial<Record<BookEvent, BookStatus>>;
};

/**
 * The single source of truth for the book lifecycle.
 *
 * ADR-011: `PREFLIGHT_PASSED` (from `QA`) is driven by the final preflight
 * gate (`POST /api/books/:id/preflight`). Editorial/QA suite results never
 * move the book out of `QA` directly.
 *
 * ADR-012: `PUBLISH_START` leaves `USER_APPROVED` only when a real publishing
 * job is started. In prepare-only mode `USER_APPROVED` is terminal.
 */
const TRANSITIONS: TransitionTable = {
  DRAFT: { RESEARCH_START: "RESEARCHING", CANCEL: "CANCELLED" },

  RESEARCHING: {
    RESEARCH_COMPLETE: "RESEARCH_READY",
    JOB_FAILED: "FAILED",
    CANCEL: "CANCELLED",
  },

  RESEARCH_READY: { PLAN_START: "PLANNING", CANCEL: "CANCELLED" },

  PLANNING: {
    PLAN_COMPLETE: "PLAN_READY",
    JOB_FAILED: "FAILED",
    CANCEL: "CANCELLED",
  },

  PLAN_READY: { WRITE_START: "WRITING", CANCEL: "CANCELLED" },

  WRITING: {
    EDITING_START: "EDITING",
    JOB_FAILED: "FAILED",
    CANCEL: "CANCELLED",
  },

  // Editorial, fact-check and consistency work happens here (ADR-011).
  EDITING: {
    PRODUCTION_START: "PRODUCTION",
    JOB_FAILED: "FAILED",
    CANCEL: "CANCELLED",
  },

  PRODUCTION: {
    QA_START: "QA",
    JOB_FAILED: "FAILED",
    CANCEL: "CANCELLED",
  },

  QA: {
    // Only the final preflight gate may promote the book past QA.
    PREFLIGHT_PASSED: "READY_FOR_REVIEW",
    PREFLIGHT_NEEDS_REVISION: "NEEDS_REVISION",
    BLOCK: "BLOCKED",
    JOB_FAILED: "FAILED",
    CANCEL: "CANCELLED",
  },

  READY_FOR_REVIEW: {
    APPROVE: "USER_APPROVED",
    PREFLIGHT_NEEDS_REVISION: "NEEDS_REVISION",
    CANCEL: "CANCELLED",
  },

  // USER_APPROVED is terminal in prepare-only mode (ADR-012).
  USER_APPROVED: { PUBLISH_START: "PUBLISHING", CANCEL: "CANCELLED" },

  PUBLISHING: {
    SUBMIT_SUCCEEDED: "SUBMITTED",
    JOB_FAILED: "FAILED",
    CANCEL: "CANCELLED",
  },

  SUBMITTED: { GO_LIVE: "LIVE", JOB_FAILED: "FAILED" },

  FAILED: {
    RESUME_AFTER_FAILURE: "RESEARCHING",
    JOB_FAILED: "FAILED",
    CANCEL: "CANCELLED",
  },

  NEEDS_REVISION: {
    RESUME_FROM_REVISION: "EDITING",
    JOB_FAILED: "FAILED",
    CANCEL: "CANCELLED",
  },

  BLOCKED: {
    UNBLOCK: "EDITING",
    CANCEL: "CANCELLED",
  },

  LIVE: {},
  CANCELLED: {},
};

export interface TransitionContext {
  /** Publishing mode of the target job. Required for PUBLISH_START. */
  publishingMode?: PublishingMode;
}

export function allowedEvents(from: BookStatus): BookEvent[] {
  const table = TRANSITIONS[from] ?? {};
  return Object.keys(table) as BookEvent[];
}

export function isTransitionAllowed(
  from: BookStatus,
  event: BookEvent,
  context: TransitionContext = {},
): boolean {
  return resolveNextStatus(from, event, context) !== null;
}

function resolveNextStatus(
  from: BookStatus,
  event: BookEvent,
  context: TransitionContext,
): BookStatus | null {
  const next = TRANSITIONS[from]?.[event];
  if (!next) return null;

  // ADR-012: prepare-only never enters PUBLISHING. USER_APPROVED is terminal.
  if (from === "USER_APPROVED" && event === "PUBLISH_START" && context.publishingMode === "prepare") {
    return null;
  }

  return next;
}

/**
 * Returns the next status, or throws `INVALID_TRANSITION`.
 * Use this everywhere a book status changes.
 */
export function nextStatus(
  from: BookStatus,
  event: BookEvent,
  context: TransitionContext = {},
): BookStatus {
  const next = resolveNextStatus(from, event, context);

  if (!next) {
    // ADR-012 deserves an explicit, actionable message.
    if (from === "USER_APPROVED" && event === "PUBLISH_START" && context.publishingMode === "prepare") {
      throw errors.invalidTransition(
        from,
        "PUBLISHING",
        "Prepare-only mode: USER_APPROVED is terminal and no publishing job is started",
      );
    }
    throw errors.invalidTransition(from, event, `event ${event} is not allowed from ${from}`);
  }

  return next;
}

export type ActorType = "user" | "system" | "agent";

/** Row shape for the append-only state transition log. */
export interface StateTransitionRecord {
  bookProjectId: string;
  fromState: BookStatus;
  toState: BookStatus;
  event: BookEvent;
  actorType: ActorType;
  actorId: string | null;
  reason: string | null;
  jobId: string | null;
  occurredAt: Date;
}

export function buildTransitionRecord(input: {
  bookProjectId: string;
  from: BookStatus;
  event: BookEvent;
  actorType: ActorType;
  actorId?: string | null;
  reason?: string | null;
  jobId?: string | null;
  context?: TransitionContext;
  occurredAt?: Date;
}): StateTransitionRecord {
  const to = nextStatus(input.from, input.event, input.context ?? {});
  return {
    bookProjectId: input.bookProjectId,
    fromState: input.from,
    toState: to,
    event: input.event,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    reason: input.reason ?? null,
    jobId: input.jobId ?? null,
    occurredAt: input.occurredAt ?? new Date(),
  };
}