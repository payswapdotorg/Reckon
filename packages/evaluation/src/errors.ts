/**
 * Typed errors for @reckon/evaluation.
 *
 * Rule (repo-wide): evaluation failures NEVER throw raw strings — every
 * failure is a discriminated, typed error carrying a machine-readable
 * `code` plus structured details (AGENTS.md completion standard).
 */

/** Machine-readable error codes for the evaluation package. */
export const EVALUATION_ERROR_CODES = [
  "EVAL_VALIDATION_FAILED",
  "EVAL_TENANT_MISMATCH",
  "EVAL_INVALID_ARGUMENT",
  "EVAL_DIRECT_MODEL_REQUIRED",
  "EVAL_CALIBRATION_IMMUTABLE",
] as const;

export type EvaluationErrorCode = (typeof EVALUATION_ERROR_CODES)[number];

/** One zod issue summary (field path + message), serializable. */
export interface EvaluationValidationIssue {
  path: string;
  message: string;
  code: string;
}

export interface EvaluationErrorDetails {
  readonly [key: string]: unknown;
}

/** Base typed error for @reckon/evaluation, discriminated by `code`. */
export class EvaluationError extends Error {
  readonly code: EvaluationErrorCode;
  readonly details: EvaluationErrorDetails;

  constructor(code: EvaluationErrorCode, message: string, details: EvaluationErrorDetails = {}) {
    super(message);
    this.name = "EvaluationError";
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A record/shape failed validation. */
export class EvaluationValidationError extends EvaluationError {
  readonly issues: readonly EvaluationValidationIssue[];
  constructor(message: string, issues: readonly EvaluationValidationIssue[], input: unknown) {
    super("EVAL_VALIDATION_FAILED", message, { issueCount: issues.length, inputType: typeof input });
    this.name = "EvaluationValidationError";
    this.issues = issues;
  }
}

/**
 * Tenant isolation (contracts.md #5): a log record belongs to a
 * different tenant than the evaluation scope. Cross-tenant mixing of
 * learning evidence is structurally rejected.
 */
export class EvaluationTenantMismatchError extends EvaluationError {
  constructor(expectedTenant: string, recordTenant: string, recordId: string) {
    super(
      "EVAL_TENANT_MISMATCH",
      `logged record ${recordId} belongs to tenant ${recordTenant}, but the evaluation is scoped to tenant ${expectedTenant}`,
      { expectedTenant, recordTenant, recordId }
    );
    this.name = "EvaluationTenantMismatchError";
  }
}

/** Invalid estimator argument (empty logs are fine; bad options are not). */
export class EvaluationArgumentError extends EvaluationError {
  constructor(message: string, details: EvaluationErrorDetails = {}) {
    super("EVAL_INVALID_ARGUMENT", message, details);
    this.name = "EvaluationArgumentError";
  }
}

/** Doubly-robust evaluation requires a direct-method reward model. */
export class DirectMethodRequiredError extends EvaluationError {
  constructor() {
    super(
      "EVAL_DIRECT_MODEL_REQUIRED",
      "doubly-robust estimation requires a directMethod reward model"
    );
    this.name = "DirectMethodRequiredError";
  }
}

/**
 * Calibration records are append-only (worker-1 handoff: "append
 * prediction-vs-observation records; never rewrite historical
 * evidence"). Any attempt to rewrite/resize history is rejected.
 */
export class CalibrationImmutableError extends EvaluationError {
  constructor(operation: string) {
    super(
      "EVAL_CALIBRATION_IMMUTABLE",
      `calibration log is append-only: ${operation} is forbidden`,
      { operation }
    );
    this.name = "CalibrationImmutableError";
  }
}

/** Narrow unknown to a shaped zod failure payload. */
export function toEvaluationIssues(error: unknown): EvaluationValidationIssue[] {
  if (error && typeof error === "object" && Array.isArray((error as { issues?: unknown }).issues)) {
    const raw = (error as { issues: unknown[] }).issues;
    return raw.map((issue) => {
      const rec = (issue ?? {}) as Record<string, unknown>;
      const path = Array.isArray(rec.path)
        ? rec.path.map((p) => String(p)).join(".")
        : String(rec.path ?? "");
      return {
        path,
        message: String(rec.message ?? "invalid value"),
        code: String(rec.code ?? "custom"),
      };
    });
  }
  return [{ path: "", message: "record failed schema validation", code: "custom" }];
}
