import type { FastifyReply, FastifyRequest } from "fastify";
import {
  IDEMPOTENT_REPLAYED_HEADER,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_WINDOW_MS,
  IdSchema,
  X_RECKON_MODE_HEADER,
  contentDigest,
  type ApiVersionRegistry,
  type TenantScope,
} from "@reckon/contracts";
import { ApiError, ERROR_CODES } from "../errors.js";
import type { KeyAuthenticator } from "../auth.js";
import type { IdempotencyStore, StoredIdempotent } from "../idempotency.js";
import type { HandlerPorts } from "../ports.js";
import type { TestModeDecisionStore } from "../test-mode.js";
import type { RequestRateLimiter } from "../rate-limit.js";
import type { AuthContext, Scope, Validator } from "../types.js";
import { assertRequestTenant, assertResponseTenant, assertTenantHeader, peekBodyTenant } from "../tenant.js";
import { resolveRequestVersion } from "../versioning.js";

export interface RouteDeps {
  readonly keyStore: KeyAuthenticator;
  readonly idempotency: IdempotencyStore;
  /** S2-003: SEPARATE idempotency scope for test-mode traffic (test state never mixes with live state). */
  readonly testIdempotency: IdempotencyStore;
  readonly handlers: HandlerPorts;
  /** S2-003: mode-isolated store for canned test-mode decisions (live keys reach it only via the cross-mode probe). */
  readonly testDecisionStore: TestModeDecisionStore;
  readonly apiVersion: string;
  /** S2-001: version registry + pinned default for X-Reckon-Version negotiation. */
  readonly versionRegistry: ApiVersionRegistry;
  readonly defaultApiVersion: string;
  /** S2-001: per-key rate limiter (absent = disabled). */
  readonly rateLimiter?: RequestRateLimiter;
  /** S2-001: injected clock (idempotency window + replay expiry). */
  readonly clock: () => number;
}

/**
 * Auth middleware (Fastify preHandler), S2-001-hardened, S2-003
 * mode-marked. The fixed order (documented law — later checks assume
 * earlier ones passed):
 *
 *   401 authenticate (bearer key; pk_ keys rejected as typed
 *      authentication_error)
 *   → X-Reckon-Mode marker (S2-003: every authenticated response —
 *      success or typed error — carries the key's mode; test traffic
 *      is always identifiable)
 *   → 429 rate limit (per-key fixed window, when configured)
 *   → 400 API version (X-Reckon-Version vs the registry)
 *   → 403 scope (route family)
 *   → 403 tenant header + security-first body tenant peek
 *   → (route) 403 live-mode test-hint guard (S2-003, decision path)
 *      → 400 validation → 422/replay idempotency (mode-scoped store)
 *      → 501/2xx handler (test-mode decisions: canned engine, never
 *      the live handler)
 */
export function authPreHandler(deps: RouteDeps, scope: Scope) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // TL6-001: the authenticator seam may be async (the DB account-key
    // fallback); awaiting a sync result is a no-op, so the static KeyStore
    // path is byte-identical.
    const auth = await deps.keyStore.authenticate(request.headers.authorization);
    request.reckonAuth = auth;
    reply.header(X_RECKON_MODE_HEADER, auth.mode);
    if (deps.rateLimiter !== undefined) {
      // TL6-001: tier-aware check — DB-minted keys carry their tier's
      // limit; static (tierless) keys keep the flat default limit.
      deps.rateLimiter.check(auth.keyHash, auth.tier);
    }
    const resolvedVersion = resolveRequestVersion(
      deps.versionRegistry,
      deps.defaultApiVersion,
      firstHeader(request.headers["x-reckon-version"]),
    );
    request.reckonApiVersion = resolvedVersion.version;
    reply.header("x-reckon-version", resolvedVersion.version);
    if (!auth.scopes.has(scope)) {
      throw new ApiError(
        ERROR_CODES.INSUFFICIENT_SCOPE,
        403,
        `API key does not grant the '${scope}' scope required by this route`,
        { requiredScope: scope, grantedScopes: [...auth.scopes] },
      );
    }
    assertTenantHeader(auth, request);
    peekBodyTenant(auth, request.body);
  };
}

function firstHeader(raw: number | string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value : undefined;
}

export function requireAuth(request: FastifyRequest): AuthContext {
  const auth = request.reckonAuth;
  if (auth === undefined) {
    throw new ApiError(
      ERROR_CODES.INTERNAL,
      500,
      "Auth context missing: the auth preHandler did not run for this route",
    );
  }
  return auth;
}

/** The idempotency namespace: method + path (path ids included on purpose). */
export function requestRouteKey(request: FastifyRequest): string {
  const path = request.url.split("?")[0] ?? request.url;
  return `${request.method} ${path}`;
}

export function formatIssue(issue: {
  readonly path: readonly PropertyKey[];
  readonly message: string;
  readonly code: string;
}): { path: string; message: string; code: string } {
  const path = issue.path.map((segment) => String(segment)).join(".");
  const message =
    typeof issue.message === "string" && issue.message.length > 0 ? issue.message : "invalid value";
  return { path, message, code: String(issue.code) };
}

/** Validate a request body against a REAL imported contract schema → typed 400 (param = first issue path). */
export function parseRequestBody<Body>(
  schema: Validator<Body>,
  request: FastifyRequest,
  contractId: string,
): Body {
  const result = schema.safeParse(request.body);
  if (!result.success) {
    const issues = result.error.issues.map(formatIssue);
    throw new ApiError(
      ERROR_CODES.VALIDATION_ERROR,
      400,
      `Request body failed ${contractId} validation`,
      { schema: contractId, issues },
      issues[0]?.path !== undefined && issues[0]?.path !== "" ? issues[0]?.path : undefined,
    );
  }
  return result.data;
}

/** Validate a handler's output against a contract schema → typed 500. */
export function validateHandlerResponse<Res>(
  schema: Validator<Res>,
  output: Res,
  contractId: string,
): Res {
  const result = schema.safeParse(output);
  if (!result.success) {
    throw new ApiError(
      ERROR_CODES.HANDLER_RESPONSE_INVALID,
      500,
      `Handler output failed ${contractId} validation`,
      { schema: contractId, issues: result.error.issues.map(formatIssue) },
    );
  }
  return result.data;
}

/**
 * Idempotency key resolution:
 * - contracts that carry a body-level idempotencyKey (DecisionRequest,
 *   OutcomeEvent) are authoritative; a header, if present, must match;
 * - every other POST requires the Idempotency-Key header (validated with
 *   the real IdSchema).
 */
export function resolveIdempotencyKey(
  bodyKey: string | undefined,
  request: FastifyRequest,
  contractId: string,
): string {
  const headerKey = firstHeader(request.headers[IDEMPOTENCY_KEY_HEADER]);
  if (bodyKey !== undefined) {
    if (headerKey !== undefined && headerKey !== "" && headerKey !== bodyKey) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_ERROR,
        400,
        "Idempotency-Key header does not match the idempotencyKey in the request body",
        { schema: contractId, header: headerKey, body: bodyKey },
        IDEMPOTENCY_KEY_HEADER,
      );
    }
    return bodyKey;
  }
  if (headerKey === undefined || headerKey === "") {
    throw new ApiError(
      ERROR_CODES.VALIDATION_ERROR,
      400,
      "Idempotency-Key header is required for this operation",
      { schema: contractId },
      IDEMPOTENCY_KEY_HEADER,
    );
  }
  const parsed = IdSchema.safeParse(headerKey);
  if (!parsed.success) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_ERROR,
      400,
      "Idempotency-Key header is not a valid Reckon id (1-128 chars, url-safe)",
      { schema: contractId, header: headerKey },
      IDEMPOTENCY_KEY_HEADER,
    );
  }
  return parsed.data;
}

export interface RouteSpec<Body, Res> {
  /** Contract id of the request schema (error details / labels). */
  readonly contractId: string;
  /** Contract id of the response schema (defaults to contractId). */
  readonly responseContractId?: string;
  readonly requestSchema: Validator<Body>;
  readonly responseSchema: Validator<Res>;
  /** Where the frozen request contract carries a tenant scope. */
  readonly tenantFromBody?: (body: Body) => TenantScope | undefined;
  /** Where the frozen response contract carries a tenant scope (invariant check). */
  readonly responseTenantOf?: (res: Res) => TenantScope | undefined;
  /** Body-level idempotency key when the frozen contract defines one. */
  readonly idempotencyFromBody?: (body: Body) => string | undefined;
  /** Post-parse response shaping (schema echo injection for envelope routes). */
  readonly transformResponse?: (res: Res) => unknown;
  readonly execute: (body: Body, auth: AuthContext) => Promise<Res>;
}

/**
 * S2-003: the idempotency scope for a request — SEPARATE stores keyed
 * by the key's mode. A test key replays only test traffic; a live key
 * only live traffic; the two scopes never observe each other's
 * entries (test state never mixes with live state).
 */
export function idempotencyForMode(deps: RouteDeps, auth: AuthContext): IdempotencyStore {
  return auth.mode === "test" ? deps.testIdempotency : deps.idempotency;
}

/** A stored idempotent entry is a replay candidate only inside the window (absent storedAt = non-expiring). */
function isWithinWindow(stored: StoredIdempotent, now: number): boolean {
  if (stored.storedAt === undefined) return true;
  return now - stored.storedAt < IDEMPOTENCY_WINDOW_MS;
}

/**
 * The full contract-route pipeline, shared by every POST route:
 * auth (done in preHandler) → body tenant check → validation →
 * idempotency replay/conflict → handler execution → response validation
 * → response tenant invariant → 200 with schema echo + idempotency
 * headers.
 *
 * S2-001: replays carry BOTH `Idempotent-Replayed: true` (the new law)
 * and the legacy lowercase `idempotent-replay: true` header; conflicts
 * answer 422 IDEMPOTENCY_CONFLICT (typed invalid_request_error); stored
 * responses expire after the 24h window (then the key executes fresh).
 *
 * S2-003: the idempotency scope is MODE-KEYED — test-mode requests
 * replay from the separate test store (never live entries) and
 * vice versa.
 */
export async function runContractRoute<Body, Res>(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  spec: RouteSpec<Body, Res>,
): Promise<void> {
  const auth = requireAuth(request);
  const idempotency = idempotencyForMode(deps, auth);
  const body = parseRequestBody(spec.requestSchema, request, spec.contractId);
  const bodyTenant = spec.tenantFromBody?.(body);
  if (bodyTenant !== undefined) assertRequestTenant(auth, bodyTenant);
  const idempotencyKey = resolveIdempotencyKey(spec.idempotencyFromBody?.(body), request, spec.contractId);
  const routeKey = requestRouteKey(request);
  const requestDigest = contentDigest(body);
  const now = deps.clock();

  const stored = await idempotency.lookup(auth.tenantId, routeKey, idempotencyKey);
  if (stored !== undefined && isWithinWindow(stored, now)) {
    if (stored.requestDigest !== requestDigest) {
      throw new ApiError(
        ERROR_CODES.IDEMPOTENCY_CONFLICT,
        422,
        `Idempotency key '${idempotencyKey}' was already used with a different request body`,
        { idempotencyKey },
        IDEMPOTENCY_KEY_HEADER,
      );
    }
    for (const [name, value] of Object.entries(stored.response.headers ?? {})) {
      reply.header(name, value);
    }
    reply.header(IDEMPOTENCY_KEY_HEADER, idempotencyKey);
    reply.header(IDEMPOTENT_REPLAYED_HEADER, "true");
    reply.header("idempotent-replay", "true");
    reply.code(stored.response.statusCode).send(stored.response.body);
    return;
  }

  const result = await spec.execute(body, auth);
  const parsed = validateHandlerResponse(
    spec.responseSchema,
    result,
    spec.responseContractId ?? spec.contractId,
  );
  const responseTenant = spec.responseTenantOf?.(parsed);
  if (responseTenant !== undefined) assertResponseTenant(auth, responseTenant);
  const payload = spec.transformResponse !== undefined ? spec.transformResponse(parsed) : parsed;

  reply.code(200);
  reply.header(IDEMPOTENCY_KEY_HEADER, idempotencyKey);
  await idempotency.store(auth.tenantId, routeKey, idempotencyKey, requestDigest, {
    statusCode: 200,
    body: payload,
  });
  reply.send(payload);
}
