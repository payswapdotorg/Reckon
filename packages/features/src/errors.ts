/**
 * Typed errors for @reckon/features.
 *
 * Rule: assembly failures NEVER throw raw strings — every failure is a
 * discriminated, typed error with a machine-readable `code` and
 * structured details.
 */

export const FEATURE_ERROR_CODES = [
  "FEATURE_VALIDATION_FAILED",
  "FEATURE_PREFERENCE_SNAPSHOT_INVALID",
] as const;

export type FeatureErrorCode = (typeof FEATURE_ERROR_CODES)[number];

export interface ValidationIssue {
  path: string;
  message: string;
  code: string;
}

export class FeaturesError extends Error {
  readonly code: FeatureErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: FeatureErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "FeaturesError";
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A contract record failed its frozen schema at assembly time. */
export class FeatureValidationError extends FeaturesError {
  readonly issues: readonly ValidationIssue[];
  constructor(message: string, issues: readonly ValidationIssue[], details: Record<string, unknown>) {
    super("FEATURE_VALIDATION_FAILED", message, details);
    this.name = "FeatureValidationError";
    this.issues = issues;
  }
}

/**
 * The `preferences` input did not match the structural preference
 * snapshot contract (see port.ts).
 */
export class FeaturePreferenceSnapshotError extends FeaturesError {
  readonly issues: readonly ValidationIssue[];
  constructor(message: string, issues: readonly ValidationIssue[]) {
    super("FEATURE_PREFERENCE_SNAPSHOT_INVALID", message, { issueCount: issues.length });
    this.name = "FeaturePreferenceSnapshotError";
    this.issues = issues;
  }
}

/** Narrow unknown to a shaped zod failure payload. */
export function toValidationIssues(error: unknown): ValidationIssue[] {
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
