/**
 * Typed errors for @reckon/events.
 *
 * Rule: ingestion and store failures NEVER throw raw strings — every
 * failure is a discriminated, typed error carrying a machine-readable
 * `code` plus structured details (AGENTS.md completion standard:
 * negative cases must be typed errors).
 */

/** Machine-readable error codes for the events package. */
export const EVENT_ERROR_CODES = [
  "EVENT_VALIDATION_FAILED",
  "CORRECTION_TARGET_NOT_FOUND",
  "CORRECTION_CROSS_TENANT",
  "CORRECTION_EVIDENCE_CLASS_MISMATCH",
  "EVENT_ID_CONFLICT",
] as const;

export type EventErrorCode = (typeof EVENT_ERROR_CODES)[number];

/** One zod issue summary (field path + message), serializable. */
export interface ValidationIssue {
  path: string;
  message: string;
  code: string;
}

export interface EventErrorDetails {
  /** Structured context for the failure (varies by code). */
  readonly [key: string]: unknown;
}

/**
 * Base typed error for @reckon/events. Discriminated by `code`; carries
 * structured `details` (never a raw string payload).
 */
export class EventsError extends Error {
  readonly code: EventErrorCode;
  readonly details: EventErrorDetails;

  constructor(code: EventErrorCode, message: string, details: EventErrorDetails = {}) {
    super(message);
    this.name = "EventsError";
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Unknown/invalid record shape rejected by the frozen contract schema. */
export class EventValidationError extends EventsError {
  readonly issues: readonly ValidationIssue[];
  constructor(message: string, issues: readonly ValidationIssue[], input: unknown) {
    super("EVENT_VALIDATION_FAILED", message, { issueCount: issues.length, inputType: typeof input });
    this.name = "EventValidationError";
    this.issues = issues;
  }
}

/** A correction references an eventId that does not exist in this tenant. */
export class CorrectionTargetNotFoundError extends EventsError {
  constructor(tenantId: string, correctsEventId: string) {
    super(
      "CORRECTION_TARGET_NOT_FOUND",
      `correction target ${correctsEventId} not found in tenant ${tenantId}`,
      { tenantId, correctsEventId }
    );
    this.name = "CorrectionTargetNotFoundError";
  }
}

/**
 * A correction target exists in another tenant. Kept as a distinct code
 * even though the same-tenant lookup yields "not found" — callers that
 * accidentally reach across tenants get an explicit signal instead of a
 * silent empty result (tenant isolation is structural, never advisory).
 */
export class CorrectionCrossTenantError extends EventsError {
  constructor(tenantId: string, correctsEventId: string) {
    super(
      "CORRECTION_CROSS_TENANT",
      `correction target ${correctsEventId} exists but is owned by another tenant (requesting tenant ${tenantId})`,
      { tenantId, correctsEventId }
    );
    this.name = "CorrectionCrossTenantError";
  }
}

/**
 * Evidence-typing law (contracts.md #9): a correction may not link an
 * observed-class record to a research-class record — that would let one
 * evidence class flow into the other's lineage.
 */
export class CorrectionEvidenceClassMismatchError extends EventsError {
  constructor(
    tenantId: string,
    correctsEventId: string,
    targetClass: string,
    correctionClass: string
  ) {
    super(
      "CORRECTION_EVIDENCE_CLASS_MISMATCH",
      `correction of evidenceClass ${correctionClass} may not correct a record of evidenceClass ${targetClass}`,
      { tenantId, correctsEventId, targetClass, correctionClass }
    );
    this.name = "CorrectionEvidenceClassMismatchError";
  }
}

/**
 * Contracts rule #2 (IDs are immutable): reusing an eventId for a
 * different event (different idempotencyKey) is a conflict, not a
 * duplicate.
 */
export class EventIdConflictError extends EventsError {
  constructor(tenantId: string, eventId: string, existingIdempotencyKey: string) {
    super(
      "EVENT_ID_CONFLICT",
      `eventId ${eventId} already exists in tenant ${tenantId} with a different idempotency key`,
      { tenantId, eventId, existingIdempotencyKey }
    );
    this.name = "EventIdConflictError";
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
