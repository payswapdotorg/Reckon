/**
 * Typed errors for @reckon/context.
 *
 * Rule: store failures NEVER throw raw strings — every failure is a
 * discriminated, typed error with a machine-readable `code` and
 * structured details.
 */

export const CONTEXT_ERROR_CODES = ["CONTEXT_VALIDATION_FAILED"] as const;

export type ContextErrorCode = (typeof CONTEXT_ERROR_CODES)[number];

export interface ValidationIssue {
  path: string;
  message: string;
  code: string;
}

export class ContextsError extends Error {
  readonly code: ContextErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ContextErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ContextsError";
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Unknown/invalid snapshot shape rejected by the frozen contract schema. */
export class ContextValidationError extends ContextsError {
  readonly issues: readonly ValidationIssue[];
  constructor(message: string, issues: readonly ValidationIssue[], input: unknown) {
    super("CONTEXT_VALIDATION_FAILED", message, { issueCount: issues.length, inputType: typeof input });
    this.name = "ContextValidationError";
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
