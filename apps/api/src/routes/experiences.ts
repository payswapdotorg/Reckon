import type { FastifyInstance } from "fastify";
import { CONTRACT_IDS, CONTRACT_VERSIONS } from "@reckon/contracts";
import { ResolveRequestSchema, ResolveResponseSchema } from "../envelopes.js";
import { authPreHandler, runContractRoute } from "./shared.js";
import type { RouteDeps } from "./shared.js";

/**
 * Experience resolution (item/realization references → concrete
 * experiences): the decision-input expansion surface, gated by the
 * `decisions` scope. The response envelope echoes the registered
 * Experience contract id + version while each element is validated against
 * the real ExperienceSchema (see envelopes.ts).
 */
export function registerExperienceRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post(
    "/v1/experiences/resolve",
    { preHandler: [authPreHandler(deps, "decisions")] },
    async (request, reply) => {
      await runContractRoute(deps, request, reply, {
        contractId: "reckon.api.resolve-request",
        responseContractId: CONTRACT_IDS.experience,
        requestSchema: ResolveRequestSchema,
        responseSchema: ResolveResponseSchema,
        transformResponse: (response) => ({
          schema: CONTRACT_IDS.experience,
          schemaVersion: CONTRACT_VERSIONS[CONTRACT_IDS.experience],
          experiences: response.experiences,
        }),
        execute: (body, auth) => deps.handlers.experienceResolver.resolve(body, auth),
      });
    },
  );
}
