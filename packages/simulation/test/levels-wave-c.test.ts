/**
 * SIM-006 — the ladder Levels 17–20 acceptance tests (package battery).
 *
 * Mirrors packages/simulation/test/levels-wave-b.test.ts (the SIM-004
 * battery) for Wave C, proving per level through the REAL public SDK
 * surface over the scripted fixture responder:
 * 1. PROFILE × MANIFEST mechanics: the exact coverage/verdict each
 *    level's honest manifest produces (all four canonical runs are
 *    Reckon-Complete — 12/12; the honest incompleteness lives in the
 *    law-mandated AUXILIARY runs: the Level 17 single-agent baseline
 *    completes, the agent-delegation / webhook-delivery probes carry
 *    one declared partial each, the Level 20 churn phase carries one
 *    declared missing).
 * 2. MEASUREMENT FIELDS: API ops + SDK methods, glue, timing to first
 *    decision and full loop, p50/p95, failures, evidence class — all
 *    from the canonical fixtures (seed/steps fixed in wave-c.ts). The
 *    Level 20 CANONICAL run is fault-injected (faultRate 0.25,
 *    maxRetries 3): provider failure/recovery is MEASURED, not asserted.
 * 3. WORLD-STATE TRANSITIONS: exact final world snapshots per level
 *    (delegation graph + budgets + termination + the MANDATORY
 *    single-agent baseline comparison at 17; the explicit cross-device
 *    consent gate + handoffs + single logical identity at 18; the
 *    budget-tier degradation ladder + observable-in-outcome metrics +
 *    honest non-presentation at 19; provider outage/failover, staleness,
 *    noisy deltas, interrupt/resume, delayed outcome, capability churn
 *    + recovery at 20).
 * 4. DETERMINISM + THE REPLAY GATE: same seed + fresh host factory ⇒
 *    byte-identical records; replaySimulationRun reproduces the
 *    identical record; a different seed ⇒ different measurements, same
 *    coverage and manifest checksum.
 * 5. GLUE HONESTY: the declared glue LOC equals a mechanical recount
 *    (comment-stripped, non-blank) of the level module source — for the
 *    Level 17 org host minus the solo-baseline region, for the Level 17
 *    solo baseline exactly its glue:baseline region (the baseline
 *    measures the MARGINAL single-agent integration); the custom
 *    adapter LOC equals the recount inside the adapter markers.
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
  createLevel17MultiAgentHost,
  createLevel17SingleAgentBaselineHost,
  createLevel17AgentDelegationProbeHost,
  createLevel18MultiSurfaceHost,
  createLevel18WebhookDeliveryProbeHost,
  createLevel19ResourceConstrainedHost,
  createLevel20StormwatchHost,
  level17MultiAgentProfile,
  level17SingleAgentBaselineProfile,
  level17AgentDelegationProbeProfile,
  level18MultiSurfaceProfile,
  level18WebhookDeliveryProbeProfile,
  level19ResourceConstrainedProfile,
  level20AdversarialProfile,
  level17MultiAgentMeta,
  level18MultiSurfaceMeta,
  level19ResourceConstrainedMeta,
  level20AdversarialMeta,
  LADDER_WAVE_C_FIXTURES,
  LADDER_WAVE_C_AUX_CASES,
  runLadderWaveCLevelFixture,
  runLadderWaveCAuxCase,
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
    meta: level17MultiAgentMeta,
    profileInput: level17MultiAgentProfile,
    createHost: createLevel17MultiAgentHost,
    moduleFile: "level-17-multi-agent.ts",
  },
  {
    meta: level18MultiSurfaceMeta,
    profileInput: level18MultiSurfaceProfile,
    createHost: createLevel18MultiSurfaceHost,
    moduleFile: "level-18-multi-surface.ts",
  },
  {
    meta: level19ResourceConstrainedMeta,
    profileInput: level19ResourceConstrainedProfile,
    createHost: createLevel19ResourceConstrainedHost,
    moduleFile: "level-19-resource-constrained.ts",
  },
  {
    meta: level20AdversarialMeta,
    profileInput: level20AdversarialProfile,
    createHost: createLevel20StormwatchHost,
    moduleFile: "level-20-adversarial.ts",
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
// Glue recount machinery (same algorithm as levels.test.ts; the Level 17
// two-host module carries the documented carve-out: the org host counts
// the module MINUS the glue:baseline region, the solo baseline counts
// exactly its glue:baseline region)
// ---------------------------------------------------------------------------

function stripComments(text: string): string {
  let out = "";
  let inLineComment = false;
  let inBlockComment = false;
  let inString: string | null = null;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    const next = i + 1 < text.length ? text[i + 1] : null;
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
  const begin = source.indexOf("// --- glue:adapter:begin");
  const end = source.indexOf("// --- glue:adapter:end");
  if (begin < 0 || end < 0 || end < begin) throw new Error(`adapter markers missing in ${moduleFile}`);
  const region = stripComments(source.slice(begin, end));
  let loc = countNonBlankLines(stripComments(source));
  // The Level 17 module hosts BOTH the org run and the mandatory
  // single-agent baseline: the org host's glue excludes the baseline
  // region (the baseline run carries its own count — no double count).
  const baselineBegin = source.indexOf("// --- glue:baseline:begin");
  const baselineEnd = source.indexOf("// --- glue:baseline:end");
  if (baselineBegin >= 0 && baselineEnd > baselineBegin) {
    loc -= countNonBlankLines(stripComments(source.slice(baselineBegin, baselineEnd)));
  }
  return { loc, customAdapterLoc: countNonBlankLines(region) };
}

function glueBaselineRecount(moduleFile: string): { loc: number; customAdapterLoc: number } {
  const source = readFileSync(join(LEVELS_SRC, moduleFile), "utf8");
  const begin = source.indexOf("// --- glue:baseline:begin");
  const end = source.indexOf("// --- glue:baseline:end");
  if (begin < 0 || end < 0 || end < begin) throw new Error(`baseline markers missing in ${moduleFile}`);
  const region = stripComments(source.slice(begin, end));
  const loc = countNonBlankLines(region);
  return { loc, customAdapterLoc: loc };
}

// ---------------------------------------------------------------------------
// Profile × manifest mechanics + measurement fields (canonical fixtures)
// ---------------------------------------------------------------------------

describe("SIM-006 levels: profile × manifest mechanics (canonical fixtures)", () => {
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
      expect(verdict.reckonComplete).toBe(true);
      expect(entry.run.reckonComplete).toBe(true);
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
      // (the platform finding, now measured at levels 17–20).
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

describe("SIM-006 levels: deterministic world-state transitions", () => {
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

  it("level 17 (multi-agent): delegation graph, budgets, escalation, termination, solo fallback", async () => {
    const { world } = await runFresh(createLevel17MultiAgentHost, LEVEL_CASES[0]!, "2117", 8);
    // The org executes the task board: research → drafting → review with
    // delegation across the searchable graph (5 delegations inside the
    // calls budget); the reviewer ESCALATES at step 4 (time-critical
    // re-dispatch → INTERRUPT with checkpoint); the checkpointed draft
    // RESUMES at step 5; the calls budget cannot cover the step-6 review
    // delegation ⇒ the budget-exhausted termination rule fires and the
    // coordinator finishes steps 6–8 SOLO; the board completes at step 8.
    expect(world.presentations).toBe(8);
    expect(world.actionLog).toEqual([
      "QUEUE",
      "SWITCH",
      "SWITCH",
      "INTERRUPT",
      "RESUME",
      "SWITCH",
      "SWITCH",
      "CONTINUE",
    ]);
    expect(world.delegatedSteps).toEqual([1, 2, 3, 4, 5]);
    expect(world.delegationPaths).toEqual([
      "l17-body-coordinator>l17-body-research",
      "l17-body-coordinator>l17-body-writer",
      "l17-body-coordinator>l17-body-writer>l17-body-reviewer",
      "l17-body-reviewer>l17-body-coordinator>l17-body-research",
      "l17-body-coordinator>l17-body-writer",
    ]);
    expect(world.escalationSteps).toEqual([4]);
    expect(world.resumeSteps).toEqual([5]);
    expect(world.soloFallbackSteps).toEqual([6, 7, 8]);
    expect(world.terminationStep).toBe(6);
    expect(world.terminationRule).toBe("budget-exhausted");
    expect(world.costLedgerUsd).toEqual([0.5, 0.9, 1.2, 1.7, 2.1, 2.35, 2.6, 2.85]);
    expect(world.delegationsRemaining).toEqual([4, 3, 2, 1, 0, 0, 0, 0]);
    expect(world.outcomeSteps).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(world.outcomeTypes).toEqual([
      "start",
      "custom",
      "custom",
      "interruption-accept",
      "resume",
      "custom",
      "custom",
      "conversion",
    ]);
    expect(world.deltaDimensions).toEqual([
      "task.research",
      "task.drafting",
      "task.review",
      "task.research",
      "task.drafting",
      "task.review",
      "task.delivery",
      "task.delivery",
    ]);
    expect(world.taskWeights).toEqual({ delivery: 1.2, drafting: 1.2, research: 1.2, review: 1.2 });
    expect(world.qualityScore).toBeCloseTo(0.92, 10);
    // The searchable org graph: 4 bodies (coordinator, research, writer,
    // reviewer) joined by 4 delegation/escalation edges.
    expect(world.orgBodies).toBe(4);
    expect(world.orgEdges).toBe(4);
  });

  it("level 17 (multi-agent): the MANDATORY single-agent baseline (architecture law) + the comparison", async () => {
    const handle = createLevel17SingleAgentBaselineHost();
    const profile = finalizeReckonCompleteProfile({ ...level17SingleAgentBaselineProfile });
    const solo = await runSimulation(
      { seed: "2121", port: createFixtureReckonPort().port },
      { host: handle.host, profile, steps: 8 },
    );
    // The baseline runs the SAME task stream with ONE body: no
    // delegation, no escalation, flat per-task cost, scripted lower
    // quality — and completes the board only by running every task
    // itself (termination: task-complete at step 8, never a budget rule).
    const world = handle.world;
    expect(solo.reckonComplete).toBe(true);
    expect(solo.verdict.coverage.satisfied).toBe(12);
    expect(world.actionLog).toEqual([
      "QUEUE",
      "SWITCH",
      "SWITCH",
      "SWITCH",
      "SWITCH",
      "SWITCH",
      "SWITCH",
      "CONTINUE",
    ]);
    expect(world.delegatedSteps).toEqual([]);
    expect(world.escalationSteps).toEqual([]);
    expect(world.resumeSteps).toEqual([]);
    expect(world.soloFallbackSteps).toEqual([]);
    expect(world.terminationStep).toBe(8);
    expect(world.terminationRule).toBe("task-complete");
    expect(world.costLedgerUsd).toEqual([0.6, 1.2, 1.8, 2.4, 3, 3.6, 4.2, 4.8]);
    expect(world.outcomeSteps).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(world.outcomeTypes).toEqual([
      "start",
      "custom",
      "custom",
      "custom",
      "custom",
      "custom",
      "custom",
      "conversion",
    ]);
    expect(world.qualityScore).toBeCloseTo(0.74, 10);

    // THE COMPARISON (the ladder's reason the baseline is mandatory):
    // the org completes the same 8-presentation board at LOWER total
    // execution cost (2.85 vs 4.80 USD — specialist bodies are cheaper
    // per task than the generalist) and HIGHER scripted quality (0.92
    // vs 0.74), while its bounded delegation budget forces the honest
    // budget-exhausted termination + solo fallback for the tail. Both
    // runs are Reckon-Complete through the SAME six public operations —
    // the multi-agent behavior never changed the Reckon-side surface.
    const org = await runLadderWaveCLevelFixture(fixtureFor(17));
    expect(org.run.reckonComplete).toBe(true);
    const orgWorld = createLevel17MultiAgentHost();
    await runSimulation(
      { seed: "2117", port: createFixtureReckonPort().port },
      { host: orgWorld.host, profile: profileFor(LEVEL_CASES[0]!), steps: 8 },
    );
    expect(orgWorld.world.costLedgerUsd[7]).toBeLessThan(world.costLedgerUsd[7]!);
    expect(orgWorld.world.qualityScore).toBeGreaterThan(world.qualityScore);
    expect(org.run.record.apiOperations).toEqual(solo.record.apiOperations);
    expect(org.run.record.sdkMethods).toEqual(solo.record.sdkMethods);
    // The baseline's marginal glue: the solo region is strictly smaller
    // than the org's (the delegation graph machinery is the delta).
    const orgRecount = glueRecount("level-17-multi-agent.ts");
    const soloRecount = glueBaselineRecount("level-17-multi-agent.ts");
    expect(soloRecount.loc).toBeLessThan(orgRecount.loc);
    expect(solo.record.glue.loc).toBe(soloRecount.loc);
    expect(solo.record.glue.customAdapterLoc).toBe(soloRecount.customAdapterLoc);
  });

  it("level 18 (multi-surface): consent gate, handoffs, cross-surface resume, single logical identity, plan coupling", async () => {
    const { world } = await runFresh(createLevel18MultiSurfaceHost, LEVEL_CASES[1]!, "2118", 8);
    // The user moves web → web → mobile → mobile → device → device →
    // web → mobile. Cross-device consent is WITHHELD at step 3 (the
    // first mobile→device handoff attempt is blocked — no implicit
    // cross-surface data flow) and EXPLICITLY GRANTED at step 4, after
    // which handoffs flow (steps 4–5); a checkpoint taken on the device
    // RESUMES on web at step 7; every decision couples to the shared
    // cross-device day plan (planId plan-l18-day-1, 8/8 steps); the
    // Personal Agent keeps ONE logical identity across all surfaces.
    expect(world.presentations).toBe(8);
    expect(world.actionLog).toEqual([
      "QUEUE",
      "CONTINUE",
      "QUEUE",
      "SWITCH",
      "SWITCH",
      "CONTINUE",
      "RESUME",
      "SWITCH",
    ]);
    expect(world.surfaceLog).toEqual([
      "web",
      "web",
      "mobile",
      "mobile",
      "device",
      "device",
      "web",
      "mobile",
    ]);
    expect(world.consentGrantedStep).toBe(4);
    expect(world.consentWithheldSteps).toEqual([3]);
    expect(world.handoffSteps).toEqual([4, 5]);
    expect(world.crossSurfaceResumeSteps).toEqual([7]);
    expect(world.crossSurfaceCurrentSteps).toEqual([5, 7, 8]);
    expect(world.distinctSubjectCount).toBe(1);
    expect(world.planCoupledSteps).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(world.outcomeSteps).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(world.outcomeTypes).toEqual([
      "start",
      "custom",
      "custom",
      "custom",
      "custom",
      "custom",
      "resume",
      "conversion",
    ]);
    expect(world.deltaDimensions).toEqual([
      "surface.web",
      "surface.web",
      "surface.mobile",
      "surface.mobile",
      "surface.device",
      "surface.device",
      "surface.web",
      "surface.mobile",
    ]);
    expect(world.surfaceWeights).toEqual({ device: 1.2, mobile: 1.3, web: 1.3 });
    // The plan coupling is the FROZEN Experience Plan contract reused
    // for the cross-device plan (module source: every decision request
    // carries the same planId; every schedule delta echoes it).
    const source = readFileSync(join(LEVELS_SRC, "level-18-multi-surface.ts"), "utf8");
    expect(source).toContain('planId: "plan-l18-day-1"');
  });

  it("level 19 (resource-constrained): budget tiers degrade, degradation observable, honest non-presentation", async () => {
    const { world } = await runFresh(createLevel19ResourceConstrainedHost, LEVEL_CASES[2]!, "2119", 8);
    // The budget ledger degrades full (steps 1–4) → reduced (5–7) →
    // minimal (8): candidate sets 4 → 2 → 1, realization tiers
    // edge-full → edge-lite → edge-minimal, latency ceilings
    // 250 → 150 → 80 ms, cost ceilings 0.10 → 0.05 → 0.02 USD. The
    // attention budget exhausts at step 8: the host still REQUESTS the
    // decision but declines to present it (the requested-but-not-
    // presented boundary — 7 presentations, 7 outcomes, no step-8
    // outcome, no step-8 delta). The API-call ledger spends 4/step
    // (32 → 4 remaining); CPU accrues 8/5/3 per tier.
    expect(world.presentations).toBe(7);
    expect(world.declinedSteps).toEqual([8]);
    expect(world.tierLog).toEqual([
      "full",
      "full",
      "full",
      "full",
      "reduced",
      "reduced",
      "reduced",
      "minimal",
    ]);
    expect(world.candidateSetSizes).toEqual([4, 4, 4, 4, 2, 2, 2, 1]);
    expect(world.realizationTiersUsed).toEqual([
      "full",
      "full",
      "full",
      "full",
      "lite",
      "lite",
      "lite",
      "minimal",
    ]);
    expect(world.apiCallsRemainingLog).toEqual([32, 28, 24, 20, 16, 12, 8, 4]);
    expect(world.attentionRemainingLog).toEqual([7.5, 6, 4.5, 3, 2, 1, 0, 0]);
    expect(world.costUsdLog).toEqual([0.08, 0.16, 0.24, 0.32, 0.36, 0.4, 0.44]);
    expect(world.cpuUnitsUsedLog).toEqual([8, 16, 24, 32, 37, 42, 47, 50]);
    expect(world.maxLatencyLog).toEqual([250, 250, 250, 250, 150, 150, 150, 80]);
    expect(world.maxCostLog).toEqual([0.1, 0.1, 0.1, 0.1, 0.05, 0.05, 0.05, 0.02]);
    expect(world.outcomeSteps).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(world.outcomeTypes).toEqual([
      "start",
      "completion",
      "start",
      "completion",
      "start",
      "completion",
      "start",
    ]);
    expect(world.contentWeights).toEqual({ alert: 1.1, ambient: 1.2, brief: 1.4 });
    // Degradation is OBSERVABLE in the outcome stream: every presented
    // outcome's metrics carry the tier code + the full budget ledger
    // state (apiCallsRemaining, attentionUnitsRemaining, costUsdTotal,
    // cpuUnitsUsed), and the final presented outcome of a degraded
    // session additionally carries degradedSession + declinedStepCount —
    // never a silent quality drop. And there is NO new scheduler
    // surface: the run composes only the six standard-loop operations
    // (asserted above).
    const source = readFileSync(join(LEVELS_SRC, "level-19-resource-constrained.ts"), "utf8");
    expect(source).toContain("tierCode");
    expect(source).toContain("attentionUnitsRemaining");
    expect(source).toContain("degradedSession");
  });

  it("level 20 (adversarial): outage/failover, staleness, noisy deltas, delayed outcome, churn + recovery", async () => {
    const handle = createLevel20StormwatchHost();
    const profile = profileFor(LEVEL_CASES[3]!);
    // The CANONICAL run is fault-injected (faultRate 0.25, maxRetries
    // 3, fixed in wave-c.ts): provider failure/recovery is measured.
    const run = await runSimulation(
      { seed: "2120", port: createFixtureReckonPort().port, faultRate: 0.25, maxRetries: 3 },
      { host: handle.host, profile, steps: 8 },
    );
    const world = handle.world;
    expect(run.reckonComplete).toBe(true);
    expect(run.record.failures.count).toBe(9);
    expect(run.record.failures.retryCount).toBe(12);
    expect(run.record.failures.exhaustedCount).toBe(0);
    // The provider-alpha index goes stale during the outage window
    // (ages 6–7h past the 4h freshness bound at steps 3–4) while the
    // host FAILS OVER to provider-beta (steps 3–4); after recovery the
    // refreshed index re-ages 1→4h. The stale window's deltas are
    // NOISY (severe-weather at 3, situation-report at 7 mixed into the
    // energy-brief stream). Step 4 INTERRUPTs (severe-weather brief)
    // and step 5 RESUMES the checkpointed energy brief. The step-2
    // completion event is reported LATE (delayed outcome — the world
    // records it, the outcome stream carries it after the fact).
    expect(world.presentations).toBe(8);
    expect(world.actionLog).toEqual([
      "QUEUE",
      "CONTINUE",
      "SWITCH",
      "INTERRUPT",
      "RESUME",
      "CONTINUE",
      "SWITCH",
      "SWITCH",
    ]);
    expect(world.providerOutageSteps).toEqual([3, 4]);
    expect(world.failoverSteps).toEqual([3, 4]);
    expect(world.indexAgeHoursLog).toEqual([1, 2, 6, 7, 1, 2, 3, 4]);
    expect(world.staleSteps).toEqual([3, 4]);
    expect(world.noisyDeltaSteps).toEqual([3, 4]);
    expect(world.interruptSteps).toEqual([4]);
    expect(world.resumeSteps).toEqual([5]);
    expect(world.delayedOutcomeReported).toBe(true);
    expect(world.outcomeSteps).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(world.outcomeTypes).toEqual([
      "start",
      "custom",
      "custom",
      "interruption-accept",
      "completion",
      "custom",
      "custom",
      "conversion",
    ]);
    expect(world.deltaDimensions).toEqual([
      "topic.energy-brief",
      "topic.energy-brief",
      "topic.energy-brief",
      "topic.severe-weather",
      "topic.energy-brief",
      "topic.energy-brief",
      "topic.situation-report",
      "topic.energy-brief",
    ]);
    expect(world.topicWeights).toEqual({
      "energy-brief": 1.6,
      "severe-weather": 1.1,
      "situation-report": 1.1,
    });
    expect(world.capabilityPhase).toBe("recovered");
    // Provider alpha is down exactly during the outage window and back
    // up after (the failover evidence trail).
    expect(world.providerAlphaUpLog.slice(0, 2).every((up) => up)).toBe(true);
    expect(world.providerAlphaUpLog.slice(2, 4).every((up) => !up)).toBe(true);
    expect(world.providerAlphaUpLog.slice(4).every((up) => up)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The law-mandated auxiliary runs (baseline, probes, churn phase)
// ---------------------------------------------------------------------------

describe("SIM-006 Wave C: the auxiliary runs (honest tiers)", () => {
  it("the single-agent baseline completes Reckon-Complete (12/12, no gaps)", async () => {
    const entry = await runLadderWaveCAuxCase(LADDER_WAVE_C_AUX_CASES[0]!);
    expect(entry.auxCase.kind).toBe("single-agent-baseline");
    expect(entry.run.reckonComplete).toBe(true);
    expect(entry.run.verdict.coverage.satisfied).toBe(12);
    expect(entry.run.verdict.gaps).toEqual([]);
    expect(entry.run.record.gaps).toEqual([]);
    expect(entry.run.record.hostAdapterId).toBe("adapter-l17-hiveops-solo-1");
    expect(entry.run.record.evidenceClass).toBe("fixture");
  });

  it("the agent-delegation probe is honestly incomplete (agent-delegation|COMPOSITION_GAP)", async () => {
    const entry = await runLadderWaveCAuxCase(LADDER_WAVE_C_AUX_CASES[1]!);
    expect(entry.auxCase.kind).toBe("capability-probe");
    expect(entry.run.reckonComplete).toBe(false);
    expect(entry.run.verdict.coverage.satisfied).toBe(12);
    expect(entry.run.verdict.coverage.partial).toBe(1);
    expect(entry.run.verdict.gaps.map((gap) => `${gap.capability}|${gap.friction}`)).toEqual([
      "agent-delegation|COMPOSITION_GAP",
    ]);
    expect(entry.run.record.gaps[0]!.detail ?? "").toContain("standard-loop");
  });

  it("the webhook-delivery probe is honestly incomplete (webhook-delivery|COMPOSITION_GAP)", async () => {
    const entry = await runLadderWaveCAuxCase(LADDER_WAVE_C_AUX_CASES[2]!);
    expect(entry.auxCase.kind).toBe("capability-probe");
    expect(entry.run.reckonComplete).toBe(false);
    expect(entry.run.verdict.coverage.satisfied).toBe(12);
    expect(entry.run.verdict.coverage.partial).toBe(1);
    expect(entry.run.verdict.gaps.map((gap) => `${gap.capability}|${gap.friction}`)).toEqual([
      "webhook-delivery|COMPOSITION_GAP",
    ]);
    expect(entry.run.record.gaps[0]!.detail ?? "").toContain("standard-loop");
  });

  it("the capability-churn phase is honestly incomplete (preference-feedback|ADAPTER_GAP); recovery is the canonical v2 run", async () => {
    const entry = await runLadderWaveCAuxCase(LADDER_WAVE_C_AUX_CASES[3]!);
    expect(entry.auxCase.kind).toBe("capability-churn");
    expect(entry.run.reckonComplete).toBe(false);
    expect(entry.run.verdict.coverage.satisfied).toBe(11);
    expect(entry.run.verdict.coverage.missing).toBe(1);
    expect(entry.run.verdict.gaps.map((gap) => `${gap.capability}|${gap.friction}`)).toEqual([
      "preference-feedback|ADAPTER_GAP",
    ]);
    // The churn phase (manifest v1) loses the preference-feedback
    // capability entirely (missing, not partial): the preference
    // provider is down, no deltas flow, nothing is wired — the record's
    // SDK methods drop preferences.appendDelta accordingly.
    expect(entry.run.record.sdkMethods).not.toContain("preferences.appendDelta");
    expect(entry.run.record.sdkMethods).toContain("outcomes.append");
    // RECOVERY IS EVIDENCED: the canonical (v2/recovered) run restores
    // the capability and completes — the recovery evidence is the
    // canonical record itself, not an assertion.
    const recovered = await runLadderWaveCLevelFixture(fixtureFor(20));
    expect(recovered.run.reckonComplete).toBe(true);
    expect(recovered.run.record.sdkMethods).toContain("preferences.appendDelta");
    expect(recovered.run.verdict.coverage.satisfied).toBe(12);
    // The world marks the phase transition (degraded → recovered).
    const degradedHandle = createLevel20StormwatchHost({ capabilityPhase: "degraded" });
    await runSimulation(
      { seed: "2124", port: createFixtureReckonPort().port },
      {
        host: degradedHandle.host,
        profile: finalizeReckonCompleteProfile({ ...level20AdversarialProfile }),
        steps: 8,
      },
    );
    expect(degradedHandle.world.capabilityPhase).toBe("degraded");
    expect(degradedHandle.world.deltaDimensions).toEqual([]);
  });

  it("every auxiliary record parses as the frozen family member with fixture evidence", async () => {
    for (const auxCase of LADDER_WAVE_C_AUX_CASES) {
      const entry = await runLadderWaveCAuxCase(auxCase);
      const record = entry.run.record;
      expect(IntegrationEffortRecordSchema.parse(record)).toEqual(record);
      expect(record.evidenceClass).toBe("fixture");
      expect(record.internalImports).toBe(0);
      expect(record.ladderLevel).toBe(auxCase.level);
      expect(record.replayInputs.seed).toBe(auxCase.seed);
    }
  });
});

// ---------------------------------------------------------------------------
// Determinism + the replay gate (per level, canonical + auxiliary)
// ---------------------------------------------------------------------------

describe("SIM-006 levels: determinism and the replay gate", () => {
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
      const second = await runLadderWaveCLevelFixture(fixture, "990017");
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

  it("the auxiliary runs replay byte-identically too (fresh host per replay)", async () => {
    for (const auxCase of LADDER_WAVE_C_AUX_CASES) {
      const original = await runLadderWaveCAuxCase(auxCase);
      const hostAndFresh = (): { readonly host: SimulationHostAdapter } => {
        switch (auxCase.caseKey) {
          case "level17-single-agent-baseline":
            return createLevel17SingleAgentBaselineHost();
          case "level17-probe-agent-delegation":
            return createLevel17AgentDelegationProbeHost();
          case "level18-probe-webhook-delivery":
            return createLevel18WebhookDeliveryProbeHost();
          case "level20-churn-degraded":
            return createLevel20StormwatchHost({ capabilityPhase: "degraded" });
          default:
            throw new Error(`unknown aux case ${auxCase.caseKey}`);
        }
      };
      const replayed = await replaySimulationRun(original.run.record.replayInputs, {
        host: hostAndFresh().host,
        profile: original.profile,
        port: createFixtureReckonPort().port,
      });
      expect(canonicalJson(replayed.record)).toBe(canonicalJson(original.run.record));
      expect(replayed.reckonComplete).toBe(original.run.reckonComplete);
    }
  });
});

// ---------------------------------------------------------------------------
// Failure honesty (fault-injected runs)
// ---------------------------------------------------------------------------

describe("SIM-006 levels: fault-injected runs stay honest and deterministic", () => {
  const FAULT_SEED = "880016";

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
      expect(run.reckonComplete).toBe(true);
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

describe("SIM-006 Wave C: canonical runs, scorecard, and report tables", () => {
  it("aggregates the canonical + auxiliary records into the sealed wave scorecard", async () => {
    const wave = await runCanonicalLadderWaveC();
    const aggregate = wave.scorecard.aggregate;
    expect(wave.scorecard.schema).toBe("reckon.complete.integration-effort-scorecard");
    expect(aggregate.runCount).toBe(8);
    expect(aggregate.distinctHosts).toBe(5);
    expect(aggregate.distinctLevels).toBe(4);
    expect(aggregate.totalFailures).toBe(9);
    expect(aggregate.totalRetries).toBe(12);
    expect(aggregate.meanCapabilityCoverageRatio).toBeCloseTo(
      (1 + 1 + 1 + 1 + 1 + 12 / 13 + 12 / 13 + 11 / 12) / 8,
      10,
    );
    expect(wave.scorecard.checksum).toMatch(/^[0-9a-f]{64}$/);

    // The 3-domain law within this wave alone: three distinct gaps, each
    // in exactly ONE domain — recurring, none a 3-domain candidate.
    // (The cross-wave composition is TL3/SIM-007's reconciliation; the
    // merged-wave candidates already on record — context-snapshots|API_GAP,
    // plan-management|COMPOSITION_GAP — are unchanged by this wave.)
    const recurring = wave.scorecard.recurringGaps;
    expect(recurring).toHaveLength(3);
    expect(recurring.map((gap) => `${gap.capability}|${gap.friction}`).sort()).toEqual([
      "agent-delegation|COMPOSITION_GAP",
      "preference-feedback|ADAPTER_GAP",
      "webhook-delivery|COMPOSITION_GAP",
    ]);
    expect(recurring.every((gap) => gap.domainCount === 1 && !gap.platformUpgradeCandidate)).toBe(true);
    // The aggregate stays fixture-class (aggregation never upgrades evidence).
    expect(
      [...wave.runs, ...wave.auxRuns].every((entry) => entry.run.record.evidenceClass === "fixture"),
    ).toBe(true);
  });

  it("the report tables are deterministic functions of the canonical runs", async () => {
    const first = await runCanonicalLadderWaveC();
    const second = await runCanonicalLadderWaveC();
    expect(first.markdownTable).toBe(second.markdownTable);
    expect(first.markdownGapsTable).toBe(second.markdownGapsTable);
    expect(first.markdownAuxTable).toBe(second.markdownAuxTable);
    expect(renderLadderWaveCScorecardSummary(first.scorecard)).toBe(
      renderLadderWaveCScorecardSummary(second.scorecard),
    );
    // The evidence table carries one row per level, all honestly
    // Reckon-Complete YES (the canonical fixtures complete; the honest
    // incompleteness lives in the auxiliary table).
    const rows = renderLadderWaveCMarkdownTable(first.runs).split("\n").slice(2);
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.endsWith("| YES |"))).toBe(true);
    // The auxiliary table carries the four law-mandated rows with the
    // honest verdicts (baseline YES; both probes NO; churn NO).
    const auxRows = first.markdownAuxTable.split("\n").slice(2);
    expect(auxRows).toHaveLength(4);
    expect(auxRows[0]!.endsWith("| YES | — |")).toBe(true);
    expect(auxRows[1]!.includes("agent-delegation|COMPOSITION_GAP")).toBe(true);
    expect(auxRows[2]!.includes("webhook-delivery|COMPOSITION_GAP")).toBe(true);
    expect(auxRows[3]!.includes("preference-feedback|ADAPTER_GAP")).toBe(true);
    // The gaps table carries the three named gap rows (aux runs only —
    // the canonical runs are gap-free).
    const gapRows = renderLadderWaveCGapsTable(first.runs, first.auxRuns).split("\n").slice(2);
    expect(gapRows).toHaveLength(3);
  });
});
