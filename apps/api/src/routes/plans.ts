import type { FastifyInstance } from "fastify";
import { CONTRACT_IDS, ExperiencePlanSchema } from "@reckon/contracts";
import { ReplanRequestSchema } from "../envelopes.js";
import { ApiError, ERROR_CODES } from "../errors.js";
import { assertResponseTenant } from "../tenant.js";
import { authPreHandler, requireAuth, runContractRoute, validateHandlerResponse } from "./shared.js";
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

  // Read surface (P1/UI-005): plan lookup by id — latest version.
  app.get<{ Params: { planId: string } }>(
    "/v1/plans/:planId",
    { preHandler: [authPreHandler(deps, "plans")] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const planId = request.params.planId;
      const found = await deps.handlers.planHandler.get(planId, auth);
      if (found === null) {
        throw new ApiError(ERROR_CODES.NOT_FOUND, 404, `Plan not found: ${planId}`, { planId });
      }
      const parsed = validateHandlerResponse(ExperiencePlanSchema, found, CONTRACT_IDS.experiencePlan);
      assertResponseTenant(auth, parsed.tenant);
      reply.code(200).send(parsed);
    },
  );

  // Read surface (P1/UI-005): full version chain — the replan history.
  // Entries carry the plan (contract-frozen shape) plus the recorded replan
  // reason from persistence (the plan contract itself has no reason field).
  app.get<{ Params: { planId: string } }>(
    "/v1/plans/:planId/history",
    { preHandler: [authPreHandler(deps, "plans")] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const planId = request.params.planId;
      const versions = await deps.handlers.planHandler.history(planId, auth);
      if (versions.length === 0) {
        throw new ApiError(ERROR_CODES.NOT_FOUND, 404, `Plan not found: ${planId}`, { planId });
      }
      const parsedVersions = versions.map((entry) => ({
        plan: validateHandlerResponse(
          ExperiencePlanSchema,
          entry.plan,
          CONTRACT_IDS.experiencePlan,
        ),
        version: entry.version,
        reason: entry.reason,
      }));
      for (const entry of parsedVersions) assertResponseTenant(auth, entry.plan.tenant);
      reply.code(200).send({ versions: parsedVersions });
    },
  );

  // Read surface (P1/UI-005): recent plans (latest version each, newest first).
  app.get<{ Querystring: { limit?: string } }>(
    "/v1/plans",
    { preHandler: [authPreHandler(deps, "plans")] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const rawLimit = request.query.limit;
      let limit = 20;
      if (rawLimit !== undefined && rawLimit !== "") {
        const parsed = Number(rawLimit);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
          throw new ApiError(
            ERROR_CODES.VALIDATION_ERROR,
            400,
            `limit must be an integer 1..100, got '${rawLimit}'`,
            { limit: rawLimit },
          );
        }
        limit = parsed;
      }
      const plans = await deps.handlers.planHandler.listRecent(auth, limit);
      const parsedPlans = plans.map((plan) =>
        validateHandlerResponse(ExperiencePlanSchema, plan, CONTRACT_IDS.experiencePlan),
      );
      for (const plan of parsedPlans) assertResponseTenant(auth, plan.tenant);
      reply.code(200).send({ plans: parsedPlans });
    },
  );
}
