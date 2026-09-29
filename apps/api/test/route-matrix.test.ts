import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  DecisionResultSchema,
  ExperiencePlanSchema,
  OutcomeEventSchema,
  PreferenceDeltaSchema,
  CatalogItemSchema,
  RealizationSchema,
  CandidateSetSchema,
  ExperienceSchema,
} from "@reckon/contracts";
import {
  ALPHA,
  BETA,
  GAMMA,
  TENANT_B,
  authHeaders,
  buildDefaultServer,
  buildStubServer,
  idemHeader,
  injectJson,
  validCandidateSet,
  validCatalogItem,
  validDecisionRequest,
  validOutcomeEvent,
  validPlan,
  validPreferenceDelta,
  validRealization,
  validReplanRequest,
  validResolveRequest,
  freshIdem,
  expectErrorEnvelope,
  seedDecision,
} from "./fixtures.js";
import type { StubServer } from "./fixtures.js";

/**
 * THE packet matrix: every route × {
 *   valid (wired stub → 200 + schema echo),
 *   invalid-body → 400 VALIDATION_ERROR,
 *   no-auth → 401 UNAUTHENTICATED,
 *   wrong-tenant → 403 TENANT_MISMATCH,
 *   wrong-scope → 403 INSUFFICIENT_SCOPE,
 *   not-wired (default server) → 501 NOT_WIRED
 * }.
 *
 * GET /v1/decisions/{id} has no request body, so its "invalid-body" cell is
 * the 404 unknown-id cell (the GET analogue of a client input error).
 */

interface RouteCase {
  name: string;
  method: string;
  url: string;
  scope: string;
  /** The key that LACKS this route's scope (drives the wrong-scope cell). */
  wrongScopeKey: string;
  port: string;
  requestContract: string;
  bodyful: boolean;
  valid: () => Record<string, unknown>;
  invalid: () => Record<string, unknown>;
  responseCheck?: (body: unknown) => void;
}

const ROUTES: RouteCase[] = [
  {
    name: "POST /v1/decisions",
    method: "POST",
    url: "/v1/decisions",
    scope: "decisions",
    wrongScopeKey: GAMMA,
    port: "DecisionHandler",
    requestContract: "reckon.decision-request",
    bodyful: true,
    valid: () => validDecisionRequest(),
    invalid: () => validDecisionRequest({ idempotencyKey: undefined }),
    responseCheck: (body) => {
      const parsed = DecisionResultSchema.parse(body);
      expect(parsed.schema).toBe("reckon.decision-result");
    },
  },
  {
    name: "GET /v1/decisions/{id}",
    method: "GET",
    url: "/v1/decisions/dec-matrix",
    scope: "decisions",
    wrongScopeKey: GAMMA,
    port: "DecisionStore",
    requestContract: "—",
    bodyful: false,
    valid: () => ({}),
    invalid: () => ({}),
    responseCheck: (body) => {
      const parsed = DecisionResultSchema.parse(body);
      expect(parsed.schema).toBe("reckon.decision-result");
    },
  },
  {
    name: "POST /v1/outcomes",
    method: "POST",
    url: "/v1/outcomes",
    scope: "outcomes",
    wrongScopeKey: BETA,
    port: "OutcomeIngestHandler",
    requestContract: "reckon.outcome-event",
    bodyful: true,
    valid: () => validOutcomeEvent(),
    invalid: () => validOutcomeEvent({ evidenceClass: "bogus-class" }),
    responseCheck: (body) => {
      const parsed = OutcomeEventSchema.parse(body);
      expect(parsed.schema).toBe("reckon.outcome-event");
    },
  },
  {
    name: "POST /v1/preferences/events",
    method: "POST",
    url: "/v1/preferences/events",
    scope: "outcomes",
    wrongScopeKey: BETA,
    port: "PreferenceIngestHandler",
    requestContract: "reckon.preference-delta",
    bodyful: true,
    valid: () => validPreferenceDelta(),
    invalid: () => validPreferenceDelta({ op: "not-an-op" }),
    responseCheck: (body) => {
      const parsed = PreferenceDeltaSchema.parse(body);
      expect(parsed.schema).toBe("reckon.preference-delta");
    },
  },
  {
    name: "POST /v1/plans",
    method: "POST",
    url: "/v1/plans",
    scope: "plans",
    wrongScopeKey: BETA,
    port: "PlanHandler",
    requestContract: "reckon.experience-plan",
    bodyful: true,
    valid: () => validPlan(),
    invalid: () => validPlan({ createdAt: -1 }),
    responseCheck: (body) => {
      const parsed = ExperiencePlanSchema.parse(body);
      expect(parsed.schema).toBe("reckon.experience-plan");
    },
  },
  {
    name: "POST /v1/plans/{id}/replan",
    method: "POST",
    url: "/v1/plans/plan-9/replan",
    scope: "plans",
    wrongScopeKey: BETA,
    port: "PlanHandler",
    requestContract: "reckon.api.replan-request",
    bodyful: true,
    valid: () => validReplanRequest(),
    invalid: () => validReplanRequest({ trigger: "not-a-trigger" }),
    responseCheck: (body) => {
      const parsed = ExperiencePlanSchema.parse(body);
      expect(parsed.schema).toBe("reckon.experience-plan");
    },
  },
  {
    name: "POST /v1/catalog/items",
    method: "POST",
    url: "/v1/catalog/items",
    scope: "catalog",
    wrongScopeKey: BETA,
    port: "CatalogItemIngestHandler",
    requestContract: "reckon.catalog-item",
    bodyful: true,
    valid: () => validCatalogItem(),
    invalid: () => validCatalogItem({ kind: "not-a-kind" }),
    responseCheck: (body) => {
      const parsed = CatalogItemSchema.parse(body);
      expect(parsed.schema).toBe("reckon.catalog-item");
    },
  },
  {
    name: "POST /v1/catalog/realizations",
    method: "POST",
    url: "/v1/catalog/realizations",
    scope: "catalog",
    wrongScopeKey: BETA,
    port: "RealizationIngestHandler",
    requestContract: "reckon.realization",
    bodyful: true,
    valid: () => validRealization(),
    invalid: () => validRealization({ kind: "" }),
    responseCheck: (body) => {
      const parsed = RealizationSchema.parse(body);
      expect(parsed.schema).toBe("reckon.realization");
    },
  },
  {
    name: "POST /v1/candidates",
    method: "POST",
    url: "/v1/candidates",
    scope: "decisions",
    wrongScopeKey: GAMMA,
    port: "CandidatesHandler",
    requestContract: "reckon.candidate-set",
    bodyful: true,
    valid: () => validCandidateSet(),
    invalid: () => validCandidateSet({ candidates: [] }),
    responseCheck: (body) => {
      const envelope = body as { schema: string; schemaVersion: string };
      expect(envelope.schema).toBe("reckon.candidate-set");
      expect(envelope.schemaVersion).toBe("0.1.0");
      CandidateSetSchema.parse(body);
    },
  },
  {
    name: "POST /v1/experiences/resolve",
    method: "POST",
    url: "/v1/experiences/resolve",
    scope: "decisions",
    wrongScopeKey: GAMMA,
    port: "ExperienceResolveHandler",
    requestContract: "reckon.api.resolve-request",
    bodyful: true,
    valid: () => validResolveRequest(),
    invalid: () => validResolveRequest({ items: [] }),
    responseCheck: (body) => {
      const envelope = body as { schema: string; schemaVersion: string; experiences: unknown[] };
      expect(envelope.schema).toBe("reckon.experience");
      expect(envelope.schemaVersion).toBe("0.1.0");
      expect(envelope.experiences.length).toBeGreaterThan(0);
      for (const experience of envelope.experiences) ExperienceSchema.parse(experience);
    },
  },
];

describe("route matrix: every route × failure modes", () => {
  let stub: StubServer;
  let defaultServer: FastifyInstance;

  beforeEach(() => {
    stub = buildStubServer();
    defaultServer = buildDefaultServer();
  });

  afterEach(async () => {
    await stub.app.close();
    await defaultServer.close();
  });

  for (const route of ROUTES) {
    describe(route.name, () => {
      it("valid request (wired handler) → 200 with schema echo", async () => {
        if (route.method === "GET") {
          seedDecision(stub.state, "tenant-a", "dec-matrix");
        }
        const headers =
          route.name === "POST /v1/decisions" || route.name === "POST /v1/outcomes"
            ? authHeaders(ALPHA)
            : idemHeader(freshIdem());
        const res = await injectJson(stub.app, route.method, route.url, {
          payload: route.method === "GET" ? undefined : route.valid(),
          headers,
        });
        expect(res.status).toBe(200);
        route.responseCheck?.(res.body);
        if (route.method === "POST") {
          expect(typeof res.headers["idempotency-key"]).toBe("string");
        }
      });

      if (route.bodyful) {
        it("invalid body → 400 VALIDATION_ERROR with issues", async () => {
          const headers =
            route.name === "POST /v1/decisions" || route.name === "POST /v1/outcomes"
              ? authHeaders(ALPHA)
              : idemHeader(freshIdem());
          const res = await injectJson(stub.app, route.method, route.url, {
            payload: route.invalid(),
            headers,
          });
          expect(res.status).toBe(400);
          expectErrorEnvelope(res.status, res.body, "VALIDATION_ERROR");
          const details = (res.body as { error: { details?: { schema?: string; issues?: unknown[] } } })
            .error.details;
          expect(details?.schema).toBe(route.requestContract);
          expect(Array.isArray(details?.issues)).toBe(true);
          expect((details?.issues ?? []).length).toBeGreaterThan(0);
        });
      } else {
        it("unknown id → 404 NOT_FOUND (GET analogue of the invalid-input cell)", async () => {
          const res = await injectJson(stub.app, route.method, route.url, {
            headers: authHeaders(ALPHA),
          });
          expect(res.status).toBe(404);
          expectErrorEnvelope(res.status, res.body, "NOT_FOUND");
        });
      }

      it("no auth → 401 UNAUTHENTICATED", async () => {
        const res = await injectJson(stub.app, route.method, route.url, {
          payload: route.method === "GET" ? undefined : route.valid(),
          headers: route.method === "GET" ? {} : { "content-type": "application/json" },
        });
        expect(res.status).toBe(401);
        expectErrorEnvelope(res.status, res.body, "UNAUTHENTICATED");
      });

      it("wrong tenant → 403 TENANT_MISMATCH", async () => {
        const headers =
          route.name === "POST /v1/decisions" || route.name === "POST /v1/outcomes"
            ? authHeaders(ALPHA)
            : idemHeader(freshIdem(), { "x-reckon-tenant": TENANT_B });
        const payload =
          route.method === "GET" || !("tenant" in route.valid())
            ? route.method === "GET" ? undefined : route.valid()
            : { ...route.valid(), tenant: { tenantId: TENANT_B } };
        const res = await injectJson(stub.app, route.method, route.url, {
          payload,
          headers,
        });
        expect(res.status).toBe(403);
        expectErrorEnvelope(res.status, res.body, "TENANT_MISMATCH");
      });

      it(`wrong scope (key without '${route.scope}') → 403 INSUFFICIENT_SCOPE`, async () => {
        const key = route.wrongScopeKey;
        const headers =
          route.name === "POST /v1/decisions" || route.name === "POST /v1/outcomes"
            ? authHeaders(key)
            : { ...idemHeader(freshIdem()), authorization: `Bearer ${key}` };
        const res = await injectJson(stub.app, route.method, route.url, {
          payload: route.method === "GET" ? undefined : route.valid(),
          headers,
        });
        expect(res.status).toBe(403);
        expectErrorEnvelope(res.status, res.body, "INSUFFICIENT_SCOPE");
        const details = (res.body as { error: { details?: { requiredScope?: string } } }).error.details;
        expect(details?.requiredScope).toBe(route.scope);
      });

      it("not wired (default server) → 501 NOT_WIRED with port name", async () => {
        const headers =
          route.name === "POST /v1/decisions" || route.name === "POST /v1/outcomes"
            ? authHeaders(ALPHA)
            : idemHeader(freshIdem());
        const res = await injectJson(defaultServer, route.method, route.url, {
          payload: route.method === "GET" ? undefined : route.valid(),
          headers,
        });
        expect(res.status).toBe(501);
        expectErrorEnvelope(res.status, res.body, "NOT_WIRED");
        const details = (res.body as { error: { details?: { port?: string } } }).error.details;
        expect(details?.port).toBe(route.port);
        expect((res.body as { error: { message: string } }).error.message).toMatch(/^NotWired:/);
      });
    });
  }
});
