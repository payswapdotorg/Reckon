/**
 * Typed errors for @reckon/sdk.
 *
 * SDK ERROR LAW: every failure surfaces as a discriminated `ReckonSdkError`
 * subclass carrying a machine-readable `code` — the SDK NEVER leaks raw
 * fetch/network failures, non-envelope bodies, or unvalidated payloads to
 * caller catch blocks (worker-3 handoff: "typed errors, never raw fetch
 * failures").
 *
 * The `code` values mirror the frozen API error model (apps/api ERROR_CODES)
 * for server-originated failures, plus `SDK_*` codes for client-side
 * failures that never reached the wire.
 */

/** Client-side failure codes (request never reached the server). */
export const SDK_CLIENT_ERROR_CODES = [
  "SDK_CONFIG_ERROR",
  "SDK_REQUEST_INVALID",
  "SDK_TRANSPORT_ERROR",
  "SDK_RESPONSE_CONTRACT_VIOLATION",
  "SDK_UNEXPECTED_ERROR_SHAPE",
] as const;

/** Server-originated codes — mirror of the frozen API error envelope model. */
export const SDK_SERVER_ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "TENANT_MISMATCH",
  "MODE_MISMATCH",
  "INSUFFICIENT_SCOPE",
  "NOT_FOUND",
  "IDEMPOTENCY_CONFLICT",
  // TL6-001: the typed 409 for a signup whose email already belongs to an
  // account (mirrors the additive frozen-catalog entry).
  "EMAIL_TAKEN",
  "RATE_LIMIT_EXCEEDED",
  "NOT_WIRED",
  "HANDLER_RESPONSE_INVALID",
  "HANDLER_TENANT_VIOLATION",
  "INTERNAL",
] as const;

export type SdkClientErrorCode = (typeof SDK_CLIENT_ERROR_CODES)[number];
export type SdkServerErrorCode = (typeof SDK_SERVER_ERROR_CODES)[number];
export type SdkErrorCode = SdkClientErrorCode | SdkServerErrorCode;

/** One schema-validation issue (field path + message), serializable. */
export interface SdkValidationIssue {
  readonly path: string;
  readonly message: string;
  readonly code: string;
}

export interface ReckonSdkErrorOptions {
  /** HTTP status code when the server responded (absent client-side). */
  readonly statusCode?: number;
  /** Error-envelope `details` payload from the server, if any. */
  readonly details?: unknown;
  /** Schema issues when the failure is a validation/contract failure. */
  readonly issues?: readonly SdkValidationIssue[];
  /** Underlying transport cause, kept for diagnostics (never stringified into message). */
  readonly cause?: unknown;
  /** S2-001: the error envelope's stable class (`invalid_request_error`, …) when the server responded. */
  readonly errorClass?: string;
  /** S2-001: the offending request parameter the server named (`param`). */
  readonly param?: string;
  /** S2-001: the catalog docs URL for this error code (`doc_url`). */
  readonly docUrl?: string;
  /** S2-003: the serving key's mode, from the X-Reckon-Mode response header (`live` | `test`). */
  readonly mode?: "live" | "test";
  /** S2-001: Retry-After seconds (429 rate_limit_error only). */
  readonly retryAfterSeconds?: number;
  /** S2-001: true when the response was an idempotency REPLAY (Idempotent-Replayed: true). */
  readonly idempotentReplayed?: boolean;
}

/** Base typed error for every SDK failure. Discriminated by `code`. */
export class ReckonSdkError extends Error {
  readonly code: SdkErrorCode;
  readonly statusCode?: number;
  readonly details?: unknown;
  readonly issues?: readonly SdkValidationIssue[];
  /** S2-001: stable error class from the wire envelope, when present. */
  readonly errorClass?: string;
  /** S2-001: the offending request parameter named by the server. */
  readonly param?: string;
  /** S2-001: catalog docs URL for this error code. */
  readonly docUrl?: string;
  /** S2-003: mode of the key that served the failing request (X-Reckon-Mode). */
  readonly mode?: "live" | "test";
  /** S2-001: Retry-After seconds on 429s. */
  readonly retryAfterSeconds?: number;
  /** S2-001: true when the failure response was itself an idempotent replay. */
  readonly idempotentReplayed?: boolean;

  constructor(code: SdkErrorCode, message: string, options: ReckonSdkErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ReckonSdkError";
    this.code = code;
    this.statusCode = options.statusCode;
    this.details = options.details;
    this.issues = options.issues;
    this.errorClass = options.errorClass;
    this.param = options.param;
    this.docUrl = options.docUrl;
    this.mode = options.mode;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.idempotentReplayed = options.idempotentReplayed;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Bad client configuration (empty baseUrl/apiKey, broken id generator). */
export class ReckonConfigError extends ReckonSdkError {
  constructor(message: string, options: ReckonSdkErrorOptions = {}) {
    super("SDK_CONFIG_ERROR", message, options);
    this.name = "ReckonConfigError";
  }
}

/**
 * The request body failed validation against a frozen contract BEFORE the
 * request was sent (code SDK_REQUEST_INVALID) — no network round trip
 * happened — or the server rejected a syntactically valid request with
 * 400 VALIDATION_ERROR (e.g. idempotency header/body mismatch).
 */
export class ReckonValidationError extends ReckonSdkError {
  constructor(code: "SDK_REQUEST_INVALID" | "VALIDATION_ERROR", message: string, options: ReckonSdkErrorOptions = {}) {
    super(code, message, options);
    this.name = "ReckonValidationError";
  }
}

/** 401 UNAUTHENTICATED — missing/unknown/invalid API key. */
export class ReckonAuthError extends ReckonSdkError {
  constructor(message: string, options: ReckonSdkErrorOptions = {}) {
    super("UNAUTHENTICATED", message, options);
    this.name = "ReckonAuthError";
  }
}

/** 403 TENANT_MISMATCH — the request body tenant does not match the key's tenant. */
export class ReckonTenantMismatchError extends ReckonSdkError {
  constructor(message: string, options: ReckonSdkErrorOptions = {}) {
    super("TENANT_MISMATCH", message, options);
    this.name = "ReckonTenantMismatchError";
  }
}

/** 403 MODE_MISMATCH (S2-003) — cross-mode violation: test key touching live data (or vice versa), or a live key carrying test-mode-only hints. */
export class ReckonModeMismatchError extends ReckonSdkError {
  constructor(message: string, options: ReckonSdkErrorOptions = {}) {
    super("MODE_MISMATCH", message, options);
    this.name = "ReckonModeMismatchError";
  }
}

/** 403 INSUFFICIENT_SCOPE — the key lacks the route's scope. */
export class ReckonScopeError extends ReckonSdkError {
  constructor(message: string, options: ReckonSdkErrorOptions = {}) {
    super("INSUFFICIENT_SCOPE", message, options);
    this.name = "ReckonScopeError";
  }
}

/** 404 NOT_FOUND — e.g. a decision id outside the authenticated tenant. */
export class ReckonNotFoundError extends ReckonSdkError {
  constructor(message: string, options: ReckonSdkErrorOptions = {}) {
    super("NOT_FOUND", message, options);
    this.name = "ReckonNotFoundError";
  }
}

/** 422 IDEMPOTENCY_CONFLICT (S2-001) — same idempotency key, different request body. */
export class ReckonIdempotencyConflictError extends ReckonSdkError {
  constructor(message: string, options: ReckonSdkErrorOptions = {}) {
    super("IDEMPOTENCY_CONFLICT", message, options);
    this.name = "ReckonIdempotencyConflictError";
  }
}

/** 409 EMAIL_TAKEN (TL6-001) — the signup email already belongs to an account. */
export class ReckonEmailTakenError extends ReckonSdkError {
  constructor(message: string, options: ReckonSdkErrorOptions = {}) {
    super("EMAIL_TAKEN", message, options);
    this.name = "ReckonEmailTakenError";
  }
}

/** 429 RATE_LIMIT_EXCEEDED (S2-001) — too many requests; honor `retryAfterSeconds`. */
export class ReckonRateLimitError extends ReckonSdkError {
  constructor(message: string, options: ReckonSdkErrorOptions = {}) {
    super("RATE_LIMIT_EXCEEDED", message, options);
    this.name = "ReckonRateLimitError";
  }
}

/** 501 NOT_WIRED — the server has no implementation mounted for this route. */
export class ReckonNotWiredError extends ReckonSdkError {
  constructor(message: string, options: ReckonSdkErrorOptions = {}) {
    super("NOT_WIRED", message, options);
    this.name = "ReckonNotWiredError";
  }
}

/** 500-family server invariant failures (INTERNAL / HANDLER_*). */
export class ReckonServerError extends ReckonSdkError {
  readonly serverCode: SdkServerErrorCode;
  constructor(serverCode: "HANDLER_RESPONSE_INVALID" | "HANDLER_TENANT_VIOLATION" | "INTERNAL", message: string, options: ReckonSdkErrorOptions = {}) {
    super(serverCode, message, options);
    this.name = "ReckonServerError";
    this.serverCode = serverCode;
  }
}

/**
 * Transport-layer failure: fetch rejected, non-JSON response, or an error
 * response whose body is not the typed error envelope (code
 * SDK_TRANSPORT_ERROR / SDK_UNEXPECTED_ERROR_SHAPE).
 */
export class ReckonTransportError extends ReckonSdkError {
  constructor(code: "SDK_TRANSPORT_ERROR" | "SDK_UNEXPECTED_ERROR_SHAPE", message: string, options: ReckonSdkErrorOptions = {}) {
    super(code, message, options);
    this.name = "ReckonTransportError";
  }
}

/** The 2xx response body failed the frozen contract validation. */
export class ReckonResponseContractError extends ReckonSdkError {
  constructor(message: string, options: ReckonSdkErrorOptions = {}) {
    super("SDK_RESPONSE_CONTRACT_VIOLATION", message, options);
    this.name = "ReckonResponseContractError";
  }
}

/** Map a wire error-envelope code onto the matching typed error class. */
export function mapServerError(
  code: SdkServerErrorCode,
  message: string,
  options: ReckonSdkErrorOptions,
): ReckonSdkError {
  switch (code) {
    case "VALIDATION_ERROR":
      return new ReckonValidationError("VALIDATION_ERROR", message, options);
    case "UNAUTHENTICATED":
      return new ReckonAuthError(message, options);
    case "TENANT_MISMATCH":
      return new ReckonTenantMismatchError(message, options);
    case "MODE_MISMATCH":
      return new ReckonModeMismatchError(message, options);
    case "INSUFFICIENT_SCOPE":
      return new ReckonScopeError(message, options);
    case "NOT_FOUND":
      return new ReckonNotFoundError(message, options);
    case "IDEMPOTENCY_CONFLICT":
      return new ReckonIdempotencyConflictError(message, options);
    case "EMAIL_TAKEN":
      return new ReckonEmailTakenError(message, options);
    case "RATE_LIMIT_EXCEEDED":
      return new ReckonRateLimitError(message, options);
    case "NOT_WIRED":
      return new ReckonNotWiredError(message, options);
    case "HANDLER_RESPONSE_INVALID":
    case "HANDLER_TENANT_VIOLATION":
    case "INTERNAL":
      return new ReckonServerError(code, message, options);
  }
}

/** Narrow a zod-shaped failure payload into serializable SDK issues. */
export function toSdkValidationIssues(error: unknown): SdkValidationIssue[] {
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
