/**
 * P1-002 — production composition end-to-end over a REAL PostgreSQL
 * server: the SDK client drives the frozen /v1 routes through the
 * PRODUCTION composition (real W2 kernel handlers over real persistence).
 *
 * Proves the handoff §4 loop over the ten endpoints:
 *   catalog ingest → experiences resolve → decision (kernel chain) →
 *   decision lookup (durable) → outcome (durable transport) →
 *   preference delta (append-only) → plan create → replan (versioned) →
 *   candidates submit (validated echo) → idempotent replay.
 *
 * Evidence class: controlled-local (real PG engine + production executor
 * + production composition; the deployed-infrastructure wire path is
 * Gate L with a real DATABASE_URL).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DecisionResult, ExperiencePlan, OutcomeEvent } from "@reckon/contracts";
import { createReckonClient, createInjectFetch } from "@reckon/sdk";
import { buildProductionServer, type ProductionComposition } from "../src/index.js";
import { startTestPostgres, type TestPostgres } from "../../../packages/persistence/test/pg-harness.js";

let server: TestPostgres;
let composition: ProductionComposition;

let tenantA: ReturnType<typeof createReckonClient>;
let tenantB: ReturnType<typeof createReckonClient>;

beforeAll(async () => {
  console.log("STEP-1: booting PG");
  server = await startTestPostgres();
  console.log("STEP-2: building production composition");
  composition = await buildProductionServer({
    executor: server.executor,
    keys: [
      {
        apiKey: "prod-key-a",
        tenantId: "prod-tenant-a",
        scopes: ["decisions", "outcomes", "plans", "catalog", "research"] as never,
      },
      {
        apiKey: "prod-key-b",
        tenantId: "prod-tenant-b",
        scopes: ["decisions", "outcomes", "plans", "catalog", "research"] as never,
      },
    ],
    apiVersion: "p1-002-production",
    clock: { now: () => 1_000 },
  });
  const fetchImpl = createInjectFetch(composition.app as never) as never;
  const makeClient = (apiKey: string) =>
    createReckonClient({
      baseUrl: "http://reckon-production.test",
      apiKey,
      fetchImpl,
      idGenerator: (() => {
        let n = 0;
        return () => `prod-sdk-${(n += 1)}`;
      })(),
    });
  tenantA = makeClient("prod-key-a");
  tenantB = makeClient("prod-key-b");
}, 120_000);

afterAll(async () => {
  await composition.close();
  await server.stop();
}, 60_000);

const ITEM = {
  itemId: "prod-item-1",
  kind: "media" as const,
  labels: ["documentary", "nature"],
  attributes: { title: "Coral Reef" },
};
const REALIZATION = {
  realizationId: "prod-real-1",
  itemId: "prod-item-1",
  kind: "stream",
  constraints: { formats: ["full"], durationSeconds: 5400 },
};

describe("P1-002 production composition — the ten /v1 endpoints over real persistence", () => {
  it("catalog: items + realizations upsert durably (tenant-scoped)", async () => {
    const item = await tenantA.catalog.upsertItem(ITEM);
    expect(item.itemId).toBe("prod-item-1");
    const realization = await tenantA.catalog.upsertRealization(REALIZATION);
    expect(realization.realizationId).toBe("prod-real-1");

    // Tenant B sees nothing of tenant A's catalog (tenant law).
    const storedB = await composition.stores.catalog.getItem({ tenantId: "prod-tenant-b" }, "prod-item-1");
    expect(storedB).toBeNull();
  });

  it("experiences/resolve: the REAL W2-003 expander over the ingested catalog", async () => {
    const result = await tenantA.experiences.resolve({ items: [ITEM], realizations: [REALIZATION] });
    expect(result.experiences.length).toBeGreaterThan(0);
  });

  it("decisions: the REAL kernel chain decides from the persisted catalog", async () => {
    const decision: DecisionResult = await tenantA.decisions.request({
      requestId: "req-1",
      tenant: { tenantId: "prod-tenant-a" },
      subject: { kind: "user", ref: "user-42" },
      objective: { objectiveId: "obj-relax", version: "1", kind: "relax", params: {} },
      attentionPolicy: { policyId: "att-balanced", version: "1", style: "balanced", params: {} },
      context: { contextId: "ctx-evening" },
      candidates: {
        setId: "cs-1",
        candidates: [{ itemId: "prod-item-1", realizationIds: ["prod-real-1"], source: "test-retrieval" }],
      },
      policySelector: { policyId: "pol-neutral", version: "1" },
      at: 10_000,
      idempotencyKey: "idem-req-1",
    } as never);

    expect(["QUEUE", "SWITCH", "HOLD", "CONTINUE", "SUGGEST"]).toContain(decision.action);
    expect(decision.decisionId).toMatch(/^dec-/);
    expect(decision.policy.policyId).toBe("pol-neutral");
    expect(decision.at).toBe(10_000);

    // Durable: GET the decision back through the route.
    const fetched = await tenantA.decisions.get(decision.decisionId);
    expect(fetched.decisionId).toBe(decision.decisionId);
    expect(fetched.action).toBe(decision.action);

    // Tenant law: tenant B cannot read tenant A's decision.
    await expect(tenantB.decisions.get(decision.decisionId)).rejects.toThrow();
  });

  it("idempotency: replaying the same decision key returns the SAME decision", async () => {
    const first = await tenantA.decisions.request({
      requestId: "req-2",
      tenant: { tenantId: "prod-tenant-a" },
      subject: { kind: "user", ref: "user-42" },
      objective: { objectiveId: "obj-relax", version: "1", kind: "relax", params: {} },
      attentionPolicy: { policyId: "att-balanced", version: "1", style: "balanced", params: {} },
      context: { contextId: "ctx-evening" },
      candidates: {
        setId: "cs-2",
        candidates: [{ itemId: "prod-item-1", realizationIds: ["prod-real-1"], source: "test-retrieval" }],
      },
      policySelector: { policyId: "pol-neutral", version: "1" },
      at: 20_000,
      idempotencyKey: "idem-req-2",
    } as never);
    const second = await tenantA.decisions.request({
      requestId: "req-2",
      tenant: { tenantId: "prod-tenant-a" },
      subject: { kind: "user", ref: "user-42" },
      objective: { objectiveId: "obj-relax", version: "1", kind: "relax", params: {} },
      attentionPolicy: { policyId: "att-balanced", version: "1", style: "balanced", params: {} },
      context: { contextId: "ctx-evening" },
      candidates: {
        setId: "cs-2",
        candidates: [{ itemId: "prod-item-1", realizationIds: ["prod-real-1"], source: "test-retrieval" }],
      },
      policySelector: { policyId: "pol-neutral", version: "1" },
      at: 20_000,
      idempotencyKey: "idem-req-2",
    } as never);
    expect(second.decisionId).toBe(first.decisionId);
  });

  it("outcomes: durable transport stores the event (at-least-once, idempotent)", async () => {
    const event: OutcomeEvent = await tenantA.outcomes.append({
      eventId: "prod-ev-1",
      tenant: { tenantId: "prod-tenant-a" },
      subject: { kind: "user", ref: "user-42" },
      eventType: "completion",
      occurredAt: 30_000,
      evidenceClass: "production-observed",
      idempotencyKey: "idem-ev-1",
    } as never);
    expect(event.eventId).toBe("prod-ev-1");
    await composition.transport.flush();
    const stored = await composition.stores.events.getByEventId(
      { tenantId: "prod-tenant-a" },
      "prod-ev-1",
    );
    expect(stored?.event.eventId).toBe("prod-ev-1");
    expect(stored?.event.occurredAt).toBe(30_000);
  });

  it("preferences: append-only durable deltas", async () => {
    const delta = await tenantA.preferences.appendDelta({
      deltaId: "prod-delta-1",
      tenant: { tenantId: "prod-tenant-a" },
      subject: { kind: "user", ref: "user-42" },
      dimension: "genre.documentary",
      op: "add",
      value: 1,
      model: { modelId: "prod-model", version: "1" },
      timestamp: 40_000,
    } as never);
    expect(delta.deltaId).toBe("prod-delta-1");
    const stored = await composition.stores.preferences.bySubject(
      { tenantId: "prod-tenant-a" },
      { kind: "user", ref: "user-42" },
    );
    expect(stored.map((d) => d.deltaId)).toEqual(["prod-delta-1"]);
  });

  it("plans: create durably, replan appends a version (never overwrites)", async () => {
    const plan: ExperiencePlan = {
      schema: "reckon.experience-plan",
      schemaVersion: "0.1.0",
      planId: "prod-plan-1",
      version: 0,
      tenant: { tenantId: "prod-tenant-a" },
      subject: { kind: "user", ref: "user-42" },
      objective: { objectiveId: "obj-relax", version: "1", kind: "relax", params: {} },
      attentionPolicy: { policyId: "att-balanced", version: "1", style: "balanced", params: {} },
      queuedExperiences: [],
      replanTriggers: [],
      resumeCheckpoints: [],
      createdAt: 50_000,
      updatedAt: 50_000,
    };
    const created = await tenantA.plans.create(plan);
    expect(created.planId).toBe("prod-plan-1");

    const replanned = await tenantA.plans.replan("prod-plan-1", { trigger: "outcome-observed" } as never);
    expect(replanned.planId).toBe("prod-plan-1");

    const history = await composition.stores.plans.history(
      { tenantId: "prod-tenant-a" },
      "prod-plan-1",
    );
    expect(history.map((h) => h.version)).toEqual([1, 2]);
    expect(history[1]?.reason).toBe("replan:outcome-observed");
  });

  it("candidates: validated echo (candidate sets enter decisions, not state)", async () => {
    const set = await tenantA.candidates.submit({
      setId: "cs-echo",
      candidates: [{ itemId: "prod-item-1", realizationIds: ["prod-real-1"], source: "test-retrieval" }],
    });
    expect(set.setId).toBe("cs-echo");
  });
});
