import type { FastifyInstance } from "fastify";
import type {
  CatalogItem,
  ExpansionAllowlist,
  ExpansionRequest,
  ExperiencePlan,
} from "@reckon/contracts";
import { CONTRACT_IDS, CatalogItemSchema, ExperiencePlanSchema } from "@reckon/contracts";
import { z } from "zod/v4";
import { ReplanRequestSchema } from "../envelopes.js";
import { ApiError, ERROR_CODES } from "../errors.js";
import type { StoredPlanVersionView } from "../ports.js";
import { assertResponseTenant } from "../tenant.js";
import { authPreHandler, requireAuth, runContractRoute, validateHandlerResponse } from "./shared.js";
import type { RouteDeps } from "./shared.js";
import { fetchSizeFor, paginationMeta, parsePaginationParams, slicePage } from "../pagination.js";
import { parseExpansion, wantsExpand, wantsNestedExpand } from "../expansion.js";
import type { AuthContext } from "../types.js";

/** Expandable references on the plan read surface (S2-001). */
const PLAN_EXPANSIONS: ExpansionAllowlist = {
  /** The full replan-history chain (same view as GET /v1/plans/{id}/history). */
  history: {},
  /** Each queued experience's catalog item (nested field.subfield expansion). */
  queuedExperiences: { item: {} },
};
const PLAN_LIST_EXPANSIONS: ExpansionAllowlist = {
  queuedExperiences: { item: {} },
};

/** Replan-history entry view (plan + row version + recorded reason) — shared with the history route. */
const PlanHistoryEntrySchema = z.object({
  plan: ExperiencePlanSchema,
  version: z.number().int().nonnegative(),
  reason: z.string().nullable(),
});

/** Tenant scope the catalog reader is called with (auth-derived — TENANT LAW). */
function catalogTenant(auth: AuthContext): { tenantId: string; workspaceId?: string } {
  return auth.workspaceId !== undefined
    ? { tenantId: auth.tenantId, workspaceId: auth.workspaceId }
    : { tenantId: auth.tenantId };
}

function parseHistoryEntry(entry: StoredPlanVersionView): {
  plan: ExperiencePlan;
  version: number;
  reason: string | null;
} {
  const result = PlanHistoryEntrySchema.safeParse(entry);
  if (!result.success) {
    throw new ApiError(
      ERROR_CODES.HANDLER_RESPONSE_INVALID,
      500,
      `Handler output failed ${CONTRACT_IDS.experiencePlan} (history chain) validation`,
      { issues: result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message, code: issue.code })) },
    );
  }
  return result.data;
}

/**
 * Apply expansions to ONE validated plan payload (additive — the frozen
 * contract fields are untouched; expanded objects ride alongside).
 * Expansion reads are auth-tenant-scoped (TENANT LAW) and every embedded
 * object is validated against its real frozen schema before it ships.
 */
async function expandPlan(
  deps: RouteDeps,
  auth: AuthContext,
  plan: Record<string, unknown>,
  expansion: ExpansionRequest,
  planId: string,
): Promise<void> {
  if (wantsExpand(expansion, "history")) {
    const versions = await deps.handlers.planHandler.history(planId, auth);
    const parsedVersions = versions.map(parseHistoryEntry);
    for (const entry of parsedVersions) assertResponseTenant(auth, entry.plan.tenant);
    plan.history = parsedVersions;
  }
  if (wantsNestedExpand(expansion, "queuedExperiences", "item")) {
    const queued = Array.isArray(plan.queuedExperiences) ? (plan.queuedExperiences as Record<string, unknown>[]) : [];
    for (const experience of queued) {
      const item: CatalogItem | null = await deps.handlers.catalogReader.getItem(
        catalogTenant(auth),
        String(experience.itemId),
      );
      experience.item = item === null ? null : validateHandlerResponse(CatalogItemSchema, item, CONTRACT_IDS.catalogItem);
    }
  }
}

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
  // S2-001 expansion: `?expand[]=history` embeds the replan-history chain;
  // `?expand[]=queuedExperiences.item` embeds each queued experience's
  // catalog item (validated, tenant-scoped).
  app.get<{ Params: { planId: string } }>(
    "/v1/plans/:planId",
    { preHandler: [authPreHandler(deps, "plans")] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const planId = request.params.planId;
      const expansion = parseExpansion(request.query as Record<string, unknown>, PLAN_EXPANSIONS);
      const found = await deps.handlers.planHandler.get(planId, auth);
      if (found === null) {
        throw new ApiError(ERROR_CODES.NOT_FOUND, 404, `Plan not found: ${planId}`, { planId });
      }
      const parsed = validateHandlerResponse(ExperiencePlanSchema, found, CONTRACT_IDS.experiencePlan);
      assertResponseTenant(auth, parsed.tenant);
      const payload = parsed as unknown as Record<string, unknown>;
      await expandPlan(deps, auth, payload, expansion, planId);
      reply.code(200).send(payload);
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
      const parsedVersions = versions.map(parseHistoryEntry);
      for (const entry of parsedVersions) assertResponseTenant(auth, entry.plan.tenant);
      reply.code(200).send({ versions: parsedVersions });
    },
  );

  // Read surface (P1/UI-005): recent plans (latest version each, newest
  // first — STABLE ORDER). S2-001: cursor pagination (limit 1..100
  // default 20, starting_after object-id cursor, has_more + next_cursor)
  // + `?expand[]=queuedExperiences.item` applied per element.
  app.get(
    "/v1/plans",
    { preHandler: [authPreHandler(deps, "plans")] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const params = parsePaginationParams(request.query as Record<string, unknown>);
      const expansion = parseExpansion(request.query as Record<string, unknown>, PLAN_LIST_EXPANSIONS);
      const recent = await deps.handlers.planHandler.listRecent(auth, fetchSizeFor(params));
      const validated = recent.map((plan) =>
        validateHandlerResponse(ExperiencePlanSchema, plan, CONTRACT_IDS.experiencePlan),
      );
      const page = slicePage(validated, params, (plan) => plan.planId);
      for (const plan of page.items) {
        assertResponseTenant(auth, plan.tenant);
        await expandPlan(deps, auth, plan as unknown as Record<string, unknown>, expansion, plan.planId);
      }
      reply.code(200).send({ plans: page.items, ...paginationMeta(page) });
    },
  );
}
