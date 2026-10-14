/**
 * SIM-005 — the ladder Levels 13–16 acceptance tests (package battery).
 *
 * Mirrors packages/simulation/test/levels-wave-b.test.ts (the SIM-004
 * battery) for Wave C-1, proving per level through the REAL public SDK
 * surface over the scripted fixture responder:
 * 1. PROFILE × MANIFEST mechanics: the exact coverage/verdict each
 *    level's honest manifest produces (Level 15 complete; Levels 13/14
 *    carry one honest declared partial each — evidence-retrieval
 *    COMPOSITION_GAP, plan-management COMPOSITION_GAP; Level 16 carries
 *    two — plan-management + evidence-retrieval COMPOSITION_GAP).
 * 2. MEASUREMENT FIELDS: API ops + SDK methods, glue, timing to first
 *    decision and full loop, p50/p95, failures, evidence class — all
 *    from the canonical fixture (seed/steps fixed in wave-c.ts).
 * 3. WORLD-STATE TRANSITIONS: exact final world snapshots per level
 *    (provenance ledger, consent deferral + safety veto + uncertainty
 *    surfacing + correction; curriculum DAG unlocks + delayed outcomes
 *    + remediation + tutor interrupt; role rotation + deferral +
 *    multi-actor reward + outage interrupt; approval chain + concurrent
 *    lanes + no-double-act blocks + compensation + audit ledger).
 * 4. DETERMINISM + THE REPLAY GATE: same seed + fresh host factory ⇒
 *    byte-identical records; replaySimulationRun reproduces the
 *    identical record; a different seed ⇒ different measurements, same
 *    coverage and manifest checksum.
 * 5. GLUE HONESTY: the declared glue LOC equals a mechanical recount
 *    (comment-stripped, non-blank) of the level module source; the
 *    custom adapter LOC equals the recount inside the adapter markers.
 * 6. FAILURE HONESTY: fault-injected runs complete honestly (no crash,
 *    failures recorded) and remain byte-identical for the same seed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  runSimulation,
  replaySimulationRun,
  createFixtureReckonPort,
  type SimulationHostAdapter,
} from "../src/index.js";
import {
  createLevel13HealthcareHost,
  createLevel14EducationHost,
  createLevel15B2bSaasHost,
  createLevel16EnterpriseWorkflowHost,
  level13HealthcareProfile,
  level14EducationProfile,
  level15B2bSaasProfile,
  level16EnterpriseWorkflowProfile,
  level13HealthcareMeta,
  level14EducationMeta,
  level15B2bSaasMeta,
  level16EnterpriseWorkflowMeta,
  LADDER_WAVE_C_FIXTURES,
  runLadderWaveCLevelFixture,
  runCanonicalLadderWaveC,
  renderLadderWaveCMarkdownTable,
  renderLadderWaveCGapsTable,
  renderLadderWaveCScorecardSummary,
} from "../src/index.js";
import {
  IntegrationEffortRecordSchema,
  ReckonCompleteEnvelopeSchema,
  canonicalJson,
  finalizeReckonCompleteProfile,
  type ReckonCompleteProfileDeclaration,
} from "@reckon/contracts";

const HERE = dirname(fileURLToPath(import.meta.url));
const LEVELS_SRC = join(HERE, "../src/levels");

// ---------------------------------------------------------------------------
// Shared level case table
// ---------------------------------------------------------------------------

interface LevelCase {
  readonly meta: {
    readonly level: number;
    readonly name: string;
    readonly hostAdapterId: string;
    readonly requiredCapabilities: number;
    readonly expectedSatisfied: number;
    readonly expectedPartial: number;
    readonly expectedMissing: number;
    readonly expectedGaps: readonly string[];
  };
  readonly profileInput: Parameters<typeof finalizeReckonCompleteProfile>[0];
  readonly createHost: () => { readonly host: SimulationHostAdapter };
  readonly moduleFile: string;
}

const LEVEL_CASES: readonly LevelCase[] = [
  {
    meta: level13HealthcareMeta,
    profileInput: level13HealthcareProfile,
    createHost: createLevel13HealthcareHost,
    moduleFile: "level-13-healthcare.ts",
  },
  {
    meta: level14EducationMeta,
    profileInput: level14EducationProfile,
    createHost: createLevel14EducationHost,
    moduleFile: "level-14-education.ts",
  },
  {
    meta: level15B2bSaasMeta,
    profileInput: level15B2bSaasProfile,
    createHost: createLevel15B2bSaasHost,
    moduleFile: "level-15-b2b-saas.ts",
  },
  {
    meta: level16EnterpriseWorkflowMeta,
    profileInput: level16EnterpriseWorkflowProfile,
    createHost: createLevel16EnterpriseWorkflowHost,
    moduleFile: "level-16-enterprise-workflow.ts",
  },
];

const STANDARD_OPERATIONS = [
  "POST /v1/candidates",
  "POST /v1/catalog/items",
  "POST /v1/catalog/realizations",
  "POST /v1/decisions",
  "POST /v1/outcomes",
  "POST /v1/preferences/events",
];
const STANDARD_SDK_METHODS = [
  "candidates.submit",
  "catalog.upsertItem",
  "catalog.upsertRealization",
  "decisions.request",
  "outcomes.append",
  "preferences.appendDelta",
];

function profileFor(levelCase: LevelCase): ReckonCompleteProfileDeclaration {
  return finalizeReckonCompleteProfile({ ...levelCase.profileInput });
}

function fixtureFor(level: number) {
  const fixture = LADDER_WAVE_C_FIXTURES.find((entry) => entry.level === level);
  if (fixture === undefined) {
    throw new Error(`no Wave C fixture for level ${level}`);
  }
  return fixture;
}

// ---------------------------------------------------------------------------
// Glue recount machinery (same algorithm as levels.test.ts)
// ---------------------------------------------------------------------------

function stripComments(text: string): string {
  let out = "";
  let inLineComment = false;
  let inBlockComment = false;
  let inString: string | null = null;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    const next = i + 1 < text.length ? text[i + 1]! : null;
    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        out += ch;
      }
      i += 1;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
      if (ch === "\n") out += ch;
      i += 1;
      continue;
    }
    if (inString !== null) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function countNonBlankLines(text: string): number {
  return text.split("\n").filter((line) => line.trim().length > 0).length;
}

function glueRecount(moduleFile: string): { loc: number; customAdapterLoc: number } {
  const source = readFileSync(join(LEVELS_SRC, moduleFile), "utf8");
  const loc = countNonBlankLines(stripComments(source));
  const begin = source.indexOf("// --- glue:adapter:begin");
  const end = source.indexOf("// --- glue:adapter:end");
  if (begin < 0 || end < 0 || end < begin) throw new Error(`adapter markers missing in ${moduleFile}`);
  const region = stripComments(source.slice(begin, end));
  return { loc, customAdapterLoc: countNonBlankLines(region) };
}

// ---------------------------------------------------------------------------
// Profile × manifest mechanics + measurement fields (canonical fixtures)
// ---------------------------------------------------------------------------

describe("SIM-005 levels: profile × manifest mechanics (canonical fixtures)", () => {
  for (const levelCase of LEVEL_CASES) {
    const { meta } = levelCase;
    it(`level ${meta.level} (${meta.name}): finalizes its profile with the declared shape`, () => {
      const profile = profileFor(levelCase);
      expect(profile.ladderLevel).toBe(meta.level);
      expect(profile.requiredCapabilities).toHaveLength(meta.requiredCapabilities);
      expect(profile.requiredEvidenceClass).toBe("fixture");
      expect(new Set(profile.requiredCapabilities.map((r) => r.capability)).size).toBe(
        meta.requiredCapabilities,
      );
    });

    it(`level ${meta.level}: the canonical run yields the exact expected verdict`, async () => {
      const entry = await runLadderWaveCLevelFixture(fixtureFor(meta.level));
      const verdict = entry.run.verdict;
      expect(verdict.coverage.required).toBe(meta.requiredCapabilities);
      expect(verdict.coverage.satisfied).toBe(meta.expectedSatisfied);
      expect(verdict.coverage.partial).toBe(meta.expectedPartial);
      expect(verdict.coverage.missing).toBe(meta.expectedMissing);
      expect(verdict.evidenceClass).toBe("fixture");
      expect(verdict.gaps.map((gap) => `${gap.capability}|${gap.friction}`).sort()).toEqual(
        [...meta.expectedGaps].sort(),
      );
      expect(verdict.reckonComplete).toBe(meta.expectedPartial === 0 && meta.expectedMissing === 0);
      expect(entry.run.reckonComplete).toBe(
        meta.expectedPartial === 0 && meta.expectedMissing === 0 && entry.run.record.timing.fullLoopSteps > 0,
      );
    });

    it(`level ${meta.level}: the effort record parses as the frozen family member with honest fields`, async () => {
      const entry = await runLadderWaveCLevelFixture(fixtureFor(meta.level));
      const record = entry.run.record;
      expect(IntegrationEffortRecordSchema.parse(record)).toEqual(record);
      const envelope = ReckonCompleteEnvelopeSchema.parse(record);
      expect(envelope.schema).toBe("reckon.complete.integration-effort-record");
      expect(record.ladderLevel).toBe(meta.level);
      expect(record.hostAdapterId).toBe(meta.hostAdapterId);
      expect(record.evidenceClass).toBe("fixture");
      expect(record.internalImports).toBe(0);
      // The standard decision loop — the SAME six public operations at
      // every level: ladder complexity grows HOST-side, not Reckon-side
      // (the platform finding, now measured at levels 13–16).
      expect(record.apiOperations).toEqual(STANDARD_OPERATIONS);
      expect(record.sdkMethods).toEqual(STANDARD_SDK_METHODS);
      expect(record.harnessVersion.length).toBeGreaterThan(0);
      expect(record.replayInputs.seed).toBe(fixtureFor(meta.level).seed);
      expect(record.replayInputs.steps).toBe(fixtureFor(meta.level).steps);
      expect(record.replayInputs.hostAdapterId).toBe(meta.hostAdapterId);
      expect(record.manifestChecksum).toMatch(/^[0-9a-f]{64}$/);
    });

    it(`level ${meta.level}: glue is declared honestly (mechanical recount of the module source)`, async () => {
      const entry = await runLadderWaveCLevelFixture(fixtureFor(meta.level));
      const recount = glueRecount(levelCase.moduleFile);
      expect(entry.run.record.glue.loc).toBe(recount.loc);
      expect(entry.run.record.glue.customAdapterLoc).toBe(recount.customAdapterLoc);
      expect(entry.run.record.glue.functions).toBeGreaterThan(0);
    });
  }
});

// ---------------------------------------------------------------------------
// World-state transitions (exact deterministic snapshots)
// ---------------------------------------------------------------------------

describe("SIM-005 levels: deterministic world-state transitions", () => {
  async function runFresh<W>(
    createHost: () => { readonly host: SimulationHostAdapter; readonly world: W },
    levelCase: LevelCase,
    seed: string,
    steps: number,
  ): Promise<{ readonly world: W }> {
    const handle = createHost();
    await runSimulation(
      { seed, port: createFixtureReckonPort().port },
      { host: handle.host, profile: profileFor(levelCase), steps },
    );
    return { world: handle.world };
  }

  it("level 13 (healthcare): provenance, consent gate, safety veto, uncertainty, correction all transition", async () => {
    const { world } = await runFresh(createLevel13HealthcareHost, LEVEL_CASES[0]!, "2113", 7);
    // Seven decisions consumed; five presented (the consent-gated
    // genetic explainer at step 4 and the safety-vetoed diet guide at
    // step 6 are requested-but-not-presented). The urgent recall
    // INTERRUPTs at step 5; the imaging guidance update CORRECTs the
    // step-3 presentation at step 7; uncertainty (0.45 > 0.4) surfaces
    // at steps 3 and 7 and rides every outcome's metrics.
    expect(world.presentations).toBe(7);
    expect(world.provenanceLedger.map((entry) => entry.step)).toEqual([1, 2, 3, 5, 7]);
    expect(world.provenanceLedger.every((entry) => entry.decisionId.startsWith("dec-"))).toBe(true);
    expect(world.provenanceLedger.map((entry) => entry.evidenceGrade)).toEqual(["B", "B", "A", "A", "A"]);
    expect(world.consentLedger).toHaveLength(7);
    expect(world.consentLedger.filter((entry) => !entry.granted).map((entry) => entry.step)).toEqual([4]);
    expect(world.consentDeferrals).toEqual([4]);
    expect(world.safetyVetoSteps).toEqual([6]);
    expect(world.anticoagulantReportedAtStep).toBe(6);
    expect(world.interruptionSteps).toEqual([5]);
    expect(world.correctionSteps).toEqual([7]);
    expect(world.progressSteps).toEqual([2]);
    expect(world.uncertaintySurfacedSteps).toEqual([3, 7]);
    expect(world.outcomeSteps).toEqual([1, 2, 3, 5, 7]);
    expect(world.outcomeTypes).toEqual([
      "start",
      "custom",
      "impression",
      "interruption-accept",
      "correction",
    ]);
    expect(world.deltaDimensions).toEqual([
      "topic.appointments",
      "topic.appointments",
      "topic.imaging",
      "topic.medication-safety",
      "topic.imaging",
    ]);
    expect(world.topicWeights).toEqual({
      appointments: 1.3,
      genetics: 1,
      imaging: 1.3,
      "medication-safety": 1.15,
      telehealth: 1,
    });
  });

  it("level 14 (education): curriculum DAG, delayed outcomes, remediation, tutor interrupt all transition", async () => {
    const { world } = await runFresh(createLevel14EducationHost, LEVEL_CASES[1]!, "2114", 9);
    // Nine decisions, six assignments, four matured assessments (the
    // delay is always 3 steps): A1 masters at 4 (unlocking A2), G1 at 6
    // (unlocking G2), A2 FAILS the 0.65 threshold at 0.58 (remediation
    // onto the practice realization at step 7), G2 masters at 9. The
    // live tutor slot INTERRUPTs at step 8. The step-7 practice and
    // step-9 statistics assignments mature after the run — honestly
    // pending. Zero DAG-coherence violations.
    expect(world.presentations).toBe(9);
    expect(world.assignments.map((entry) => `${entry.step}:${entry.itemId}:${entry.realizationId}`)).toEqual([
      "1:l14-unit-algebra-basics:l14-real-algebra-basics-standard",
      "3:l14-unit-geometry-intro:l14-real-geometry-intro-standard",
      "4:l14-unit-algebra-functions:l14-real-algebra-functions-standard",
      "6:l14-unit-geometry-triangles:l14-real-geometry-triangles-standard",
      "7:l14-unit-algebra-functions:l14-real-algebra-functions-practice",
      "9:l14-unit-stats-basics:l14-real-stats-basics-standard",
    ]);
    expect(world.assignments.map((entry) => entry.source)).toEqual([
      "host-curriculum-next",
      "host-curriculum-next",
      "host-curriculum-unlock",
      "host-curriculum-unlock",
      "host-adaptive-practice",
      "host-curriculum-next",
    ]);
    expect(world.continuedSteps).toEqual([2, 5]);
    expect(world.pendingAtEnd.map((entry) => `${entry.assignedAtStep}:${entry.itemId}:${entry.dueStep}`)).toEqual([
      "7:l14-unit-algebra-functions:10",
      "9:l14-unit-stats-basics:12",
    ]);
    expect(world.matured.map((entry) => `${entry.assignedAtStep}>${entry.maturedAtStep}:${entry.itemId}:${entry.score}:${entry.mastered}`)).toEqual([
      "1>4:l14-unit-algebra-basics:0.85:true",
      "3>6:l14-unit-geometry-intro:0.72:true",
      "4>7:l14-unit-algebra-functions:0.58:false",
      "6>9:l14-unit-geometry-triangles:0.81:true",
    ]);
    expect(world.matured.every((entry) => entry.decisionId.startsWith("dec-"))).toBe(true);
    expect(world.masteredUnits).toEqual([
      "l14-unit-algebra-basics",
      "l14-unit-geometry-intro",
      "l14-unit-geometry-triangles",
    ]);
    expect(world.belowThresholdUnits).toEqual(["l14-unit-algebra-functions"]);
    expect(world.unlockedSteps).toEqual([
      { itemId: "l14-unit-algebra-functions", step: 4 },
      { itemId: "l14-unit-geometry-triangles", step: 6 },
    ]);
    expect(world.interruptionSteps).toEqual([8]);
    expect(world.coherenceViolations).toEqual([]);
    expect(world.outcomeSteps).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(world.outcomeTypes).toEqual([
      "start",
      "custom",
      "custom",
      "completion",
      "custom",
      "completion",
      "completion",
      "interruption-accept",
      "completion",
    ]);
    expect(world.deltaDimensions).toEqual([
      "subject.algebra",
      "subject.algebra",
      "subject.geometry",
      "subject.algebra",
      "subject.algebra",
      "subject.geometry",
      "subject.algebra",
      "subject.tutoring",
      "subject.statistics",
    ]);
    expect(world.subjectWeights).toEqual({
      algebra: 1.75,
      geometry: 1.3,
      statistics: 1.15,
      tutoring: 1.15,
    });
  });

  it("level 15 (B2B SaaS): roles, workflow context, multi-actor reward, outage interrupt all transition", async () => {
    const { world } = await runFresh(createLevel15B2bSaasHost, LEVEL_CASES[2]!, "2115", 8);
    // Eight decisions consumed by the rotating 3-actor team; the
    // member-requested sprint report at step 3 is role-gated
    // (requested-but-not-presented) and completes at step 8 when an
    // admin requests it. The production outage at step 7 INTERRUPTs the
    // retro board. The multi-actor reward is declared on ALL eight
    // requests; workflow eligibility records zero violations (the
    // time-critical outage is cross-workflow by nature).
    expect(world.presentations).toBe(8);
    expect(world.teamRosterSize).toBe(3);
    expect(world.roleGateLedger).toHaveLength(8);
    expect(world.roleGateLedger.filter((entry) => !entry.allowed).map((entry) => `${entry.step}:${entry.role}<${entry.minRole}`)).toEqual([
      "3:member<admin",
    ]);
    expect(world.roleDeferrals).toEqual([3]);
    expect(world.workflowRotation).toEqual([
      "standup",
      "standup",
      "sprint",
      "sprint",
      "approvals",
      "retro",
      "retro",
      "sprint",
    ]);
    expect(world.roleRotation).toEqual([
      "member",
      "admin",
      "member",
      "member",
      "admin",
      "owner",
      "member",
      "admin",
    ]);
    expect(world.workflowEligibilityViolations).toEqual([]);
    expect(world.rewardDeclaredSteps).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(world.interruptionSteps).toEqual([7]);
    expect(world.conversionSteps).toEqual([5]);
    expect(world.completionSteps).toEqual([8]);
    expect(world.refreshSteps).toEqual([2]);
    expect(world.outcomeSteps).toEqual([1, 2, 4, 5, 6, 7, 8]);
    expect(world.outcomeTypes).toEqual([
      "start",
      "custom",
      "impression",
      "conversion",
      "impression",
      "interruption-accept",
      "completion",
    ]);
    expect(world.deltaDimensions).toEqual([
      "domain.standup",
      "domain.standup",
      "domain.integrations",
      "domain.approvals",
      "domain.retro",
      "domain.integrations",
      "domain.sprint",
    ]);
    expect(world.domainWeights).toEqual({
      approvals: 1.15,
      integrations: 1.3,
      onboarding: 1,
      retro: 1.15,
      sprint: 1.15,
      standup: 1.3,
    });
  });

  it("level 16 (enterprise workflow): approvals, concurrency, no-double-act, audit, compensation all transition", async () => {
    const { world } = await runFresh(createLevel16EnterpriseWorkflowHost, LEVEL_CASES[3]!, "2116", 10);
    // Ten steps across two concurrent plan lanes (procurement 7, vendor
    // 3). The approval chain advances submitted → manager-approved →
    // director-approved → budget-verified → dispatch-failed →
    // compensated → dispatched. The step-7 budget check is the SHARED
    // action claimed once (vendor lane merged). The step-9 re-plan
    // double-act guard BLOCKS re-submission of the claimed
    // uncompensated po-submit and failed dispatch; the step-9
    // compensation CORRECTs the step-8 dispatch event and unlocks
    // exactly one compensated re-execution, which lands at step 10
    // (conversion). Every step is audited with decision + outcome
    // linkage.
    expect(world.presentations).toBe(10);
    expect(world.concurrentPlanIds).toEqual(["plan-l16-procurement-1", "plan-l16-vendor-1"]);
    expect(world.laneRotation).toEqual([
      "procurement",
      "vendor",
      "procurement",
      "vendor",
      "vendor",
      "procurement",
      "procurement",
      "procurement",
      "procurement",
      "procurement",
    ]);
    expect(world.actionClaims).toHaveLength(10);
    expect(world.sharedActionClaims).toEqual([
      { itemId: "l16-step-budget-check", lane: "procurement", step: 7, mergedLane: "vendor" },
    ]);
    expect(world.doubleActBlocks).toEqual([
      { step: 9, itemId: "l16-step-po-submit" },
      { step: 9, itemId: "l16-step-payment-dispatch" },
    ]);
    expect(world.compensationSteps).toEqual([9]);
    expect(world.compensationUnlocks).toEqual([{ step: 9, itemId: "l16-step-payment-dispatch" }]);
    // No-double-act invariant: no action is EVER claimed by two
    // different plan lanes (the shared budget check is claimed once by
    // procurement with the vendor lane's need merged). The only
    // re-executions are (a) vendor-onboard within its OWN plan (open at
    // step 2 → complete at step 5 — step progression, no compensation
    // needed) and (b) the failed payment dispatch, re-executed exactly
    // once AFTER the compensation that unlocked it (8 → 9 → 10).
    const claimsByItem = new Map<string, Array<{ lane: string; step: number }>>();
    for (const claim of world.actionClaims) {
      claimsByItem.set(claim.itemId, [
        ...(claimsByItem.get(claim.itemId) ?? []),
        { lane: claim.lane, step: claim.step },
      ]);
    }
    for (const claims of claimsByItem.values()) {
      expect(new Set(claims.map((claim) => claim.lane)).size).toBe(1);
    }
    expect(claimsByItem.get("l16-step-vendor-onboard")!.map((claim) => claim.step)).toEqual([2, 5]);
    const dispatchClaims = claimsByItem.get("l16-step-payment-dispatch")!;
    expect(dispatchClaims.map((claim) => claim.step)).toEqual([8, 10]);
    expect(dispatchClaims[1]!.step).toBeGreaterThan(world.compensationSteps[0]!);
    for (const [itemId, claims] of claimsByItem) {
      if (itemId !== "l16-step-vendor-onboard" && itemId !== "l16-step-payment-dispatch") {
        expect(claims).toHaveLength(1);
      }
    }
    expect(world.approvalChainStates).toEqual([
      { step: 1, state: "submitted" },
      { step: 3, state: "manager-approved" },
      { step: 6, state: "director-approved" },
      { step: 7, state: "budget-verified" },
      { step: 8, state: "dispatch-failed" },
      { step: 9, state: "compensated" },
      { step: 10, state: "dispatched" },
    ]);
    expect(world.vendorStates).toEqual([
      { step: 2, state: "opened" },
      { step: 4, state: "compliance-reviewed" },
      { step: 5, state: "completed" },
    ]);
    expect(world.auditLedger).toHaveLength(10);
    expect(world.auditLedger.every((entry) => entry.decisionId.startsWith("dec-"))).toBe(true);
    expect(world.auditLedger.every((entry) => entry.outcomeEventId === `ev-l16-${entry.step}`)).toBe(true);
    expect(world.auditLedger.map((entry) => entry.planId)).toEqual([
      "plan-l16-procurement-1",
      "plan-l16-vendor-1",
      "plan-l16-procurement-1",
      "plan-l16-vendor-1",
      "plan-l16-vendor-1",
      "plan-l16-procurement-1",
      "plan-l16-procurement-1",
      "plan-l16-procurement-1",
      "plan-l16-procurement-1",
      "plan-l16-procurement-1",
    ]);
    expect(world.outcomeSteps).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(world.outcomeTypes).toEqual([
      "start",
      "custom",
      "custom",
      "custom",
      "completion",
      "custom",
      "custom",
      "custom",
      "correction",
      "conversion",
    ]);
    expect(world.deltaDimensions).toEqual([
      "workflow.procurement",
      "workflow.vendor",
      "workflow.approvals",
      "workflow.vendor",
      "workflow.vendor",
      "workflow.approvals",
      "workflow.finance",
      "workflow.payments",
      "workflow.compensation",
      "workflow.payments",
    ]);
    expect(world.workflowWeights).toEqual({
      approvals: 1.2,
      compensation: 1.1,
      finance: 1.1,
      payments: 1.2,
      procurement: 1.1,
      vendor: 1.3,
    });
  });
});

// ---------------------------------------------------------------------------
// Determinism + the replay gate (per level)
// ---------------------------------------------------------------------------

describe("SIM-005 levels: determinism and the replay gate", () => {
  for (const levelCase of LEVEL_CASES) {
    const { meta } = levelCase;
    const fixture = fixtureFor(meta.level);

    it(`level ${meta.level}: same seed + fresh host ⇒ byte-identical records`, async () => {
      const first = await runLadderWaveCLevelFixture(fixture);
      const second = await runLadderWaveCLevelFixture(fixture);
      expect(canonicalJson(first.run.record)).toBe(canonicalJson(second.run.record));
      expect(canonicalJson(first.run.calls)).toBe(canonicalJson(second.run.calls));
      expect(canonicalJson(first.run.verdict)).toBe(canonicalJson(second.run.verdict));
    });

    it(`level ${meta.level}: a different seed ⇒ different measurements, same coverage and manifest`, async () => {
      const first = await runLadderWaveCLevelFixture(fixture);
      const second = await runLadderWaveCLevelFixture(fixture, "990013");
      expect(canonicalJson(first.run.record)).not.toBe(canonicalJson(second.run.record));
      expect(second.run.record.capabilityCoverage).toEqual(first.run.record.capabilityCoverage);
      expect(second.run.manifest.checksum).toBe(first.run.manifest.checksum);
      expect(second.run.record.latency.samples).toBe(first.run.record.latency.samples);
    });

    it(`level ${meta.level}: replaySimulationRun reproduces the byte-identical record`, async () => {
      const original = await runLadderWaveCLevelFixture(fixture);
      const replayHandle = levelCase.createHost();
      const replayed = await replaySimulationRun(original.run.record.replayInputs, {
        host: replayHandle.host,
        profile: profileFor(levelCase),
        port: createFixtureReckonPort().port,
      });
      expect(canonicalJson(replayed.record)).toBe(canonicalJson(original.run.record));
      expect(replayed.reckonComplete).toBe(original.run.reckonComplete);
    });
  }
});

// ---------------------------------------------------------------------------
// Failure honesty (fault-injected runs)
// ---------------------------------------------------------------------------

describe("SIM-005 levels: fault-injected runs stay honest and deterministic", () => {
  const FAULT_SEED = "880066";

  async function faultedRun(levelCase: LevelCase) {
    const handle = levelCase.createHost();
    return runSimulation(
      { seed: FAULT_SEED, port: createFixtureReckonPort().port, faultRate: 0.25, maxRetries: 3 },
      { host: handle.host, profile: profileFor(levelCase), steps: fixtureFor(levelCase.meta.level).steps },
    );
  }

  for (const levelCase of LEVEL_CASES) {
    const { meta } = levelCase;
    it(`level ${meta.level}: injected faults are recorded honestly and the run completes`, async () => {
      const run = await faultedRun(levelCase);
      expect(run.record.failures.count).toBeGreaterThan(0);
      expect(run.record.failures.retryCount).toBeGreaterThanOrEqual(run.record.failures.count);
      // p50/p95 come from SUCCESSFUL calls only.
      expect(run.record.latency.samples).toBe(run.calls.filter((call) => call.status === "ok").length);
      // The verdict mechanics are seed-independent (manifest-driven).
      expect(run.record.capabilityCoverage.satisfied).toBe(meta.expectedSatisfied);
    });

    it(`level ${meta.level}: the same fault seed reproduces byte-identically (faults are seeded draws)`, async () => {
      const first = await faultedRun(levelCase);
      const second = await faultedRun(levelCase);
      expect(canonicalJson(first.record)).toBe(canonicalJson(second.record));
      expect(canonicalJson(first.calls)).toBe(canonicalJson(second.calls));
    });
  }
});

// ---------------------------------------------------------------------------
// The wave scorecard + the report tables
// ---------------------------------------------------------------------------

describe("SIM-005 Wave C-1: canonical runs, scorecard, and report tables", () => {
  it("aggregates the four canonical records into the sealed wave scorecard", async () => {
    const wave = await runCanonicalLadderWaveC();
    const aggregate = wave.scorecard.aggregate;
    expect(wave.scorecard.schema).toBe("reckon.complete.integration-effort-scorecard");
    expect(aggregate.runCount).toBe(4);
    expect(aggregate.distinctHosts).toBe(4);
    expect(aggregate.distinctLevels).toBe(4);
    expect(aggregate.totalFailures).toBe(0);
    expect(aggregate.totalRetries).toBe(0);
    expect(aggregate.meanCapabilityCoverageRatio).toBeCloseTo((12 / 13 + 12 / 13 + 1 + 12 / 14) / 4, 10);
    expect(wave.scorecard.checksum).toMatch(/^[0-9a-f]{64}$/);

    // The 3-domain law within this wave alone: two distinct gaps, each
    // in exactly TWO domains — recurring, none yet a 3-domain candidate
    // INSIDE the wave. (The cross-wave composition lives in
    // cross-wave-through-wave-c.test.ts — where evidence-retrieval
    // reaches its third domain {12, 13, 16} and plan-management its
    // fifth {5, 8, 9, 14, 16}.)
    const recurring = wave.scorecard.recurringGaps;
    expect(recurring).toHaveLength(2);
    expect(recurring.map((gap) => `${gap.capability}|${gap.friction}`).sort()).toEqual([
      "evidence-retrieval|COMPOSITION_GAP",
      "plan-management|COMPOSITION_GAP",
    ]);
    expect(recurring.every((gap) => gap.domainCount === 2 && !gap.platformUpgradeCandidate)).toBe(true);
  });

  it("the report tables are deterministic functions of the canonical runs", async () => {
    const first = await runCanonicalLadderWaveC();
    const second = await runCanonicalLadderWaveC();
    expect(first.markdownTable).toBe(second.markdownTable);
    expect(first.markdownGapsTable).toBe(second.markdownGapsTable);
    expect(renderLadderWaveCScorecardSummary(first.scorecard)).toBe(
      renderLadderWaveCScorecardSummary(second.scorecard),
    );
    // The evidence table carries one row per level with the honest
    // Reckon-Complete column (Levels 13/14/16 are honestly NO; Level 15
    // is the wave's complete level).
    const rows = renderLadderWaveCMarkdownTable(first.runs).split("\n").slice(2);
    expect(rows).toHaveLength(4);
    expect(rows[0]!.endsWith("| NO |")).toBe(true);
    expect(rows[1]!.endsWith("| NO |")).toBe(true);
    expect(rows[2]!.endsWith("| YES |")).toBe(true);
    expect(rows[3]!.endsWith("| NO |")).toBe(true);
    // The gaps table carries the four named rows (one for L13, one for
    // L14, two for L16).
    const gapRows = renderLadderWaveCGapsTable(first.runs).split("\n").slice(2);
    expect(gapRows).toHaveLength(4);
  });
});
