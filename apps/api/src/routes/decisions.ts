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
import {
  assertNoTestHintsInLiveMode,
  crossModeMismatch,
  executeTestModeDecision,
  markTestMode,
  probeLiveDecision,
} from "../test-mode.js";
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
      const auth = requireAuth(request);
      // S2-003 cross-mode protection (raw-body peek, pre-validation —
      // the tenant-peek ordering): a LIVE key must never drive test-mode
      // semantics; scenario hints / itm_test_ item ids are test-only.
      assertNoTestHintsInLiveMode(auth, request.body);
      await runContractRoute(deps, request, reply, {
        contractId: CONTRACT_IDS.decisionRequest,
        responseContractId: CONTRACT_IDS.decisionResult,
        requestSchema: DecisionRequestSchema,
        responseSchema: DecisionResultSchema,
        tenantFromBody: (body) => body.tenant,
        responseTenantOf: (result) => result.tenant,
        idempotencyFromBody: (body) => body.idempotencyKey,
        // S2-003 SEPARATION LAW: in test mode the recommendation path
        // NEVER executes the mounted (live) decision handler — it
        // resolves a canned scenario against fully separated test state.
        // Live mode is unchanged: the mounted handler decides.
        execute: (body, authContext) =>
          authContext.mode === "test"
            ? Promise.resolve(executeTestModeDecision(deps.testDecisionStore, request.body, body))
            : deps.handlers.decisionHandler.decide(body, authContext),
        // S2-003 mode marker: test-mode decision responses carry a
        // visible `mode: "test"` sibling next to the contract payload.
        transformResponse: (result) => (auth.mode === "test" ? markTestMode(result) : result),
      });
    },
  );

  // S2-001 expansion: `?expand[]=selectedExperience.item` embeds the
  // selected experience's catalog item (validated, tenant-scoped).
  // S2-003: LIVE mode only — a test-mode expansion read must never
  // touch live catalog state (test keys never read live state), so the
  // embedded item is an explicit null (the honest-absence expansion).
  app.get<{ Params: { decisionId: string } }>(
    "/v1/decisions/:decisionId",
    { preHandler: [authPreHandler(deps, "decisions")] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const decisionId = request.params.decisionId;
      const expansion = parseExpansion(request.query as Record<string, unknown>, DECISION_EXPANSIONS);

      // S2-003 mode-scoped read: test keys read the mode-isolated test
      // store; live keys read the mounted live store. A miss followed by
      // a hit in the OTHER mode's state is a typed cross-mode violation
      // (MODE_MISMATCH, 403) — never a silent 404, never a payload leak.
      // Cross-TENANT ids stay invisible (404) in both modes.
      let found;
      if (auth.mode === "test") {
        found = await deps.testDecisionStore.get(auth.tenantId, decisionId);
        if (found === null) {
          const liveHit = await probeLiveDecision(deps.handlers.decisionStore, auth.tenantId, decisionId);
          if (liveHit !== null) {
            throw crossModeMismatch("test", "live", decisionId);
          }
          throw new ApiError(ERROR_CODES.NOT_FOUND, 404, `Decision not found: ${decisionId}`, {
            decisionId,
          });
        }
      } else {
        found = await deps.handlers.decisionStore.get(auth.tenantId, decisionId);
        if (found === null) {
          const testHit = await deps.testDecisionStore.get(auth.tenantId, decisionId);
          if (testHit !== null) {
            throw crossModeMismatch("live", "test", decisionId);
          }
          throw new ApiError(ERROR_CODES.NOT_FOUND, 404, `Decision not found: ${decisionId}`, {
            decisionId,
          });
        }
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
          let item: CatalogItem | null = null;
          if (auth.mode === "live") {
            item = await deps.handlers.catalogReader.getItem(
              catalogTenant(auth),
              String(selected.itemId),
            );
          }
          selected.item =
            item === null ? null : validateHandlerResponse(CatalogItemSchema, item, CONTRACT_IDS.catalogItem);
        }
      }
      reply.code(200).send(auth.mode === "test" ? markTestMode(payload) : payload);
    },
  );
}
