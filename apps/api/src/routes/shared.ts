import type { FastifyReply, FastifyRequest } from "fastify";
import { contentDigest, IdSchema } from "@reckon/contracts";
import type { TenantScope } from "@reckon/contracts";
import { ApiError, ERROR_CODES } from "../errors.js";
import type { KeyAuthenticator } from "../auth.js";
import type { IdempotencyStore } from "../idempotency.js";
import type { HandlerPorts } from "../ports.js";
import type { AuthContext, Scope, Validator } from "../types.js";
import { assertRequestTenant, assertResponseTenant, assertTenantHeader, peekBodyTenant } from "../tenant.js";

export interface RouteDeps {
  readonly keyStore: KeyAuthenticator;
  readonly idempotency: IdempotencyStore;
  readonly handlers: HandlerPorts;
  readonly apiVersion: string;
}

/**
 * Auth middleware (Fastify preHandler): authenticate the bearer key,
 * enforce the route's scope, enforce the advisory tenant header, and run
 * the security-first tenant peek on the raw body. Order is fixed:
 * 401 (auth) → 403 (scope) → 403 (tenant) → 400 (validation) → 409/replay
 * (idempotency) → 501/2xx (handler).
 */
export function authPreHandler(deps: RouteDeps, scope: Scope) {
  return async (request: FastifyRequest): Promise<void> => {
    const auth = deps.keyStore.authenticate(request.headers.authorization);
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
    request.reckonAuth = auth;
  };
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

/** Validate a request body against a REAL imported contract schema → typed 400. */
export function parseRequestBody<Body>(
  schema: Validator<Body>,
  request: FastifyRequest,
  contractId: string,
): Body {
  const result = schema.safeParse(request.body);
  if (!result.success) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_ERROR,
      400,
      `Request body failed ${contractId} validation`,
      { schema: contractId, issues: result.error.issues.map(formatIssue) },
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
  const raw = request.headers["idempotency-key"];
  const headerKey = Array.isArray(raw) ? raw[0] : raw;
  if (bodyKey !== undefined) {
    if (headerKey !== undefined && headerKey !== "" && headerKey !== bodyKey) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_ERROR,
        400,
        "Idempotency-Key header does not match the idempotencyKey in the request body",
        { schema: contractId, header: headerKey, body: bodyKey },
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
    );
  }
  const parsed = IdSchema.safeParse(headerKey);
  if (!parsed.success) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_ERROR,
      400,
      "Idempotency-Key header is not a valid Reckon id (1-128 chars, url-safe)",
      { schema: contractId, header: headerKey },
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
 * The full contract-route pipeline, shared by every POST route:
 * auth (done in preHandler) → body tenant check → validation → idempotency
 * replay/conflict → handler execution → response validation → response
 * tenant invariant → 200 with schema echo + idempotency-key header.
 */
export async function runContractRoute<Body, Res>(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  spec: RouteSpec<Body, Res>,
): Promise<void> {
  const auth = requireAuth(request);
  const body = parseRequestBody(spec.requestSchema, request, spec.contractId);
  const bodyTenant = spec.tenantFromBody?.(body);
  if (bodyTenant !== undefined) assertRequestTenant(auth, bodyTenant);
  const idempotencyKey = resolveIdempotencyKey(spec.idempotencyFromBody?.(body), request, spec.contractId);
  const routeKey = requestRouteKey(request);
  const requestDigest = contentDigest(body);

  const stored = await deps.idempotency.lookup(auth.tenantId, routeKey, idempotencyKey);
  if (stored !== undefined) {
    if (stored.requestDigest !== requestDigest) {
      throw new ApiError(
        ERROR_CODES.IDEMPOTENCY_CONFLICT,
        409,
        `Idempotency key '${idempotencyKey}' was already used with a different request body`,
        { idempotencyKey },
      );
    }
    for (const [name, value] of Object.entries(stored.response.headers ?? {})) {
      reply.header(name, value);
    }
    reply.header("idempotency-key", idempotencyKey);
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
  reply.header("idempotency-key", idempotencyKey);
  await deps.idempotency.store(auth.tenantId, routeKey, idempotencyKey, requestDigest, {
    statusCode: 200,
    body: payload,
  });
  reply.send(payload);
}
