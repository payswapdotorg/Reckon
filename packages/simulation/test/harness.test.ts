/**
 * SIM-001 — the common simulation harness acceptance tests.
 *
 * Proves:
 * 1. DETERMINISM: same seed ⇒ byte-identical IntegrationEffortRecords
 *    (canonical-JSON digest equality); different seed ⇒ different record.
 * 2. The driver lifecycle: register manifest → connect sources →
 *    decision loop → outcomes → effort record, through the REAL public
 *    SDK surface (createFixtureReckonPort) — every call crosses the SDK's
 *    frozen-contract validation twice.
 * 3. Measurement fields: API ops + SDK methods, timing to first decision
 *    and full loop, p50/p95 latency, failure/retry behavior, capability
 *    coverage, evidence class, replay inputs.
 * 4. The REPLAY GATE: replaySimulationRun reproduces byte-identical
 *    records from (seed + manifest checksum + host adapter id + config),
 *    and a manifest mismatch is a typed error.
 * 5. Scorecard aggregation + the 3-domain platform-upgrade law.
 * 6. Retry classification: deterministic SDK failures are terminal
 *    (never retried); injected transport faults are retried.
 */
import { describe, it, expect } from "vitest";
import {
  runSimulation,
  replaySimulationRun,
  createFixtureReckonPort,
  createRecordingPort,
  createSimClock,
  createRng,
  scriptedDecisionFor,
  aggregateIntegrationEffortScorecard,
  HARNESS_VERSION,
  SimulationReplayMismatchError,
  PortCallFailedError,
  drawSuccessLatencyMs,
  drawFailureLatencyMs,
  retryBackoffMs,
  percentileNearestRank,
  type SimulationHostAdapter,
  type SimulationRunResult,
  type SimulationManifestContentInput,
  type HostDecisionInputs,
  type TenantScope,
  type SubjectReference,
  type ReckonPublicPort,
} from "../src/index.js";
import {
  DecisionRequestSchema,
  canonicalJson,
  contentDigest,
  finalizeReckonCompleteProfile,
  ReckonCompleteEnvelopeSchema,
  type DecisionRequest,
  type ReckonCompleteCapability,
  type ReckonCompleteProfileDeclaration,
} from "@reckon/contracts";
import { ReckonValidationError } from "@reckon/sdk";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const LEVEL_1_PROFILE: ReckonCompleteProfileDeclaration = finalizeReckonCompleteProfile({
  profileId: "profile-level-1",
  name: "Static catalog picker",
  ladderLevel: 1,
  requiredCapabilities: [
    { capability: "tenant-identity" },
    { capability: "catalog-registration" },
    { capability: "candidate-retrieval" },
    { capability: "objective-declaration" },
    { capability: "attention-policy" },
    { capability: "decision-request" },
    { capability: "outcome-return" },
    { capability: "preference-feedback" },
    { capability: "conformance-verification" },
  ],
  requiredEvidenceClass: "fixture",
  declaredAt: 1_000,
});

const TENANT: TenantScope = { tenantId: "tenant-a" };
const SUBJECT: SubjectReference = { kind: "user", ref: "user-7" };

/** A minimal-but-complete synthetic host (static catalog picker). */
function createTestHost(overrides?: {
  hostAdapterId?: string;
  dropCapability?: string;
}): SimulationHostAdapter {
  const supported = ([
    { capability: "tenant-identity", status: "supported", evidenceClass: "fixture" },
    {
      capability: "catalog-registration",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/catalog/items"],
      sdkMethods: ["catalog.upsertItem"],
    },
    {
      capability: "candidate-retrieval",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/candidates"],
      sdkMethods: ["candidates.submit"],
    },
    { capability: "objective-declaration", status: "supported", evidenceClass: "fixture" },
    { capability: "attention-policy", status: "supported", evidenceClass: "fixture" },
    {
      capability: "decision-request",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
    },
    {
      capability: "outcome-return",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/outcomes"],
      sdkMethods: ["outcomes.append"],
    },
    {
      capability: "preference-feedback",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/preferences/events"],
      sdkMethods: ["preferences.appendDelta"],
    },
    { capability: "conformance-verification", status: "supported", evidenceClass: "fixture" },
  ] as SimulationManifestContentInput["supportedCapabilities"]).filter((c) => c.capability !== overrides?.dropCapability);

  return {
    hostAdapterId: overrides?.hostAdapterId ?? "adapter-test-static-1",
    hostSystem: { hostId: "host-test-1", name: "Test Static Picker", version: "0.1.0" },
    glue: { functions: 6, loc: 140, customAdapterLoc: 45 },
    manifestContent: {
      manifestVersion: "1",
      hostSystem: { hostId: "host-test-1", name: "Test Static Picker", hostAdapterId: "adapter-test-static-1", version: "0.1.0" },
      declaredAt: 1_100,
      supportedCapabilities: supported,
    },
    catalog: {
      items: [
        { itemId: "item-1", kind: "article", labels: ["news"], attributes: { title: "A" } },
        { itemId: "item-2", kind: "article", labels: ["news"], attributes: { title: "B" } },
      ],
      realizations: [
        { realizationId: "real-1", itemId: "item-1", kind: "web" },
        { realizationId: "real-2", itemId: "item-2", kind: "web" },
      ],
    },
    provideDecisionInputs(step: number) {
      return {
        contextId: `ctx-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        objective: { objectiveId: "obj-1", version: "1", kind: "stay-informed", params: {} },
        attentionPolicy: { policyId: "ap-1", version: "1", style: "balanced", params: {} },
        candidates: {
          setId: `cs-${step}`,
          candidates: [
            { itemId: "item-1", realizationIds: ["real-1"], source: "host-retrieval", rankHint: 1 },
            { itemId: "item-2", realizationIds: ["real-2"], source: "host-retrieval", rankHint: 2 },
          ],
        },
        policySelector: { policyId: "greedy-v1" },
      };
    },
    consumeDecision() {
      return { presented: true };
    },
    provideOutcome(step: number, result, _reaction, nowMs: number) {
      return {
        eventId: `ev-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        decisionId: result.decisionId,
        experienceId: result.selectedExperience?.experienceId,
        eventType: "completion",
        occurredAt: nowMs,
        evidenceClass: "fixture",
        metrics: { dwellSeconds: 42 },
        idempotencyKey: `idem-out-${step}`,
      };
    },
    providePreferenceDelta(step: number, _result, nowMs: number) {
      return {
        deltaId: `delta-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        dimension: "topic.news",
        op: "add",
        newValue: 1,
        resultingConfidence: 0.6,
        model: { modelId: "fixture-model", version: "1" },
        timestamp: nowMs,
      };
    },
  };
}

const digestOf = (value: unknown): string => contentDigest(value);
const recordDigest = (run: SimulationRunResult): string => digestOf(run.record);

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("harness determinism", () => {
  it("same seed ⇒ byte-identical records (canonical JSON digest equality)", async () => {
    const runA = await runSimulation(
      { seed: "42", port: createFixtureReckonPort().port },
      { host: createTestHost(), profile: LEVEL_1_PROFILE, steps: 5 },
    );
    const runB = await runSimulation(
      { seed: "42", port: createFixtureReckonPort().port },
      { host: createTestHost(), profile: LEVEL_1_PROFILE, steps: 5 },
    );
    expect(recordDigest(runA)).toBe(recordDigest(runB));
    expect(canonicalJson(runA.record)).toBe(canonicalJson(runB.record));
    expect(canonicalJson(runA.verdict)).toBe(canonicalJson(runB.verdict));
    expect(canonicalJson(runA.calls)).toBe(canonicalJson(runB.calls));
  });

  it("a different seed ⇒ a different record (latency draws differ)", async () => {
    const runA = await runSimulation(
      { seed: "42", port: createFixtureReckonPort().port },
      { host: createTestHost(), profile: LEVEL_1_PROFILE, steps: 5 },
    );
    const runB = await runSimulation(
      { seed: "42424242424242424242", port: createFixtureReckonPort().port },
      { host: createTestHost(), profile: LEVEL_1_PROFILE, steps: 5 },
    );
    expect(recordDigest(runA)).not.toBe(recordDigest(runB));
    expect(runA.record.latency.samples).toBe(runB.record.latency.samples);
  });

  it("deterministic across a real-time gap (no wall-clock influence)", async () => {
    const runA = await runSimulation(
      { seed: "7", port: createFixtureReckonPort().port },
      { host: createTestHost(), profile: LEVEL_1_PROFILE, steps: 3 },
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    const runB = await runSimulation(
      { seed: "7", port: createFixtureReckonPort().port },
      { host: createTestHost(), profile: LEVEL_1_PROFILE, steps: 3 },
    );
    expect(recordDigest(runA)).toBe(recordDigest(runB));
  });

  it("repeated runs through the same harness handle are identical", async () => {
    const { createSimulationHarness } = await import("../src/index.js");
    const harness = createSimulationHarness({ seed: "99", port: createFixtureReckonPort().port });
    const runA = await harness.run({ host: createTestHost(), profile: LEVEL_1_PROFILE, steps: 2 });
    const runB = await harness.run({ host: createTestHost(), profile: LEVEL_1_PROFILE, steps: 2 });
    expect(recordDigest(runA)).toBe(recordDigest(runB));
  });
});

// ---------------------------------------------------------------------------
// Driver lifecycle + measurement fields
// ---------------------------------------------------------------------------

describe("driver lifecycle and measurement", () => {
  it("register → connect → loop → record, through the REAL public SDK surface", async () => {
    const run = await runSimulation(
      { seed: "42", port: createFixtureReckonPort().port },
      { host: createTestHost(), profile: LEVEL_1_PROFILE, steps: 5 },
    );

    // The record parses as a member of the frozen family union.
    expect(() => ReckonCompleteEnvelopeSchema.parse(run.record)).not.toThrow();

    // Every API operation the loop needs, and nothing else.
    expect(run.record.apiOperations).toEqual([
      "POST /v1/candidates",
      "POST /v1/catalog/items",
      "POST /v1/catalog/realizations",
      "POST /v1/decisions",
      "POST /v1/outcomes",
      "POST /v1/preferences/events",
    ]);
    expect(run.record.sdkMethods).toEqual([
      "candidates.submit",
      "catalog.upsertItem",
      "catalog.upsertRealization",
      "decisions.request",
      "outcomes.append",
      "preferences.appendDelta",
    ]);

    // 2 items + 2 realizations + 5 × (submit + decision + outcome + delta).
    expect(run.record.latency.samples).toBe(4 + 5 * 4);

    // Timing: first decision at step 1; full loop completed.
    expect(run.record.timing.firstDecisionSteps).toBe(1);
    expect(run.record.timing.firstDecisionMs).toBeGreaterThan(0);
    expect(run.record.timing.fullLoopSteps).toBeGreaterThanOrEqual(1);
    expect(run.record.timing.fullLoopMs).toBeGreaterThanOrEqual(run.record.timing.firstDecisionMs);

    // Glue + zero internal imports + evidence honesty.
    expect(run.record.glue).toEqual({ functions: 6, loc: 140, customAdapterLoc: 45 });
    expect(run.record.internalImports).toBe(0);
    expect(run.record.evidenceClass).toBe("fixture");
    expect(run.record.harnessVersion).toBe(HARNESS_VERSION);

    // Replay inputs carry the full deterministic run identity.
    expect(run.record.replayInputs.seed).toBe("42");
    expect(run.record.replayInputs.hostAdapterId).toBe("adapter-test-static-1");
    expect(run.record.replayInputs.manifestChecksum).toBe(run.manifest.checksum);
    expect(run.record.replayInputs.steps).toBe(5);

    // The manifest is sealed with its checksum.
    expect(run.manifest.checksum).toMatch(/^[0-9a-f]{64}$/);

    // Run-level completion.
    expect(run.reckonComplete).toBe(true);
    expect(run.verdict.reckonComplete).toBe(true);
  });

  it("records capability coverage: declared vs supported", async () => {
    const run = await runSimulation(
      { seed: "42", port: createFixtureReckonPort().port },
      { host: createTestHost({ dropCapability: "preference-feedback" }), profile: LEVEL_1_PROFILE, steps: 2 },
    );
    expect(run.verdict.reckonComplete).toBe(false);
    expect(run.record.capabilityCoverage.required).toBe(9);
    expect(run.record.capabilityCoverage.satisfied).toBe(8);
    expect(run.record.capabilityCoverage.missing).toBe(1);
    expect(run.record.capabilityCoverage.coverageRatio).toBeCloseTo(8 / 9, 10);
    expect(run.record.gaps).toEqual([
      expect.objectContaining({ capability: "preference-feedback", friction: "CAPABILITY_GAP" }),
    ]);
  });

  it("p50/p95 equal the nearest-rank percentiles of successful call latencies", async () => {
    const run = await runSimulation(
      { seed: "42", port: createFixtureReckonPort().port, faultRate: 0.2, maxRetries: 2 },
      { host: createTestHost(), profile: LEVEL_1_PROFILE, steps: 8 },
    );
    const ok = run.calls.filter((c) => c.status === "ok").map((c) => c.latencyMs);
    expect(ok.length).toBe(run.record.latency.samples);
    expect(run.record.latency.p50Ms).toBe(percentileNearestRank(ok, 50));
    expect(run.record.latency.p95Ms).toBe(percentileNearestRank(ok, 95));
  });

  it("steps validation rejects zero/negative/non-integer steps", async () => {
    await expect(
      runSimulation(
        { seed: "1", port: createFixtureReckonPort().port },
        { host: createTestHost(), profile: LEVEL_1_PROFILE, steps: 0 },
      ),
    ).rejects.toThrow(/steps must be a positive integer/);
  });
});

// ---------------------------------------------------------------------------
// Failure / retry behavior
// ---------------------------------------------------------------------------

describe("failure and retry behavior", () => {
  it("total fault storm: every call fails, the run completes honestly", async () => {
    const run = await runSimulation(
      { seed: "42", port: createFixtureReckonPort().port, faultRate: 1, maxRetries: 1 },
      { host: createTestHost(), profile: LEVEL_1_PROFILE, steps: 3 },
    );
    // 4 connect + 3 × (submit + decision + outcome + delta) = 16 calls, all failed.
    expect(run.calls).toHaveLength(16);
    expect(run.calls.every((c) => c.status === "error")).toBe(true);
    expect(run.record.failures.exhaustedCount).toBe(16);
    expect(run.record.failures.count).toBe(16);
    expect(run.record.failures.retriedCount).toBe(0);
    expect(run.record.failures.retryCount).toBe(16); // each call: 1 failed retry + 1 failed final attempt
    expect(run.record.latency.samples).toBe(0);
    expect(run.record.latency.p50Ms).toBe(0);
    expect(run.record.latency.p95Ms).toBe(0);
    expect(run.record.timing.firstDecisionSteps).toBe(0);
    expect(run.record.timing.fullLoopSteps).toBe(0);
    expect(run.reckonComplete).toBe(false); // verdict true but the loop never ran
  });

  it("partial faults: retries recover, failures recorded honestly", async () => {
    const run = await runSimulation(
      { seed: "42", port: createFixtureReckonPort().port, faultRate: 0.3, maxRetries: 3 },
      { host: createTestHost(), profile: LEVEL_1_PROFILE, steps: 10 },
    );
    expect(run.record.failures.count).toBeGreaterThan(0);
    expect(run.record.failures.retryCount).toBeGreaterThanOrEqual(run.record.failures.count);
    // With 3 retries at 30% fault rate, exhaustion is very unlikely but the
    // run must remain complete and honest whatever the draws were.
    expect(run.record.timing.firstDecisionSteps).toBeGreaterThan(0);
    expect(run.calls.length).toBeGreaterThan(run.record.latency.samples);
  });

  it("deterministic SDK failures are terminal (never retried)", async () => {
    const failingPort: ReckonPublicPort = {
      decisions: {
        request: () => {
          throw new ReckonValidationError(
            "SDK_REQUEST_INVALID",
            "request failed validation before it was sent",
            { issues: [] },
          );
        },
      },
      outcomes: { append: () => Promise.reject(new Error("unused")) },
      preferences: { appendDelta: () => Promise.reject(new Error("unused")) },
      catalog: {
        upsertItem: () => Promise.reject(new Error("unused")),
        upsertRealization: () => Promise.reject(new Error("unused")),
      },
      candidates: { submit: () => Promise.reject(new Error("unused")) },
    };
    // Use a raw recording port to assert the retry classification.
    const clock = createSimClock({ startMs: 0, stepMs: 1000 });
    const rng = createRng("5");
    const recording = createRecordingPort({
      inner: failingPort,
      clock,
      rng,
      faultRate: 0,
      maxRetries: 5,
    });
    await expect(recording.decisions.request({} as never)).rejects.toBeInstanceOf(
      PortCallFailedError,
    );
    expect(recording.calls).toHaveLength(1);
    expect(recording.calls[0]!.attempts).toBe(1); // NOT retried despite maxRetries=5
    expect(recording.calls[0]!.errorCode).toBe("SDK_REQUEST_INVALID");
    expect(recording.calls[0]!.status).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// The scripted responder
// ---------------------------------------------------------------------------

describe("scripted responder", () => {
  const request: DecisionRequest = DecisionRequestSchema.parse({
    requestId: "req-1",
    tenant: TENANT,
    subject: SUBJECT,
    objective: { objectiveId: "obj-1", kind: "stay-informed" },
    attentionPolicy: { policyId: "ap-1", style: "balanced" },
    context: { contextId: "ctx-1" },
    candidates: {
      setId: "cs-1",
      candidates: [
        { itemId: "item-1", source: "host-retrieval" },
        { itemId: "item-2", source: "host-retrieval" },
      ],
    },
    policySelector: { policyId: "greedy-v1" },
    at: 1_000,
    idempotencyKey: "idem-1",
  });

  it("is deterministic: the same request yields the same decision", () => {
    expect(canonicalJson(scriptedDecisionFor(request))).toBe(
      canonicalJson(scriptedDecisionFor(DecisionRequestSchema.parse(JSON.parse(canonicalJson(request))))),
    );
  });

  it("selects the first candidate and ranks alternatives deterministically", () => {
    const decision = scriptedDecisionFor(request);
    expect(decision.action).toBe("QUEUE");
    expect((decision.selectedExperience as any).itemId).toBe("item-1");
    expect(decision.alternatives).toHaveLength(1);
    expect((decision.alternatives[0] as any).itemId === undefined).toBe(true); // summary carries ids only
    expect(decision.scheduleDelta!.enqueue).toHaveLength(1);
    expect(decision.provenance!.system).toBe("@reckon/simulation-fixture-responder");
  });
});

// ---------------------------------------------------------------------------
// The replay gate
// ---------------------------------------------------------------------------

describe("replay gates", () => {
  it("replays byte-identically from the recorded replay inputs", async () => {
    const original = await runSimulation(
      { seed: "42", port: createFixtureReckonPort().port, faultRate: 0.2, maxRetries: 2 },
      { host: createTestHost(), profile: LEVEL_1_PROFILE, steps: 6 },
    );
    const replayed = await replaySimulationRun(original.record.replayInputs, {
      host: createTestHost(),
      profile: LEVEL_1_PROFILE,
      port: createFixtureReckonPort().port,
    });
    expect(canonicalJson(replayed.record)).toBe(canonicalJson(original.record));
    expect(canonicalJson(replayed.calls)).toBe(canonicalJson(original.calls));
  });

  it("rejects a replay whose regenerated manifest checksum mismatches", async () => {
    const original = await runSimulation(
      { seed: "42", port: createFixtureReckonPort().port },
      { host: createTestHost(), profile: LEVEL_1_PROFILE, steps: 2 },
    );
    // Same adapter id, but a DIFFERENT manifest (dropped capability).
    const tamperedInputs = {
      ...original.record.replayInputs,
      manifestChecksum: contentDigest({ tampered: true }),
    };
    await expect(
      replaySimulationRun(tamperedInputs, {
        host: createTestHost(),
        profile: LEVEL_1_PROFILE,
        port: createFixtureReckonPort().port,
      }),
    ).rejects.toBeInstanceOf(SimulationReplayMismatchError);
  });

  it("rejects a replay across harness versions", async () => {
    const original = await runSimulation(
      { seed: "42", port: createFixtureReckonPort().port },
      { host: createTestHost(), profile: LEVEL_1_PROFILE, steps: 1 },
    );
    await expect(
      replaySimulationRun(
        { ...original.record.replayInputs, harnessVersion: "0.0.0" },
        { host: createTestHost(), profile: LEVEL_1_PROFILE, port: createFixtureReckonPort().port },
      ),
    ).rejects.toThrow(/harness version mismatch/);
  });
});

// ---------------------------------------------------------------------------
// Scorecard aggregation
// ---------------------------------------------------------------------------

describe("scorecard aggregation", () => {
  async function runWithLevel(
    seed: string,
    ladderLevel: number | undefined,
    dropCapability?: string,
  ): Promise<SimulationRunResult> {
    const profile =
      ladderLevel === undefined
        ? LEVEL_1_PROFILE
        : finalizeReckonCompleteProfile({
            ...LEVEL_1_PROFILE,
            profileId: `profile-level-${ladderLevel}`,
            ladderLevel,
            // A dropped capability is required by THIS profile so the drop
            // manifests as the measured CAPABILITY_GAP (the test's intent).
            ...(dropCapability !== undefined
              ? {
                  requiredCapabilities: [
                    ...LEVEL_1_PROFILE.requiredCapabilities,
                    { capability: dropCapability as ReckonCompleteCapability },
                  ],
                }
              : {}),
          });
    return runSimulation(
      { seed, port: createFixtureReckonPort().port },
      { host: createTestHost({ dropCapability }), profile, steps: 3 },
    );
  }

  it("aggregates runs and flags the 3-domain platform-upgrade candidates", async () => {
    // The same gap (missing webhook-delivery) across THREE ladder levels.
    const runs = await Promise.all([
      runWithLevel("1", 1, "webhook-delivery"),
      runWithLevel("2", 5, "webhook-delivery"),
      runWithLevel("3", 9, "webhook-delivery"),
      runWithLevel("4", 2), // complete run, level 2
    ]);
    const scorecard = aggregateIntegrationEffortScorecard(
      runs.map((r) => r.record),
      { scorecardId: "scorecard-test-1", generatedAt: 50_000 },
    );

    expect(scorecard.aggregate.runCount).toBe(4);
    expect(scorecard.aggregate.distinctHosts).toBe(1);
    expect(scorecard.aggregate.distinctLevels).toBe(4);
    expect(scorecard.records).toHaveLength(4);
    expect(scorecard.records[0]!.recordChecksum).toBe(runs[0]!.record.checksum);

    const recurring = scorecard.recurringGaps.find(
      (g) => g.capability === "webhook-delivery" && g.friction === "CAPABILITY_GAP",
    );
    expect(recurring).toBeDefined();
    expect(recurring!.ladderLevels).toEqual([1, 5, 9]);
    expect(recurring!.domainCount).toBe(3);
    expect(recurring!.platformUpgradeCandidate).toBe(true); // the 3-domain law
    expect(recurring!.runCount).toBe(3);

    // A gap in only two domains is NOT yet a platform-upgrade candidate.
    expect(
      scorecard.recurringGaps.every((g) => g.platformUpgradeCandidate === (g.domainCount >= 3)),
    ).toBe(true);
  });

  it("medians are the nearest-rank p50 over the contributing records", async () => {
    const runs = await Promise.all([
      runWithLevel("11", 1),
      runWithLevel("12", 2),
      runWithLevel("13", 3),
    ]);
    const scorecard = aggregateIntegrationEffortScorecard(
      runs.map((r) => r.record),
      { scorecardId: "scorecard-test-2", generatedAt: 60_000 },
    );
    const glueLocs = runs.map((r) => r.record.glue.loc);
    const fullLoops = runs.map((r) => r.record.timing.fullLoopMs);
    expect(scorecard.aggregate.medianGlueLoc).toBe(percentileNearestRank(glueLocs, 50));
    expect(scorecard.aggregate.medianFullLoopMs).toBe(percentileNearestRank(fullLoops, 50));
    expect(scorecard.aggregate.meanCapabilityCoverageRatio).toBe(1);
    expect(scorecard.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects an empty record set", () => {
    expect(() =>
      aggregateIntegrationEffortScorecard([], { scorecardId: "x", generatedAt: 0 }),
    ).toThrow(/at least one record/);
  });
});

// ---------------------------------------------------------------------------
// Latency/backoff primitives
// ---------------------------------------------------------------------------

describe("latency and backoff primitives", () => {
  it("latency draws are within their documented ranges", () => {
    const rng = createRng("123");
    for (let i = 0; i < 100; i += 1) {
      const ok = drawSuccessLatencyMs(rng);
      const bad = drawFailureLatencyMs(rng);
      expect(ok).toBeGreaterThanOrEqual(5);
      expect(ok).toBeLessThanOrEqual(49);
      expect(bad).toBeGreaterThanOrEqual(3);
      expect(bad).toBeLessThanOrEqual(9);
    }
  });

  it("backoff follows the fixed 10·2^n formula", () => {
    expect(retryBackoffMs(0)).toBe(10);
    expect(retryBackoffMs(1)).toBe(20);
    expect(retryBackoffMs(2)).toBe(40);
  });

  it("the clock is monotonic and rejects non-positive steps", () => {
    const clock = createSimClock({ startMs: 100, stepMs: 50 });
    expect(clock.now()).toBe(100);
    expect(clock.advance(25)).toBe(125);
    expect(() => clock.advance(0)).toThrow(/positive finite/);
    expect(() => clock.advance(-5)).toThrow(/positive finite/);
    expect(() => createSimClock({ startMs: -1 })).toThrow();
    expect(() => createSimClock({ stepMs: 0 })).toThrow();
  });
});
