import { randomBytes } from "node:crypto";
import { z } from "zod/v4";

/**
 * S2-001 — the developer-platform API contracts (Stripe-style hardening).
 *
 * This module EXTENDS the frozen contract surface additively: every type
 * here is new; no existing exported shape changes. It is the single
 * source of truth for the four API-craft laws adopted from the
 * stripe.com survey (§3, "API reference discipline"):
 *
 *   Authentication · Errors · Idempotent requests · Versioning ·
 *   Expanding responses · Pagination
 *
 * Downstream waves plug in here:
 *   - S2-002 (webhooks): reuses the machine-code vocabulary below;
 *   - S2-003 (test mode): reuses KeyMode + the sk_/pk_ key model;
 *   - S2-004 (SDKs): reuses ErrorEnvelopeSchema + pagination params.
 */

/* ================================================================== *
 * 1. API key model (sk_live_ / sk_test_ / pk_live_ / pk_test_)
 * ================================================================== */

/** Key modes. Test mode separates test data from live data (S2-003 owns the semantics; S2-001 only carries the mode). */
export const KEY_MODES = ["live", "test"] as const;
export type KeyMode = (typeof KEY_MODES)[number];

/** Secret keys authenticate server-side API calls; publishable keys identify the account client-side only. */
export const API_KEY_KINDS = ["secret", "publishable"] as const;
export type ApiKeyKind = (typeof API_KEY_KINDS)[number];

/**
 * Key format (STABLE, frozen here):
 *   sk_live_<token>   secret key, live mode
 *   sk_test_<token>   secret key, test mode
 *   pk_live_<token>   publishable key, live mode
 *   pk_test_<token>   publishable key, test mode
 *
 * `<token>` is at least 24 url-safe base62 characters. The Reckon API
 * generates 40-char tokens (~238 bits of entropy). Publishable keys are
 * NEVER valid API credentials: a bearer pk_… key is a 401
 * authentication_error (see apps/api auth middleware).
 */
export const API_KEY_TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export const API_KEY_MIN_TOKEN_LENGTH = 24;
export const API_KEY_GENERATED_TOKEN_LENGTH = 40;

const secretKeyPattern = new RegExp(`^sk_(live|test)_[${API_KEY_TOKEN_ALPHABET}]{${API_KEY_MIN_TOKEN_LENGTH},}$`);
const publishableKeyPattern = new RegExp(`^pk_(live|test)_[${API_KEY_TOKEN_ALPHABET}]{${API_KEY_MIN_TOKEN_LENGTH},}$`);

/** A well-formed secret key (sk_live_… / sk_test_…). */
export const SecretApiKeySchema = z.string().regex(secretKeyPattern, "secret key must be sk_live_… or sk_test_… followed by at least 24 base62 characters");
/** A well-formed publishable key (pk_live_… / pk_test_…). */
export const PublishableApiKeySchema = z.string().regex(publishableKeyPattern, "publishable key must be pk_live_… or pk_test_… followed by at least 24 base62 characters");
/** Any well-formed Reckon API key (secret or publishable). */
export const ReckonApiKeySchema = z.union([SecretApiKeySchema, PublishableApiKeySchema]);

export type SecretApiKey = z.infer<typeof SecretApiKeySchema>;
export type PublishableApiKey = z.infer<typeof PublishableApiKeySchema>;
export type ReckonApiKey = SecretApiKey | PublishableApiKey;

/** Parsed key identity — the mode/kind vocabulary every consumer shares. */
export interface ReckonApiKeyInfo {
  readonly kind: ApiKeyKind;
  readonly mode: KeyMode;
  /** The random token part (after the sk_test_ style prefix). Never secret on its own. */
  readonly token: string;
}

/**
 * Parse a key into its kind/mode vocabulary. Returns null for anything
 * that is not a well-formed Reckon key (legacy opaque keys included —
 * they carry no in-band mode; the host key configuration supplies it).
 */
export function parseReckonApiKey(key: string): ReckonApiKeyInfo | null {
  const match = /^(sk|pk)_(live|test)_([A-Za-z0-9]+)$/.exec(key);
  if (match === null) return null;
  const token = match[3] ?? "";
  if (token.length < API_KEY_MIN_TOKEN_LENGTH) return null;
  return {
    kind: match[1] === "sk" ? "secret" : "publishable",
    mode: match[2] === "live" ? "live" : "test",
    token,
  };
}

/** Injectable randomness source for key generation (deterministic tests). */
export type KeyTokenGenerator = (length: number) => string;

function defaultTokenGenerator(length: number): string {
  const bytes = randomBytes(length);
  let token = "";
  for (let index = 0; index < length; index += 1) {
    token += API_KEY_TOKEN_ALPHABET[(bytes[index] ?? 0) % API_KEY_TOKEN_ALPHABET.length];
  }
  return token;
}

/**
 * Generate a new API key. Keys are configured/provisioned, never
 * discovered — the host stays the identity authority (architecture lock
 * #4); this helper exists for provisioning surfaces, tests and S2-003
 * test-mode tooling.
 */
export function generateReckonApiKey(
  kind: ApiKeyKind,
  mode: KeyMode,
  generateToken: KeyTokenGenerator = defaultTokenGenerator,
): string {
  const prefix = kind === "secret" ? "sk" : "pk";
  return `${prefix}_${mode}_${generateToken(API_KEY_GENERATED_TOKEN_LENGTH)}`;
}

/** Convenience wrappers (explicit at call sites). */
export function generateSecretKey(mode: KeyMode, generateToken?: KeyTokenGenerator): string {
  return generateReckonApiKey("secret", mode, generateToken);
}
export function generatePublishableKey(mode: KeyMode, generateToken?: KeyTokenGenerator): string {
  return generateReckonApiKey("publishable", mode, generateToken);
}

/* ================================================================== *
 * 2. API versioning (X-Reckon-Version + pinned default)
 * ================================================================== */

/** The version negotiation header (HTTP wire name is lowercase). */
export const X_RECKON_VERSION_HEADER = "x-reckon-version" as const;
/** Canonical header spelling (documentation / clients). */
export const X_RECKON_VERSION_HEADER_CANONICAL = "X-Reckon-Version" as const;

/**
 * A pin-able API version. Two families are legal:
 *  - semver (`0.1.0`) — the current pinned family;
 *  - calendar date (`2026-10-03`) — reserved for future pins
 *    (Stripe-style date pins); the registry decides what is accepted.
 */
export const ApiVersionSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^(\d{4}-\d{2}-\d{2}|\d+\.\d+\.\d+)$/, "API version must be a semver (X.Y.Z) or calendar date (YYYY-MM-DD) string");
export type ApiVersion = z.infer<typeof ApiVersionSchema>;

/** Lifecycle of a registered API version. */
export const API_VERSION_STATUSES = ["active", "deprecated", "retired"] as const;
export type ApiVersionStatus = (typeof API_VERSION_STATUSES)[number];

/** One registry entry. `deprecated` versions still serve; `retired` versions reject with a typed 400. */
export interface ApiVersionEntry {
  readonly version: ApiVersion;
  readonly status: ApiVersionStatus;
  /** ISO date when the version was (or will be) deprecated. */
  readonly deprecatedOn?: string;
  /** ISO date when the version stops serving (moves to retired). */
  readonly retiresOn?: string;
  readonly notes?: string;
}

/** The version registry type — the API pins one default and accepts any non-retired registered version. */
export type ApiVersionRegistry = readonly ApiVersionEntry[];

/* ================================================================== *
 * 3. Idempotent requests (Idempotency-Key)
 * ================================================================== */

/** Header carrying the caller-chosen idempotency key (POST routes). */
export const IDEMPOTENCY_KEY_HEADER = "idempotency-key" as const;
/**
 * Header marking a REPLAYED response: `Idempotent-Replayed: true`
 * (S2-001 law). The legacy lowercase `idempotent-replay` header is kept
 * during the transition so existing clients keep working.
 */
export const IDEMPOTENT_REPLAYED_HEADER = "idempotent-replayed" as const;
/** The replay window: stored responses are replayable for 24 hours, then forgotten. */
export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

/* ================================================================== *
 * 4. Cursor pagination (limit + starting_after)
 * ================================================================== */

export const PAGINATION_DEFAULT_LIMIT = 20;
export const PAGINATION_MAX_LIMIT = 100;
/** Cursor scan bound: a starting_after anchor must be within the most recent N items of the list. */
export const PAGINATION_SCAN_MAX = 1000;

/** `limit` (1..100, default 20) + `starting_after` (object-id cursor). */
export const PaginationParamsSchema = z.object({
  limit: z.number().int().min(1).max(PAGINATION_MAX_LIMIT).default(PAGINATION_DEFAULT_LIMIT),
  starting_after: z.string().min(1).max(128).optional(),
});
export type PaginationParams = z.infer<typeof PaginationParamsSchema>;

/** Every list response carries pagination metadata next to its collection field. */
export const PaginationMetaSchema = z.object({
  has_more: z.boolean(),
  /** The id of the last item of this page — feed it back as starting_after; null when the page is empty or exhausted. */
  next_cursor: z.string().nullable(),
});
export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

/* ================================================================== *
 * 5. Expanding responses (?expand[]=field.subfield)
 * ================================================================== */

/** One expand path token (url-safe identifier segment). */
export const ExpandPathTokenSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "expand path segment must be url-safe");
export type ExpandPathToken = z.infer<typeof ExpandPathTokenSchema>;

/** A parsed expand request: dot-paths (`field.subfield`). Unknown fields are a typed 400 (validated against per-route allowlists in the API). */
export type ExpansionRequest = readonly (readonly [ExpandPathToken, ...ExpandPathToken[]])[];

/** Maximum depth of a nested expand path (`a.b.c.d` = 4). */
export const EXPAND_MAX_DEPTH = 4;
/** Maximum number of expand paths per request. */
export const EXPAND_MAX_PATHS = 10;

/** Query keys an expand request may arrive on (Stripe uses `expand[]`). */
export const EXPAND_QUERY_KEYS = ["expand[]", "expand"] as const;

/**
 * Recursive allowlist tree for a route: the keys are the expandable field
 * names; a non-empty subtree means the field supports nested expansion.
 */
export interface ExpansionAllowlist {
  readonly [field: string]: ExpansionAllowlist;
}

/* ================================================================== *
 * 6. Typed error catalog (stable classes + machine codes)
 * ================================================================== */

/** The five stable error classes (Stripe-style). Every error body names exactly one. */
export const ERROR_CLASSES = [
  "invalid_request_error",
  "authentication_error",
  "permission_error",
  "rate_limit_error",
  "api_error",
] as const;
export type ErrorClass = (typeof ERROR_CLASSES)[number];

export const ErrorClassSchema = z.enum(ERROR_CLASSES);

/**
 * The error catalog — THE docs table (machine code → class, HTTP status,
 * doc slug, description). Machine codes are STABLE public identifiers:
 * clients branch on them. Adding a code is additive; changing the class,
 * status or meaning of an existing code is a breaking contract change
 * and requires a new code instead.
 *
 * | Machine code              | Class                  | HTTP | Param? | Meaning |
 * |---------------------------|------------------------|------|--------|---------|
 * | VALIDATION_ERROR          | invalid_request_error  | 400  | yes    | request body/query failed a frozen contract schema |
 * | UNAUTHENTICATED           | authentication_error   | 401  | no     | missing/malformed/unknown/invalid API key, or a publishable key used as a secret |
 * | TENANT_MISMATCH           | permission_error       | 403  | no     | body/header tenant ≠ key tenant, or workspace scope violation |
 * | INSUFFICIENT_SCOPE        | permission_error       | 403  | no     | key lacks the route's scope |
 * | NOT_FOUND                 | invalid_request_error  | 404  | no     | unknown id inside the authenticated tenant |
 * | IDEMPOTENCY_CONFLICT      | invalid_request_error  | 422  | yes    | Idempotency-Key reused with a different request body |
 * | RATE_LIMIT_EXCEEDED       | rate_limit_error       | 429  | no     | too many requests; honor Retry-After |
 * | NOT_WIRED                 | api_error              | 501  | no     | operation has no mounted handler (composition, not client, fault) |
 * | HANDLER_RESPONSE_INVALID  | api_error              | 500  | no     | handler output failed its frozen response contract |
 * | HANDLER_TENANT_VIOLATION  | api_error              | 500  | no     | handler produced another tenant's data (withheld) |
 * | INTERNAL                  | api_error              | 500  | no     | unexpected internal failure |
 */
export interface ErrorCatalogEntry {
  readonly errorClass: ErrorClass;
  readonly httpStatus: number;
  /** Stable docs slug: <doc base>/errors/<slug> (S1-004 owns the real docs host). */
  readonly docSlug: string;
  readonly description: string;
}

export const ERROR_CATALOG = {
  VALIDATION_ERROR: {
    errorClass: "invalid_request_error",
    httpStatus: 400,
    docSlug: "validation-error",
    description: "The request body or query failed its frozen contract schema.",
  },
  UNAUTHENTICATED: {
    errorClass: "authentication_error",
    httpStatus: 401,
    docSlug: "unauthenticated",
    description: "Missing, malformed or unknown API key, or a publishable (pk_) key used where a secret (sk_) key is required.",
  },
  TENANT_MISMATCH: {
    errorClass: "permission_error",
    httpStatus: 403,
    docSlug: "tenant-mismatch",
    description: "The request tenant does not match the authenticated tenant, or a workspace-scoped key operated outside its workspace.",
  },
  INSUFFICIENT_SCOPE: {
    errorClass: "permission_error",
    httpStatus: 403,
    docSlug: "insufficient-scope",
    description: "The API key does not grant the scope this route requires.",
  },
  NOT_FOUND: {
    errorClass: "invalid_request_error",
    httpStatus: 404,
    docSlug: "not-found",
    description: "No such resource id inside the authenticated tenant.",
  },
  IDEMPOTENCY_CONFLICT: {
    errorClass: "invalid_request_error",
    httpStatus: 422,
    docSlug: "idempotency-conflict",
    description: "An Idempotency-Key was reused with a different request body.",
  },
  RATE_LIMIT_EXCEEDED: {
    errorClass: "rate_limit_error",
    httpStatus: 429,
    docSlug: "rate-limit-exceeded",
    description: "Too many requests; retry after the Retry-After delay.",
  },
  NOT_WIRED: {
    errorClass: "api_error",
    httpStatus: 501,
    docSlug: "not-wired",
    description: "This operation has no mounted handler implementation in the current composition.",
  },
  HANDLER_RESPONSE_INVALID: {
    errorClass: "api_error",
    httpStatus: 500,
    docSlug: "handler-response-invalid",
    description: "A handler produced a response that failed its frozen response contract.",
  },
  HANDLER_TENANT_VIOLATION: {
    errorClass: "api_error",
    httpStatus: 500,
    docSlug: "handler-tenant-violation",
    description: "A handler produced data belonging to a different tenant; the response was withheld.",
  },
  INTERNAL: {
    errorClass: "api_error",
    httpStatus: 500,
    docSlug: "internal",
    description: "Unexpected internal failure.",
  },
} as const satisfies Record<string, ErrorCatalogEntry>;

/** The stable machine-code vocabulary (keys of the catalog). */
export type MachineErrorCode = keyof typeof ERROR_CATALOG;

/**
 * Docs URL base for error doc_url values. The docs portal itself is
 * S1-004's surface; this constant is the pinned seam — the API composes
 * `doc_url = ERROR_DOC_URL_BASE + "/errors/" + slug` (overridable in
 * server config so a deployment can point at its own docs host).
 */
export const ERROR_DOC_URL_BASE = "https://docs.reckon.dev" as const;

function kebabCase(value: string): string {
  return value.toLowerCase().replaceAll("_", "-");
}

/** Compose the doc_url for a machine code (unknown codes fall back to a kebab slug). */
export function errorDocUrl(code: string, baseUrl: string = ERROR_DOC_URL_BASE): string {
  const slug = ERROR_CATALOG[code as MachineErrorCode]?.docSlug ?? kebabCase(code);
  return `${baseUrl}/errors/${slug}`;
}

/**
 * The frozen typed error body contract. EVERY failure the API emits is
 * this shape:
 *   { "error": { "class": …, "code": …, "message": …, "param"?: …, "doc_url"?: …, "details"?: … } }
 * `code`/`message`/`details` are the pre-S2-001 fields (kept for
 * backward compatibility); `class`/`param`/`doc_url` are the Stripe-style
 * additions.
 */
export const ApiErrorEnvelopeSchema = z.object({
  error: z.object({
    class: ErrorClassSchema,
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(4096),
    param: z.string().min(1).max(256).optional(),
    doc_url: z.string().min(1).max(2048).optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelopeSchema>;

/** Look up the catalog entry for a machine code (unknown codes map to api_error/500). */
export function errorCatalogEntry(code: string): ErrorCatalogEntry {
  const entry = ERROR_CATALOG[code as MachineErrorCode];
  if (entry !== undefined) return entry;
  return {
    errorClass: "api_error",
    httpStatus: 500,
    docSlug: kebabCase(code),
    description: "Uncatalogued error code.",
  };
}
