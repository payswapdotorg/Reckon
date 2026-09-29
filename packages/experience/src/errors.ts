/**
 * Typed errors and results for the experience kernel.
 *
 * Errors are typed values, never raw throws (testable negative cases).
 */
export type ExperienceErrorCode = "INVALID_INPUT";

export interface ExperienceError {
  code: ExperienceErrorCode;
  message: string;
  issues?: { path: string; message: string }[];
}

export type Result<T, E = ExperienceError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function invalidInput(
  message: string,
  issues?: { path: string; message: string }[],
): { ok: false; error: ExperienceError } {
  return { ok: false, error: { code: "INVALID_INPUT", message, issues } };
}
