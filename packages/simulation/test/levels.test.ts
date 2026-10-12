/**
 * SIM-002 — the ladder Levels 1–4 acceptance tests (package battery).
 *
 * Proves, per level, through the REAL public SDK surface over the
 * scripted fixture responder:
 * 1. PROFILE × MANIFEST mechanics: the exact coverage/verdict the
 *    level's honest manifest produces (complete for Levels 1/3; an
 *    honest context-snapshots API_GAP partial for Levels 2/4).
 * 2. MEASUREMENT FIELDS: API ops + SDK methods, glue, timing to first
 *    decision and full loop, p50/p95, failures, evidence class — all
 *    from the canonical fixture (seed/steps fixed in wave-a.ts).
 * 3. THE DEFER COST (Level 4): first decision lands at step 1 but the
 *    full loop completes at step 2 — the background-attention deferral
 *    is a MEASURED number, not a claim.
 * 4. WORLD-STATE TRANSITIONS: exact final world snapshots per level
 *    (preference weights, queue/replace counts, stock/sell-out,
 *    fatigue suppressions, defer-queue drain, interruptions).
 * 5. DETERMINISM + THE REPLAY GATE: same seed + fresh host factory ⇒
 *    byte-identical records (canonical JSON); replaySimulationRun
 *    reproduces the identical record; a different seed ⇒ different
 *    measurements, same coverage and manifest checksum.
 * 6. GLUE HONESTY: the declared glue LOC equals a mechanical recount
 *    (comment-stripped, non-blank) of the level module source; the
 *    custom adapter LOC equals the recount inside the adapter markers.
 * 7. FAILURE HONESTY: fault-injected runs complete honestly (no crash,
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
  scriptedDecisionFor,
  type SimulationHostAdapter,
} from "../src/index.js";
import {
  createLevel1StaticCatalogHost,
  createLevel2ContentFeedHost,
  createLevel3StorefrontHost,
  createLevel4NotificationsHost,
  level1StaticCatalogProfile,
  level2ContentFeedProfile,
  level3StorefrontProfile,
  level4NotificationsProfile,
  level1StaticCatalogMeta,
  level2ContentFeedMeta,
  level3StorefrontMeta,
  level4NotificationsMeta,
  LADDER_WAVE_A_FIXTURES,
  runLadderLevelFixture,
  runCanonicalLadderWaveA,
  renderLadderWaveAMarkdownTable,
  renderLadderWaveAGapsTable,
  renderLadderWaveAScorecardSummary,
} from "../src/index.js";
import {
  DecisionRequestSchema,
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
    meta: level1StaticCatalogMeta,
    profileInput: level1StaticCatalogProfile,
    createHost: createLevel1StaticCatalogHost,
    moduleFile: "level-1-static-catalog.ts",
  },
  {
    meta: level2ContentFeedMeta,
    profileInput: level2ContentFeedProfile,
    createHost: createLevel2ContentFeedHost,
    moduleFile: "level-2-content-feed.ts",
  },
  {
    meta: level3StorefrontMeta,
    profileInput: level3StorefrontProfile,
    createHost: createLevel3StorefrontHost,
    moduleFile: "level-3-storefront.ts",
  },
  {
    meta: level4NotificationsMeta,
    profileInput: level4NotificationsProfile,
    createHost: createLevel4NotificationsHost,
    moduleFile: "level-4-notifications.ts",
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

/** The canonical fixture for a level (from LADDER_WAVE_A_FIXTURES). */
function fixtureFor(level: number) {
  const fixture = LADDER_WAVE_A_FIXTURES.find((entry) => entry.level === level);
  if (fixture === undefined) throw new Error(`missing canonical fixture for level ${level}`);
  return fixture;
}

const profileCache = new Map<number, ReckonCompleteProfileDeclaration>();
function profileFor(levelCase: LevelCase): ReckonCompleteProfileDeclaration {
  const cached = profileCache.get(levelCase.meta.level);
  if (cached !== undefined) return cached;
  const profile = finalizeReckonCompleteProfile({ ...levelCase.profileInput });
  profileCache.set(levelCase.meta.level, profile);
  return profile;
}

// ---------------------------------------------------------------------------
// Glue honesty (mechanical recount)
// ---------------------------------------------------------------------------

/** Strip line + block comments, keeping string literals intact. */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let inString: string | null = null;
  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];
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

describe("SIM-002 levels: profile × manifest mechanics (canonical fixtures)", () => {
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
      const entry = await runLadderLevelFixture(fixtureFor(meta.level));
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
      const entry = await runLadderLevelFixture(fixtureFor(meta.level));
      const record = entry.run.record;
      expect(IntegrationEffortRecordSchema.parse(record)).toEqual(record);
      const envelope = ReckonCompleteEnvelopeSchema.parse(record);
      expect(envelope.schema).toBe("reckon.complete.integration-effort-record");
      expect(record.ladderLevel).toBe(meta.level);
      expect(record.hostAdapterId).toBe(meta.hostAdapterId);
      expect(record.evidenceClass).toBe("fixture");
      expect(record.internalImports).toBe(0);
      // The standard decision loop — the SAME six public operations at
      // every level: ladder complexity grows HOST-side, not Reckon-side.
      expect(record.apiOperations).toEqual(STANDARD_OPERATIONS);
      expect(record.sdkMethods).toEqual(STANDARD_SDK_METHODS);
      expect(record.harnessVersion.length).toBeGreaterThan(0);
      expect(record.replayInputs.seed).toBe(fixtureFor(meta.level).seed);
      expect(record.replayInputs.steps).toBe(fixtureFor(meta.level).steps);
      expect(record.replayInputs.hostAdapterId).toBe(meta.hostAdapterId);
      expect(record.manifestChecksum).toMatch(/^[0-9a-f]{64}$/);
    });

    it(`level ${meta.level}: glue is declared honestly (mechanical recount of the module source)`, async () => {
      const entry = await runLadderLevelFixture(fixtureFor(meta.level));
      const recount = glueRecount(levelCase.moduleFile);
      expect(entry.run.record.glue.loc).toBe(recount.loc);
      expect(entry.run.record.glue.customAdapterLoc).toBe(recount.customAdapterLoc);
      expect(entry.run.record.glue.functions).toBeGreaterThan(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Timing semantics (the measured defer cost)
// ---------------------------------------------------------------------------

describe("SIM-002 levels: timing semantics", () => {
  it("levels 1–3 present immediately: first decision and full loop both land at step 1", async () => {
    for (const level of [1, 2, 3]) {
      const entry = await runLadderLevelFixture(fixtureFor(level));
      expect(entry.run.record.timing.firstDecisionSteps).toBe(1);
      expect(entry.run.record.timing.fullLoopSteps).toBe(1);
      expect(entry.run.record.timing.firstDecisionMs).toBeGreaterThan(0);
      expect(entry.run.record.timing.fullLoopMs).toBeGreaterThanOrEqual(
        entry.run.record.timing.firstDecisionMs,
      );
    }
  });

  it("level 4 MEASURES the defer cost: first decision at step 1, full loop at step 2", async () => {
    const entry = await runLadderLevelFixture(fixtureFor(4));
    // Step 1 lands in a background-attention window: the decision is
    // requested and returned (first decision achieved) but the host
    // defers presentation — the full loop completes one step later.
    expect(entry.run.record.timing.firstDecisionSteps).toBe(1);
    expect(entry.run.record.timing.fullLoopSteps).toBe(2);
    expect(entry.run.record.timing.fullLoopMs).toBeGreaterThan(
      entry.run.record.timing.firstDecisionMs,
    );
  });
});

// ---------------------------------------------------------------------------
// World-state transitions (exact deterministic snapshots)
// ---------------------------------------------------------------------------

describe("SIM-002 levels: deterministic world-state transitions", () => {
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

  it("level 1 (static catalog): the fixed editorial pick wins every step; the ledger records it", async () => {
    const { world } = await runFresh(createLevel1StaticCatalogHost, LEVEL_CASES[0]!, "1101", 5);
    expect(world.presentations).toBe(5);
    expect(world.presentedTopics).toEqual(["news", "news", "news", "news", "news"]);
    expect(world.outcomeSteps).toEqual([1, 2, 3, 4, 5]);
    expect(world.deltaDimensions).toEqual([
      "topic.news",
      "topic.news",
      "topic.news",
      "topic.news",
      "topic.news",
    ]);
  });

  it("level 2 (content feed): preferences move retrieval; consumed articles never re-show; queue/replace runs", async () => {
    const { world } = await runFresh(createLevel2ContentFeedHost, LEVEL_CASES[1]!, "1102", 8);
    // Preference feedback: business + science gained (completions), culture
    // and sports lost ground (abandonments at steps 4 and 8), technology
    // was never surfaced.
    expect(Object.fromEntries([...world.preferenceWeights.entries()].sort())).toEqual({
      business: 1.6,
      culture: 1.1,
      science: 1.6,
      sports: 1.1,
      technology: 1,
    });
    // Eight DISTINCT articles presented (consumption exclusion works).
    const presentedItems = world.presentedLog.map((entry) => entry.itemId);
    expect(new Set(presentedItems).size).toBe(8);
    expect(presentedItems).toEqual([
      "l2-feed-03",
      "l2-feed-04",
      "l2-feed-07",
      "l2-feed-08",
      "l2-feed-05",
      "l2-feed-06",
      "l2-feed-09",
      "l2-feed-10",
    ]);
    // The scripted synthetic-user pattern: abandonment on every 4th item.
    expect(world.completions).toBe(6);
    expect(world.abandonments).toBe(2);
    expect(world.presentedLog.filter((e) => e.outcomeType === "abandonment").map((e) => e.step)).toEqual([4, 8]);
    // Queue/replace: depth-2 prefetch with overflow drops + wholesale
    // replacement on abandonment steps.
    expect(world.replacedCount).toBe(7);
    expect(world.queue.map((entry) => entry.itemId)).toEqual(["l2-feed-10"]);
    // Context rotation: morning → afternoon → evening by step (ids only —
    // the API_GAP finding of this level).
    expect(world.contextLog.map((entry) => entry.dayPart)).toEqual([
      "morning",
      "afternoon",
      "evening",
      "morning",
      "afternoon",
      "evening",
      "morning",
      "afternoon",
    ]);
  });

  it("level 3 (storefront): variants convert, stock decrements, a variant SELLS OUT and leaves retrieval", async () => {
    const { world } = await runFresh(createLevel3StorefrontHost, LEVEL_CASES[2]!, "1103", 6);
    // Six DISTINCT products surfaced (session browsing never re-surfaces).
    const presentedItems = world.presentedLog.map((entry) => entry.itemId);
    expect(new Set(presentedItems).size).toBe(6);
    // Two conversions (every 3rd step) with real order values; the
    // tee-S variant sells out and lands in the sold-out ledger.
    expect(world.conversions).toBe(2);
    expect(world.impressions).toBe(4);
    expect(world.presentedLog.filter((e) => e.eventType === "conversion").map((e) => e.orderValueUsd)).toEqual([24, 19.5]);
    expect(world.soldOutRealizations).toEqual(["l3-real-tee-s"]);
    expect(world.stockByRealization.get("l3-real-tee-s")).toBe(0);
    expect(world.stockByRealization.get("l3-real-bottle-750")).toBe(4);
    // Category affinity: gear gained from the bottle conversion, apparel
    // from the tee conversion, footwear decayed on impressions.
    const weights = Object.fromEntries([...world.categoryWeights.entries()].sort());
    expect(weights.apparel).toBeCloseTo(1.3604, 6);
    expect(weights.footwear).toBeCloseTo(0.98, 6);
    expect(weights.gear).toBeCloseTo(1.372, 6);
  });

  it("level 4 (notifications): attention, fatigue, defer/queue drain, and interruptions all transition", async () => {
    const { world } = await runFresh(createLevel4NotificationsHost, LEVEL_CASES[3]!, "1104", 9);
    // Deferrals: 3 background-attention steps + 1 quiet-hours step; the
    // defer queue DRAINS to empty (defer → queue → re-retrieval → present).
    expect(world.backgroundDeferrals).toBe(3);
    expect(world.quietDeferrals).toBe(1);
    expect(world.deferQueue).toEqual([]);
    // Fatigue: the calendar category was presented twice in three steps
    // (2, 3) and got suppressed at step 4 through step 6.
    expect(world.suppressionLog).toEqual([{ category: "calendar", detectedAtStep: 4, untilStep: 6 }]);
    // Interruptions: two high-urgency notifications accepted while
    // attention was partial; none rejected (budget never exceeded).
    expect(world.interruptionAccepts).toBe(2);
    expect(world.interruptionRejects).toBe(0);
    expect(world.completions).toBe(2);
    expect(world.skips).toBe(1);
    // The presentation ledger, exactly (step:itemId:attention:eventType).
    expect(
      world.presentedLog.map((e) => `${e.step}:${e.itemId}:${e.attention}:${e.eventType}`),
    ).toEqual([
      "2:l4-notif-cal-01:partial:interruption-accept",
      "3:l4-notif-cal-02:full:completion",
      "6:l4-notif-msg-01:full:skip",
      "8:l4-notif-news-01:partial:interruption-accept",
      "9:l4-notif-news-02:full:completion",
    ]);
    // Category affinity: accepted-interruption and completion categories
    // gained; the skipped messages category decayed.
    expect(Object.fromEntries([...world.categoryWeights.entries()].sort())).toEqual({
      calendar: 1.5,
      messages: 0.7,
      "news-alerts": 1.5,
      promos: 1,
    });
  });

  it("level 4: the interruption budget rejects beyond 3 accepted interruptions (direct world drive)", async () => {
    // The canonical run never exceeds the budget; drive the host's own
    // callbacks directly with a scripted high-urgency decision to prove
    // the interruption-REJECT path (host-side guard semantics).
    const { host, world } = createLevel4NotificationsHost();
    const request = DecisionRequestSchema.parse({
      requestId: "req-l4-reject-probe",
      tenant: { tenantId: "tenant-l4-notifications" },
      subject: { kind: "user", ref: "user-l4-notify-1" },
      objective: { objectiveId: "obj-l4-catch-up", kind: "catch-up" },
      attentionPolicy: { policyId: "ap-l4-mindful", style: "mindful" },
      context: { contextId: "ctx-l4-probe" },
      candidates: {
        setId: "cs-l4-probe",
        candidates: [
          { itemId: "l4-notif-msg-01", realizationIds: ["l4-real-msg-01-push"], source: "host-notification-center" },
        ],
      },
      policySelector: { policyId: "greedy-v1" },
      at: 1_000,
      idempotencyKey: "idem-l4-probe",
    });
    const result = scriptedDecisionFor(request);
    // Steps 2, 8, 11, 14 are partial-attention, non-quiet steps.
    for (const step of [2, 8, 11, 14]) {
      const reaction = host.consumeDecision(step, result);
      expect(reaction.presented).toBe(true);
      host.provideOutcome(step, result, reaction, step * 1_000);
    }
    expect(world.interruptionAccepts).toBe(3);
    expect(world.interruptionRejects).toBe(1);
    expect(world.recentInterruptions).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Determinism + the replay gate (per level)
// ---------------------------------------------------------------------------

describe("SIM-002 levels: determinism and the replay gate", () => {
  for (const levelCase of LEVEL_CASES) {
    const { meta } = levelCase;
    const fixture = fixtureFor(meta.level);

    it(`level ${meta.level}: same seed + fresh host ⇒ byte-identical records`, async () => {
      const first = await runLadderLevelFixture(fixture);
      const second = await runLadderLevelFixture(fixture);
      expect(canonicalJson(first.run.record)).toBe(canonicalJson(second.run.record));
      expect(canonicalJson(first.run.calls)).toBe(canonicalJson(second.run.calls));
      expect(canonicalJson(first.run.verdict)).toBe(canonicalJson(second.run.verdict));
    });

    it(`level ${meta.level}: a different seed ⇒ different measurements, same coverage and manifest`, async () => {
      const first = await runLadderLevelFixture(fixture);
      const second = await runLadderLevelFixture(fixture, "990011");
      expect(canonicalJson(first.run.record)).not.toBe(canonicalJson(second.run.record));
      expect(second.run.record.capabilityCoverage).toEqual(first.run.record.capabilityCoverage);
      expect(second.run.manifest.checksum).toBe(first.run.manifest.checksum);
      expect(second.run.record.latency.samples).toBe(first.run.record.latency.samples);
    });

    it(`level ${meta.level}: replaySimulationRun reproduces the byte-identical record`, async () => {
      const original = await runLadderLevelFixture(fixture);
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

describe("SIM-002 levels: fault-injected runs stay honest and deterministic", () => {
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
      // Calls that recovered through retries are still latency samples
      // (status ok); the p50/p95 come from SUCCESSFUL calls only.
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

describe("SIM-002 Wave A: canonical runs, scorecard, and report tables", () => {
  it("aggregates the four canonical records into the sealed wave scorecard", async () => {
    const wave = await runCanonicalLadderWaveA();
    const aggregate = wave.scorecard.aggregate;
    expect(wave.scorecard.schema).toBe("reckon.complete.integration-effort-scorecard");
    expect(aggregate.runCount).toBe(4);
    expect(aggregate.distinctHosts).toBe(4);
    expect(aggregate.distinctLevels).toBe(4);
    expect(aggregate.totalFailures).toBe(0);
    expect(aggregate.totalRetries).toBe(0);
    expect(aggregate.meanCapabilityCoverageRatio).toBeCloseTo((1 + 11 / 12 + 1 + 12 / 13) / 4, 10);
    expect(wave.scorecard.checksum).toMatch(/^[0-9a-f]{64}$/);

    // The 3-domain law, honestly applied: the context-snapshots API_GAP
    // appears in exactly TWO domains (2 and 4) — flagged as recurring,
    // NOT yet a platform-upgrade candidate.
    const recurring = wave.scorecard.recurringGaps;
    expect(recurring).toHaveLength(1);
    expect(recurring[0]!.capability).toBe("context-snapshots");
    expect(recurring[0]!.friction).toBe("API_GAP");
    expect(recurring[0]!.ladderLevels).toEqual([2, 4]);
    expect(recurring[0]!.domainCount).toBe(2);
    expect(recurring[0]!.platformUpgradeCandidate).toBe(false);
  });

  it("the report tables are deterministic functions of the canonical runs", async () => {
    const first = await runCanonicalLadderWaveA();
    const second = await runCanonicalLadderWaveA();
    expect(first.markdownTable).toBe(second.markdownTable);
    expect(first.markdownGapsTable).toBe(second.markdownGapsTable);
    expect(renderLadderWaveAScorecardSummary(first.scorecard)).toBe(
      renderLadderWaveAScorecardSummary(second.scorecard),
    );
    // The evidence table carries one row per level with the honest
    // Reckon-Complete column (Levels 2 and 4 are honestly NO).
    const rows = renderLadderWaveAMarkdownTable(first.runs).split("\n").slice(2);
    expect(rows).toHaveLength(4);
    expect(rows[0]!.endsWith("| YES |")).toBe(true);
    expect(rows[1]!.endsWith("| NO |")).toBe(true);
    expect(rows[2]!.endsWith("| YES |")).toBe(true);
    expect(rows[3]!.endsWith("| NO |")).toBe(true);
    // The gaps table carries the two named context-snapshots API_GAP rows.
    const gapRows = renderLadderWaveAGapsTable(first.runs).split("\n").slice(2);
    expect(gapRows).toHaveLength(2);
    expect(gapRows.every((row) => row.includes("context-snapshots") && row.includes("API_GAP"))).toBe(true);
  });

  it("fixture evidence never satisfies a production-observed profile floor (any level)", async () => {
    const levelCase = LEVEL_CASES[0]!;
    const strictProfile = finalizeReckonCompleteProfile({
      ...level1StaticCatalogProfile,
      profileId: "profile-l1-strict-probe",
      requiredEvidenceClass: "production-observed",
    });
    const handle = levelCase.createHost();
    const run = await runSimulation(
      { seed: "1101", port: createFixtureReckonPort().port },
      { host: handle.host, profile: strictProfile, steps: 2 },
    );
    expect(run.verdict.reckonComplete).toBe(false);
    expect(run.verdict.evidenceSufficient).toBe(false);
    expect(run.verdict.gaps.filter((gap) => gap.friction === "OBSERVABILITY_GAP")).toHaveLength(
      level1StaticCatalogMeta.requiredCapabilities,
    );
  });
});
