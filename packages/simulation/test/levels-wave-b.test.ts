/**
 * SIM-004 — the ladder Levels 9–12 acceptance tests (package battery).
 *
 * Mirrors packages/simulation/test/levels.test.ts (the SIM-002 battery)
 * for Wave B, proving per level through the REAL public SDK surface over
 * the scripted fixture responder:
 * 1. PROFILE × MANIFEST mechanics: the exact coverage/verdict each
 *    level's honest manifest produces (Level 11 complete; Levels 9/10/12
 *    carry one honest declared partial each — plan-management
 *    COMPOSITION_GAP, context-snapshots API_GAP, evidence-retrieval
 *    COMPOSITION_GAP).
 * 2. MEASUREMENT FIELDS: API ops + SDK methods, glue, timing to first
 *    decision and full loop, p50/p95, failures, evidence class — all
 *    from the canonical fixture (seed/steps fixed in wave-b.ts).
 * 3. WORLD-STATE TRANSITIONS: exact final world snapshots per level
 *    (ETA drift + correction, substitution switch, priority-prep
 *    interrupt, delivery; zone rotation, matching pool, surge,
 *    in-flight ride; feed freshness, policy deferrals, exploration,
 *    staleness; suitability gates, acceptance, audit correction).
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
  createLevel9FoodDeliveryHost,
  createLevel10MobilityHost,
  createLevel11SocialFeedHost,
  createLevel12FinanceHost,
  level9FoodDeliveryProfile,
  level10MobilityProfile,
  level11SocialFeedProfile,
  level12FinanceProfile,
  level9FoodDeliveryMeta,
  level10MobilityMeta,
  level11SocialFeedMeta,
  level12FinanceMeta,
  LADDER_WAVE_B_FIXTURES,
  runLadderWaveBLevelFixture,
  runCanonicalLadderWaveB,
  renderLadderWaveBMarkdownTable,
  renderLadderWaveBGapsTable,
  renderLadderWaveBScorecardSummary,
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
    meta: level9FoodDeliveryMeta,
    profileInput: level9FoodDeliveryProfile,
    createHost: createLevel9FoodDeliveryHost,
    moduleFile: "level-9-food-delivery.ts",
  },
  {
    meta: level10MobilityMeta,
    profileInput: level10MobilityProfile,
    createHost: createLevel10MobilityHost,
    moduleFile: "level-10-mobility.ts",
  },
  {
    meta: level11SocialFeedMeta,
    profileInput: level11SocialFeedProfile,
    createHost: createLevel11SocialFeedHost,
    moduleFile: "level-11-social-feed.ts",
  },
  {
    meta: level12FinanceMeta,
    profileInput: level12FinanceProfile,
    createHost: createLevel12FinanceHost,
    moduleFile: "level-12-finance.ts",
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
  const fixture = LADDER_WAVE_B_FIXTURES.find((entry) => entry.level === level);
  if (fixture === undefined) {
    throw new Error(`no Wave B fixture for level ${level}`);
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

describe("SIM-004 levels: profile × manifest mechanics (canonical fixtures)", () => {
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
      const entry = await runLadderWaveBLevelFixture(fixtureFor(meta.level));
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
      const entry = await runLadderWaveBLevelFixture(fixtureFor(meta.level));
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
      // (the platform finding, now measured at levels 9–12).
      expect(record.apiOperations).toEqual(STANDARD_OPERATIONS);
      expect(record.sdkMethods).toEqual(STANDARD_SDK_METHODS);
      expect(record.harnessVersion.length).toBeGreaterThan(0);
      expect(record.replayInputs.seed).toBe(fixtureFor(meta.level).seed);
      expect(record.replayInputs.steps).toBe(fixtureFor(meta.level).steps);
      expect(record.replayInputs.hostAdapterId).toBe(meta.hostAdapterId);
      expect(record.manifestChecksum).toMatch(/^[0-9a-f]{64}$/);
    });

    it(`level ${meta.level}: glue is declared honestly (mechanical recount of the module source)`, async () => {
      const entry = await runLadderWaveBLevelFixture(fixtureFor(meta.level));
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

describe("SIM-004 levels: deterministic world-state transitions", () => {
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

  it("level 9 (food delivery): changing ETA, substitution, urgent replanning, hard deadline all transition", async () => {
    const { world } = await runFresh(createLevel9FoodDeliveryHost, LEVEL_CASES[0]!, "2109", 8);
    // Fresh order at step 1 (pasta, promise 18 min) → the kitchen sells
    // the pasta out at step 3 → the decision SWITCHes to the substitution
    // sibling (risotto, promise 21 min) → the ETA drifts +2 min/step and
    // first breaches promise+slack at step 4 (one append-oriented
    // CORRECTION of the step-1 promise) → at step 6 the priority-prep
    // candidate INTERRUPTs (promise 21−6 = 15) → delivery at step 8.
    expect(world.presentations).toBe(8);
    expect(world.orderedItemId).toBe("l9-dish-risotto");
    expect(world.promisedEtaMinutes).toBe(15);
    expect(world.etaLog).toEqual([20, 22, 27, 29, 31, 27, 29]);
    expect(world.substitutionSteps).toEqual([3]);
    expect(world.correctionSteps).toEqual([4]);
    expect(world.priorityPrepSteps).toEqual([6]);
    expect(world.soldOutItems).toEqual(["l9-dish-pasta"]);
    expect(world.deliveredSteps).toEqual([8]);
    expect(world.outcomeSteps).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(world.outcomeTypes).toEqual([
      "start",
      "custom",
      "custom",
      "correction",
      "custom",
      "interruption-accept",
      "custom",
      "conversion",
    ]);
    expect(world.deltaDimensions.every((dimension) => dimension === "cuisine.italian")).toBe(true);
    expect(world.deltaDimensions).toHaveLength(8);
    expect(world.cuisineWeights).toEqual({ american: 1, italian: 1.8, thai: 1 });
  });

  it("level 10 (mobility): zone rotation, matching pool, surge, completion, in-flight ride", async () => {
    const { world } = await runFresh(createLevel10MobilityHost, LEVEL_CASES[1]!, "2110", 7);
    // Zone rotation central → north → east → south → central → north →
    // east; four rides matched (home-zone, nearest-zone for the south
    // scarcity, time-critical surge re-dispatch, home-zone again), rides
    // 1 and 3 completed, ride 4 still in flight at the end.
    expect(world.presentations).toBe(7);
    expect(world.zoneRotation).toEqual(["central", "north", "east", "south", "central", "north", "east"]);
    expect(world.rides).toEqual([
      { rideId: 1, pickupZone: "central", vehicleId: "l10-veh-standard-01", matchedAtStep: 1, completedAtStep: 3 },
      { rideId: 2, pickupZone: "south", vehicleId: "l10-veh-standard-02", matchedAtStep: 4, completedAtStep: 5 },
      { rideId: 3, pickupZone: "central", vehicleId: "l10-veh-xl-01", matchedAtStep: 5, completedAtStep: 6 },
      { rideId: 4, pickupZone: "east", vehicleId: "l10-veh-standard-03", matchedAtStep: 7, completedAtStep: null },
    ]);
    expect(world.matchedLog.map((entry) => `${entry.step}:${entry.zone}:${entry.source}`)).toEqual([
      "1:central:home-zone-supply",
      "4:south:host-nearest-zone",
      "5:central:host-time-critical",
      "7:east:home-zone-supply",
    ]);
    expect(world.surgeSteps).toEqual([5]);
    expect(world.completedRides).toEqual([1, 3]);
    expect(world.inFlightAtEnd).toBe("l10-veh-standard-03");
    // Real-time matching pool bookkeeping: matched vehicles leave the
    // pool; completed vehicles return to it (scarce-resource tracking).
    expect(world.poolLog[0]).toHaveLength(5);
    expect(world.poolLog[4]).toHaveLength(3);
    expect(world.poolLog[5]).toContain("l10-veh-standard-01");
    expect(world.candidateSources).toEqual([
      "home-zone-supply",
      "host-ride-track",
      "host-ride-track",
      "host-nearest-zone",
      "host-time-critical",
      "host-ride-track",
      "home-zone-supply",
    ]);
    expect(world.outcomeTypes).toEqual([
      "start",
      "custom",
      "completion",
      "start",
      "interruption-accept",
      "completion",
      "start",
    ]);
    expect(world.zoneWeights).toEqual({ central: 1.9, east: 1.3, north: 1.3, south: 1.15 });
  });

  it("level 11 (social feed): large candidate sets, freshness, exploration, policy boundary", async () => {
    const { world } = await runFresh(createLevel11SocialFeedHost, LEVEL_CASES[2]!, "2111", 9);
    // Seven presented posts of nine decisions: steps 4 and 8 are
    // POLICY-BOUNDARY deferrals (requested but never presented — the
    // strong policy boundary of the ladder definition). Exploration
    // candidates inject every 3rd step (candidate sets of 14). Stale
    // posts (> 5h old) leave retrieval as fresh ones age in.
    expect(world.presentations).toBe(9);
    expect(world.presentedLog.map((entry) => `${entry.step}:${entry.itemId}:${entry.eventType}`)).toEqual([
      "1:l11-post-01:completion",
      "2:l11-post-02:completion",
      "3:l11-post-03:completion",
      "5:l11-post-10:abandonment",
      "6:l11-post-19:completion",
      "7:l11-post-20:completion",
      "9:l11-post-13:completion",
    ]);
    expect(world.policyDeferrals).toEqual([4, 8]);
    expect(world.policySuppressed).toEqual(["l11-post-04", "l11-post-21"]);
    expect(world.candidateSetSizes).toEqual([12, 12, 14, 12, 12, 14, 12, 8, 4]);
    expect(world.explorationSteps).toEqual([3, 6]);
    // Freshness: twelve posts went stale and departed retrieval.
    expect(world.staleDeparted).toHaveLength(12);
    expect(world.topicWeights).toEqual({ design: 1.75, food: 1, news: 0.85, sports: 1.25, tech: 1.5, travel: 1 });
    expect(world.deltaDimensions).toEqual([
      "topic.design",
      "topic.design",
      "topic.design",
      "topic.news",
      "topic.tech",
      "topic.tech",
      "topic.sports",
    ]);
  });

  it("level 12 (finance): suitability gates, acceptance, append-oriented audit correction", async () => {
    const { world } = await runFresh(createLevel12FinanceHost, LEVEL_CASES[3]!, "2112", 6);
    // Six offers requested; two fail the host's suitability-band gate
    // (steps 3 and 5 — requested-but-not-presented, no outcome, no
    // delta: the strict-eligibility boundary is HOST authority). The
    // acceptance lands at step 2; the APY correction (append-oriented,
    // referencing the accepted decision) lands at step 6. Every
    // presented offer is an audit-ledger entry with decision linkage.
    expect(world.presentations).toBe(6);
    expect(world.auditLedger).toHaveLength(6);
    expect(world.suitabilityDeferrals).toEqual([3, 5]);
    expect(world.auditLedger.filter((entry) => !entry.presented).map((entry) => entry.step)).toEqual([3, 5]);
    expect(world.auditLedger.filter((entry) => entry.presented).map((entry) => entry.step)).toEqual([1, 2, 4, 6]);
    expect(world.auditLedger.every((entry) => entry.decisionId.startsWith("dec-"))).toBe(true);
    expect(world.shownSteps).toEqual([1, 4]);
    expect(world.acceptedSteps).toEqual([2]);
    expect(world.correctionSteps).toEqual([6]);
    expect(world.outcomeSteps).toEqual([1, 2, 4, 6]);
    expect(world.outcomeTypes).toEqual(["impression", "conversion", "impression", "correction"]);
    expect(world.deltaDimensions).toEqual(["product.credit", "product.savings", "product.lending", "product.credit"]);
    expect(world.productWeights).toEqual({ brokerage: 1, credit: 1.4, insurance: 1, lending: 1.2, savings: 1.2 });
  });
});

// ---------------------------------------------------------------------------
// Determinism + the replay gate (per level)
// ---------------------------------------------------------------------------

describe("SIM-004 levels: determinism and the replay gate", () => {
  for (const levelCase of LEVEL_CASES) {
    const { meta } = levelCase;
    const fixture = fixtureFor(meta.level);

    it(`level ${meta.level}: same seed + fresh host ⇒ byte-identical records`, async () => {
      const first = await runLadderWaveBLevelFixture(fixture);
      const second = await runLadderWaveBLevelFixture(fixture);
      expect(canonicalJson(first.run.record)).toBe(canonicalJson(second.run.record));
      expect(canonicalJson(first.run.calls)).toBe(canonicalJson(second.run.calls));
      expect(canonicalJson(first.run.verdict)).toBe(canonicalJson(second.run.verdict));
    });

    it(`level ${meta.level}: a different seed ⇒ different measurements, same coverage and manifest`, async () => {
      const first = await runLadderWaveBLevelFixture(fixture);
      const second = await runLadderWaveBLevelFixture(fixture, "990012");
      expect(canonicalJson(first.run.record)).not.toBe(canonicalJson(second.run.record));
      expect(second.run.record.capabilityCoverage).toEqual(first.run.record.capabilityCoverage);
      expect(second.run.manifest.checksum).toBe(first.run.manifest.checksum);
      expect(second.run.record.latency.samples).toBe(first.run.record.latency.samples);
    });

    it(`level ${meta.level}: replaySimulationRun reproduces the byte-identical record`, async () => {
      const original = await runLadderWaveBLevelFixture(fixture);
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

describe("SIM-004 levels: fault-injected runs stay honest and deterministic", () => {
  const FAULT_SEED = "770099";

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

describe("SIM-004 Wave B: canonical runs, scorecard, and report tables", () => {
  it("aggregates the four canonical records into the sealed wave scorecard", async () => {
    const wave = await runCanonicalLadderWaveB();
    const aggregate = wave.scorecard.aggregate;
    expect(wave.scorecard.schema).toBe("reckon.complete.integration-effort-scorecard");
    expect(aggregate.runCount).toBe(4);
    expect(aggregate.distinctHosts).toBe(4);
    expect(aggregate.distinctLevels).toBe(4);
    expect(aggregate.totalFailures).toBe(0);
    expect(aggregate.totalRetries).toBe(0);
    expect(aggregate.meanCapabilityCoverageRatio).toBeCloseTo((12 / 13 + 12 / 13 + 1 + 12 / 13) / 4, 10);
    expect(wave.scorecard.checksum).toMatch(/^[0-9a-f]{64}$/);

    // The 3-domain law within this wave alone: three distinct gaps, each
    // in exactly ONE domain — recurring, none yet a 3-domain candidate.
    // (The cross-wave composition lives in cross-wave-3-domain.test.ts.)
    const recurring = wave.scorecard.recurringGaps;
    expect(recurring).toHaveLength(3);
    expect(recurring.map((gap) => `${gap.capability}|${gap.friction}`).sort()).toEqual([
      "context-snapshots|API_GAP",
      "evidence-retrieval|COMPOSITION_GAP",
      "plan-management|COMPOSITION_GAP",
    ]);
    expect(recurring.every((gap) => gap.domainCount === 1 && !gap.platformUpgradeCandidate)).toBe(true);
  });

  it("the report tables are deterministic functions of the canonical runs", async () => {
    const first = await runCanonicalLadderWaveB();
    const second = await runCanonicalLadderWaveB();
    expect(first.markdownTable).toBe(second.markdownTable);
    expect(first.markdownGapsTable).toBe(second.markdownGapsTable);
    expect(renderLadderWaveBScorecardSummary(first.scorecard)).toBe(
      renderLadderWaveBScorecardSummary(second.scorecard),
    );
    // The evidence table carries one row per level with the honest
    // Reckon-Complete column (Levels 9/10/12 are honestly NO).
    const rows = renderLadderWaveBMarkdownTable(first.runs).split("\n").slice(2);
    expect(rows).toHaveLength(4);
    expect(rows[0]!.endsWith("| NO |")).toBe(true);
    expect(rows[1]!.endsWith("| NO |")).toBe(true);
    expect(rows[2]!.endsWith("| YES |")).toBe(true);
    expect(rows[3]!.endsWith("| NO |")).toBe(true);
    // The gaps table carries the three named rows.
    const gapRows = renderLadderWaveBGapsTable(first.runs).split("\n").slice(2);
    expect(gapRows).toHaveLength(3);
  });
});
