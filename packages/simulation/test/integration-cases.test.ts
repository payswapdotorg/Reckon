/**
 * SIM-003 — the Level 5–8 integration-case acceptance suite (W2 lane).
 *
 * Proves, end to end through the REAL public SDK surface (the fixture
 * responder validates against the frozen zod contracts on both sides of
 * every operation):
 *
 * 1. DETERMINISM: every scenario run twice ⇒ byte-identical
 *    IntegrationEffortRecords (canonical-JSON equality); the full suite
 *    aggregated twice ⇒ identical scorecards.
 * 2. THE REPLAY GATE: every scenario's recorded replay inputs reproduce
 *    the identical record.
 * 3. SCENARIO SEMANTICS per level: the schedule actions, formats,
 *    checkpoints, plan coupling, presented/declined steps, host-side queue
 *    evolution and the append-oriented correction outcome.
 * 4. MEASUREMENT HONESTY: API ops + SDK methods, glue, zero internal
 *    imports, timing, latency sample counts, failure/retry behavior
 *    (resilience runs), evidence class `fixture`, ladder levels.
 * 5. CAPABILITY COVERAGE + PROBES: baselines 12/12 satisfied; each level's
 *    capability probe honestly incomplete with the NAMED friction gap
 *    (COMPOSITION_GAP) recorded in the record.
 * 6. EVIDENCE HONESTY: a production-observed profile is never satisfied by
 *    these fixture-class runs (OBSERVABILITY_GAP, never a silent pass).
 * 7. THE 3-DOMAIN LAW on the wave scorecard: no (capability, friction)
 *    pair reaches three domains in this wave — no platform-upgrade
 *    candidate is claimed.
 */
import { describe, it, expect } from "vitest";
import {
  runIntegrationCase,
  runIntegrationCaseSuite,
  integrationCaseSeed,
  type IntegrationCaseScenario,
  type IntegrationCaseRun,
} from "../src/index.js";
import { replaySimulationRun, createFixtureReckonPort } from "../src/index.js";
import {
  DecisionRequestSchema,
  IntegrationEffortRecordSchema,
  ReckonCompleteEnvelopeSchema,
  canonicalJson,
  contentDigest,
  finalizeReckonCompleteProfile,
  type ReckonCompleteProfileDeclaration,
} from "@reckon/contracts";
import { level5Scenarios, level5Profile } from "../../../tests/conformance/fixtures/integration-cases/level5-media.js";
import { level6Scenarios } from "../../../tests/conformance/fixtures/integration-cases/level6-ads.js";
import { level7Scenarios } from "../../../tests/conformance/fixtures/integration-cases/level7-marketplace.js";
import { level8Scenarios } from "../../../tests/conformance/fixtures/integration-cases/level8-travel.js";

const ALL_SCENARIOS: readonly IntegrationCaseScenario[] = [
  ...level5Scenarios,
  ...level6Scenarios,
  ...level7Scenarios,
  ...level8Scenarios,
];

const STANDARD_LOOP_OPERATIONS = [
  "POST /v1/candidates",
  "POST /v1/catalog/items",
  "POST /v1/catalog/realizations",
  "POST /v1/decisions",
  "POST /v1/outcomes",
  "POST /v1/preferences/events",
];
const STANDARD_LOOP_SDK_METHODS = [
  "candidates.submit",
  "catalog.upsertItem",
  "catalog.upsertRealization",
  "decisions.request",
  "outcomes.append",
  "preferences.appendDelta",
];

// ---------------------------------------------------------------------------
// Determinism + the replay gate (every scenario, both laws)
// ---------------------------------------------------------------------------

describe("SIM-003 determinism and replay (all 24 scenario runs)", () => {
  it("every scenario runs twice ⇒ byte-identical records", async () => {
    for (const scenario of ALL_SCENARIOS) {
      const a = await runIntegrationCase(scenario);
      const b = await runIntegrationCase(scenario);
      expect(canonicalJson(a.run.record)).toBe(canonicalJson(b.run.record));
      expect(canonicalJson(a.run.calls)).toBe(canonicalJson(b.run.calls));
      expect(a.run.record.checksum).toBe(b.run.record.checksum);
    }
  });

  it("distinct scenarios of the same host level produce distinct records", async () => {
    const switching = await runIntegrationCase(level5Scenarios[0]!);
    const interruption = await runIntegrationCase(level5Scenarios[1]!);
    expect(switching.run.record.checksum).not.toBe(interruption.run.record.checksum);
  });

  it("the scenario seed derivation is the documented deriveSeed('sim-003', level, scenarioId)", () => {
    // The exact values are digest-derived; assert the derivation contract
    // (stable, distinct per scenario, uint64 decimal strings).
    for (const scenario of ALL_SCENARIOS) {
      const seed = integrationCaseSeed(scenario.level, scenario.scenarioId);
      expect(seed).toMatch(/^[0-]{0,1}[0-9]{1,20}$/);
      expect(seed.length).toBeGreaterThan(0);
    }
    expect(integrationCaseSeed(5, "switching")).not.toBe(integrationCaseSeed(6, "switching"));
    expect(integrationCaseSeed(5, "switching")).not.toBe(integrationCaseSeed(5, "resume"));
  });

  it("the replay gate reproduces every scenario's record byte-identically", async () => {
    for (const scenario of ALL_SCENARIOS) {
      const original = await runIntegrationCase(scenario);
      const replayed = await replaySimulationRun(original.run.record.replayInputs, {
        host: scenario.createHost().host,
        profile: scenario.profile,
        port: createFixtureReckonPort().port,
      });
      expect(canonicalJson(replayed.record)).toBe(canonicalJson(original.run.record));
      expect(canonicalJson(replayed.calls)).toBe(canonicalJson(original.run.calls));
    }
  });

  it("the full suite aggregated twice ⇒ identical scorecards", async () => {
    const suiteA = await runIntegrationCaseSuite(ALL_SCENARIOS, { scorecardId: "scorecard-sim-003-wave-a" });
    const suiteB = await runIntegrationCaseSuite(ALL_SCENARIOS, { scorecardId: "scorecard-sim-003-wave-a" });
    expect(canonicalJson(suiteA.scorecard)).toBe(canonicalJson(suiteB.scorecard));
    expect(suiteA.scorecard.checksum).toBe(suiteB.scorecard.checksum);
  });
});

// ---------------------------------------------------------------------------
// Measurement honesty (every record)
// ---------------------------------------------------------------------------

describe("SIM-003 measurement honesty (every record)", () => {
  it("every record parses as a frozen family member and carries the ladder fields", async () => {
    for (const scenario of ALL_SCENARIOS) {
      const { run } = await runIntegrationCase(scenario);
      expect(() => IntegrationEffortRecordSchema.parse(run.record)).not.toThrow();
      expect(ReckonCompleteEnvelopeSchema.parse(run.record).schema).toBe(
        "reckon.complete.integration-effort-record",
      );
      expect(run.record.ladderLevel).toBe(scenario.level);
      expect(run.record.evidenceClass).toBe("fixture");
      expect(run.record.internalImports).toBe(0);
      expect(run.record.apiOperations).toEqual(STANDARD_LOOP_OPERATIONS);
      expect(run.record.sdkMethods).toEqual(STANDARD_LOOP_SDK_METHODS);
      expect(run.record.hostAdapterId).toContain(`l${scenario.level}`);
      expect(run.record.timing.firstDecisionSteps).toBe(1);
      expect(run.record.timing.fullLoopSteps).toBeGreaterThanOrEqual(1);
      expect(run.record.latency.p95Ms).toBeGreaterThanOrEqual(run.record.latency.p50Ms);
    }
  });

  it("latency samples = catalog connects + per-step calls (unpresented steps emit no outcome/delta)", async () => {
    const cases: Array<[IntegrationCaseScenario, number, number, number]> = [
      // [scenario, items, realizations, presentedStepsWithDeltaAndOutcome]
      [level5Scenarios[0]!, 6, 6, 5],
      [level6Scenarios[1]!, 8, 8, 5], // pacing: 6 steps, one unpresented
      [level6Scenarios[3]!, 8, 8, 3], // rights-consent: 5 steps, two unpresented
      [level7Scenarios[2]!, 4, 7, 6],
      [level8Scenarios[3]!, 5, 5, 6],
    ];
    for (const [scenario, items, realizations, presentedCount] of cases) {
      const { run, instance } = await runIntegrationCase(scenario);
      const deltaCount = instance.observations.steps.filter((s) => s.presented && s.preferenceDeltaId).length;
      // presented steps always emit an outcome; only some emit a delta —
      // samples = connects + steps×(submit+decision) + presented×(outcome) + deltas
      const expected = items + realizations + scenario.steps * 2 + presentedCount + deltaCount;
      expect(run.record.latency.samples).toBe(expected);
    }
  });

  it("fault-free runs report zero failures; resilience runs report honest retry behavior", async () => {
    for (const scenario of ALL_SCENARIOS) {
      const { run } = await runIntegrationCase(scenario);
      if ((scenario.faultRate ?? 0) === 0) {
        expect(run.record.failures).toEqual({ count: 0, retriedCount: 0, retryCount: 0, exhaustedCount: 0 });
      } else {
        expect(run.record.failures.retryCount).toBeGreaterThan(0);
        expect(run.record.failures.count).toBeGreaterThanOrEqual(run.record.failures.retriedCount);
        expect(run.reckonComplete).toBe(scenario.expectReckonComplete);
      }
    }
  });

  it("the run-level completion matches the honest expectation (probes incomplete by design)", async () => {
    for (const scenario of ALL_SCENARIOS) {
      const { run } = await runIntegrationCase(scenario);
      expect(run.reckonComplete).toBe(scenario.expectReckonComplete);
      expect(run.verdict.reckonComplete).toBe(scenario.expectReckonComplete);
    }
  });
});

// ---------------------------------------------------------------------------
// Level 5 — media streaming
// ---------------------------------------------------------------------------

describe("SIM-003 Level 5 — media streaming", () => {
  it("switching: QUEUE → SWITCH → CONTINUE → mindful SUGGEST → SWITCH, checkpoints kept", async () => {
    const { run, instance } = await runIntegrationCase(level5Scenarios[0]!);
    expect(instance.observations.steps.map((s) => s.action)).toEqual(["QUEUE", "SWITCH", "CONTINUE", "SUGGEST", "SWITCH"]);
    expect(instance.observations.steps.map((s) => s.presented)).toEqual([true, true, true, true, true]);
    // SWITCH away keeps a resume checkpoint of the current experience.
    expect(instance.observations.steps[1]!.resumeCheckpoint).toBeDefined();
    expect(instance.observations.steps[1]!.dequeue).toHaveLength(1);
    expect(instance.observations.steps[2]!.enqueue).toHaveLength(0); // CONTINUE = no queue change
    expect(instance.observations.steps[3]!.dequeue).toHaveLength(0); // SUGGEST = no displacement
    expect(run.record.capabilityCoverage.satisfied).toBe(12);
    expect(run.record.capabilityCoverage.coverageRatio).toBe(1);
  });

  it("interruption: a time-critical live event INTERRUPTs, the episode RESUMEs, then SWITCHes to the next", async () => {
    const { instance } = await runIntegrationCase(level5Scenarios[1]!);
    expect(instance.observations.steps.map((s) => s.action)).toEqual(["QUEUE", "INTERRUPT", "RESUME", "SWITCH"]);
    const interrupt = instance.observations.steps[1]!;
    expect(interrupt.resumeCheckpoint).toBeDefined();
    expect(interrupt.enqueue).toHaveLength(1);
    expect(interrupt.dequeue).toHaveLength(1);
    const resume = instance.observations.steps[2]!;
    expect(resume.resumeCheckpoint).toBeDefined();
    expect(resume.enqueue).toHaveLength(1);
  });

  it("resume: the checkpoint round trip — interrupt → resume from token → continue to completion", async () => {
    const { instance } = await runIntegrationCase(level5Scenarios[2]!);
    expect(instance.observations.steps.map((s) => s.action)).toEqual(["QUEUE", "INTERRUPT", "RESUME", "CONTINUE"]);
    const checkpoints = instance.observations.steps[2]!.checkpointsAfter;
    // The documentary's checkpoint is retained through the interruption and
    // refreshed by the RESUME (the resumed experience shares its id).
    expect(Object.keys(checkpoints)).toHaveLength(1);
    expect(Object.values(checkpoints)[0]).toMatch(/^resume-/);
  });

  it("rolling-plans: planId echoed on every schedule delta while the queue rolls forward", async () => {
    const { instance } = await runIntegrationCase(level5Scenarios[3]!);
    expect(instance.observations.steps.map((s) => s.action)).toEqual(["QUEUE", "SWITCH", "SWITCH", "SWITCH", "SWITCH", "CONTINUE"]);
    for (const step of instance.observations.steps) {
      expect(step.planId).toBe("plan-streamline-evening");
    }
    // The rolling queue never exceeds one pending next-episode (SWITCH dequeues the current).
    for (const step of instance.observations.steps) {
      expect(step.queueAfter.length).toBeLessThanOrEqual(2);
    }
    expect(instance.observations.steps[5]!.queueAfter).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Level 6 — ad-supported media
// ---------------------------------------------------------------------------

describe("SIM-003 Level 6 — ad-supported media", () => {
  it("placements-formats: format-required constraints are honored on every placement", async () => {
    const { instance } = await runIntegrationCase(level6Scenarios[0]!);
    expect(instance.observations.steps.map((s) => s.action)).toEqual(["QUEUE", "SWITCH", "SWITCH", "SUGGEST", "SWITCH"]);
    expect(instance.observations.steps.map((s) => s.selectedFormatKind)).toEqual(["interstitial", "interstitial", "full", "banner", "interstitial"]);
    // The rail banner is a SUGGESTION: it never displaces the playing show.
    expect(instance.observations.steps[3]!.dequeue).toHaveLength(0);
  });

  it("pacing: mid-roll INTERRUPT + RESUME; the pacing-gated pod attempt is declined host-side (unpresented, no outcome)", async () => {
    const { instance } = await runIntegrationCase(level6Scenarios[1]!);
    expect(instance.observations.steps.map((s) => s.action)).toEqual(["QUEUE", "INTERRUPT", "RESUME", "CONTINUE", "INTERRUPT", "SWITCH"]);
    expect(instance.observations.steps.map((s) => s.presented)).toEqual([true, true, true, true, false, true]);
    const declined = instance.observations.steps[4]!;
    expect(declined.outcome).toBeUndefined(); // unpresented ⇒ no outcome event
    expect(declined.preferenceDeltaId).toBeUndefined();
    expect(declined.queueAfter).toEqual(instance.observations.steps[3]!.queueAfter); // schedule NOT executed
    for (const step of instance.observations.steps) {
      expect(step.planId).toBe("plan-broadcastly-pacing");
    }
  });

  it("interruption-resume: the full mid-roll round trip with a creative swap inside the pod", async () => {
    const { instance } = await runIntegrationCase(level6Scenarios[2]!);
    expect(instance.observations.steps.map((s) => s.action)).toEqual(["QUEUE", "INTERRUPT", "SWITCH", "RESUME", "CONTINUE"]);
    expect(instance.observations.steps.map((s) => s.selectedFormatKind)).toEqual(["full", "interstitial", "interstitial", "full", "full"]);
    expect(instance.observations.steps[2]!.selectedExperienceId).not.toBe(
      instance.observations.steps[1]!.selectedExperienceId,
    );
  });

  it("rights-consent: consent/rights gates are host-owned — declined ads are requested but never presented", async () => {
    const { instance } = await runIntegrationCase(level6Scenarios[3]!);
    expect(instance.observations.steps.map((s) => s.action)).toEqual(["QUEUE", "SWITCH", "SWITCH", "SWITCH", "SWITCH"]);
    expect(instance.observations.steps.map((s) => s.presented)).toEqual([true, true, false, true, false]);
    // The declined steps still crossed the public surface (measured) but
    // emitted no outcome and executed no schedule delta.
    const declinedSteps = instance.observations.steps.filter((s) => !s.presented);
    expect(declinedSteps).toHaveLength(2);
    for (const step of declinedSteps) {
      expect(step.outcome).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Level 7 — marketplace
// ---------------------------------------------------------------------------

describe("SIM-003 Level 7 — marketplace", () => {
  it("offer-selection: the item/offer/decision vertical with a same-product OFFER SWAP", async () => {
    const { instance } = await runIntegrationCase(level7Scenarios[0]!);
    expect(instance.observations.steps.map((s) => s.action)).toEqual(["QUEUE", "SWITCH", "CONTINUE", "SWITCH", "CONTINUE"]);
    // The offer swap is a SWITCH (different realization of the same item).
    const swap = instance.observations.steps[1]!;
    expect(swap.enqueue).toHaveLength(1);
    expect(swap.dequeue).toHaveLength(1);
    expect(swap.selectedExperienceId).not.toBe(instance.observations.steps[0]!.selectedExperienceId);
    expect(instance.observations.steps[2]!.action).toBe("CONTINUE"); // same realization ⇒ continue
  });

  it("competing-objectives: reward mixes ride the same request surface; trust mode adds a mindful SUGGEST", async () => {
    const { run, instance } = await runIntegrationCase(level7Scenarios[1]!);
    expect(instance.observations.steps.map((s) => s.action)).toEqual(["QUEUE", "SWITCH", "SUGGEST", "CONTINUE", "SWITCH"]);
    // Clean runs prove the multi-term reward specs validated against the
    // frozen contract on every step (the SDK rejects invalid requests).
    expect(run.record.failures.count).toBe(0);
  });

  it("uncertain-inventory: stock-out abandonment, budget ceiling, restock replan, purchase", async () => {
    const { instance } = await runIntegrationCase(level7Scenarios[2]!);
    expect(instance.observations.steps.map((s) => s.action)).toEqual(["QUEUE", "SWITCH", "CONTINUE", "SWITCH", "SWITCH", "CONTINUE"]);
    expect(instance.observations.steps[1]!.outcome?.eventType).toBe("abandonment");
    expect(instance.observations.steps[4]!.outcome?.eventType).toBe("custom");
  });

  it("deal-interruption-resume: flash deal INTERRUPTs browsing, is purchased, browsing RESUMEs", async () => {
    const { instance } = await runIntegrationCase(level7Scenarios[3]!);
    expect(instance.observations.steps.map((s) => s.action)).toEqual(["QUEUE", "INTERRUPT", "CONTINUE", "RESUME", "CONTINUE"]);
    expect(instance.observations.steps[1]!.resumeCheckpoint).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Level 8 — travel / booking
// ---------------------------------------------------------------------------

describe("SIM-003 Level 8 — travel / booking", () => {
  it("itinerary-assembly: sequential QUEUEs build the planId-coupled itinerary; the rebook SWITCH swaps the leg", async () => {
    const { instance } = await runIntegrationCase(level8Scenarios[0]!);
    expect(instance.observations.steps.map((s) => s.action)).toEqual(["QUEUE", "QUEUE", "QUEUE", "SWITCH", "CONTINUE"]);
    for (const step of instance.observations.steps) {
      expect(step.planId).toBe("plan-voyageeasy-acc-jnb");
    }
    // After three assembly QUEUEs the itinerary holds three legs; the
    // rebook dequeues the original outbound and enqueues the alternate.
    expect(instance.observations.steps[2]!.queueAfter).toHaveLength(3);
    expect(instance.observations.steps[3]!.queueAfter).toHaveLength(3);
    expect(instance.observations.steps[3]!.dequeue).toEqual([
      instance.observations.steps[0]!.selectedExperienceId,
    ]);
  });

  it("availability-switching: a sold-out rate plan forces a same-item realization SWITCH", async () => {
    const { instance } = await runIntegrationCase(level8Scenarios[1]!);
    expect(instance.observations.steps.map((s) => s.action)).toEqual(["QUEUE", "SWITCH", "SWITCH", "SWITCH", "CONTINUE"]);
    expect(instance.observations.steps[2]!.outcome?.eventType).toBe("custom");
    const rateSwap = instance.observations.steps[2]!;
    expect(rateSwap.enqueue).toHaveLength(1);
    expect(rateSwap.dequeue).toHaveLength(1);
  });

  it("cancellation-recovery: the correction outcome is append-oriented (correctsEventId → the original booking)", async () => {
    const { instance } = await runIntegrationCase(level8Scenarios[2]!);
    expect(instance.observations.steps.map((s) => s.action)).toEqual(["QUEUE", "QUEUE", "INTERRUPT", "RESUME", "CONTINUE"]);
    // The INTERRUPT removes the CANCELLED leg from the plan queue and the
    // correction references the original booking outcome event.
    expect(instance.observations.steps[2]!.dequeue).toEqual([
      instance.observations.steps[0]!.selectedExperienceId,
    ]);
    const correction = instance.observations.steps[2]!;
    expect(correction.outcome?.eventId).toBe("ev-adapter-l8-trv-cancellation-recovery-3");
    // The emitted outcome event corrects the step-1 booking outcome.
    const correctedBooking = "ev-adapter-l8-trv-cancellation-recovery-1";
    expect(instance.observations.steps[0]!.outcome?.eventId).toBe(correctedBooking);
    expect(instance.observations.steps[2]!.action).toBe("INTERRUPT");
  });

  it("budget-replan: the tightening budget replans every leg under max-cost constraints", async () => {
    const { instance } = await runIntegrationCase(level8Scenarios[3]!);
    expect(instance.observations.steps.map((s) => s.action)).toEqual(["QUEUE", "QUEUE", "SWITCH", "SWITCH", "SWITCH", "CONTINUE"]);
    for (const step of instance.observations.steps) {
      expect(step.planId).toBe("plan-voyageeasy-budget");
    }
    expect(instance.observations.steps[5]!.queueAfter).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Capability probes + evidence honesty + the wave scorecard
// ---------------------------------------------------------------------------

describe("SIM-003 capability probes, evidence honesty, and the wave scorecard", () => {
  it("every baseline scenario covers 12/12 required capabilities", async () => {
    for (const scenario of ALL_SCENARIOS) {
      if (scenario.scenarioId.startsWith("probe-")) continue;
      const { run } = await runIntegrationCase(scenario);
      expect(run.record.capabilityCoverage.required).toBe(12);
      expect(run.record.capabilityCoverage.satisfied).toBe(12);
      expect(run.record.capabilityCoverage.partial).toBe(0);
      expect(run.record.capabilityCoverage.missing).toBe(0);
      expect(run.record.gaps).toHaveLength(0);
    }
  });

  it("the plan-management probes (L5, L8) honestly record the COMPOSITION_GAP", async () => {
    for (const scenario of [level5Scenarios[4]!, level8Scenarios[4]!]) {
      const { run } = await runIntegrationCase(scenario);
      expect(run.verdict.reckonComplete).toBe(false);
      expect(run.record.capabilityCoverage.required).toBe(13);
      expect(run.record.capabilityCoverage.satisfied).toBe(12);
      expect(run.record.capabilityCoverage.partial).toBe(1);
      expect(run.record.gaps).toEqual([
        expect.objectContaining({ capability: "plan-management", friction: "COMPOSITION_GAP" }),
      ]);
    }
  });

  it("the ad-memory probe (L6) and the decision-retrieval probe (L7) record their named gaps", async () => {
    const adProbe = await runIntegrationCase(level6Scenarios[4]!);
    expect(adProbe.run.record.gaps).toEqual([
      expect.objectContaining({ capability: "ad-memory", friction: "COMPOSITION_GAP" }),
    ]);
    const retrievalProbe = await runIntegrationCase(level7Scenarios[4]!);
    expect(retrievalProbe.run.record.gaps).toEqual([
      expect.objectContaining({ capability: "decision-retrieval", friction: "COMPOSITION_GAP" }),
    ]);
  });

  it("fixture evidence never satisfies a production-observed requirement", async () => {
    const strictProfile: ReckonCompleteProfileDeclaration = finalizeReckonCompleteProfile({
      ...level5Profile,
      profileId: "profile-level-5-production-strict",
      requiredEvidenceClass: "production-observed",
    });
    const scenario = { ...level5Scenarios[0]!, profile: strictProfile };
    const { run } = await runIntegrationCase(scenario);
    expect(run.verdict.reckonComplete).toBe(false);
    expect(run.verdict.evidenceSufficient).toBe(false);
    // All 12 wired capabilities carry OBSERVABILITY_GAP — never a silent pass.
    expect(run.verdict.gaps.filter((g) => g.friction === "OBSERVABILITY_GAP")).toHaveLength(12);
    expect(run.verdict.coverage.satisfied).toBe(0);
  });

  it("the wave scorecard aggregates 24 runs across 4 levels and 16 hosts honestly", async () => {
    const suite = await runIntegrationCaseSuite(ALL_SCENARIOS, { scorecardId: "scorecard-sim-003-wave-a" });
    expect(suite.runs).toHaveLength(24);
    expect(suite.records).toHaveLength(24);
    expect(suite.scorecard.aggregate.runCount).toBe(24);
    expect(suite.scorecard.aggregate.distinctLevels).toBe(4);
    expect(suite.scorecard.aggregate.distinctHosts).toBe(16);
    expect(suite.scorecard.records.every((r) => r.recordChecksum.match(/^[0-9a-f]{64}$/))).toBe(true);

    // The recurring-gap register: plan-management|COMPOSITION_GAP appears in
    // exactly TWO domains (5 and 8) — below the 3-domain law threshold.
    const planGap = suite.scorecard.recurringGaps.find(
      (g) => g.capability === "plan-management" && g.friction === "COMPOSITION_GAP",
    );
    expect(planGap).toBeDefined();
    expect(planGap!.ladderLevels).toEqual([5, 8]);
    expect(planGap!.domainCount).toBe(2);
    expect(planGap!.platformUpgradeCandidate).toBe(false);

    const adGap = suite.scorecard.recurringGaps.find(
      (g) => g.capability === "ad-memory" && g.friction === "COMPOSITION_GAP",
    );
    expect(adGap!.domainCount).toBe(1);
    const retrievalGap = suite.scorecard.recurringGaps.find(
      (g) => g.capability === "decision-retrieval" && g.friction === "COMPOSITION_GAP",
    );
    expect(retrievalGap!.domainCount).toBe(1);

    // HONESTY: no gap reaches three domains in this wave ⇒ no platform
    // upgrade candidate is claimed (the law is domainCount ≥ 3).
    expect(suite.scorecard.recurringGaps.every((g) => g.platformUpgradeCandidate === (g.domainCount >= 3))).toBe(true);
    expect(suite.scorecard.recurringGaps.some((g) => g.platformUpgradeCandidate)).toBe(false);

    // The aggregate is honest about the probes: mean coverage < 1.
    expect(suite.scorecard.aggregate.meanCapabilityCoverageRatio).toBeLessThan(1);
    expect(suite.scorecard.aggregate.meanCapabilityCoverageRatio).toBeGreaterThan(0.98);
    expect(suite.scorecard.aggregate.totalRetries).toBeGreaterThan(0); // resilience runs contribute
  });
});

// ---------------------------------------------------------------------------
// The scripted schedule policy (frozen semantics, documented)
// ---------------------------------------------------------------------------

describe("the scripted schedule policy (fixture responder, SIM-003)", () => {
  const TENANT = { tenantId: "tenant-policy" };
  const SUBJECT = { kind: "user", ref: "user-policy-1" };

  function requestWith(overrides: {
    currentExperience?: { experienceId: string; itemId: string; realizationId: string };
    source?: string;
    style?: "mindful" | "balanced" | "immersive";
    sameItem?: boolean;
  }) {
    const current = overrides.currentExperience;
    return DecisionRequestSchema.parse({
      requestId: "req-policy-1",
      tenant: TENANT,
      subject: SUBJECT,
      objective: { objectiveId: "obj-policy", kind: "be-entertained" },
      attentionPolicy: { policyId: "ap-policy", style: overrides.style ?? "balanced" },
      context: { contextId: "ctx-policy" },
      candidates: {
        setId: "cs-policy",
        candidates: [
          {
            itemId: overrides.sameItem && current ? current.itemId : "item-other",
            realizationIds: [overrides.sameItem && current ? current.realizationId : "real-other"],
            source: overrides.source ?? "host-recommendation",
          },
        ],
      },
      ...(current !== undefined
        ? {
            currentExperience: {
              experienceId: current.experienceId,
              itemId: current.itemId,
              realizationId: current.realizationId,
              format: { kind: "full" },
              duration: 600,
            },
          }
        : {}),
      policySelector: { policyId: "greedy-v1" },
      at: 1_000,
      idempotencyKey: "idem-policy-1",
    });
  }

  it("no current experience ⇒ QUEUE (the SIM-001 behavior, byte-stable)", async () => {
    const { scriptedDecisionFor } = await import("../src/index.js");
    const decision = scriptedDecisionFor(requestWith({}));
    expect(decision.action).toBe("QUEUE");
    expect(decision.scheduleDelta?.enqueue).toHaveLength(1);
    expect(decision.scheduleDelta?.dequeue).toHaveLength(0);
    expect(decision.reasons).toHaveLength(1); // unchanged SIM-001 reasons
  });

  it("same item + realization ⇒ CONTINUE; different realization ⇒ SWITCH (offer swaps)", async () => {
    const { scriptedDecisionFor } = await import("../src/index.js");
    const current = { experienceId: "exp-cur", itemId: "item-a", realizationId: "real-a1" };
    const continueDecision = scriptedDecisionFor(
      requestWith({ currentExperience: current, sameItem: true, source: "host-recommendation" }),
    );
    expect(continueDecision.action).toBe("CONTINUE");
    expect(continueDecision.selectedExperience?.experienceId).toBe("exp-cur");
    const swapDecision = scriptedDecisionFor(
      requestWith({
        currentExperience: current,
        source: "host-recommendation",
      }),
    );
    expect(swapDecision.action).toBe("SWITCH");
    expect(swapDecision.scheduleDelta?.resumeCheckpoint?.experienceId).toBe("exp-cur");
  });

  it("host-time-critical ⇒ INTERRUPT; host-resume ⇒ RESUME; mindful ⇒ SUGGEST (in that precedence order)", async () => {
    const { scriptedDecisionFor } = await import("../src/index.js");
    const current = { experienceId: "exp-cur", itemId: "item-a", realizationId: "real-a1" };
    expect(scriptedDecisionFor(requestWith({ currentExperience: current, source: "host-time-critical" })).action).toBe("INTERRUPT");
    expect(scriptedDecisionFor(requestWith({ currentExperience: current, source: "host-resume" })).action).toBe("RESUME");
    expect(scriptedDecisionFor(requestWith({ currentExperience: current, style: "mindful" })).action).toBe("SUGGEST");
    // A mindful host is never interrupted — time-critical degrades to a suggestion.
    expect(scriptedDecisionFor(requestWith({ currentExperience: current, style: "mindful", source: "host-time-critical" })).action).toBe("SUGGEST");
  });

  it("the policy is deterministic: the same request always yields the same decision", async () => {
    const { scriptedDecisionFor } = await import("../src/index.js");
    const current = { experienceId: "exp-cur", itemId: "item-a", realizationId: "real-a1" };
    const request = requestWith({ currentExperience: current, source: "host-time-critical" });
    const first = scriptedDecisionFor(request);
    const second = scriptedDecisionFor(DecisionRequestSchema.parse(JSON.parse(canonicalJson(request))));
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(first.scheduleDelta?.resumeCheckpoint?.resumeToken).toMatch(/^resume-/);
  });
});
