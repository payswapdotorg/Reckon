import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DecisionResultSchema } from "@reckon/contracts";
import { buildServer } from "../src/server.js";
import { ERROR_CODES } from "../src/errors.js";
import {
  ALPHA,
  BETA,
  TENANT_B,
  WS_KEY,
  authHeaders,
  buildStubServer,
  idemHeader,
  injectJson,
  validDecisionRequest,
  validOutcomeEvent,
  validPlan,
  validPreferenceDelta,
  validCatalogItem,
  validCandidateSet,
  validReplanRequest,
  validResolveRequest,
  expectErrorEnvelope,
  freshIdem,
  seedDecision,
  testConfig,
} from "./fixtures.js";
import type { StubServer } from "./fixtures.js";

/**
 * THE TENANT LAW: tenantId comes from the API key. Body tenant must match
 * (403), the advisory X-Reckon-Tenant header must match (403), workspace
 * rules hold, and cross-tenant reads are invisible (404). Cross-tenant
 * access is structurally impossible.
 */

describe("tenant boundary: body tenant on tenant-carrying contracts", () => {
  let stub: StubServer;

  beforeEach(() => {
    stub = buildStubServer();
  });

  afterEach(async () => {
    await stub.app.close();
  });

  const tenantCarryingRoutes: Array<{ name: string; url: string; body: () => Record<string, unknown> }> = [
    { name: "POST /v1/decisions", url: "/v1/decisions", body: () => validDecisionRequest() },
    { name: "POST /v1/outcomes", url: "/v1/outcomes", body: () => validOutcomeEvent() },
    { name: "POST /v1/preferences/events", url: "/v1/preferences/events", body: () => validPreferenceDelta() },
    { name: "POST /v1/plans", url: "/v1/plans", body: () => validPlan() },
  ];

  for (const route of tenantCarryingRoutes) {
    it(`${route.name}: body tenant ≠ authenticated tenant → 403 before validation`, async () => {
      const body = { ...route.body(), tenant: { tenantId: TENANT_B } };
      // Deliberately corrupt an unrelated field too: the tenant check must
      // still fire first (security-first ordering).
      (body as Record<string, unknown>).subject = 42;
      const res = await injectJson(stub.app, "POST", route.url, {
        payload: body,
        headers:
          route.url === "/v1/decisions" || route.url === "/v1/outcomes"
            ? authHeaders(ALPHA)
            : idemHeader(freshIdem()),
      });
      expect(res.status).toBe(403);
      expectErrorEnvelope(res.status, res.body, "TENANT_MISMATCH");
      const details = (res.body as { error: { details?: { authenticatedTenantId?: string; requestTenantId?: string } } }).error.details;
      expect(details?.authenticatedTenantId).toBe("tenant-a");
      expect(details?.requestTenantId).toBe(TENANT_B);
    });
  }
});

describe("tenant boundary: X-Reckon-Tenant header on non-tenant contracts", () => {
  let stub: StubServer;

  beforeEach(() => {
    stub = buildStubServer();
  });

  afterEach(async () => {
    await stub.app.close();
  });

  const headerRoutes: Array<{ name: string; method: "GET" | "POST"; url: string; body: () => Record<string, unknown> }> = [
    { name: "POST /v1/catalog/items", method: "POST", url: "/v1/catalog/items", body: () => validCatalogItem() },
    { name: "POST /v1/candidates", method: "POST", url: "/v1/candidates", body: () => validCandidateSet() },
    { name: "POST /v1/experiences/resolve", method: "POST", url: "/v1/experiences/resolve", body: () => validResolveRequest() },
    { name: "POST /v1/plans/{id}/replan", method: "POST", url: "/v1/plans/plan-1/replan", body: () => validReplanRequest() },
    { name: "GET /v1/decisions/{id}", method: "GET", url: "/v1/decisions/dec-1", body: () => ({}) },
  ];

  for (const route of headerRoutes) {
    it(`${route.name}: mismatched X-Reckon-Tenant header → 403`, async () => {
      const res = await injectJson(stub.app, route.method, route.url, {
        payload: route.method === "POST" ? route.body() : undefined,
        headers: idemHeader(freshIdem(), { "x-reckon-tenant": TENANT_B }),
      });
      expect(res.status).toBe(403);
      expectErrorEnvelope(res.status, res.body, "TENANT_MISMATCH");
    });

    it(`${route.name}: matching X-Reckon-Tenant header passes (proceeds to handler)`, async () => {
      if (route.method === "GET") seedDecision(stub.state, "tenant-a", "dec-1");
      const res = await injectJson(stub.app, route.method, route.url, {
        payload: route.method === "POST" ? route.body() : undefined,
        headers: idemHeader(freshIdem(), { "x-reckon-tenant": "tenant-a" }),
      });
      expect(res.status).toBe(200);
    });
  }
});

describe("tenant boundary: workspace-scoped keys", () => {
  let stub: StubServer;

  beforeEach(() => {
    stub = buildStubServer();
  });

  afterEach(async () => {
    await stub.app.close();
  });

  it("workspace key + different body workspace → 403", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest({ tenant: { tenantId: "tenant-a", workspaceId: "ws-other" } }),
      headers: authHeaders(WS_KEY),
    });
    expect(res.status).toBe(403);
    expectErrorEnvelope(res.status, res.body, "TENANT_MISMATCH");
  });

  it("workspace key + body without workspace (tenant-wide target) → 403", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest(),
      headers: authHeaders(WS_KEY),
    });
    expect(res.status).toBe(403);
    expectErrorEnvelope(res.status, res.body, "TENANT_MISMATCH");
  });

  it("workspace key + matching body workspace → 200", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest({ tenant: { tenantId: "tenant-a", workspaceId: "ws-1" } }),
      headers: authHeaders(WS_KEY),
    });
    expect(res.status).toBe(200);
  });

  it("tenant-wide key + body with any workspace of its tenant → 200", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest({ tenant: { tenantId: "tenant-a", workspaceId: "ws-9" } }),
      headers: authHeaders(ALPHA),
    });
    expect(res.status).toBe(200);
  });
});

describe("tenant boundary: cross-tenant reads are invisible (404)", () => {
  it("tenant-b key cannot see tenant-a's decision (404, no data leak)", async () => {
    const stub = buildStubServer();
    try {
      seedDecision(stub.state, "tenant-a", "dec-secret");
      const res = await injectJson(stub.app, "GET", "/v1/decisions/dec-secret", {
        headers: authHeaders(BETA),
      });
      expect(res.status).toBe(404);
      expectErrorEnvelope(res.status, res.body, "NOT_FOUND");
      expect(JSON.stringify(res.body)).not.toContain("dec-secret-tenant-a");
      expect(JSON.stringify(res.body)).not.toContain("tenant-a");
    } finally {
      await stub.app.close();
    }
  });
});

describe("tenant boundary: handler tenant invariant (defense in depth)", () => {
  it("handler returning another tenant's decision → 500 HANDLER_TENANT_VIOLATION, no data leak", async () => {
    const app = buildServer(
      testConfig({
        handlers: {
          decisionHandler: {
            decide: async (request, auth) =>
              DecisionResultSchema.parse({
                decisionId: `dec-${auth.tenantId}-${request.idempotencyKey}`,
                requestId: request.requestId,
                // BUG being simulated: handler answers for tenant-b while the
                // authenticated tenant is tenant-a.
                tenant: { tenantId: "tenant-b" },
                action: "SUGGEST",
                policy: { policyId: "p", version: "1" },
                at: 1,
              }),
          },
        },
      }),
    );
    try {
      const res = await injectJson(app, "POST", "/v1/decisions", {
        payload: validDecisionRequest(),
        headers: authHeaders(ALPHA),
      });
      expect(res.status).toBe(500);
      expectErrorEnvelope(res.status, res.body, ERROR_CODES.HANDLER_TENANT_VIOLATION);
      // The withheld response content must not leak.
      expect(JSON.stringify(res.body)).not.toContain("tenant-b");
    } finally {
      await app.close();
    }
  });

  it("buggy decision store returning a cross-tenant object → 500, not served", async () => {
    const stub = buildStubServer();
    try {
      seedDecision(stub.state, "tenant-b", "dec-b");
      // Buggy store ignores the tenantId argument entirely.
      const buggyStore = {
        get: async () => stub.state.decisions.get("tenant-b|dec-b") ?? null,
      };
      const app = buildServer(testConfig({ handlers: { decisionStore: buggyStore } }));
      try {
        const res = await injectJson(app, "GET", "/v1/decisions/anything", {
          headers: authHeaders(ALPHA),
        });
        expect(res.status).toBe(500);
        expectErrorEnvelope(res.status, res.body, ERROR_CODES.HANDLER_TENANT_VIOLATION);
        expect(JSON.stringify(res.body)).not.toContain("tenant-b");
      } finally {
        await app.close();
      }
    } finally {
      await stub.app.close();
    }
  });
});
