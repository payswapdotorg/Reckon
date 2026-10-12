/**
 * TL6-003 — the account-surface client (PURE, dependency-free except the
 * frozen contracts): the dashboard's typed fetch client for the
 * /v1/account family implemented by TL6-001.
 *
 * PURE BY DESIGN (same law as developers-api.ts): no "server-only", no
 * env access, injectable fetch — every outcome mapping is unit-testable
 * (test/account-api.test.ts) against the EXACT wire shapes the API's own
 * contract tests assert (apps/api/test/account.test.ts):
 *
 *   POST   /v1/account/signup        201 { account, session } (token shown ONCE)
 *                                   409 EMAIL_TAKEN (param: email)
 *   POST   /v1/account/login         200 { account, session } / 401 UNAUTHENTICATED
 *   POST   /v1/account/logout        204 (session revoked)
 *   GET    /v1/account/keys          200 { keys: [...] } (metadata only — NO secrets, ever)
 *   POST   /v1/account/keys          201 { ...key metadata, key: RAW } (shown EXACTLY ONCE)
 *   DELETE /v1/account/keys/:keyId   204 / 404 NOT_FOUND
 *
 * Responses are validated against the FROZEN zod schemas from
 * @reckon/contracts (the same schemas the API validates with) — a 2xx
 * body that violates the frozen contract is an ERROR outcome reported
 * precisely, never silently reshaped (Gate Q).
 *
 * WHY NOT @reckon/sdk: the SDK client factory REQUIRES a pre-configured
 * API key, but signup/login are UNAUTHENTICATED routes that must work
 * before any key exists — fabricating a key to satisfy the constructor
 * would violate the honesty law. This module therefore follows the
 * repo's established dashboard→API proxy precedent (developers-api.ts /
 * the /healthz probe) while importing the frozen CONTRACT TYPES+SCHEMAS
 * from @reckon/contracts, so the wire truth stays single-sourced.
 *
 * Auth law: the session-authenticated calls carry ONLY the session
 * bearer (reckonsess_…) — the demo/static key lane never rides this
 * family (asserted by tests; the two credential lanes must not cross).
 */

import {
  AccountKeyCreatedSchema,
  AccountKeySchema,
  AccountSessionResponseSchema,
  CreateKeyRequestSchema,
  LoginRequestSchema,
  SignupRequestSchema,
  type AccountKey,
  type AccountKeyCreated,
  type AccountSessionResponse,
} from "@reckon/contracts";

/* ================================================================== *
 * Route names (verbatim in honest states)
 * ================================================================== */

export const ACCOUNT_ROUTES = {
  signup: "POST /v1/account/signup",
  login: "POST /v1/account/login",
  logout: "POST /v1/account/logout",
  listKeys: "GET /v1/account/keys",
  createKey: "POST /v1/account/keys",
  revokeKey: (keyId: string): string => `DELETE /v1/account/keys/${keyId}`,
} as const;

/* ================================================================== *
 * Typed outcomes (Gate Q — honest degradation)
 * ================================================================== */

/**
 * The account-family outcome vocabulary. Deliberately DIFFERENT from the
 * demo-lane developers-api vocabulary: there is no "unconfigured" —
 * signup/login need no pre-configured key (that is the point of the
 * account family) — and there IS "unauthenticated" (401: the session is
 * missing, invalid or expired).
 */
export type AccountSurfaceOutcome = "ok" | "unauthenticated" | "unreachable" | "not-wired" | "error";

export interface AccountSurfaceFailure {
  readonly outcome: Exclude<AccountSurfaceOutcome, "ok">;
  /** What was actually observed — the network message / status / error message, verbatim. */
  readonly detail: string;
  /** The API's stable machine code when it answered with the typed envelope (EMAIL_TAKEN, UNAUTHENTICATED, NOT_FOUND, …). */
  readonly code: string | null;
  /** The API's error param when present (e.g. "email" for EMAIL_TAKEN). */
  readonly param: string | null;
  /** The API route this surface needs, when the failure is about the route itself. */
  readonly pendingRoute: string | null;
  /** HTTP status the API answered with, when it answered. */
  readonly httpStatus: number | null;
}

export type AccountSurfaceResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly failure: AccountSurfaceFailure };

/* ================================================================== *
 * Shared plumbing
 * ================================================================== */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** The API origin + the (optional) session token for authenticated calls. */
export interface AccountEndpoint {
  readonly baseUrl: string;
  /**
   * The reckonsess_ session token. `null`/empty ⇒ every SESSION-authenticated
   * call reports "unauthenticated" (sign in first) — the honest pre-flight,
   * never a fabricated anonymous attempt.
   */
  readonly sessionToken: string | null;
}

interface ErrorEnvelopeShape {
  error?: { code?: unknown; message?: unknown; class?: unknown; param?: unknown };
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

function describeHttpStatus(status: number, bodyText: string): string {
  const parsed = parseJson(bodyText) as unknown;
  const envelope = isRecord(parsed) ? (parsed as ErrorEnvelopeShape).error : undefined;
  if (isRecord(envelope)) {
    const code = typeof envelope.code === "string" ? envelope.code : null;
    const message = typeof envelope.message === "string" ? envelope.message : null;
    if (code !== null && message !== null) return `HTTP ${status} — ${code}: ${message}`;
    if (message !== null) return `HTTP ${status} — ${message}`;
  }
  return `HTTP ${status}`;
}

function typedEnvelope(bodyText: string): { code: string | null; message: string | null; param: string | null } {
  const parsed = parseJson(bodyText) as unknown;
  const envelope = isRecord(parsed) ? (parsed as ErrorEnvelopeShape).error : undefined;
  if (isRecord(envelope)) {
    return {
      code: typeof envelope.code === "string" ? envelope.code : null,
      message: typeof envelope.message === "string" && envelope.message.length > 0 ? envelope.message : null,
      param: typeof envelope.param === "string" ? envelope.param : null,
    };
  }
  return { code: null, message: null, param: null };
}

/** Format zod issues into an honest, readable detail string. */
function formatIssues(issues: readonly { readonly path: PropertyKey[]; readonly message: string }[]): string {
  return issues
    .map((issue) => `${issue.path.length > 0 ? `${issue.path.join(".")}: ` : ""}${issue.message}`)
    .join("; ");
}

function validationFailure(pendingRoute: string, detail: string): AccountSurfaceFailure {
  return {
    outcome: "error",
    detail,
    code: "REQUEST_INVALID",
    param: null,
    pendingRoute,
    httpStatus: null,
  };
}

/**
 * One account-family call: bearer (when a session rides the call) →
 * fetch → honest outcome mapping. `init.body` must already be a string.
 * 204s resolve as `null` data; every other 2xx body must parse as JSON.
 */
async function attemptAccountCall(
  endpoint: AccountEndpoint,
  pendingRoute: string,
  path: string,
  init: RequestInit,
  fetchImpl: FetchLike,
  options: { readonly session: boolean } = { session: true },
): Promise<{ readonly ok: true; readonly status: number; readonly body: unknown } | { readonly ok: false; readonly failure: AccountSurfaceFailure }> {
  let authorization: string | undefined;
  if (options.session) {
    const token = endpoint.sessionToken?.trim() ?? "";
    if (token.length === 0) {
      return {
        ok: false,
        failure: {
          outcome: "unauthenticated",
          detail: "No studio session is present — sign in (or sign up) first; this call was not sent.",
          code: null,
          param: null,
          pendingRoute,
          httpStatus: null,
        },
      };
    }
    authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetchImpl(`${endpoint.baseUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        ...(authorization !== undefined ? { authorization } : {}),
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
        code: null,
        param: null,
        pendingRoute,
        httpStatus: null,
      },
    };
  }

  const bodyText = await response.text().catch(() => "");

  if (response.status === 404 || response.status === 501) {
    const typed = typedEnvelope(bodyText);
    // A 404 carrying a DIFFERENT typed code (e.g. NOT_FOUND for an
    // unknown key id) is the API answering THIS route — an honest error
    // outcome with the code carried, not a missing-route signal. 501 is
    // always the typed NOT_WIRED envelope (or an unmounted deployment).
    if (response.status === 404 && typed.code !== null && typed.code !== "NOT_WIRED") {
      return {
        ok: false,
        failure: {
          outcome: "error",
          detail: `${pendingRoute} answered ${describeHttpStatus(response.status, bodyText)}.`,
          code: typed.code,
          param: typed.param,
          pendingRoute,
          httpStatus: response.status,
        },
      };
    }
    // 404 = the route does not exist on this deployment; 501 = the typed
    // NOT_WIRED envelope. Both mean: the account family is not mounted —
    // named verbatim, never faked.
    return {
      ok: false,
      failure: {
        outcome: "not-wired",
        detail: `${pendingRoute} answered ${describeHttpStatus(response.status, bodyText)} — the account surface is not mounted on this API deployment.`,
        code: typed.code,
        param: typed.param,
        pendingRoute,
        httpStatus: response.status,
      },
    };
  }

  if (response.status === 401) {
    const typed = typedEnvelope(bodyText);
    return {
      ok: false,
      failure: {
        outcome: "unauthenticated",
        detail:
          typed.message !== null
            ? `${pendingRoute} answered 401 — ${typed.message}`
            : `${pendingRoute} answered 401 — the session is missing, invalid or expired; sign in again.`,
        code: typed.code ?? "UNAUTHENTICATED",
        param: typed.param,
        pendingRoute,
        httpStatus: 401,
      },
    };
  }

  if (!response.ok) {
    const typed = typedEnvelope(bodyText);
    return {
      ok: false,
      failure: {
        outcome: "error",
        detail: `${pendingRoute} answered ${describeHttpStatus(response.status, bodyText)}.`,
        code: typed.code,
        param: typed.param,
        pendingRoute,
        httpStatus: response.status,
      },
    };
  }

  if (response.status === 204) {
    // The documented no-content success (logout / revoke).
    return { ok: true, status: 204, body: null };
  }

  const body = parseJson(bodyText);
  if (body === undefined) {
    return {
      ok: false,
      failure: {
        outcome: "error",
        detail: `${pendingRoute} answered ${response.status} but the body was not valid JSON — the response was withheld rather than guessed.`,
        code: null,
        param: null,
        pendingRoute,
        httpStatus: response.status,
      },
    };
  }

  return { ok: true, status: response.status, body };
}

/** Validate a 2xx body against a frozen contract schema — mismatch is an honest ERROR, never a reshape. */
function contractValidated<T>(
  pendingRoute: string,
  schema: { safeParse: (data: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } },
  body: unknown,
): AccountSurfaceResult<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      failure: {
        outcome: "error",
        detail: `${pendingRoute} answered 2xx but the body violated the frozen account contract (${formatIssues(
          parsed.error.issues,
        )}) — the response was withheld rather than guessed.`,
        code: "CONTRACT_VIOLATION",
        param: null,
        pendingRoute,
        httpStatus: 200,
      },
    };
  }
  return { ok: true, data: parsed.data };
}

/* ================================================================== *
 * Signup / login / logout
 * ================================================================== */

export interface SignupInput {
  readonly email: string;
  readonly password: string;
  readonly fullName: string;
  readonly workspaceName: string;
}

/** POST /v1/account/signup — 201 with the account + its FIRST session (token shown once). */
export async function accountSignup(
  endpoint: AccountEndpoint,
  input: SignupInput,
  fetchImpl: FetchLike,
): Promise<AccountSurfaceResult<AccountSessionResponse>> {
  const parsedRequest = SignupRequestSchema.safeParse(input);
  if (!parsedRequest.success) {
    return {
      ok: false,
      failure: validationFailure(
        ACCOUNT_ROUTES.signup,
        `The signup request failed contract validation before it was sent — ${formatIssues(parsedRequest.error.issues)}.`,
      ),
    };
  }
  const result = await attemptAccountCall(
    endpoint,
    ACCOUNT_ROUTES.signup,
    "/v1/account/signup",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsedRequest.data),
    },
    fetchImpl,
    { session: false },
  );
  if (!result.ok) return result;
  return contractValidated(ACCOUNT_ROUTES.signup, AccountSessionResponseSchema, result.body);
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

/** POST /v1/account/login — 200 with a fresh session (401 on bad credentials). */
export async function accountLogin(
  endpoint: AccountEndpoint,
  input: LoginInput,
  fetchImpl: FetchLike,
): Promise<AccountSurfaceResult<AccountSessionResponse>> {
  const parsedRequest = LoginRequestSchema.safeParse(input);
  if (!parsedRequest.success) {
    return {
      ok: false,
      failure: validationFailure(
        ACCOUNT_ROUTES.login,
        `The login request failed contract validation before it was sent — ${formatIssues(parsedRequest.error.issues)}.`,
      ),
    };
  }
  const result = await attemptAccountCall(
    endpoint,
    ACCOUNT_ROUTES.login,
    "/v1/account/login",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsedRequest.data),
    },
    fetchImpl,
    { session: false },
  );
  if (!result.ok) return result;
  return contractValidated(ACCOUNT_ROUTES.login, AccountSessionResponseSchema, result.body);
}

/** POST /v1/account/logout — 204; the session token is revoked server-side. */
export async function accountLogout(
  endpoint: AccountEndpoint,
  fetchImpl: FetchLike,
): Promise<AccountSurfaceResult<{ revoked: true }>> {
  const result = await attemptAccountCall(
    endpoint,
    ACCOUNT_ROUTES.logout,
    "/v1/account/logout",
    { method: "POST" },
    fetchImpl,
  );
  if (!result.ok) return result;
  if (result.status !== 204) {
    return {
      ok: false,
      failure: {
        outcome: "error",
        detail: `${ACCOUNT_ROUTES.logout} answered ${result.status} — the frozen contract specifies 204 no content; the observed response was withheld rather than guessed.`,
        code: "CONTRACT_VIOLATION",
        param: null,
        pendingRoute: ACCOUNT_ROUTES.logout,
        httpStatus: result.status,
      },
    };
  }
  return { ok: true, data: { revoked: true as const } };
}

/* ================================================================== *
 * Account keys (session-authenticated)
 * ================================================================== */

/** GET /v1/account/keys — the account's keys, newest first (metadata only). */
export async function listAccountKeys(
  endpoint: AccountEndpoint,
  fetchImpl: FetchLike,
): Promise<AccountSurfaceResult<readonly AccountKey[]>> {
  const result = await attemptAccountCall(
    endpoint,
    ACCOUNT_ROUTES.listKeys,
    "/v1/account/keys",
    { method: "GET" },
    fetchImpl,
  );
  if (!result.ok) return result;
  const envelope = isRecord(result.body) && Array.isArray(result.body["keys"]) ? result.body["keys"] : null;
  if (envelope === null) {
    return {
      ok: false,
      failure: {
        outcome: "error",
        detail: `${ACCOUNT_ROUTES.listKeys} answered 2xx but the body was not the { keys: [...] } envelope — the response was withheld rather than guessed.`,
        code: "CONTRACT_VIOLATION",
        param: null,
        pendingRoute: ACCOUNT_ROUTES.listKeys,
        httpStatus: 200,
      },
    };
  }
  const keys: AccountKey[] = [];
  for (const row of envelope) {
    const parsed = AccountKeySchema.safeParse(row);
    if (!parsed.success) {
      return {
        ok: false,
        failure: {
          outcome: "error",
          detail: `${ACCOUNT_ROUTES.listKeys} answered 2xx but a key row violated the frozen account contract (${formatIssues(
            parsed.error.issues,
          )}) — the response was withheld rather than guessed.`,
          code: "CONTRACT_VIOLATION",
          param: null,
          pendingRoute: ACCOUNT_ROUTES.listKeys,
          httpStatus: 200,
        },
      };
    }
    keys.push(parsed.data);
  }
  return { ok: true, data: keys };
}

export interface CreateAccountKeyInput {
  readonly kind: "secret" | "publishable";
  readonly mode: "live" | "test";
}

/** POST /v1/account/keys — mint a key; the RAW key appears in the response EXACTLY ONCE. */
export async function createAccountKey(
  endpoint: AccountEndpoint,
  input: CreateAccountKeyInput,
  fetchImpl: FetchLike,
): Promise<AccountSurfaceResult<AccountKeyCreated>> {
  const parsedRequest = CreateKeyRequestSchema.safeParse(input);
  if (!parsedRequest.success) {
    return {
      ok: false,
      failure: validationFailure(
        ACCOUNT_ROUTES.createKey,
        `The create-key request failed contract validation before it was sent — ${formatIssues(parsedRequest.error.issues)}.`,
      ),
    };
  }
  const result = await attemptAccountCall(
    endpoint,
    ACCOUNT_ROUTES.createKey,
    "/v1/account/keys",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsedRequest.data),
    },
    fetchImpl,
  );
  if (!result.ok) return result;
  return contractValidated(ACCOUNT_ROUTES.createKey, AccountKeyCreatedSchema, result.body);
}

/** DELETE /v1/account/keys/{keyId} — revoke (204); the key stops authenticating immediately. */
export async function revokeAccountKey(
  endpoint: AccountEndpoint,
  keyId: string,
  fetchImpl: FetchLike,
): Promise<AccountSurfaceResult<{ revoked: true }>> {
  const pendingRoute = ACCOUNT_ROUTES.revokeKey(keyId);
  if (typeof keyId !== "string" || keyId.trim().length === 0) {
    return {
      ok: false,
      failure: validationFailure(pendingRoute, "A key id is required."),
    };
  }
  const result = await attemptAccountCall(
    endpoint,
    pendingRoute,
    `/v1/account/keys/${encodeURIComponent(keyId.trim())}`,
    { method: "DELETE" },
    fetchImpl,
  );
  if (!result.ok) return result;
  if (result.status !== 204) {
    return {
      ok: false,
      failure: {
        outcome: "error",
        detail: `${pendingRoute} answered ${result.status} — the frozen contract specifies 204 no content; the observed response was withheld rather than guessed.`,
        code: "CONTRACT_VIOLATION",
        param: null,
        pendingRoute,
        httpStatus: result.status,
      },
    };
  }
  return { ok: true, data: { revoked: true as const } };
}
