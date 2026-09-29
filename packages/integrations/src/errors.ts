/**
 * W3-005/W3-006 — typed errors and results for reference adapters.
 *
 * Adapter laws (AGENTS.md + docs/work-items/worker-3.md):
 * - Adapters are pure, total, deterministic MAPPERS. No network, no
 *   filesystem, no clocks, no host-internal persistence imports — host
 *   data enters exclusively through interface types declared in this
 *   package (host-boundary law).
 * - Errors are typed values, never raw throws (same convention as the
 *   W2 kernels), so negative cases are testable without try/catch.
 * - Fail-closed: a mapping that cannot be completed honestly returns a
 *   typed error; partial/fabricated records are never emitted.
 */

/** Error codes emitted by the reference adapters. */
export type AdapterErrorCode =
  | "INVALID_INPUT"
  | "LIMIT_EXCEEDED"
  | "UNSUPPORTED_EVIDENCE_CLASS";

export interface AdapterError {
  code: AdapterErrorCode;
  message: string;
  /** Structured issue list when shape/schema validation failed. */
  issues?: { path: string; message: string }[];
}

/** Result type used across the reference adapters. */
export type AdapterResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AdapterError };

export function invalidAdapterInput(
  message: string,
  issues?: { path: string; message: string }[],
): { ok: false; error: AdapterError } {
  return { ok: false, error: { code: "INVALID_INPUT", message, ...(issues !== undefined ? { issues } : {}) } };
}

export function limitExceeded(
  message: string,
  issues?: { path: string; message: string }[],
): { ok: false; error: AdapterError } {
  return { ok: false, error: { code: "LIMIT_EXCEEDED", message, ...(issues !== undefined ? { issues } : {}) } };
}

export function unsupportedEvidenceClass(
  message: string,
  issues?: { path: string; message: string }[],
): { ok: false; error: AdapterError } {
  return { ok: false, error: { code: "UNSUPPORTED_EVIDENCE_CLASS", message, ...(issues !== undefined ? { issues } : {}) } };
}

/** Issue list type shared by the validation helpers. */
export type IssueList = { path: string; message: string }[];
