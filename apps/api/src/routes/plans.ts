import type { FastifyInstance } from "fastify";
import { CONTRACT_IDS, ExperiencePlanSchema } from "@reckon/contracts";
import { ReplanRequestSchema } from "../envelopes.js";
import { authPreHandler, runContractRoute } from "./shared.js";
import type { RouteDeps } from "./shared.js";

export function registerPlanRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post(
    "/v1/plans",
    { preHandler: [authPreHandler(deps, "plans")] },
    async (request, reply) => {
      await runContractRoute(deps, request, reply, {
        contractId: CONTRACT_IDS.experiencePlan,
        requestSchema: ExperiencePlanSchema,
        responseSchema: ExperiencePlanSchema,
        tenantFromBody: (plan) => plan.tenant,
        responseTenantOf: (plan) => plan.tenant,
        execute: (plan, auth) => deps.handlers.planHandler.create(plan, auth),
      });
    },
  );

  app.post<{ Params: { planId: string } }>(
    "/v1/plans/:planId/replan",
    { preHandler: [authPreHandler(deps, "plans")] },
    async (request, reply) => {
      await runContractRoute(deps, request, reply, {
        contractId: "reckon.api.replan-request",
        responseContractId: CONTRACT_IDS.experiencePlan,
        requestSchema: ReplanRequestSchema,
        responseSchema: ExperiencePlanSchema,
        responseTenantOf: (plan) => plan.tenant,
        execute: (body, auth) =>
          deps.handlers.planHandler.replan(request.params.planId, body, auth),
      });
    },
  );
}
