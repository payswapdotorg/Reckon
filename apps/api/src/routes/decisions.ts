import type { FastifyInstance } from "fastify";
import { CONTRACT_IDS, DecisionRequestSchema, DecisionResultSchema } from "@reckon/contracts";
import { ApiError, ERROR_CODES } from "../errors.js";
import { assertResponseTenant } from "../tenant.js";
import { authPreHandler, requireAuth, runContractRoute, validateHandlerResponse } from "./shared.js";
import type { RouteDeps } from "./shared.js";

export function registerDecisionRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post(
    "/v1/decisions",
    { preHandler: [authPreHandler(deps, "decisions")] },
    async (request, reply) => {
      await runContractRoute(deps, request, reply, {
        contractId: CONTRACT_IDS.decisionRequest,
        responseContractId: CONTRACT_IDS.decisionResult,
        requestSchema: DecisionRequestSchema,
        responseSchema: DecisionResultSchema,
        tenantFromBody: (body) => body.tenant,
        responseTenantOf: (result) => result.tenant,
        idempotencyFromBody: (body) => body.idempotencyKey,
        execute: (body, auth) => deps.handlers.decisionHandler.decide(body, auth),
      });
    },
  );

  app.get<{ Params: { decisionId: string } }>(
    "/v1/decisions/:decisionId",
    { preHandler: [authPreHandler(deps, "decisions")] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const decisionId = request.params.decisionId;
      const found = await deps.handlers.decisionStore.get(auth.tenantId, decisionId);
      if (found === null) {
        throw new ApiError(ERROR_CODES.NOT_FOUND, 404, `Decision not found: ${decisionId}`, {
          decisionId,
        });
      }
      const parsed = validateHandlerResponse(
        DecisionResultSchema,
        found,
        CONTRACT_IDS.decisionResult,
      );
      assertResponseTenant(auth, parsed.tenant);
      reply.code(200).send(parsed);
    },
  );
}
