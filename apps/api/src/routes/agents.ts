import type { FastifyInstance } from "fastify";
import { AgentBodySchema, AgentOrganizationSchema, CONTRACT_IDS } from "@reckon/contracts";
import { ApiError, ERROR_CODES } from "../errors.js";
import { assertResponseTenant } from "../tenant.js";
import { authPreHandler, requireAuth, runContractRoute, validateHandlerResponse } from "./shared.js";
import type { RouteDeps } from "./shared.js";

/**
 * Agent declaration surface (UI-007): tenant scope from AUTH (catalog
 * pattern — the frozen AgentBody/AgentOrganization contracts carry no
 * tenant field). POST creates/version-appends (idempotent by content
 * digest); GET reads latest by id or recent list.
 */
export function registerAgentRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post(
    "/v1/agents/bodies",
    { preHandler: [authPreHandler(deps, "agents")] },
    async (request, reply) => {
      await runContractRoute(deps, request, reply, {
        contractId: CONTRACT_IDS.agentBody,
        requestSchema: AgentBodySchema,
        responseSchema: AgentBodySchema,
        tenantFromBody: () => ({ tenantId: requireAuth(request).tenantId }),
        responseTenantOf: () => ({ tenantId: requireAuth(request).tenantId }),
        execute: (body, auth) => deps.handlers.agentHandler.createBody(body, auth),
      });
    },
  );

  app.get<{ Params: { bodyId: string } }>(
    "/v1/agents/bodies/:bodyId",
    { preHandler: [authPreHandler(deps, "agents")] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const found = await deps.handlers.agentHandler.getBody(request.params.bodyId, auth);
      if (found === null) {
        throw new ApiError(ERROR_CODES.NOT_FOUND, 404, `Agent body not found: ${request.params.bodyId}`, {
          bodyId: request.params.bodyId,
        });
      }
      const parsed = validateHandlerResponse(AgentBodySchema, found, CONTRACT_IDS.agentBody);
      reply.code(200).send(parsed);
    },
  );

  app.get<{ Querystring: { limit?: string } }>(
    "/v1/agents/bodies",
    { preHandler: [authPreHandler(deps, "agents")] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const limit = boundedLimit(request.query.limit);
      const bodies = await deps.handlers.agentHandler.listBodies(auth, limit);
      const parsed = bodies.map((body) =>
        validateHandlerResponse(AgentBodySchema, body, CONTRACT_IDS.agentBody),
      );
      reply.code(200).send({ bodies: parsed });
    },
  );

  app.post(
    "/v1/agents/organizations",
    { preHandler: [authPreHandler(deps, "agents")] },
    async (request, reply) => {
      await runContractRoute(deps, request, reply, {
        contractId: CONTRACT_IDS.agentOrganization,
        requestSchema: AgentOrganizationSchema,
        responseSchema: AgentOrganizationSchema,
        tenantFromBody: () => ({ tenantId: requireAuth(request).tenantId }),
        responseTenantOf: () => ({ tenantId: requireAuth(request).tenantId }),
        execute: (organization, auth) =>
          deps.handlers.agentHandler.createOrganization(organization, auth),
      });
    },
  );

  app.get<{ Params: { organizationId: string } }>(
    "/v1/agents/organizations/:organizationId",
    { preHandler: [authPreHandler(deps, "agents")] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const found = await deps.handlers.agentHandler.getOrganization(
        request.params.organizationId,
        auth,
      );
      if (found === null) {
        throw new ApiError(
          ERROR_CODES.NOT_FOUND,
          404,
          `Agent organization not found: ${request.params.organizationId}`,
          { organizationId: request.params.organizationId },
        );
      }
      const parsed = validateHandlerResponse(
        AgentOrganizationSchema,
        found,
        CONTRACT_IDS.agentOrganization,
      );
      reply.code(200).send(parsed);
    },
  );

  app.get<{ Querystring: { limit?: string } }>(
    "/v1/agents/organizations",
    { preHandler: [authPreHandler(deps, "agents")] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const limit = boundedLimit(request.query.limit);
      const organizations = await deps.handlers.agentHandler.listOrganizations(auth, limit);
      const parsed = organizations.map((organization) =>
        validateHandlerResponse(
          AgentOrganizationSchema,
          organization,
          CONTRACT_IDS.agentOrganization,
        ),
      );
      reply.code(200).send({ organizations: parsed });
    },
  );
}

function boundedLimit(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 20;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 400, `limit must be an integer 1..100, got '${raw}'`, {
      limit: raw,
    });
  }
  return parsed;
}
