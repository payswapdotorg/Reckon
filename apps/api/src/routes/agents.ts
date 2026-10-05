import type { FastifyInstance } from "fastify";
import { AgentBodySchema, AgentOrganizationSchema, CONTRACT_IDS } from "@reckon/contracts";
import { ApiError, ERROR_CODES } from "../errors.js";
import { assertResponseTenant } from "../tenant.js";
import { authPreHandler, requireAuth, runContractRoute, validateHandlerResponse } from "./shared.js";
import type { RouteDeps } from "./shared.js";
import { fetchSizeFor, paginationMeta, parsePaginationParams, slicePage } from "../pagination.js";

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

  // S2-001: cursor pagination (limit 1..100 default 20, starting_after,
  // has_more + next_cursor). Ordering: newest bodies first (stable).
  app.get(
    "/v1/agents/bodies",
    { preHandler: [authPreHandler(deps, "agents")] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const params = parsePaginationParams(request.query as Record<string, unknown>);
      const bodies = await deps.handlers.agentHandler.listBodies(auth, fetchSizeFor(params));
      const validated = bodies.map((body) =>
        validateHandlerResponse(AgentBodySchema, body, CONTRACT_IDS.agentBody),
      );
      const page = slicePage(validated, params, (body) => body.bodyId);
      reply.code(200).send({ bodies: page.items, ...paginationMeta(page) });
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

  // S2-001: cursor pagination — same contract as /v1/agents/bodies.
  app.get(
    "/v1/agents/organizations",
    { preHandler: [authPreHandler(deps, "agents")] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const params = parsePaginationParams(request.query as Record<string, unknown>);
      const organizations = await deps.handlers.agentHandler.listOrganizations(auth, fetchSizeFor(params));
      const validated = organizations.map((organization) =>
        validateHandlerResponse(
          AgentOrganizationSchema,
          organization,
          CONTRACT_IDS.agentOrganization,
        ),
      );
      const page = slicePage(validated, params, (organization) => organization.organizationId);
      reply.code(200).send({ organizations: page.items, ...paginationMeta(page) });
    },
  );
}
