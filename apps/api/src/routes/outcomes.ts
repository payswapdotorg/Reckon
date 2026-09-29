import type { FastifyInstance } from "fastify";
import { CONTRACT_IDS, OutcomeEventSchema } from "@reckon/contracts";
import { authPreHandler, runContractRoute } from "./shared.js";
import type { RouteDeps } from "./shared.js";

export function registerOutcomeRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post(
    "/v1/outcomes",
    { preHandler: [authPreHandler(deps, "outcomes")] },
    async (request, reply) => {
      await runContractRoute(deps, request, reply, {
        contractId: CONTRACT_IDS.outcomeEvent,
        requestSchema: OutcomeEventSchema,
        responseSchema: OutcomeEventSchema,
        tenantFromBody: (event) => event.tenant,
        responseTenantOf: (event) => event.tenant,
        idempotencyFromBody: (event) => event.idempotencyKey,
        execute: (event, auth) => deps.handlers.outcomeIngest.ingest(event, auth),
      });
    },
  );
}
