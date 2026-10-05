import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ExperiencePlanSchema } from "@reckon/contracts";
import {
  ALPHA,
  authHeaders,
  buildStubServer,
  idemHeader,
  injectJson,
  validPlan,
  freshIdem,
  seedCatalogItem,
  seedDecision,
  expectErrorEnvelope,
} from "./fixtures.js";
import type { StubServer } from "./fixtures.js";

/**
 * S2-001 response expansion — `?expand[]=field.subfield`:
 *   valid fields embed resolved references (additive, schema-validated,
 *   tenant-scoped); unknown fields are a typed 400 with param expand[i].
 */

function validPlanWithQueue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return validPlan({
    queuedExperiences: [
      {
        experienceId: "exp-1",
        itemId: "item-expand",
        realizationId: "real-1",
        format: { kind: "full", params: {} },
      },
    ],
    ...overrides,
  });
}

describe("expansion: plan detail (GET /v1/plans/:id)", () => {
  let stub: StubServer;

  beforeEach(() => {
    stub = buildStubServer();
  });

  afterEach(async () => {
    await stub.app.close();
  });

  async function seedPlan(): Promise<void> {
    const res = await injectJson(stub.app, "POST", "/v1/plans", {
      payload: validPlanWithQueue(),
      headers: idemHeader(freshIdem("plan")),
    });
    expect(res.status).toBe(200);
  }

  it("?expand[]=history embeds the version chain next to the plan", async () => {
    await seedPlan();
    const res = await injectJson(stub.app, "GET", "/v1/plans/plan-1?expand[]=history", {
      headers: authHeaders(ALPHA),
    });
    expect(res.status).toBe(200);
    const body = res.body as { history?: { plan: unknown; version: number; reason: string | null }[] };
    expect(Array.isArray(body.history)).toBe(true);
    expect(body.history?.length).toBeGreaterThan(0);
    expect(ExperiencePlanSchema.parse(body.history?.[0]?.plan).planId).toBe("plan-1");
    expect(body.history?.[0]?.reason).toBeNull();
    // The plan itself is still the frozen contract payload.
    expect(ExperiencePlanSchema.parse(res.body).planId).toBe("plan-1");
  });

  it("?expand[]=queuedExperiences.item embeds each queued experience's catalog item", async () => {
    await seedPlan();
    seedCatalogItem(stub.state, "tenant-a", {
      itemId: "item-expand",
      kind: "media",
      labels: ["scifi"],
      attributes: { year: 2024 },
    });
    const res = await injectJson(stub.app, "GET", "/v1/plans/plan-1?expand[]=queuedExperiences.item", {
      headers: authHeaders(ALPHA),
    });
    expect(res.status).toBe(200);
    const queued = (res.body as { queuedExperiences?: { item?: { itemId?: string; kind?: string } }[] })
      .queuedExperiences;
    expect(queued?.[0]?.item).toMatchObject({ itemId: "item-expand", kind: "media" });
    // The expansion read was tenant-scoped.
    expect(stub.state.catalogReaderTenants).toContain("tenant-a");
  });

  it("an unknown catalog item expands to item: null (visible, honest)", async () => {
    await seedPlan();
    const res = await injectJson(stub.app, "GET", "/v1/plans/plan-1?expand[]=queuedExperiences.item", {
      headers: authHeaders(ALPHA),
    });
    expect(res.status).toBe(200);
    const queued = (res.body as { queuedExperiences?: { item?: unknown }[] }).queuedExperiences;
    expect(queued?.[0]?.item).toBeNull();
  });

  it("multiple expansions compose (?expand[]=history&expand[]=queuedExperiences.item)", async () => {
    await seedPlan();
    seedCatalogItem(stub.state, "tenant-a", { itemId: "item-expand", kind: "media" });
    const res = await injectJson(
      stub.app,
      "GET",
      "/v1/plans/plan-1?expand[]=history&expand[]=queuedExperiences.item",
      { headers: authHeaders(ALPHA) },
    );
    expect(res.status).toBe(200);
    const body = res.body as {
      history?: unknown[];
      queuedExperiences?: { item?: { itemId?: string } }[];
    };
    expect(Array.isArray(body.history)).toBe(true);
    expect(body.queuedExperiences?.[0]?.item).toMatchObject({ itemId: "item-expand" });
  });

  it("unknown expand field → typed 400 invalid_request_error with param expand[0]", async () => {
    await seedPlan();
    const res = await injectJson(stub.app, "GET", "/v1/plans/plan-1?expand[]=bogusField", {
      headers: authHeaders(ALPHA),
    });
    expect(res.status).toBe(400);
    expectErrorEnvelope(res.status, res.body, "VALIDATION_ERROR", "invalid_request_error");
    const error = (res.body as { error: { param?: string; details?: { expandable?: string[] } } }).error;
    expect(error.param).toBe("expand[0]");
    expect(error.details?.expandable).toEqual(["history", "queuedExperiences"]);
  });

  it("unknown NESTED expand field → typed 400 with param expand[0]", async () => {
    await seedPlan();
    const res = await injectJson(stub.app, "GET", "/v1/plans/plan-1?expand[]=queuedExperiences.nope", {
      headers: authHeaders(ALPHA),
    });
    expect(res.status).toBe(400);
    expectErrorEnvelope(res.status, res.body, "VALIDATION_ERROR", "invalid_request_error");
    expect((res.body as { error: { param?: string } }).error.param).toBe("expand[0]");
  });

  it("bare `expand` query key works too (Stripe accepts the unbracketed form)", async () => {
    await seedPlan();
    const res = await injectJson(stub.app, "GET", "/v1/plans/plan-1?expand=history", {
      headers: authHeaders(ALPHA),
    });
    expect(res.status).toBe(200);
    expect(Array.isArray((res.body as { history?: unknown[] }).history)).toBe(true);
  });

  it("no expand → the response carries NO history key (pure frozen contract)", async () => {
    await seedPlan();
    const res = await injectJson(stub.app, "GET", "/v1/plans/plan-1", {
      headers: authHeaders(ALPHA),
    });
    expect(res.status).toBe(200);
    expect((res.body as { history?: unknown }).history).toBeUndefined();
  });
});

describe("expansion: plan list (GET /v1/plans) applies per element", () => {
  let stub: StubServer;

  beforeEach(() => {
    stub = buildStubServer();
  });

  afterEach(async () => {
    await stub.app.close();
  });

  it("each returned plan gets its queued experiences' items embedded", async () => {
    for (const planId of ["plan-a", "plan-b"]) {
      const res = await injectJson(stub.app, "POST", "/v1/plans", {
        payload: validPlanWithQueue({ planId }),
        headers: idemHeader(freshIdem(planId)),
      });
      expect(res.status).toBe(200);
    }
    seedCatalogItem(stub.state, "tenant-a", { itemId: "item-expand", kind: "media" });
    const res = await injectJson(stub.app, "GET", "/v1/plans?expand[]=queuedExperiences.item", {
      headers: authHeaders(ALPHA),
    });
    expect(res.status).toBe(200);
    const plans = (res.body as { plans?: { planId: string; queuedExperiences?: { item?: unknown }[] }[] }).plans;
    expect(plans).toHaveLength(2);
    for (const plan of plans ?? []) {
      expect(plan.queuedExperiences?.[0]?.item).toMatchObject({ itemId: "item-expand" });
    }
  });

  it("unknown expand on the list route → typed 400 (param expand[1] names the second path)", async () => {
    const res = await injectJson(
      stub.app,
      "GET",
      "/v1/plans?expand[]=queuedExperiences.item&expand[]=queuedExperiences.bogus",
      { headers: authHeaders(ALPHA) },
    );
    expect(res.status).toBe(400);
    expectErrorEnvelope(res.status, res.body, "VALIDATION_ERROR", "invalid_request_error");
    expect((res.body as { error: { param?: string } }).error.param).toBe("expand[1]");
  });
});

describe("expansion: decision detail (GET /v1/decisions/:id)", () => {
  let stub: StubServer;

  beforeEach(() => {
    stub = buildStubServer();
  });

  afterEach(async () => {
    await stub.app.close();
  });

  it("?expand[]=selectedExperience.item embeds the selected experience's item", async () => {
    const decision = seedDecision(stub.state, "tenant-a", "dec-expand", {
      selectedExperience: {
        experienceId: "exp-sel",
        itemId: "item-sel",
        realizationId: "real-sel",
        format: { kind: "full", params: {} },
      },
    });
    expect(decision.selectedExperience).toBeDefined();
    seedCatalogItem(stub.state, "tenant-a", {
      itemId: decision.selectedExperience?.itemId ?? "item-1",
      kind: "media",
    });
    const res = await injectJson(stub.app, "GET", "/v1/decisions/dec-expand?expand[]=selectedExperience.item", {
      headers: authHeaders(ALPHA),
    });
    expect(res.status).toBe(200);
    const selected = (res.body as { selectedExperience?: { item?: { itemId?: string } } }).selectedExperience;
    expect(selected?.item).toMatchObject({ itemId: decision.selectedExperience?.itemId });
  });

  it("unknown expand field on decisions → typed 400 listing the expandable fields", async () => {
    seedDecision(stub.state, "tenant-a", "dec-expand-2", {
      selectedExperience: {
        experienceId: "exp-sel",
        itemId: "item-sel",
        realizationId: "real-sel",
        format: { kind: "full", params: {} },
      },
    });
    const res = await injectJson(stub.app, "GET", "/v1/decisions/dec-expand-2?expand[]=alternatives.item", {
      headers: authHeaders(ALPHA),
    });
    expect(res.status).toBe(400);
    expectErrorEnvelope(res.status, res.body, "VALIDATION_ERROR", "invalid_request_error");
    expect((res.body as { error: { details?: { expandable?: string[] } } }).error.details?.expandable).toEqual([
      "selectedExperience",
    ]);
  });

  it("expansion reads are tenant-scoped: another tenant's item is NOT embedded", async () => {
    const decision = seedDecision(stub.state, "tenant-a", "dec-expand-3", {
      selectedExperience: {
        experienceId: "exp-sel",
        itemId: "item-sel",
        realizationId: "real-sel",
        format: { kind: "full", params: {} },
      },
    });
    // Seed the SAME itemId under a DIFFERENT tenant only.
    seedCatalogItem(stub.state, "tenant-b", {
      itemId: decision.selectedExperience?.itemId ?? "item-1",
      kind: "commerce",
    });
    const res = await injectJson(stub.app, "GET", "/v1/decisions/dec-expand-3?expand[]=selectedExperience.item", {
      headers: authHeaders(ALPHA),
    });
    expect(res.status).toBe(200);
    const selected = (res.body as { selectedExperience?: { item?: unknown } }).selectedExperience;
    expect(selected?.item).toBeNull(); // tenant-a has no such item — no cross-tenant leak
  });
});

describe("expansion: unwired catalog reader surfaces as 501 NOT_WIRED", () => {
  it("expanding items with the CatalogReader port unmounted → typed 501 naming the port", async () => {
    const { buildServer } = await import("../src/server.js");
    const { DecisionResultSchema } = await import("@reckon/contracts");
    const { newStubState, stubHandlers, TEST_KEYS } = await import("./fixtures.js");
    const state = newStubState();
    state.decisions.set(
      "tenant-a|dec-x",
      DecisionResultSchema.parse({
        decisionId: "dec-x",
        requestId: "req-x",
        tenant: { tenantId: "tenant-a" },
        action: "SUGGEST",
        selectedExperience: {
          experienceId: "exp-x",
          itemId: "item-x",
          realizationId: "real-x",
          format: { kind: "full", params: {} },
        },
        policy: { policyId: "p", version: "1" },
        at: 1,
      }),
    );
    const handlers = stubHandlers(state);
    // Unmount ONLY the catalog reader — the expansion is what breaks.
    delete (handlers as Partial<typeof handlers>).catalogReader;
    const app = buildServer({ keys: TEST_KEYS, handlers });
    try {
      const res = await injectJson(app, "GET", "/v1/decisions/dec-x?expand[]=selectedExperience.item", {
        headers: authHeaders(ALPHA),
      });
      expect(res.status).toBe(501);
      expectErrorEnvelope(res.status, res.body, "NOT_WIRED", "api_error");
      expect((res.body as { error: { details?: { port?: string } } }).error.details?.port).toBe("CatalogReader");
    } finally {
      await app.close();
    }
  });
});
