/**
 * Developer-platform surface client (S3-001) — PURE, dependency-free
 * logic (no "server-only", no env access) so every outcome mapping is
 * unit-testable (test/developers-api.test.ts).
 *
 * The studio law (Gate Q): the dashboard renders REAL backend state or
 * says precisely what is missing — never fabricated data. The S2-001 API
 * hardened the core surface but the developer-platform management routes
 * (key management, request logs, webhook events) are NOT WIRED yet
 * (S2-002/S2-003 land them in parallel). This module therefore ATTEMPTS
 * each documented/pending route with the server-side credentials and maps
 * whatever actually happened to a typed outcome:
 *
 *   ok           — the route answered 200 and the body matched the
 *                  expected wire shape (data flows through);
 *   unconfigured — RECKON_DEMO_API_KEY is not set (the precise reason);
 *   unreachable  — the network call failed (observed error message);
 *   not-wired    — the API answered 404 (no such route) or 501
 *                  (NOT_WIRED envelope) — the route is pending, named
 *                  verbatim in the outcome;
 *   error        — anything else the API said or did (observed detail).
 *
 * When the real routes land, the same attempts start returning "ok" and
 * the dashboard lights up with zero UI changes — that is the seam.
 *
 * Wire shapes follow the S2-001 conventions: list responses are
 * `{ data: [...], pagination: { has_more, next_cursor } }` and errors are
 * the typed `{ error: { class, code, message, … } }` envelope.
 */

/* ================================================================== *
 * Pending developer-platform routes (named verbatim in honest states)
 * ================================================================== */

export const PENDING_API_KEY_ROUTES = {
  list: "GET /v1/api-keys",
  create: "POST /v1/api-keys",
  revoke: "DELETE /v1/api-keys/{id}",
} as const;

export const PENDING_REQUEST_LOG_ROUTE = "GET /v1/request-logs";

export const PENDING_EVENT_ROUTES = {
  list: "GET /v1/events",
  replay: "POST /v1/events/{id}/replay",
} as const;

/* ================================================================== *
 * Typed outcomes
 * ================================================================== */

export type SurfaceOutcomeKind = "ok" | "unconfigured" | "unreachable" | "not-wired" | "error";

export interface SurfaceFailure {
  readonly outcome: Exclude<SurfaceOutcomeKind, "ok">;
  /** What was actually observed — the network message / status / error message, verbatim. */
  readonly detail: string;
  /** The pending API route this surface needs, when the failure is about the route itself. */
  readonly pendingRoute: string | null;
  /** HTTP status the API answered with, when it answered. */
  readonly httpStatus: number | null;
}

export type SurfaceResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly failure: SurfaceFailure };

/** The raw result of one authenticated surface attempt. */
export type SurfaceAttempt = { readonly ok: true; readonly body: unknown } | { readonly ok: false; readonly failure: SurfaceFailure };

/* ================================================================== *
 * Wire shapes (the dashboard's expectation of the pending routes)
 * ================================================================== */

/** The S2-001 pagination envelope carried by every list response. */
export interface PaginationEnvelope {
  readonly has_more: boolean;
  readonly next_cursor: string | null;
}

/** One API key row as the keys surface is expected to report it. */
export interface ApiKeyRecord {
  readonly id: string;
  readonly name: string;
  /** Key prefix including the kind/mode vocabulary, e.g. "sk_test_…9f2K". */
  readonly prefix: string;
  readonly mode: "live" | "test";
  readonly kind: "secret" | "publishable";
  readonly created_at: string;
  readonly last_used_at: string | null;
}

/** A newly created key — the ONLY time the full secret exists. */
export interface CreatedApiKey extends ApiKeyRecord {
  /** The full secret (sk_…/pk_…). Shown exactly once, never stored. */
  readonly secret: string;
}

export interface ApiKeysPage {
  readonly keys: readonly ApiKeyRecord[];
  readonly pagination: PaginationEnvelope | null;
}

/** One request-log row (the S2-001 request trail). */
export interface RequestLogRecord {
  readonly id: string;
  /** ISO timestamp of the request. */
  readonly created_at: string;
  readonly method: string;
  /** Route as the API saw it, e.g. "POST /v1/decisions". */
  readonly route: string;
  readonly status: number;
  readonly latency_ms: number;
  /** Prefix of the key that made the request, e.g. "sk_test_…9f2K". */
  readonly key_prefix: string;
}

export interface RequestLogsPage {
  readonly logs: readonly RequestLogRecord[];
  readonly pagination: PaginationEnvelope;
}

/** One webhook event row (the S2-002 surface). */
export interface EventRecord {
  readonly id: string;
  /** Event type from the S2-002 catalog (recommendation.delivered, …). */
  readonly type: string;
  readonly created_at: string;
  /** Delivery status as the events surface reports it. */
  readonly status: string;
}

export interface EventsPage {
  readonly events: readonly EventRecord[];
  readonly pagination: PaginationEnvelope;
}

/* ================================================================== *
 * Shared plumbing
 * ================================================================== */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface SurfaceEndpoint {
  readonly baseUrl: string;
  /** Bearer key; when empty every attempt reports "unconfigured". */
  readonly apiKey: string;
}

interface ErrorEnvelopeShape {
  error?: { code?: unknown; message?: unknown; class?: unknown };
}

function describeHttpStatus(status: number, bodyText: string): string {
  const parsed = parseJson(bodyText) as unknown;
  const envelope = isRecord(parsed) ? (parsed as ErrorEnvelopeShape).error : undefined;
  if (isRecord(envelope)) {
    const code = typeof envelope.code === "string" ? envelope.code : null;
    const message = typeof envelope.message === "string" ? envelope.message : null;
    if (code !== null && message !== null) {
      return `HTTP ${status} — ${code}: ${message}`;
    }
    if (message !== null) {
      return `HTTP ${status} — ${message}`;
    }
  }
  return `HTTP ${status}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Attempt one authenticated JSON call against the API and map the raw
 * result to an honest outcome. `pendingRoute` is attached to not-wired
 * and error outcomes so the UI can name the route verbatim.
 */
export async function attemptSurfaceCall(
  endpoint: SurfaceEndpoint,
  pendingRoute: string,
  path: string,
  init: RequestInit,
  fetchImpl: FetchLike,
): Promise<SurfaceAttempt> {
  if (endpoint.apiKey.trim().length === 0) {
    return {
      ok: false,
      failure: {
        outcome: "unconfigured",
        detail:
          "RECKON_DEMO_API_KEY is not set — the dashboard cannot authenticate against the Reckon API. Configure it in the server environment.",
        pendingRoute,
        httpStatus: null,
      },
    };
  }

  let response: Response;
  try {
    response = await fetchImpl(`${endpoint.baseUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${endpoint.apiKey}`,
        ...(init.headers ?? {}),
      },
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return {
      ok: false,
      failure: {
        outcome: "unreachable",
        detail: `Could not reach the Reckon API at ${endpoint.baseUrl} — ${reason}`,
        pendingRoute,
        httpStatus: null,
      },
    };
  }

  const bodyText = await response.text().catch(() => "");

  if (response.status === 404 || response.status === 501) {
    // 404 = the route does not exist yet; 501 = the typed NOT_WIRED
    // envelope (S2-001 error catalog). Both mean: pending route, honest.
    return {
      ok: false,
      failure: {
        outcome: "not-wired",
        detail: `${pendingRoute} answered ${describeHttpStatus(response.status, bodyText)} — the developer-platform surface is not mounted yet.`,
        pendingRoute,
        httpStatus: response.status,
      },
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      failure: {
        outcome: "error",
        detail: `${pendingRoute} answered ${describeHttpStatus(response.status, bodyText)}.`,
        pendingRoute,
        httpStatus: response.status,
      },
    };
  }

  const body = parseJson(bodyText);
  if (body === undefined) {
    return {
      ok: false,
      failure: {
        outcome: "error",
        detail: `${pendingRoute} answered 200 but the body was not valid JSON — the response was withheld rather than guessed.`,
        pendingRoute,
        httpStatus: response.status,
      },
    };
  }

  return { ok: true, body };
}

/* ================================================================== *
 * Narrow wire-shape guards — strict by design: a 200 body that does not
 * match the expected shape is an ERROR outcome (reported precisely),
 * never silently reshaped or padded with defaults.
 * ================================================================== */

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asIsoString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parsePaginationEnvelope(value: unknown): PaginationEnvelope | null {
  if (!isRecord(value)) return null;
  const hasMore = value["has_more"];
  const nextCursor = value["next_cursor"];
  if (typeof hasMore !== "boolean") return null;
  if (nextCursor !== null && typeof nextCursor !== "string") return null;
  return { has_more: hasMore, next_cursor: nextCursor };
}

function parseApiKeyRecord(value: unknown): ApiKeyRecord | null {
  if (!isRecord(value)) return null;
  const id = asNonEmptyString(value["id"]);
  const name = asNonEmptyString(value["name"]);
  const prefix = asNonEmptyString(value["prefix"]);
  const mode = value["mode"];
  const kind = value["kind"];
  const createdAt = asIsoString(value["created_at"]);
  const lastUsedAt = value["last_used_at"];
  if (
    id === null ||
    name === null ||
    prefix === null ||
    createdAt === null ||
    (mode !== "live" && mode !== "test") ||
    (kind !== "secret" && kind !== "publishable") ||
    (lastUsedAt !== null && typeof lastUsedAt !== "string")
  ) {
    return null;
  }
  return {
    id,
    name,
    prefix,
    mode,
    kind,
    created_at: createdAt,
    last_used_at: lastUsedAt,
  };
}

export function parseApiKeysPage(value: unknown): ApiKeysPage | null {
  if (!isRecord(value) || !Array.isArray(value["data"])) return null;
  const keys: ApiKeyRecord[] = [];
  for (const row of value["data"]) {
    const record = parseApiKeyRecord(row);
    if (record === null) return null;
    keys.push(record);
  }
  const pagination = value["pagination"] === undefined ? null : parsePaginationEnvelope(value["pagination"]);
  if (value["pagination"] !== undefined && pagination === null) return null;
  return { keys, pagination };
}

export function parseCreatedApiKey(value: unknown): CreatedApiKey | null {
  const record = parseApiKeyRecord(value);
  if (record === null) return null;
  const secret = asNonEmptyString(value instanceof Object ? (value as Record<string, unknown>)["secret"] : undefined);
  if (secret === null) return null;
  return { ...record, secret };
}

function parseRequestLogRecord(value: unknown): RequestLogRecord | null {
  if (!isRecord(value)) return null;
  const id = asNonEmptyString(value["id"]);
  const createdAt = asIsoString(value["created_at"]);
  const method = asNonEmptyString(value["method"]);
  const route = asNonEmptyString(value["route"]);
  const status = asNumber(value["status"]);
  const latencyMs = asNumber(value["latency_ms"]);
  const keyPrefix = asNonEmptyString(value["key_prefix"]);
  if (
    id === null ||
    createdAt === null ||
    method === null ||
    route === null ||
    status === null ||
    latencyMs === null ||
    keyPrefix === null
  ) {
    return null;
  }
  return { id, created_at: createdAt, method, route, status, latency_ms: latencyMs, key_prefix: keyPrefix };
}

export function parseRequestLogsPage(value: unknown): RequestLogsPage | null {
  if (!isRecord(value) || !Array.isArray(value["data"])) return null;
  const logs: RequestLogRecord[] = [];
  for (const row of value["data"]) {
    const record = parseRequestLogRecord(row);
    if (record === null) return null;
    logs.push(record);
  }
  const pagination = parsePaginationEnvelope(value["pagination"]);
  if (pagination === null) return null;
  return { logs, pagination };
}

function parseEventRecord(value: unknown): EventRecord | null {
  if (!isRecord(value)) return null;
  const id = asNonEmptyString(value["id"]);
  const type = asNonEmptyString(value["type"]);
  const createdAt = asIsoString(value["created_at"]);
  const status = asNonEmptyString(value["status"]);
  if (id === null || type === null || createdAt === null || status === null) return null;
  return { id, type, created_at: createdAt, status };
}

export function parseEventsPage(value: unknown): EventsPage | null {
  if (!isRecord(value) || !Array.isArray(value["data"])) return null;
  const events: EventRecord[] = [];
  for (const row of value["data"]) {
    const record = parseEventRecord(row);
    if (record === null) return null;
    events.push(record);
  }
  const pagination = parsePaginationEnvelope(value["pagination"]);
  if (pagination === null) return null;
  return { events, pagination };
}

/* ================================================================== *
 * Surface attempts (inject your own fetch in tests)
 * ================================================================== */

function shapeError(pendingRoute: string): SurfaceFailure {
  return {
    outcome: "error",
    detail:
      `${pendingRoute} answered 200 but the body did not match the expected ` +
      `S2-001 list envelope ({ data: [...], pagination: { has_more, next_cursor } }) — ` +
      `the response was withheld rather than guessed.`,
    pendingRoute,
    httpStatus: 200,
  };
}

/** GET /v1/api-keys — list the account's keys. */
export async function listApiKeys(
  endpoint: SurfaceEndpoint,
  fetchImpl: FetchLike,
): Promise<SurfaceResult<ApiKeysPage>> {
  const result = await attemptSurfaceCall(endpoint, PENDING_API_KEY_ROUTES.list, "/v1/api-keys", { method: "GET" }, fetchImpl);
  if (!result.ok) return result;
  const page = parseApiKeysPage(result.body);
  if (page === null) return { ok: false, failure: shapeError(PENDING_API_KEY_ROUTES.list) };
  return { ok: true, data: page };
}

export interface CreateApiKeyInput {
  readonly name: string;
  readonly kind: "secret" | "publishable";
  readonly mode: "live" | "test";
}

/** POST /v1/api-keys — create a key; the response carries the full secret exactly once. */
export async function createApiKey(
  endpoint: SurfaceEndpoint,
  input: CreateApiKeyInput,
  fetchImpl: FetchLike,
): Promise<SurfaceResult<CreatedApiKey>> {
  const result = await attemptSurfaceCall(
    endpoint,
    PENDING_API_KEY_ROUTES.create,
    "/v1/api-keys",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: input.name, kind: input.kind, mode: input.mode }),
    },
    fetchImpl,
  );
  if (!result.ok) return result;
  const created = parseCreatedApiKey(result.body);
  if (created === null) {
    return {
      ok: false,
      failure: {
        outcome: "error",
        detail:
          `${PENDING_API_KEY_ROUTES.create} answered 200 but the body did not match the expected ` +
          `created-key shape ({ id, name, prefix, mode, kind, created_at, secret }) — the response was withheld rather than guessed.`,
        pendingRoute: PENDING_API_KEY_ROUTES.create,
        httpStatus: 200,
      },
    };
  }
  return { ok: true, data: created };
}

/** DELETE /v1/api-keys/{id} — revoke a key. */
export async function revokeApiKey(
  endpoint: SurfaceEndpoint,
  keyId: string,
  fetchImpl: FetchLike,
): Promise<SurfaceResult<{ revoked: true }>> {
  const pendingRoute = PENDING_API_KEY_ROUTES.revoke.replace("{id}", keyId);
  const result = await attemptSurfaceCall(endpoint, pendingRoute, `/v1/api-keys/${encodeURIComponent(keyId)}`, { method: "DELETE" }, fetchImpl);
  if (!result.ok) return result;
  return { ok: true, data: { revoked: true as const } };
}

/** GET /v1/request-logs?starting_after=…&limit=… — the cursor-paginated request trail. */
export async function listRequestLogs(
  endpoint: SurfaceEndpoint,
  options: { readonly startingAfter?: string; readonly limit?: number } ,
  fetchImpl: FetchLike,
): Promise<SurfaceResult<RequestLogsPage>> {
  const params = new URLSearchParams();
  if (options.startingAfter !== undefined && options.startingAfter.length > 0) {
    params.set("starting_after", options.startingAfter);
  }
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  const result = await attemptSurfaceCall(
    endpoint,
    PENDING_REQUEST_LOG_ROUTE,
    `/v1/request-logs${query}`,
    { method: "GET" },
    fetchImpl,
  );
  if (!result.ok) return result;
  const page = parseRequestLogsPage(result.body);
  if (page === null) return { ok: false, failure: shapeError(PENDING_REQUEST_LOG_ROUTE) };
  return { ok: true, data: page };
}

/** GET /v1/events — the webhook events list (S2-002 surface). */
export async function listEvents(
  endpoint: SurfaceEndpoint,
  options: { readonly startingAfter?: string; readonly limit?: number },
  fetchImpl: FetchLike,
): Promise<SurfaceResult<EventsPage>> {
  const params = new URLSearchParams();
  if (options.startingAfter !== undefined && options.startingAfter.length > 0) {
    params.set("starting_after", options.startingAfter);
  }
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  const result = await attemptSurfaceCall(
    endpoint,
    PENDING_EVENT_ROUTES.list,
    `/v1/events${query}`,
    { method: "GET" },
    fetchImpl,
  );
  if (!result.ok) return result;
  const page = parseEventsPage(result.body);
  if (page === null) return { ok: false, failure: shapeError(PENDING_EVENT_ROUTES.list) };
  return { ok: true, data: page };
}
