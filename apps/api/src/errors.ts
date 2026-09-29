/**
 * The single typed error envelope for EVERY failure (ERROR-MODEL LAW):
 *   { error: { code, message, details? } }
 * Status mapping: 400 VALIDATION_ERROR, 401 UNAUTHENTICATED, 403
 * TENANT_MISMATCH / INSUFFICIENT_SCOPE, 404 NOT_FOUND, 409
 * IDEMPOTENCY_CONFLICT, 501 NOT_WIRED, plus 500-family internal invariant
 * codes for mis-wired handlers (documented in the README).
 */
export const ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  TENANT_MISMATCH: "TENANT_MISMATCH",
  INSUFFICIENT_SCOPE: "INSUFFICIENT_SCOPE",
  NOT_FOUND: "NOT_FOUND",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  NOT_WIRED: "NOT_WIRED",
  HANDLER_RESPONSE_INVALID: "HANDLER_RESPONSE_INVALID",
  HANDLER_TENANT_VIOLATION: "HANDLER_TENANT_VIOLATION",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** An HTTP-facing failure carrying its typed envelope fields. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, statusCode: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

/** A startup/configuration failure (never mapped to an HTTP response). */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface ErrorEnvelope {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

export function errorEnvelope(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ErrorEnvelope {
  const error: { code: string; message: string; details?: Record<string, unknown> } = { code, message };
  if (details !== undefined) error.details = details;
  return { error };
}

/**
 * NotWired marker with 501 semantics: thrown by default handler ports so
 * that routes respond 501 with `error.code === "NOT_WIRED"` and the port
 * name in `details`. Real handler implementations replace these defaults.
 */
export function notWired(port: string, operation: string): never {
  throw new ApiError(
    ERROR_CODES.NOT_WIRED,
    501,
    `NotWired: ${port}.${operation} has no mounted implementation`,
    { port, operation },
  );
}
