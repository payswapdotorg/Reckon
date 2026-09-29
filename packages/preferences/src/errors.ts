/**
 * Typed errors for @reckon/preferences.
 *
 * Rule: store failures NEVER throw raw strings — every failure is a
 * discriminated, typed error with a machine-readable `code` and
 * structured details.
 */

export const PREFERENCE_ERROR_CODES = [
  "PREFERENCE_VALIDATION_FAILED",
  "PREFERENCE_DELTA_CONFLICT",
  "PREFERENCE_OP_INCOMPATIBLE",
] as const;

export type PreferenceErrorCode = (typeof PREFERENCE_ERROR_CODES)[number];

export interface ValidationIssue {
  path: string;
  message: string;
  code: string;
}

export class PreferencesError extends Error {
  readonly code: PreferenceErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: PreferenceErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "PreferencesError";
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Unknown/invalid delta shape rejected by the frozen contract schema. */
export class PreferenceValidationError extends PreferencesError {
  readonly issues: readonly ValidationIssue[];
  constructor(message: string, issues: readonly ValidationIssue[], input: unknown) {
    super(
      "PREFERENCE_VALIDATION_FAILED",
      message,
      { issueCount: issues.length, inputType: typeof input }
    );
    this.name = "PreferenceValidationError";
    this.issues = issues;
  }
}

/**
 * deltaId reuse with DIFFERENT content (contracts #2: IDs are
 * immutable). Re-applying the identical delta is idempotent and returns
 * the original result; only a conflicting re-use is an error.
 */
export class PreferenceDeltaConflictError extends PreferencesError {
  constructor(tenantId: string, deltaId: string) {
    super(
      "PREFERENCE_DELTA_CONFLICT",
      `deltaId ${deltaId} was already applied with different content in tenant ${tenantId}`,
      { tenantId, deltaId }
    );
    this.name = "PreferenceDeltaConflictError";
  }
}

/** An update operation cannot be applied to the current value type. */
export class PreferenceOpError extends PreferencesError {
  constructor(message: string, details: Record<string, unknown>) {
    super("PREFERENCE_OP_INCOMPATIBLE", message, details);
    this.name = "PreferenceOpError";
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
