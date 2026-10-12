import type { FastifyInstance } from "fastify";
import {
  AdForgetRequestSchema,
  AdForgetResultSchema,
  AdQueryRequestSchema,
  AdQueryResultSchema,
} from "@reckon/contracts";
import { authPreHandler, runContractRoute } from "./shared.js";
import type { RouteDeps } from "./shared.js";

/**
 * AD-003 — the /v1/ads route family (scope: `ads`).
 *
 *   POST /v1/ads/query  — reckon.ad-query-request → reckon.ad-query-result
 *   POST /v1/ads/forget — reckon.ad-forget-request → reckon.ad-forget-result
 *
 * Both routes run the shared contract pipeline (auth → tenant law →
 * frozen-schema validation → idempotency replay/conflict → handler →
 * frozen-schema response validation → tenant invariant). The
 * contract-id labels below are the frozen contracts' own `schema`
 * literals — the CONTRACT_IDS registry predates the ad family and
 * carries no ad entries (frozen; recorded as a CONTRACT_GAP finding in
 * docs/architecture/ad-retrieval.md — never worked around by editing
 * contracts).
 *
 * Idempotency follows the body-key convention of decisions/outcomes:
 * the frozen ad contracts carry a body-level `idempotencyKey`
 * (OPTIONAL on AdQueryRequest, REQUIRED on AdForgetRequest). The
 * pipeline's resolveIdempotencyKey makes the body key authoritative
 * when present (a mismatching header is a typed 400) and requires the
 * Idempotency-Key header otherwise. The optional-body-key shape is
 * recorded as a UX_DX_GAP finding (the SDK hides it by always sending
 * a header for the query route).
 *
 * Determinism law: every temporal evaluation in the mounted handler
 * runs against the REQUIRED caller-supplied `at` — the route itself
 * never reads a clock.
 */
export function registerAdsRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post(
    "/v1/ads/query",
    { preHandler: [authPreHandler(deps, "ads")] },
    async (request, reply) => {
      await runContractRoute(deps, request, reply, {
        contractId: "reckon.ad-query-request",
        responseContractId: "reckon.ad-query-result",
        requestSchema: AdQueryRequestSchema,
        responseSchema: AdQueryResultSchema,
        tenantFromBody: (body) => body.tenant,
        responseTenantOf: (result) => result.tenant,
        idempotencyFromBody: (body) => body.idempotencyKey,
        execute: (body, auth) => deps.handlers.adRetrievalHandler.query(body, auth),
      });
    },
  );

  app.post(
    "/v1/ads/forget",
    { preHandler: [authPreHandler(deps, "ads")] },
    async (request, reply) => {
      await runContractRoute(deps, request, reply, {
        contractId: "reckon.ad-forget-request",
        responseContractId: "reckon.ad-forget-result",
        requestSchema: AdForgetRequestSchema,
        responseSchema: AdForgetResultSchema,
        tenantFromBody: (body) => body.tenant,
        responseTenantOf: (result) => result.tenant,
        idempotencyFromBody: (body) => body.idempotencyKey,
        execute: (body, auth) => deps.handlers.adRetrievalHandler.forget(body, auth),
      });
    },
  );
}
