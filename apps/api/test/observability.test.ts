import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryEventStoreAdapter } from "@reckon/events";
import type { EventStore } from "@reckon/events";
import {
  InMemoryObservabilitySink,
  JsonlFileObservabilitySink,
  ObservabilityRecorder,
} from "@reckon/observability";
import type { ObservabilityRecord } from "@reckon/observability";
import { DecisionResultSchema } from "@reckon/contracts";
import type { DecisionRequest, OutcomeEvent } from "@reckon/contracts";
import { buildServer } from "../src/server.js";
import { wireOutcomeTransport } from "../src/outcome-transport.js";
import type { HandlerPorts, PartialHandlerPorts } from "../src/ports.js";

/**
 * W3-004 apps/api wiring: decision/outcome/scheduler paths emit records
 * through the sink port (composition only; route contracts frozen).
 * Evidence class: controlled-local.
 */

const TENANT = "tenant-a";
const KEY = "obs-key-alpha";
const KEYS = [{ apiKey: KEY, tenantId: TENANT, scopes: ["decisions", "outcomes", "plans", "catalog"] as const }];

function ids(): () => string {
  let n = 0;
  return () => `rec-${(n += 1)}`;
}

let unique = 0;
function uniqueId(prefix: string): string {
  unique += 1;
  return `${prefix}-${unique}`;
}

function decisionRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: "req-1",
    tenant: { tenantId: TENANT },
    subject: { kind: "user", ref: "user-9" },
    objective: { objectiveId: "obj-1", kind: "relax" },
    attentionPolicy: { policyId: "ap-1", style: "balanced" },
    context: { contextId: "ctx-1" },
    candidates: {
      setId: "cs-1",
      candidates: [{ itemId: "item-1", realizationIds: ["real-1"], source: "host-retrieval" }],
    },
    policySelector: { policyId: "greedy-v1", version: "2" },
    idempotencyKey: uniqueId("idem"),
    ...overrides,
  };
}

function outcomeBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventId: uniqueId("ev"),
    tenant: { tenantId: TENANT },
    subject: { kind: "user", ref: "user-9" },
    eventType: "completion",
    occurredAt: 2_000,
    evidenceClass: "production-observed",
    decisionId: "dec-obs-1",
    experienceId: "exp-1",
    idempotencyKey: uniqueId("idem"),
    ...overrides,
  };
}

function authed(method: "POST" | "GET", url: string, payload?: unknown) {
  return {
    method,
    url,
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  };
}

/** Deterministic decision handler that advances the manual clock. */
function clockedDecisionHandler(clock: { advance(ms: number): number }): HandlerPorts["decisionHandler"] {
  return {
    decide: async (request: DecisionRequest) => {
      clock.advance(42); // deterministic simulated handler work
      return DecisionResultSchema.parse({
        decisionId: `dec-${request.idempotencyKey}`,
        requestId: request.requestId,
        tenant: request.tenant,
        action: "SUGGEST",
        selectedExperience: {
          experienceId: "exp-1",
          itemId: "item-1",
          realizationId: "real-1",
          format: { kind: "full", params: {} },
        },
        uncertainty: { confidence: 0.77, method: "ensemble" },
        policy: { policyId: request.policySelector.policyId, version: request.policySelector.version },
        scheduleDelta: { action: "SUGGEST", enqueue: ["exp-1"], dequeue: [] },
        latency: { inferenceCost: 0.001, currency: "USD" },
        at: 1_000,
      });
    },
  };
}

/** An EventStore facade whose append always fails (transport sink down). */
function downStore(): EventStore {
  const store = new InMemoryEventStoreAdapter();
  return {
    append: () => {
      throw new Error("store down");
    },
    getByDecision: (t, id) => store.getByDecision(t, id),
    getBySubject: (t, s, r) => store.getBySubject(t, s, r),
    getByExperience: (t, id) => store.getByExperience(t, id),
    stream: (t, r) => store.stream(t, r),
    observed: (t, r) => store.observed(t, r),
    research: (t, r) => store.research(t, r),
  };
}

describe("W3-004 apps/api — records flow from the composition root", () => {
  it("decision → schedule → outcome flow produces complete record sets", async () => {
    const sink = new InMemoryObservabilitySink();
    const clock = { value: 1_000 };
    const manualClock = {
      now: () => clock.value,
      advance: (ms: number) => (clock.value += ms),
    };
    const handlers: PartialHandlerPorts = {
      decisionHandler: clockedDecisionHandler(manualClock),
      outcomeIngest: { ingest: async (event: OutcomeEvent) => event },
    };
    const app = buildServer({
      keys: KEYS,
      handlers,
      observability: { sink, clock: () => clock.value, idGenerator: ids() },
    });

    // Decision path (latency measured from the injected clock: the handler
    // advances it by 42 deterministically).
    const decisionResponse = await app.inject(authed("POST", "/v1/decisions", decisionRequest()));
    expect(decisionResponse.statusCode).toBe(200);
    const decisionId = (decisionResponse.json() as { decisionId: string }).decisionId;

    // Outcome path linked to that decision.
    const outcomeResponse = await app.inject(authed("POST", "/v1/outcomes", outcomeBody({ decisionId })));
    expect(outcomeResponse.statusCode).toBe(200);

    const records = sink.records();
    // 9 capability records + decision + scheduler-action + outcome-linkage.
    expect(records.filter((r) => r.kind === "integration-capability")).toHaveLength(11);

    const decision = records.find((r) => r.kind === "decision");
    expect(decision).toMatchObject({
      kind: "decision",
      tenant: { tenantId: TENANT },
      decisionId,
      requestId: "req-1",
      action: "SUGGEST",
      policy: { policyId: "greedy-v1", version: "2" },
      latencyMs: 42,
      latencySource: "injected-clock",
      status: "ok",
    });
    expect((decision as { uncertainty?: { confidence?: number } }).uncertainty?.confidence).toBe(0.77);
    expect((decision as { cost?: { inferenceCost?: number } }).cost?.inferenceCost).toBe(0.001);

    const scheduler = records.find((r) => r.kind === "scheduler-action");
    expect(scheduler).toMatchObject({
      source: "decision",
      action: "SUGGEST",
      decisionId,
      enqueuedCount: 1,
      dequeuedCount: 0,
    });

    const linkage = records.find((r) => r.kind === "outcome-linkage");
    expect(linkage).toMatchObject({
      eventId: (outcomeResponse.json() as { eventId: string }).eventId,
      decisionId,
      experienceId: "exp-1",
      linked: true,
      outcomeEvidenceClass: "production-observed",
    });
    await app.close();
  });

  it("handler failure: error-decorated decision record + route error record", async () => {
    const sink = new InMemoryObservabilitySink();
    const clock = { value: 5_000 };
    const handlers: PartialHandlerPorts = {
      decisionHandler: {
        decide: async () => {
          clock.value += 7;
          throw new Error("kernel exploded");
        },
      },
    };
    const app = buildServer({
      keys: KEYS,
      handlers,
      observability: { sink, clock: () => clock.value, idGenerator: ids() },
    });

    const response = await app.inject(authed("POST", "/v1/decisions", decisionRequest()));
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: { code: "INTERNAL" } });

    const decision = sink.records().find((r) => r.kind === "decision");
    expect(decision).toMatchObject({
      status: "error",
      errorCode: "INTERNAL",
      latencyMs: 7,
    });
    const routeError = sink.records().find((r) => r.kind === "error");
    expect(routeError).toMatchObject({
      scope: "route",
      code: "INTERNAL",
      route: "POST /v1/decisions",
      tenant: { tenantId: TENANT },
    });
    await app.close();
  });

  it("unauthenticated requests record route errors without a tenant", async () => {
    const sink = new InMemoryObservabilitySink();
    const app = buildServer({
      keys: KEYS,
      observability: { sink, clock: () => 0, idGenerator: ids() },
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/decisions",
      headers: { authorization: "Bearer wrong-key", "content-type": "application/json" },
      payload: decisionRequest(),
    });
    expect(response.statusCode).toBe(401);
    const error = sink.records().find((r) => r.kind === "error");
    expect(error).toMatchObject({ scope: "route", code: "UNAUTHENTICATED", route: "POST /v1/decisions" });
    expect((error as { tenant?: unknown }).tenant).toBeUndefined();
    await app.close();
  });

  it("validation failures (400) produce route error records", async () => {
    const sink = new InMemoryObservabilitySink();
    const app = buildServer({
      keys: KEYS,
      observability: { sink, clock: () => 0, idGenerator: ids() },
    });
    const response = await app.inject(authed("POST", "/v1/outcomes", outcomeBody({ eventType: "not-an-event-type" })));
    expect(response.statusCode).toBe(400);
    const error = sink.records().find((r) => r.kind === "error");
    expect(error).toMatchObject({ scope: "route", code: "VALIDATION_ERROR" });
    await app.close();
  });

  it("not-wired ports are recorded as unavailable capabilities + 501 errors", async () => {
    const sink = new InMemoryObservabilitySink();
    const app = buildServer({
      keys: KEYS,
      observability: { sink, clock: () => 0, idGenerator: ids() },
    });
    const response = await app.inject(authed("POST", "/v1/decisions", decisionRequest()));
    expect(response.statusCode).toBe(501);
    const capabilities = sink.records().filter((r) => r.kind === "integration-capability");
    const all = capabilities as unknown as { capability: string; available: boolean; detail?: string }[];
    expect(all.every((c) => c.available === false)).toBe(true);
    expect(all.find((c) => c.capability === "handler:decisionHandler")).toMatchObject({
      available: false,
      detail: "NotWired",
    });
    expect(sink.records().find((r) => r.kind === "error")).toMatchObject({
      code: "NOT_WIRED",
      scope: "route",
    });
    await app.close();
  });

  it("terminal transport failures surface as error records through the composition", async () => {
    const sink = new InMemoryObservabilitySink();
    const clock = { value: 0 };
    // Host composition: transport terminal failures → observability error
    // records through the same sink the API writes to.
    const failureRecorder = new ObservabilityRecorder({ sink, clock: () => clock.value, idGenerator: ids() });
    const wiring = wireOutcomeTransport({
      store: downStore(),
      clock: { now: () => clock.value },
      maxAttempts: 1,
      onTerminalFailure: (failure) =>
        failureRecorder.recordError({
          scope: "transport",
          code: "TRANSPORT_TERMINAL_FAILURE",
          message: failure.reason.message,
          tenant: { tenantId: TENANT },
        }),
    });
    const app = buildServer({
      keys: KEYS,
      handlers: { outcomeIngest: wiring.handler },
      observability: { sink, clock: () => clock.value, idGenerator: ids() },
    });

    const response = await app.inject(authed("POST", "/v1/outcomes", outcomeBody()));
    expect(response.statusCode).toBe(200); // accepted (async at-least-once)

    const error = sink.records().find((r) => r.kind === "error" && r.scope === "transport");
    expect(error).toMatchObject({ code: "TRANSPORT_TERMINAL_FAILURE", message: "store down" });
    // The outcome-linkage record for the accepted event is also present.
    expect(sink.records().find((r) => r.kind === "outcome-linkage")).toMatchObject({
      linked: true,
    });
    await app.close();
  });

  it("the JSONL file sink works through the route composition", async () => {
    const dir = mkdtempSync(join(tmpdir(), "reckon-api-observability-"));
    try {
      const path = join(dir, "records.jsonl");
      const clock = { value: 100 };
      const app = buildServer({
        keys: KEYS,
        handlers: {
          decisionHandler: clockedDecisionHandler({
            advance: (ms: number) => (clock.value += ms),
          }),
        },
        observability: {
          sink: new JsonlFileObservabilitySink(path),
          clock: () => clock.value,
          idGenerator: ids(),
        },
      });
      const response = await app.inject(authed("POST", "/v1/decisions", decisionRequest()));
      expect(response.statusCode).toBe(200);

      const records: readonly ObservabilityRecord[] = new JsonlFileObservabilitySink(path).readAll();
      expect(records.filter((r) => r.kind === "integration-capability")).toHaveLength(11);
      expect(records.find((r) => r.kind === "decision")).toMatchObject({ latencyMs: 42, status: "ok" });
      expect(records.find((r) => r.kind === "scheduler-action")).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
