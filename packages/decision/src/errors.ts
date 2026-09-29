/**
 * Typed errors and results for the decision kernel.
 *
 * NO-LLM LAW (architecture-lock #6, ADR-002): the fast decisioning path
 * is pure deterministic TypeScript and correct with ZERO LLM calls. The
 * kernel never throws raw errors on invalid input — it returns typed
 * error results (`Result`), so callers can branch on error codes.
 */

/** Error codes emitted by the decision kernel. */
export type DecisionErrorCode = "INVALID_INPUT";

export interface DecisionError {
  code: DecisionErrorCode;
  message: string;
  /** Structured issue list when schema/shape validation failed. */
  issues?: { path: string; message: string }[];
}

/**
 * Result type used across the decision kernel. Errors are typed values,
 * never raw throws (negative cases must be testable without try/catch).
 */
export type Result<T, E = DecisionError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function invalidInput(
  message: string,
  issues?: { path: string; message: string }[],
): { ok: false; error: DecisionError } {
  return { ok: false, error: { code: "INVALID_INPUT", message, issues } };
}
