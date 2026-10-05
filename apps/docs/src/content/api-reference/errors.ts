/**
 * API reference — Errors (S1-004): the typed error catalog.
 *
 * TARGET contract per the survey §3: four error classes
 * (invalid_request_error / authentication_error / rate_limit_error /
 * api_error) with stable machine codes and an HTTP mapping. The stable
 * codes below are the snake_case evolution of the v0.1.0
 * VALIDATION_ERROR / IDEMPOTENCY_CONFLICT codes that apps/api and
 * @reckon/sdk already implement (S2-001 reconciles the two spellings).
 */

import type { ErrorClassEntry, TocEntry } from "../types.js";

export const ERRORS_HEADINGS: readonly TocEntry[] = [
  { id: "the-error-envelope", label: "The error envelope", level: 2 },
  { id: "error-classes", label: "Error classes", level: 2 },
  { id: "stable-codes", label: "Stable code catalog", level: 2 },
  { id: "handling-errors", label: "Handling errors", level: 2 },
];

export const ERROR_ENVELOPE_EXAMPLE = {
  language: "json" as const,
  label: "Error envelope",
  code: `{
  "error": {
    "type": "invalid_request_error",
    "code": "validation_error",
    "message": "candidates.candidates[0].itemId: id must be url-safe and non-empty",
    "details": {
      "schema": "reckon.decision-request",
      "issues": [
        { "path": "candidates.candidates[0].itemId", "code": "invalid_string" }
      ]
    }
  }
}`,
  caption:
    "`type` is the coarse class you branch on, `code` is the stable machine code you can persist, `message` is human-readable and **may change** between versions. `details` carries structured context (schema id, field-level validation issues).",
};

export const ERROR_CLASSES: readonly ErrorClassEntry[] = [
  {
    id: "invalid_request_error",
    name: "invalid_request_error",
    http: "400 · 403 · 404 · 409 · 422",
    description:
      "The request was wrong: malformed payloads, contract validation failures, tenant/scope violations, unknown ids, idempotency conflicts. Never retry unchanged — fix the request.",
    retryable: false,
    codes: [
      { code: "validation_error", http: 400, meaning: "Body failed its frozen contract (field-level issues in `details`)." },
      { code: "tenant_mismatch", http: 403, meaning: "Body tenant does not match the key's tenant." },
      { code: "insufficient_scope", http: 403, meaning: "The key lacks the route's scope." },
      { code: "not_found", http: 404, meaning: "Unknown id for this tenant (never leaks other tenants' existence)." },
      { code: "idempotency_key_reused", http: 409, meaning: "Same Idempotency-Key replayed with a different body." },
    ],
  },
  {
    id: "authentication_error",
    name: "authentication_error",
    http: "401",
    description:
      "The key is missing, malformed, revoked, or from the wrong mode (test key against live). Never retry with the same key.",
    retryable: false,
    codes: [
      { code: "missing_authorization", http: 401, meaning: "No `Authorization: Bearer` header." },
      { code: "invalid_api_key", http: 401, meaning: "Unknown or revoked key." },
      { code: "wrong_key_mode", http: 401, meaning: "Test-mode key used against the live endpoint (or vice versa)." },
    ],
  },
  {
    id: "rate_limit_error",
    name: "rate_limit_error",
    http: "429",
    description:
      "Too many requests, or the tenant's plan quota is exhausted. Retry later with exponential backoff; honor `Retry-After`.",
    retryable: true,
    codes: [
      { code: "rate_limit_exceeded", http: 429, meaning: "Short-window rate limit — back off and retry." },
      { code: "quota_exceeded", http: 429, meaning: "Monthly/plan quota exhausted — will not clear within a backoff window." },
    ],
  },
  {
    id: "api_error",
    name: "api_error",
    http: "500 · 501 · 503 · 504",
    description:
      "Reckon failed. Safe to retry idempotent requests with backoff and jitter — replays return the original response.",
    retryable: true,
    codes: [
      { code: "internal_error", http: 500, meaning: "Unexpected internal invariant failure." },
      { code: "not_wired", http: 501, meaning: "No handler mounted for this route (composition-level, safe to retry later)." },
      { code: "service_unavailable", http: 503, meaning: "Degraded — retry with backoff." },
      { code: "timeout", http: 504, meaning: "Upstream deadline exceeded." },
    ],
  },
];

export const SDK_CATCH_EXAMPLE = {
  language: "typescript" as const,
  label: "Typed handling with the SDK",
  code: `import { ReckonValidationError, ReckonIdempotencyConflictError, ReckonSdkError } from "@reckon/sdk";

try {
  const decision = await reckon.decisions.request(payload);
} catch (error) {
  if (error instanceof ReckonValidationError) {
    // 400 validation_error — the SDK pre-validates, so this is usually
    // caught before the request is even sent (code SDK_REQUEST_INVALID).
    for (const issue of error.issues ?? []) console.error(issue.path, issue.message);
  } else if (error instanceof ReckonIdempotencyConflictError) {
    // 409 idempotency_key_reused — same key, different body. Log loudly.
    throw error;
  } else if (error instanceof ReckonSdkError) {
    // Every failure is a typed ReckonSdkError discriminated by code —
    // raw fetch errors never escape the SDK.
    console.error(error.code, error.statusCode, error.message);
  } else {
    throw error;
  }
}`,
  caption:
    "Every SDK failure is a `ReckonSdkError` subclass discriminated by a machine-readable `code` — the SDK never leaks a raw fetch or network error into your catch blocks.",
};

export const ERROR_HANDLING_BULLETS: readonly string[] = [
  "Branch on `type` for retry policy; persist `code` for alerting — codes are stable, messages are not.",
  "Retry `rate_limit_error` and `api_error` with exponential backoff and jitter; honor `Retry-After` when present.",
  "Never blind-retry `invalid_request_error` — the same body will fail the same way.",
  "Idempotency keys make retries of POSTs safe: a retried request replays the original response instead of double-executing.",
];
