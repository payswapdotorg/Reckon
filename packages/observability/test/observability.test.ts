import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contentDigest } from "@reckon/contracts";
import type { DecisionRequest, DecisionResult, OutcomeEvent, TenantScope } from "@reckon/contracts";
import { DecisionResultSchema } from "@reckon/contracts";
import {
  InMemoryObservabilitySink,
  JsonlFileObservabilitySink,
  ObservabilityInputError,
  ObservabilityRecorder,
  ObservabilityRecordCorruptError,
} from "../src/index.js";
import type { ObservabilityRecord } from "../src/index.js";

/**
 * W3-004 — observability records. Evidence class: controlled-local
 * (in-memory + JSONL sinks are TEST INFRASTRUCTURE).
 */

const tenant: TenantScope = { tenantId: "tenant-a" };

function makeIdFactory(): () => string {
  let n = 0;
  return () => `rec-${(n += 1)}`;
}

function makeRequest(): DecisionRequest {
  return {
    schema: "reckon.decision-request",
    schemaVersion: "0.1.0",
    requestId: "req-1",
    tenant,
    subject: { kind: "user", ref: "user-9" },
    objective: { objectiveId: "obj-1", version: "1", kind: "relax", params: {} },
    attentionPolicy: { policyId: "ap-1", version: "1", style: "balanced", params: {} },
    context: { contextId: "ctx-1" },
    candidates: {
      setId: "cs-1",
      candidates: [{ itemId: "item-1", realizationIds: ["real-1"], source: "host-retrieval" }],
    },
    constraints: [],
    policySelector: { policyId: "greedy-v1", version: "2" },
    idempotencyKey: "idem-1",
  };
}

function makeResult(overrides: Record<string, unknown> = {}): DecisionResult {
  return DecisionResultSchema.parse({
    decisionId: "dec-1",
    requestId: "req-1",
    tenant,
    action: "SUGGEST",
    selectedExperience: {
      experienceId: "exp-1",
      itemId: "item-1",
      realizationId: "real-1",
      format: { kind: "full", params: {} },
    },
    uncertainty: { confidence: 0.81, spread: 0.05, method: "ensemble" },
    policy: { policyId: "greedy-v1", version: "2" },
    scheduleDelta: {
      action: "SUGGEST",
      enqueue: ["exp-1", "exp-2"],
      dequeue: [],
      resumeCheckpoint: { experienceId: "exp-old", resumeToken: "token-1" },
    },
    reasons: [{ code: "test", message: "deterministic result" }],
    latency: { latencyMsP50: 12, inferenceCost: 0.002, currency: "USD" },
    at: 1_500,
    ...overrides,
  });
}

function makeEvent(): OutcomeEvent {
  return {
    schema: "reckon.outcome-event",
    schemaVersion: "0.1.0",
    eventId: "ev-1",
    tenant,
    decisionId: "dec-1",
    experienceId: "exp-1",
    subject: { kind: "user", ref: "user-9" },
    eventType: "completion",
    occurredAt: 2_000,
    evidenceClass: "production-observed",
    metrics: { watchRatio: 0.92 },
    idempotencyKey: "outcome-1",
  };
}

describe("W3-004 — record completeness for a decision → schedule → outcome flow", () => {
  it("records the full flow with every mandated field present", () => {
    const sink = new InMemoryObservabilitySink();
    let clockValue = 1_000;
    const recorder = new ObservabilityRecorder({
      sink,
      clock: () => clockValue,
      idGenerator: makeIdFactory(),
    });

    const request = makeRequest();
    const result = makeResult();

    const decision = recorder.recordDecision({ request, result, latencyMs: 37 });
    clockValue += 5;
    const scheduler = recorder.recordSchedulerAction({
      source: "decision",
      action: result.scheduleDelta?.action ?? "SUGGEST",
      tenant: request.tenant,
      decisionId: result.decisionId,
      planId: result.scheduleDelta?.planId,
      scheduleDelta: result.scheduleDelta,
    });
    clockValue += 5;
    const outcome = recorder.recordOutcome({ event: makeEvent(), transportStatus: "delivered" });

    expect(sink.size).toBe(3);

    // Decision record completeness: latency, policy version, uncertainty, cost.
    expect(decision).toMatchObject({
      kind: "decision",
      recordId: "rec-1",
      recordedAt: 1_000,
      tenant,
      decisionId: "dec-1",
      requestId: "req-1",
      action: "SUGGEST",
      policy: { policyId: "greedy-v1", version: "2" },
      latencyMs: 37,
      latencySource: "injected-clock",
      status: "ok",
    });
    expect(decision.uncertainty).toMatchObject({ confidence: 0.81, method: "ensemble" });
    expect(decision.cost).toMatchObject({ latencyMsP50: 12, inferenceCost: 0.002, currency: "USD" });

    // Scheduler action record: counts + interrupted experience.
    expect(scheduler).toMatchObject({
      kind: "scheduler-action",
      source: "decision",
      action: "SUGGEST",
      decisionId: "dec-1",
      enqueuedCount: 2,
      dequeuedCount: 0,
      interruptedExperienceId: "exp-old",
      recordedAt: 1_005,
    });

    // Outcome linkage record: eventId ↔ decisionId.
    expect(outcome).toMatchObject({
      kind: "outcome-linkage",
      eventId: "ev-1",
      decisionId: "dec-1",
      experienceId: "exp-1",
      eventType: "completion",
      outcomeEvidenceClass: "production-observed",
      linked: true,
      transportStatus: "delivered",
      recordedAt: 1_010,
    });

    // Unlinked outcomes are explicitly marked.
    const unlinked = recorder.recordOutcome({
      event: { ...makeEvent(), decisionId: undefined },
    });
    expect(unlinked.linked).toBe(false);
    expect(unlinked.decisionId).toBeUndefined();
  });
});

describe("W3-004 — digest stability (calibration law)", () => {
  it("identical inputs produce identical records and digests across instances", () => {
    const record = (sink: InMemoryObservabilitySink): ObservabilityRecord => {
      const recorder = new ObservabilityRecorder({
        sink,
        clock: () => 5_000,
        idGenerator: makeIdFactory(),
      });
      return recorder.recordDecision({ request: makeRequest(), result: makeResult(), latencyMs: 12 });
    };
    const sinkA = new InMemoryObservabilitySink();
    const sinkB = new InMemoryObservabilitySink();
    expect(record(sinkA)).toEqual(record(sinkB));
    expect(sinkA.records()[0]?.contentDigest).toBe(sinkB.records()[0]?.contentDigest);
  });

  it("the digest is the contentDigest of the record minus the digest field", () => {
    const sink = new InMemoryObservabilitySink();
    const recorder = new ObservabilityRecorder({ sink, clock: () => 7, idGenerator: makeIdFactory() });
    const decision = recorder.recordDecision({ request: makeRequest(), result: makeResult(), latencyMs: 3 });
    const { contentDigest: digest, ...content } = decision;
    expect(digest).toBe(contentDigest(content));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("records are frozen — historical evidence cannot be mutated through the sink", () => {
    const sink = new InMemoryObservabilitySink();
    const recorder = new ObservabilityRecorder({ sink, clock: () => 7, idGenerator: makeIdFactory() });
    const decision = recorder.recordDecision({ request: makeRequest(), result: makeResult(), latencyMs: 3 });
    expect(Object.isFrozen(decision)).toBe(true);
    const stored = sink.records()[0] as { latencyMs?: number };
    expect(() => {
      stored.latencyMs = 999;
    }).toThrow();
  });
});

describe("W3-004 — latency from the injected clock", () => {
  it("latency is caller-computed from clock deltas and recorded verbatim", () => {
    const sink = new InMemoryObservabilitySink();
    let clockValue = 10_000;
    const recorder = new ObservabilityRecorder({ sink, clock: () => clockValue, idGenerator: makeIdFactory() });

    // The composition wrapper pattern: measure around the handler.
    const startedAt = clockValue;
    clockValue += 42; // simulated handler execution under the injected clock
    const latencyMs = clockValue - startedAt;

    const decision = recorder.recordDecision({ request: makeRequest(), result: makeResult(), latencyMs });
    expect(decision.latencyMs).toBe(42);
    expect(decision.latencySource).toBe("injected-clock");
  });

  it("negative latency is clamped to 0 (clock skew defense)", () => {
    const sink = new InMemoryObservabilitySink();
    const recorder = new ObservabilityRecorder({ sink, clock: () => 0, idGenerator: makeIdFactory() });
    const decision = recorder.recordDecision({ request: makeRequest(), result: makeResult(), latencyMs: -5 });
    expect(decision.latencyMs).toBe(0);
  });
});

describe("W3-004 — error-path records", () => {
  it("records a failed decision (no result) with the error code", () => {
    const sink = new InMemoryObservabilitySink();
    const recorder = new ObservabilityRecorder({ sink, clock: () => 1, idGenerator: makeIdFactory() });
    const decision = recorder.recordDecision({
      request: makeRequest(),
      error: { code: "INTERNAL", message: "handler exploded" },
      latencyMs: 4,
    });
    expect(decision).toMatchObject({
      status: "error",
      errorCode: "INTERNAL",
      errorMessage: "handler exploded",
    });
    expect(decision.decisionId).toBeUndefined();
    expect(decision.policy).toBeUndefined();
  });

  it("records transport failures as error records and failed outcomes with status", () => {
    const sink = new InMemoryObservabilitySink();
    const recorder = new ObservabilityRecorder({ sink, clock: () => 1, idGenerator: makeIdFactory() });
    const error = recorder.recordError({
      scope: "transport",
      code: "SINK_PERMANENTLY_DOWN",
      message: "outcome transport exhausted retries",
      tenant,
    });
    expect(error).toMatchObject({ kind: "error", scope: "transport", code: "SINK_PERMANENTLY_DOWN", tenant });

    const failedOutcome = recorder.recordOutcome({ event: makeEvent(), transportStatus: "failed" });
    expect(failedOutcome.transportStatus).toBe("failed");
  });

  it("error records omit tenant when the failure predates authentication", () => {
    const sink = new InMemoryObservabilitySink();
    const recorder = new ObservabilityRecorder({ sink, clock: () => 1, idGenerator: makeIdFactory() });
    const error = recorder.recordError({ scope: "route", code: "UNAUTHENTICATED", message: "bad key" });
    expect(error.tenant).toBeUndefined();
  });
});

describe("W3-004 — input validation (typed errors, never raw throws)", () => {
  it("rejects an invalid DecisionResult with typed ObservabilityInputError", () => {
    const recorder = new ObservabilityRecorder({
      sink: new InMemoryObservabilitySink(),
      clock: () => 0,
      idGenerator: makeIdFactory(),
    });
    const badResult = { ...makeResult(), action: "NOT_AN_ACTION" } as unknown as DecisionResult;
    expect(() =>
      recorder.recordDecision({ request: makeRequest(), result: badResult, latencyMs: 1 }),
    ).toThrow(ObservabilityInputError);
  });

  it("rejects an invalid OutcomeEvent", () => {
    const recorder = new ObservabilityRecorder({
      sink: new InMemoryObservabilitySink(),
      clock: () => 0,
      idGenerator: makeIdFactory(),
    });
    const badEvent = { ...makeEvent(), evidenceClass: "not-a-class" } as unknown as OutcomeEvent;
    expect(() => recorder.recordOutcome({ event: badEvent })).toThrow(ObservabilityInputError);
  });

  it("rejects recordDecision with neither result nor error", () => {
    const recorder = new ObservabilityRecorder({
      sink: new InMemoryObservabilitySink(),
      clock: () => 0,
      idGenerator: makeIdFactory(),
    });
    expect(() =>
      recorder.recordDecision({ request: makeRequest(), latencyMs: 1 } as never),
    ).toThrow(ObservabilityInputError);
  });
});

describe("W3-004 — integration capability + JSONL sink", () => {
  it("records integration capabilities (wired vs not-wired)", () => {
    const sink = new InMemoryObservabilitySink();
    const recorder = new ObservabilityRecorder({ sink, clock: () => 1, idGenerator: makeIdFactory() });
    recorder.recordIntegrationCapability({
      integration: "@reckon/api",
      capability: "handler:decisionHandler",
      available: true,
    });
    recorder.recordIntegrationCapability({
      integration: "@reckon/api",
      capability: "handler:planHandler",
      available: false,
      detail: "NotWired",
    });
    const capabilities = sink.byKind("integration-capability");
    expect(capabilities).toHaveLength(2);
    expect(capabilities[0]).toMatchObject({ available: true, capability: "handler:decisionHandler" });
    expect(capabilities[1]).toMatchObject({ available: false, detail: "NotWired" });
  });

  it("the JSONL file sink writes canonical lines and digest-verifies on read", () => {
    const dir = mkdtempSync(join(tmpdir(), "reckon-observability-"));
    try {
      const path = join(dir, "records.jsonl");
      const sink = new JsonlFileObservabilitySink(path);
      const recorder = new ObservabilityRecorder({ sink, clock: () => 9_000, idGenerator: makeIdFactory() });
      recorder.recordDecision({ request: makeRequest(), result: makeResult(), latencyMs: 5 });
      recorder.recordOutcome({ event: makeEvent() });

      const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.length > 0);
      expect(lines).toHaveLength(2);

      const read = sink.readAll();
      expect(read).toHaveLength(2);
      expect(read[0]).toMatchObject({ kind: "decision", latencyMs: 5 });
      expect(read[1]).toMatchObject({ kind: "outcome-linkage", eventId: "ev-1" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a tampered JSONL record fails read-back with a typed error", () => {
    const dir = mkdtempSync(join(tmpdir(), "reckon-observability-"));
    try {
      const path = join(dir, "records.jsonl");
      const sink = new JsonlFileObservabilitySink(path);
      const recorder = new ObservabilityRecorder({ sink, clock: () => 9_000, idGenerator: makeIdFactory() });
      recorder.recordDecision({ request: makeRequest(), result: makeResult(), latencyMs: 5 });

      // Tamper after the fact (rewrite latency through a raw line edit).
      const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.length > 0);
      const record = JSON.parse(lines[0]!) as { latencyMs: number };
      record.latencyMs = 999;
      writeFileSync(path, `${JSON.stringify(record)}\n`, "utf8");

      expect(() => sink.readAll()).toThrow(ObservabilityRecordCorruptError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
