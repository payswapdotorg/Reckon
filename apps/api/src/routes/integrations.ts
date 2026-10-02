import type { FastifyInstance } from "fastify";
import { authPreHandler, requireAuth } from "./shared.js";
import type { RouteDeps } from "./shared.js";

/**
 * Integration declaration surface (UI-009): the adapter declarations
 * from @reckon/integrations — static product truth (no tenant data),
 * auth-gated by the `integrations` scope. The §14 honesty law is
 * structural here: liveVerification is fixture-only until a real
 * provider path is verified, so the response can never claim
 * "connected".
 */
export function registerIntegrationRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get(
    "/v1/integrations/adapters",
    { preHandler: [authPreHandler(deps, "integrations")] },
    async (_request, reply) => {
      requireAuth(_request);
      const adapters = await deps.handlers.integrationHandler.listAdapters();
      reply.code(200).send({ adapters });
    },
  );
}
