import type { FastifyInstance } from "fastify";
import {
  CONTRACT_IDS,
  CatalogItemSchema,
  DecisionRequestSchema,
  DecisionResultSchema,
  type CatalogItem,
  type ExpansionAllowlist,
} from "@reckon/contracts";
import { ApiError, ERROR_CODES } from "../errors.js";
import { assertResponseTenant } from "../tenant.js";
import { authPreHandler, requireAuth, runContractRoute, validateHandlerResponse } from "./shared.js";
import type { RouteDeps } from "./shared.js";
import { parseExpansion, wantsNestedExpand } from "../expansion.js";
import type { AuthContext } from "../types.js";

/** Expandable references on the decision detail surface (S2-001). */
const DECISION_EXPANSIONS: ExpansionAllowlist = {
  /** The selected experience's catalog item (nested field.subfield expansion). */
  selectedExperience: { item: {} },
};

function catalogTenant(auth: AuthContext): { tenantId: string; workspaceId?: string } {
  return auth.workspaceId !== undefined
    ? { tenantId: auth.tenantId, workspaceId: auth.workspaceId }
    : { tenantId: auth.tenantId };
}

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

  // S2-001 expansion: `?expand[]=selectedExperience.item` embeds the
  // selected experience's catalog item (validated, tenant-scoped).
  app.get<{ Params: { decisionId: string } }>(
    "/v1/decisions/:decisionId",
    { preHandler: [authPreHandler(deps, "decisions")] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const decisionId = request.params.decisionId;
      const expansion = parseExpansion(request.query as Record<string, unknown>, DECISION_EXPANSIONS);
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
      const payload = parsed as unknown as Record<string, unknown>;
      if (wantsNestedExpand(expansion, "selectedExperience", "item")) {
        const selected = payload.selectedExperience as Record<string, unknown> | undefined;
        if (selected !== undefined) {
          const item: CatalogItem | null = await deps.handlers.catalogReader.getItem(
            catalogTenant(auth),
            String(selected.itemId),
          );
          selected.item =
            item === null ? null : validateHandlerResponse(CatalogItemSchema, item, CONTRACT_IDS.catalogItem);
        }
      }
      reply.code(200).send(payload);
    },
  );
}
