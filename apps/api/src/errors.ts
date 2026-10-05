import {
  ERROR_CATALOG,
  errorCatalogEntry,
  errorDocUrl,
  type ApiErrorEnvelope,
  type ErrorClass,
  type MachineErrorCode,
} from "@reckon/contracts";

/**
 * The single typed error envelope for EVERY failure (ERROR-MODEL LAW,
 * hardened S2-001 to the Stripe-style catalog):
 *   { error: { class, code, message, param?, doc_url?, details? } }
 *
 * - `class` is one of the five stable classes (invalid_request_error /
 *   authentication_error / permission_error / rate_limit_error /
 *   api_error) — the catalog in @reckon/contracts is the single source
 *   of truth (code → class, HTTP status, doc slug).
 * - `code` is the STABLE machine code (pre-S2-001 SCREAMING_CASE codes
 *   are kept verbatim so existing clients and the SDK error mapping keep
 *   working; RATE_LIMIT_EXCEEDED is new).
 * - `param` names the offending request parameter when the error is
 *   request-shaped (Stripe-style).
 * - `doc_url` points at the catalog docs page (base is configurable;
 *   the docs host itself is S1-004's surface).
 *
 * Status mapping: 400 VALIDATION_ERROR, 401 UNAUTHENTICATED, 403
 * TENANT_MISMATCH / INSUFFICIENT_SCOPE, 404 NOT_FOUND, 422
 * IDEMPOTENCY_CONFLICT, 429 RATE_LIMIT_EXCEEDED (+ Retry-After), 501
 * NOT_WIRED, plus 500-family internal invariant codes for mis-wired
 * handlers (documented in the README).
 */
export const ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  TENANT_MISMATCH: "TENANT_MISMATCH",
  MODE_MISMATCH: "MODE_MISMATCH",
  INSUFFICIENT_SCOPE: "INSUFFICIENT_SCOPE",
  NOT_FOUND: "NOT_FOUND",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  NOT_WIRED: "NOT_WIRED",
  HANDLER_RESPONSE_INVALID: "HANDLER_RESPONSE_INVALID",
  HANDLER_TENANT_VIOLATION: "HANDLER_TENANT_VIOLATION",
  INTERNAL: "INTERNAL",
} as const satisfies Record<string, MachineErrorCode>;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** An HTTP-facing failure carrying its typed envelope fields. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  /** The stable Stripe-style class for this error (derived from the catalog). */
  readonly errorClass: ErrorClass;
  readonly details?: Record<string, unknown>;
  /** The offending request parameter (Stripe-style `param`). */
  readonly param?: string;
  /** Docs page for this error code (catalog-derived; composed at send time with the configured base). */
  readonly docSlug: string;
  /** Retry-After seconds (429 rate_limit_error only). */
  readonly retryAfterSeconds?: number;

  constructor(
    code: ErrorCode,
    statusCode: number,
    message: string,
    details?: Record<string, unknown>,
    param?: string,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = statusCode;
    this.errorClass = errorCatalogEntry(code).errorClass;
    this.details = details;
    this.param = param;
    this.docSlug = errorCatalogEntry(code).docSlug;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** A startup/configuration failure (never mapped to an HTTP response). */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** The typed error body (frozen shape from @reckon/contracts). */
export type ErrorEnvelope = ApiErrorEnvelope;

/** Docs base URL used to compose doc_url (default: the pinned contracts base; deployments may override). */
let docsBaseUrl: string | undefined;

/** Set the docs URL base for composed doc_url values (composition root call). */
export function setDocsBaseUrl(base: string | undefined): void {
  docsBaseUrl = base;
}

/**
 * Build the typed error envelope for a machine code. The class and doc
 * slug come from the catalog; `details` and `param` ride along when
 * present. Unknown codes degrade to class api_error with no doc_url.
 */
export function errorEnvelope(
  code: string,
  message: string,
  details?: Record<string, unknown>,
  param?: string,
): ErrorEnvelope {
  const entry = errorCatalogEntry(code);
  const error: ApiErrorEnvelope["error"] = {
    class: entry.errorClass,
    code,
    message,
  };
  if (param !== undefined && param !== "") error.param = param;
  if (code in ERROR_CATALOG) error.doc_url = errorDocUrl(code, docsBaseUrl);
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
