/** Canonical application error codes (API.md section 2). */
export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "BOOK_NOT_FOUND",
  "VALIDATION_FAILED",
  "INVALID_TRANSITION",
  "PRECONDITION_FAILED",
  "ARTIFACT_DRIFT",
  "APPROVAL_REQUIRED",
  "CRITICAL_ISSUES_OPEN",
  "PROVIDENCE_INCOMPLETE",
  "JOB_NOT_FOUND",
  "PROVIDER_ERROR",
  "RATE_LIMITED",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface AppErrorShape {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Application-level error carrying a stable machine-readable code.
 * Services throw these; the HTTP layer maps them to `AppErrorShape`.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;
  readonly status: number;

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: Record<string, unknown>; status?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.details = options.details ?? {};
    this.status = options.status ?? defaultStatusForCode(code);
  }

  toJSON(): AppErrorShape {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
      },
    };
  }
}

function defaultStatusForCode(code: ErrorCode): number {
  switch (code) {
    case "UNAUTHENTICATED":
      return 401;
    case "FORBIDDEN":
    case "BOOK_NOT_FOUND":
    case "NOT_FOUND":
      return code === "FORBIDDEN" ? 403 : 404;
    case "VALIDATION_FAILED":
      return 422;
    case "INVALID_TRANSITION":
    case "PRECONDITION_FAILED":
    case "ARTIFACT_DRIFT":
    case "APPROVAL_REQUIRED":
    case "CRITICAL_ISSUES_OPEN":
    case "PROVIDENCE_INCOMPLETE":
      return 409;
    case "RATE_LIMITED":
      return 429;
    case "PROVIDER_ERROR":
      return 502;
    case "JOB_NOT_FOUND":
      return 404;
    case "INTERNAL":
      return 500;
  }
}

export const errors = {
  unauthenticated: (message = "Authentication required") =>
    new AppError("UNAUTHENTICATED", message),
  forbidden: (message = "Not permitted") => new AppError("FORBIDDEN", message),
  bookNotFound: (bookId: string) =>
    new AppError("BOOK_NOT_FOUND", "Book not found", { details: { bookId } }),
  notFound: (entity: string, id: string) =>
    new AppError("NOT_FOUND", `${entity} not found`, { details: { entity, id } }),
  validation: (message: string, details?: Record<string, unknown>) =>
    new AppError("VALIDATION_FAILED", message, details ? { details } : {}),
  invalidTransition: (from: string, to: string, reason?: string) =>
    new AppError("INVALID_TRANSITION", `Cannot move book from ${from} to ${to}`, {
      details: { from, to, ...(reason ? { reason } : {}) },
    }),
  precondition: (message: string, details?: Record<string, unknown>) =>
    new AppError("PRECONDITION_FAILED", message, details ? { details } : {}),
  artifactDrift: (changed: string[]) =>
    new AppError("ARTIFACT_DRIFT", "Artifacts changed after approval; re-approval required", {
      details: { changed },
    }),
  approvalRequired: (message = "Explicit approval is required") =>
    new AppError("APPROVAL_REQUIRED", message),
  criticalIssuesOpen: (count: number) =>
    new AppError("CRITICAL_ISSUES_OPEN", "Critical quality issues must be resolved", {
      details: { count },
    }),
  provenanceIncomplete: (message = "Required provenance is missing") =>
    new AppError("PROVIDENCE_INCOMPLETE", message),
  jobNotFound: (jobId: string) =>
    new AppError("JOB_NOT_FOUND", "Job not found", { details: { jobId } }),
  providerError: (provider: string, cause?: unknown) =>
    new AppError("PROVIDER_ERROR", `Provider ${provider} failed`, { cause }),
  rateLimited: (message = "Too many requests") => new AppError("RATE_LIMITED", message),
} as const;