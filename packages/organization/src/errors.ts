/**
 * Typed errors and results for the Agent Organization runtime.
 *
 * All errors are typed values — never raw throws (negative cases are
 * testable without try/catch). The organization kernel returns typed
 * `Result` values for every fallible operation.
 */
export type OrganizationErrorCode = "INVALID_INPUT";

export interface OrganizationError {
  code: OrganizationErrorCode;
  message: string;
  /** Structured issue list when shape validation failed. */
  issues?: { path: string; message: string }[];
}

export type Result<T, E = OrganizationError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function invalidInput(
  message: string,
  issues?: { path: string; message: string }[],
): { ok: false; error: OrganizationError } {
  return { ok: false, error: { code: "INVALID_INPUT", message, issues } };
}
