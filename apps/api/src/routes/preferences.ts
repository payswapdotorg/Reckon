import type { FastifyInstance } from "fastify";
import { CONTRACT_IDS, PreferenceDeltaSchema } from "@reckon/contracts";
import { authPreHandler, runContractRoute } from "./shared.js";
import type { RouteDeps } from "./shared.js";

/**
 * POST /v1/preferences/events — preference delta ingestion. Gated by the
 * `outcomes` scope (the event-ingestion route family; preference events are
 * ingest events like outcomes). Idempotency via Idempotency-Key header
 * (the frozen PreferenceDelta contract has no body-level idempotencyKey).
 */
export function registerPreferenceRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post(
    "/v1/preferences/events",
    { preHandler: [authPreHandler(deps, "outcomes")] },
    async (request, reply) => {
      await runContractRoute(deps, request, reply, {
        contractId: CONTRACT_IDS.preferenceDelta,
        requestSchema: PreferenceDeltaSchema,
        responseSchema: PreferenceDeltaSchema,
        tenantFromBody: (delta) => delta.tenant,
        responseTenantOf: (delta) => delta.tenant,
        execute: (delta, auth) => deps.handlers.preferenceIngest.ingest(delta, auth),
      });
    },
  );
}
