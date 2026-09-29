/**
 * Typed errors for @reckon/observability.
 *
 * Rule: the recorder never throws raw strings — invalid inputs produce
 * discriminated typed errors; sink failures produce typed sink errors.
 */

export const OBSERVABILITY_ERROR_CODES = [
  "OBSERVABILITY_INPUT_INVALID",
  "OBSERVABILITY_SINK_FAILED",
  "OBSERVABILITY_RECORD_CORRUPT",
] as const;

export type ObservabilityErrorCode = (typeof OBSERVABILITY_ERROR_CODES)[number];

export interface ObservabilityValidationIssue {
  readonly path: string;
  readonly message: string;
  readonly code: string;
}

export class ObservabilityError extends Error {
  readonly code: ObservabilityErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ObservabilityErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ObservabilityError";
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A contract input failed its frozen schema validation. */
export class ObservabilityInputError extends ObservabilityError {
  readonly issues: readonly ObservabilityValidationIssue[];
  constructor(message: string, issues: readonly ObservabilityValidationIssue[]) {
    super("OBSERVABILITY_INPUT_INVALID", message, { issueCount: issues.length });
    this.name = "ObservabilityInputError";
    this.issues = issues;
  }
}

/** The sink rejected/failed the append (records must never be lost silently). */
export class ObservabilitySinkError extends ObservabilityError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("OBSERVABILITY_SINK_FAILED", message, details);
    this.name = "ObservabilitySinkError";
  }
}

/** A record read back failed digest/shape verification. */
export class ObservabilityRecordCorruptError extends ObservabilityError {
  readonly lineNumber?: number;
  readonly path?: string;
  constructor(message: string, details: { lineNumber?: number; path?: string } = {}) {
    super("OBSERVABILITY_RECORD_CORRUPT", message, details);
    this.name = "ObservabilityRecordCorruptError";
    this.lineNumber = details.lineNumber;
    this.path = details.path;
  }
}

/** Narrow a zod-shaped failure payload into serializable issues. */
export function toObservabilityIssues(error: unknown): ObservabilityValidationIssue[] {
  if (error && typeof error === "object" && Array.isArray((error as { issues?: unknown }).issues)) {
    const raw = (error as { issues: unknown[] }).issues;
    return raw.map((issue) => {
      const rec = (issue ?? {}) as Record<string, unknown>;
      const path = Array.isArray(rec.path)
        ? rec.path.map((p) => String(p)).join(".")
        : String(rec.path ?? "");
      return {
        path,
        message: typeof rec.message === "string" && rec.message.length > 0 ? rec.message : "invalid value",
        code: String(rec.code ?? "custom"),
      };
    });
  }
  return [{ path: "", message: "value failed schema validation", code: "custom" }];
}
