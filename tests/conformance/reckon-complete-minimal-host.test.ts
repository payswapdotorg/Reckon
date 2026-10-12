/**
 * SIM-001 — the Reckon-Complete conformance proof for a minimal host.
 *
 * Proves, end to end through the REAL public SDK surface (the fixture
 * responder validates against the frozen zod contracts on both sides of
 * every operation — the SDK does this itself before/after each call):
 *
 * 1. The minimal host (tests/conformance/fixtures/minimal-static-picker-
 *    host.ts) goes Reckon-Complete against the declared Level 1 profile:
 *    full capability coverage, zero internal imports, complete decision
 *    loop, valid IntegrationEffortRecord + ConformanceVerdict envelopes.
 * 2. The ladder's target onboarding flow is exactly what the host did:
 *    manifest → connect sources → declare objectives → decisions →
 *    outcomes → evidence → conformance.
 * 3. Evidence honesty: a profile requiring production-observed evidence
 *    is NOT satisfied by this fixture-class run — fixture evidence never
 *    masquerades as observed.
 * 4. The replay gate: the recorded replay inputs reproduce the identical
 *    record.
 */
import { describe, it, expect } from "vitest";
import {
  runSimulation,
  replaySimulationRun,
  createFixtureReckonPort,
  aggregateIntegrationEffortScorecard,
} from "../../packages/simulation/src/index.js";
import {
  finalizeReckonCompleteProfile,
  ReckonCompleteEnvelopeSchema,
  IntegrationEffortRecordSchema,
  ReckonCompleteConformanceVerdictSchema,
  canonicalJson,
  type ReckonCompleteProfileDeclaration,
} from "../../packages/contracts/src/index.js";
import {
  minimalStaticPickerHost,
  level1ProfileInput,
} from "./fixtures/minimal-static-picker-host.js";

const PROFILE: ReckonCompleteProfileDeclaration = finalizeReckonCompleteProfile({
  ...level1ProfileInput,
  requiredCapabilities: [...level1ProfileInput.requiredCapabilities],
});

const SEED = "9007199254740993"; // a valid uint64 seed

async function runFixture(seed: string = SEED) {
  return runSimulation(
    { seed, port: createFixtureReckonPort().port },
    { host: minimalStaticPickerHost, profile: PROFILE, steps: 4 },
  );
}

describe("minimal host goes Reckon-Complete (Level 1 profile)", () => {
  it("the run completes and the verdict is Reckon-Complete", async () => {
    const run = await runFixture();
    expect(run.verdict.reckonComplete).toBe(true);
    expect(run.reckonComplete).toBe(true);
    expect(run.verdict.coverage.required).toBe(9);
    expect(run.verdict.coverage.satisfied).toBe(9);
    expect(run.verdict.coverage.partial).toBe(0);
    expect(run.verdict.coverage.missing).toBe(0);
    expect(run.verdict.coverage.coverageRatio).toBe(1);
    expect(run.verdict.evidenceClass).toBe("fixture");
    expect(run.verdict.gaps).toHaveLength(0);
  });

  it("the effort record parses as a member of the frozen contract family", async () => {
    const run = await runFixture();
    // Direct schema parse + family-envelope parse (discriminator routing).
    expect(IntegrationEffortRecordSchema.parse(run.record)).toEqual(run.record);
    const envelope = ReckonCompleteEnvelopeSchema.parse(run.record);
    expect(envelope.schema).toBe("reckon.complete.integration-effort-record");
    // The verdict too.
    expect(ReckonCompleteConformanceVerdictSchema.parse(run.verdict)).toEqual(run.verdict);
    const verdictEnvelope = ReckonCompleteEnvelopeSchema.parse(run.verdict);
    expect(verdictEnvelope.schema).toBe("reckon.complete.conformance-verdict");
  });

  it("zero internal Reckon access: internalImports is 0 and the host used only public operations", async () => {
    const run = await runFixture();
    expect(run.record.internalImports).toBe(0);
    // Exactly the public operations of the standard loop — no more.
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
  });

  it("the full decision loop completed with measured timing and latency", async () => {
    const run = await runFixture();
    expect(run.record.timing.firstDecisionSteps).toBe(1);
    expect(run.record.timing.firstDecisionMs).toBeGreaterThan(0);
    expect(run.record.timing.fullLoopSteps).toBeGreaterThanOrEqual(1);
    expect(run.record.timing.fullLoopMs).toBeGreaterThan(0);
    // 3 items + 3 realizations + 4 × (submit + decision + outcome + delta)
    expect(run.record.latency.samples).toBe(6 + 4 * 4);
    expect(run.record.latency.p50Ms).toBeGreaterThan(0);
    expect(run.record.latency.p95Ms).toBeGreaterThanOrEqual(run.record.latency.p50Ms);
    expect(run.record.failures).toEqual({
      count: 0,
      retriedCount: 0,
      retryCount: 0,
      exhaustedCount: 0,
    });
  });

  it("host glue is recorded honestly", async () => {
    const run = await runFixture();
    expect(run.record.glue).toEqual({ functions: 6, loc: 140, customAdapterLoc: 45 });
    expect(run.record.hostSystem.hostAdapterId).toBe("adapter-minimal-static-picker-1");
    expect(run.record.ladderLevel).toBe(1);
  });

  it("fixture evidence never satisfies a production-observed requirement", async () => {
    const strictProfile = finalizeReckonCompleteProfile({
      ...level1ProfileInput,
      profileId: "profile-level-1-strict",
      requiredEvidenceClass: "production-observed",
      requiredCapabilities: [...level1ProfileInput.requiredCapabilities],
    });
    const run = await runSimulation(
      { seed: SEED, port: createFixtureReckonPort().port },
      { host: minimalStaticPickerHost, profile: strictProfile, steps: 2 },
    );
    expect(run.verdict.reckonComplete).toBe(false);
    expect(run.verdict.evidenceSufficient).toBe(false);
    // Every capability is wired but the EVIDENCE class is insufficient —
    // surfaced as OBSERVABILITY_GAP gaps, never a silent pass.
    expect(run.verdict.gaps.filter((g) => g.friction === "OBSERVABILITY_GAP")).toHaveLength(9);
    expect(run.verdict.coverage.satisfied).toBe(0);
    expect(run.verdict.coverage.missing).toBe(0);
  });

  it("the replay gate reproduces the identical record from replay inputs", async () => {
    const original = await runFixture();
    const replayed = await replaySimulationRun(original.record.replayInputs, {
      host: minimalStaticPickerHost,
      profile: PROFILE,
      port: createFixtureReckonPort().port,
    });
    expect(canonicalJson(replayed.record)).toBe(canonicalJson(original.record));
    expect(replayed.reckonComplete).toBe(true);
  });

  it("the run aggregates into a valid scorecard", async () => {
    const runA = await runFixture("100");
    const runB = await runFixture("200");
    const scorecard = aggregateIntegrationEffortScorecard([runA.record, runB.record], {
      scorecardId: "scorecard-conformance-fixture",
      generatedAt: 20_000,
    });
    expect(scorecard.schema).toBe("reckon.complete.integration-effort-scorecard");
    expect(scorecard.aggregate.runCount).toBe(2);
    expect(scorecard.aggregate.distinctHosts).toBe(1);
    expect(scorecard.aggregate.distinctLevels).toBe(1);
    expect(scorecard.aggregate.meanCapabilityCoverageRatio).toBe(1);
    expect(scorecard.recurringGaps).toHaveLength(0);
    expect(scorecard.records.map((r) => r.recordChecksum)).toEqual([
      runA.record.checksum,
      runB.record.checksum,
    ]);
    // Family-envelope parse for the scorecard as well.
    const envelope = ReckonCompleteEnvelopeSchema.parse(scorecard);
    expect(envelope.schema).toBe("reckon.complete.integration-effort-scorecard");
  });

  it("two different seeds yield different measurements for the same host", async () => {
    const runA = await runFixture("300");
    const runB = await runFixture("400");
    expect(canonicalJson(runA.record)).not.toBe(canonicalJson(runB.record));
    // Same host ⇒ same manifest ⇒ same coverage; only seeded measurements differ.
    expect(runA.record.capabilityCoverage).toEqual(runB.record.capabilityCoverage);
    expect(runA.manifest.checksum).toBe(runB.manifest.checksum);
  });
});
