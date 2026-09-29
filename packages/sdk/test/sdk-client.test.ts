import { describe, it, expect } from "vitest";
import { createReckonClient } from "../src/client.js";
import { isReckonSdkError } from "../src/client.js";
import {
  buildHarness,
  decisionRequestInput,
  outcomeEventInput,
  preferenceDeltaInput,
  planInput,
  catalogItemInput,
  realizationInput,
  candidateSetInput,
  resolveRequestInput,
  TENANT_A,
} from "./harness.js";

/**
 * W3-002 happy-path coverage: every SDK operation round-trips through the
 * REAL apps/api route pipeline in-process (auth → zod validation → handler
 * → response validation → typed result). Evidence class: controlled-local.
 */
describe("W3-002 SDK — happy paths against the real in-process API", () => {
  it("requests a decision and returns a contract-valid DecisionResult", async () => {
    const harness = buildHarness();
    const client = createReckonClient({ baseUrl: "http://reckon.test", apiKey: "sdk-alpha", fetchImpl: harness.fetch });
    const result = await client.decisions.request(decisionRequestInput());
    expect(result.action).toBe("SUGGEST");
    expect(result.tenant).toEqual({ tenantId: TENANT_A });
    expect(result.policy).toEqual({ policyId: "greedy-v1", version: "1" });
    expect(result.uncertainty?.confidence).toBe(0.72);
    expect(result.scheduleDelta?.enqueue).toEqual(["exp-1"]);
    expect(harness.state.decisionCalls).toBe(1);
    await harness.app.close();
  });

  it("appends an outcome event and round-trips it", async () => {
    const harness = buildHarness();
    const client = createReckonClient({ baseUrl: "http://reckon.test", apiKey: "sdk-alpha", fetchImpl: harness.fetch });
    const event = await client.outcomes.append(outcomeEventInput());
    expect(event.eventType).toBe("completion");
    expect(event.metrics.watchRatio).toBe(0.9);
    expect(event.evidenceClass).toBe("production-observed");
    expect(harness.state.outcomeCalls).toBe(1);
    expect(harness.state.outcomeTenants).toEqual([TENANT_A]);
    await harness.app.close();
  });

  it("appends a preference delta", async () => {
    const harness = buildHarness();
    const client = createReckonClient({ baseUrl: "http://reckon.test", apiKey: "sdk-alpha", fetchImpl: harness.fetch });
    const delta = await client.preferences.appendDelta(preferenceDeltaInput());
    expect(delta.dimension).toBe("genre.scifi");
    expect(delta.op).toBe("add");
    expect(harness.state.preferenceCalls).toBe(1);
    await harness.app.close();
  });

  it("creates and replans an experience plan", async () => {
    const harness = buildHarness();
    const client = createReckonClient({ baseUrl: "http://reckon.test", apiKey: "sdk-alpha", fetchImpl: harness.fetch });
    const created = await client.plans.create(planInput());
    expect(created.planId).toBeTypeOf("string");
    expect(harness.state.planCreateCalls).toBe(1);

    const replanned = await client.plans.replan(created.planId, { trigger: "outcome-observed" });
    expect(replanned.planId).toBe(created.planId);
    expect(replanned.replanTriggers).toEqual(["outcome-observed"]);
    expect(harness.state.replanCalls).toBe(1);
    await harness.app.close();
  });

  it("upserts catalog items and realizations", async () => {
    const harness = buildHarness();
    const client = createReckonClient({ baseUrl: "http://reckon.test", apiKey: "sdk-alpha", fetchImpl: harness.fetch });
    const item = await client.catalog.upsertItem(catalogItemInput());
    expect(item.kind).toBe("media");
    expect(item.schema).toBe("reckon.catalog-item");
    expect(harness.state.catalogItemCalls).toBe(1);

    const realization = await client.catalog.upsertRealization(realizationInput());
    expect(realization.kind).toBe("stream");
    expect(realization.schema).toBe("reckon.realization");
    expect(harness.state.realizationCalls).toBe(1);
    await harness.app.close();
  });

  it("submits a candidate set", async () => {
    const harness = buildHarness();
    const client = createReckonClient({ baseUrl: "http://reckon.test", apiKey: "sdk-alpha", fetchImpl: harness.fetch });
    const set = await client.candidates.submit(candidateSetInput());
    expect(set.candidates).toHaveLength(1);
    expect(set.candidates[0]!.source).toBe("host-retrieval");
    expect(harness.state.candidateCalls).toBe(1);
    await harness.app.close();
  });

  it("resolves experiences from items + realizations", async () => {
    const harness = buildHarness();
    const client = createReckonClient({ baseUrl: "http://reckon.test", apiKey: "sdk-alpha", fetchImpl: harness.fetch });
    const resolved = await client.experiences.resolve(resolveRequestInput());
    expect(resolved.experiences).toHaveLength(1);
    expect(resolved.experiences[0]!.itemId).toBe("item-1");
    expect(resolved.experiences[0]!.realizationId).toBe("real-1");
    expect(resolved.experiences[0]!.format.kind).toBe("full");
    expect(harness.state.resolveCalls).toBe(1);
    await harness.app.close();
  });

  it("fetches a decision by id after requesting it", async () => {
    const harness = buildHarness();
    const client = createReckonClient({ baseUrl: "http://reckon.test", apiKey: "sdk-alpha", fetchImpl: harness.fetch });
    const result = await client.decisions.request(decisionRequestInput());
    const fetched = await client.decisions.get(result.decisionId);
    expect(fetched.decisionId).toBe(result.decisionId);
    expect(fetched.action).toBe("SUGGEST");
    await harness.app.close();
  });
});

describe("W3-002 SDK — idempotency through the client", () => {
  it("replays the original response for a repeated body idempotencyKey (handler called once)", async () => {
    const harness = buildHarness();
    const client = createReckonClient({ baseUrl: "http://reckon.test", apiKey: "sdk-alpha", fetchImpl: harness.fetch });
    const body = decisionRequestInput();
    const first = await client.decisions.request(body);
    const second = await client.decisions.request({ ...body });
    expect(second).toEqual(first);
    expect(harness.state.decisionCalls).toBe(1);
    await harness.app.close();
  });

  it("uses the generated Idempotency-Key header for header-keyed routes", async () => {
    const harness = buildHarness();
    let counter = 0;
    const client = createReckonClient({
      baseUrl: "http://reckon.test",
      apiKey: "sdk-alpha",
      fetchImpl: harness.fetch,
      idGenerator: () => `generated-key-${(counter += 1)}`,
    });
    await client.plans.create(planInput());
    await client.preferences.appendDelta(preferenceDeltaInput());
    // Different generated keys → distinct requests → handlers called once each.
    expect(harness.state.planCreateCalls).toBe(1);
    expect(harness.state.preferenceCalls).toBe(1);
    await harness.app.close();
  });

  it("replays when the caller reuses an explicit Idempotency-Key", async () => {
    const harness = buildHarness();
    const client = createReckonClient({ baseUrl: "http://reckon.test", apiKey: "sdk-alpha", fetchImpl: harness.fetch });
    const body = planInput();
    const first = await client.plans.create(body, { idempotencyKey: "explicit-1" });
    const second = await client.plans.create(body, { idempotencyKey: "explicit-1" });
    expect(second).toEqual(first);
    expect(harness.state.planCreateCalls).toBe(1);
    await harness.app.close();
  });

  it("surfaces 409 when the same key is reused with a different body", async () => {
    const harness = buildHarness();
    const client = createReckonClient({ baseUrl: "http://reckon.test", apiKey: "sdk-alpha", fetchImpl: harness.fetch });
    await client.plans.create(planInput({ planId: "plan-1" }), { idempotencyKey: "key-409" });
    const different = planInput({ planId: "plan-2" });
    await expect(client.plans.create(different, { idempotencyKey: "key-409" })).rejects.toMatchObject({
      name: "ReckonIdempotencyConflictError",
      code: "IDEMPOTENCY_CONFLICT",
      statusCode: 409,
    });
    await harness.app.close();
  });
});

describe("W3-002 SDK — tenant isolation through the client", () => {
  it("rejects a body tenant that does not match the API key tenant (403 TENANT_MISMATCH)", async () => {
    const harness = buildHarness();
    const client = createReckonClient({ baseUrl: "http://reckon.test", apiKey: "sdk-alpha", fetchImpl: harness.fetch });
    const crossTenant = decisionRequestInput({ tenant: { tenantId: "sdk-tenant-b" } });
    const error = await client.decisions.request(crossTenant).catch((e: unknown) => e);
    expect(isReckonSdkError(error)).toBe(true);
    expect(error).toMatchObject({ name: "ReckonTenantMismatchError", code: "TENANT_MISMATCH", statusCode: 403 });
    expect(harness.state.decisionCalls).toBe(0);
    await harness.app.close();
  });

  it("cannot read another tenant's decisions (tenant-scoped 404, not data leak)", async () => {
    const harness = buildHarness();
    // Tenant B creates a decision through the beta key.
    const beta = createReckonClient({ baseUrl: "http://reckon.test", apiKey: "sdk-beta", fetchImpl: harness.fetch });
    const theirs = await beta.decisions.request(decisionRequestInput({ tenant: { tenantId: "sdk-tenant-b" } }));

    // Tenant A's key cannot see it.
    const alpha = createReckonClient({ baseUrl: "http://reckon.test", apiKey: "sdk-alpha", fetchImpl: harness.fetch });
    const error = await alpha.decisions.get(theirs.decisionId).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: "ReckonNotFoundError", code: "NOT_FOUND", statusCode: 404 });

    // Tenant B's key can.
    const visible = await beta.decisions.get(theirs.decisionId);
    expect(visible.decisionId).toBe(theirs.decisionId);
    await harness.app.close();
  });

  it("keys with insufficient scope get 403 INSUFFICIENT_SCOPE", async () => {
    const harness = buildHarness();
    // gamma has only the outcomes scope.
    const gamma = createReckonClient({ baseUrl: "http://reckon.test", apiKey: "sdk-gamma", fetchImpl: harness.fetch });
    const error = await gamma.decisions.request(decisionRequestInput({ tenant: { tenantId: "sdk-tenant-c" } })).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: "ReckonScopeError", code: "INSUFFICIENT_SCOPE", statusCode: 403 });
    // The same key CAN append outcomes.
    const ok = await gamma.outcomes.append(outcomeEventInput({ tenant: { tenantId: "sdk-tenant-c" } }));
    expect(ok.eventType).toBe("completion");
    await harness.app.close();
  });
});
