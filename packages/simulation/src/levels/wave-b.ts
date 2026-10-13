/**
 * SIM-004 — Wave B: the canonical fixture runs for ladder Levels 9–12
 * (W3's wave per the ladder doc's parallel waves: "Wave B: W1 Levels
 * 9–12; W3 validates the public API/SDK across representative levels"),
 * the wave scorecard, the CROSS-WAVE 3-domain recurring-gap analysis,
 * and the machine-generated evidence tables embedded in
 * docs/simulations/sim-004-levels-9-12.md.
 *
 * DETERMINISM CONTRACT: the canonical fixtures fix (seed, steps, fault
 * config, clock) per level. The same fixture + a fresh host factory ⇒
 * byte-identical IntegrationEffortRecords, verdicts, and call logs.
 * The markdown tables below are PURE functions of those runs — the
 * doc-drift gate (tests/conformance/fixtures/ladder-wave-b.test.ts)
 * re-renders them and compares them against the marked sections of the
 * report doc, so the documented numbers can never silently drift from
 * the measured ones.
 *
 * THE 3-DOMAIN LAW (the wave-B mandate): the ladder law — "When the
 * same gap appears in at least three domains, upgrade the common
 * platform primitive and replay earlier levels" — is evaluated on the
 * CROSS-WAVE record set (Wave A levels 1–8 + Wave B levels 9–12), not
 * on this wave alone. `crossWaveRecurringGaps` composes the wave-A
 * canonical records, the SIM-003 integration-case records (supplied by
 * the caller — they live in the conformance fixtures), and the Wave B
 * canonical records, then groups every record gap by
 * (capability, friction) across DISTINCT ladder levels. The result is
 * the honest trigger register: this wave's expected triggers are
 * context-snapshots|API_GAP (Wave A domains 2+4 + Wave B domain 10)
 * and plan-management|COMPOSITION_GAP (SIM-003 domains 5+8 + Wave B
 * domain 9) — both reach domainCount 3 ⇒ platformUpgradeCandidate
 * true. SIM-004 records the candidates; it does NOT upgrade the
 * platform (that is SIM-008/TL3).
 *
 * EVIDENCE HONESTY: every canonical run uses the scripted fixture
 * responder (createFixtureReckonPort) — evidenceClass "fixture". The
 * wave scorecard therefore aggregates fixture-class evidence only and
 * can never present itself as production evidence.
 */
import { runSimulation } from "../harness/driver.js";
import { createFixtureReckonPort } from "../harness/responder.js";
import { aggregateIntegrationEffortScorecard } from "../harness/scorecard.js";
import type { SimulationRunResult } from "../harness/driver.js";
import type {
  IntegrationEffortRecord,
  IntegrationEffortScorecard,
  ReckonCompleteProfileDeclarationInput,
  ScorecardRecurringGap,
} from "@reckon/contracts";
import { finalizeReckonCompleteProfile, type ReckonCompleteProfileDeclaration } from "@reckon/contracts";
import {
  createLevel9FoodDeliveryHost,
  level9FoodDeliveryProfile,
  level9FoodDeliveryMeta,
} from "./level-9-food-delivery.js";
import {
  createLevel10MobilityHost,
  level10MobilityProfile,
  level10MobilityMeta,
} from "./level-10-mobility.js";
import {
  createLevel11SocialFeedHost,
  level11SocialFeedProfile,
  level11SocialFeedMeta,
} from "./level-11-social-feed.js";
import {
  createLevel12FinanceHost,
  level12FinanceProfile,
  level12FinanceMeta,
} from "./level-12-finance.js";

/** One canonical ladder-level fixture: the fixed deterministic inputs. */
interface LadderLevelFixture {
  readonly level: number;
  readonly name: string;
  readonly seed: string;
  readonly steps: number;
  readonly faultRate: number;
  readonly maxRetries: number;
  readonly clock: { readonly startMs: number; readonly stepMs: number };
}

/** Ensemble seeds for aggregate-stability fixtures (3 seeds × 4 levels). */
export const LADDER_WAVE_B_ENSEMBLE_SEEDS: readonly string[] = ["4411", "5522", "6633"] as const;

/** The canonical Wave B fixtures (Levels 9–12; zero injected faults). */
export const LADDER_WAVE_B_FIXTURES: readonly LadderLevelFixture[] = [
  { level: 9, name: "Food delivery", seed: "2109", steps: 8, faultRate: 0, maxRetries: 2, clock: { startMs: 0, stepMs: 1000 } },
  { level: 10, name: "Mobility / ride-hailing", seed: "2110", steps: 7, faultRate: 0, maxRetries: 2, clock: { startMs: 0, stepMs: 1000 } },
  { level: 11, name: "Social feed", seed: "2111", steps: 9, faultRate: 0, maxRetries: 2, clock: { startMs: 0, stepMs: 1000 } },
  { level: 12, name: "Finance / offers", seed: "2112", steps: 6, faultRate: 0, maxRetries: 2, clock: { startMs: 0, stepMs: 1000 } },
] as const;

/** The wave-B level case registry entry (profile + host factory + metadata). */
interface LadderLevelCase {
  readonly level: number;
  readonly name: string;
  readonly profileInput: ReckonCompleteProfileDeclarationInput;
  readonly createHost: () => { readonly host: import("../harness/host-adapter.js").SimulationHostAdapter };
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
}

/** The four Wave B level cases, ordered by ladder level. */
export const LADDER_WAVE_B_CASES = [
  {
    level: 9,
    name: "Food delivery",
    profileInput: level9FoodDeliveryProfile,
    createHost: createLevel9FoodDeliveryHost,
    meta: level9FoodDeliveryMeta,
  },
  {
    level: 10,
    name: "Mobility / ride-hailing",
    profileInput: level10MobilityProfile,
    createHost: createLevel10MobilityHost,
    meta: level10MobilityMeta,
  },
  {
    level: 11,
    name: "Social feed",
    profileInput: level11SocialFeedProfile,
    createHost: createLevel11SocialFeedHost,
    meta: level11SocialFeedMeta,
  },
  {
    level: 12,
    name: "Finance / offers",
    profileInput: level12FinanceProfile,
    createHost: createLevel12FinanceHost,
    meta: level12FinanceMeta,
  },
] as const;

/** One canonical level run (record + verdict + scorecard-facing fields). */
export interface LadderWaveBRun {
  readonly fixture: LadderLevelFixture;
  readonly run: SimulationRunResult;
  readonly profile: ReckonCompleteProfileDeclaration;
}

/** The canonical Wave B result: four runs + the sealed scorecard. */
export interface LadderWaveBResult {
  readonly runs: readonly LadderWaveBRun[];
  readonly scorecard: IntegrationEffortScorecard;
  readonly markdownTable: string;
  readonly markdownGapsTable: string;
}

/** Run one canonical level fixture (fresh host ⇒ deterministic). */
export async function runLadderWaveBLevelFixture(
  fixture: LadderLevelFixture,
  seedOverride?: string,
): Promise<LadderWaveBRun> {
  const caseEntry = LADDER_WAVE_B_CASES.find((entry) => entry.level === fixture.level);
  if (caseEntry === undefined) {
    throw new Error(`runLadderLevelFixture: unknown ladder level ${fixture.level}`);
  }
  const profile = finalizeReckonCompleteProfile(caseEntry.profileInput);
  const { host } = caseEntry.createHost();
  const run = await runSimulation(
    {
      seed: seedOverride ?? fixture.seed,
      port: createFixtureReckonPort().port,
      faultRate: fixture.faultRate,
      maxRetries: fixture.maxRetries,
      clock: fixture.clock,
    },
    { host, profile, steps: fixture.steps },
  );
  return { fixture, run, profile };
}

/** Run the canonical Wave B (Levels 9–12) + aggregate the wave scorecard. */
export async function runCanonicalLadderWaveB(): Promise<LadderWaveBResult> {
  const runs: LadderWaveBRun[] = [];
  for (const fixture of LADDER_WAVE_B_FIXTURES) {
    runs.push(await runLadderWaveBLevelFixture(fixture));
  }
  const records: IntegrationEffortRecord[] = runs.map((entry) => entry.run.record);
  const generatedAt = Math.max(...records.map((record) => record.completedAt));
  const scorecard = aggregateIntegrationEffortScorecard(records, {
    scorecardId: "scorecard-sim-004-wave-b",
    generatedAt,
  });
  return {
    runs,
    scorecard,
    markdownTable: renderLadderWaveBMarkdownTable(runs),
    markdownGapsTable: renderLadderWaveBGapsTable(runs),
  };
}

function formatCoverage(record: IntegrationEffortRecord): string {
  const { satisfied, required } = record.capabilityCoverage;
  const ratio = required === 0 ? 0 : satisfied / required;
  return `${satisfied}/${required} (${ratio.toFixed(3)})`;
}

/** The canonical evidence table (pure function of the canonical runs). */
export function renderLadderWaveBMarkdownTable(runs: readonly LadderWaveBRun[]): string {
  const header =
    "| Level | Host adapter | Glue (fn/LOC/adapter LOC) | API ops | SDK methods | First decision (step/ms) | Full loop (step/ms) | p50/p95 (ms) | Samples | Failures (cnt/retry/exh) | Capability coverage | Evidence | Reckon-Complete |";
  const separator =
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|";
  const rows = runs.map((entry) => {
    const record = entry.run.record;
    return `| ${record.ladderLevel} | ${record.hostAdapterId} | ${record.glue.functions}/${record.glue.loc}/${record.glue.customAdapterLoc} | ${record.apiOperations.length} | ${record.sdkMethods.length} | ${record.timing.firstDecisionSteps}/${record.timing.firstDecisionMs} | ${record.timing.fullLoopSteps}/${record.timing.fullLoopMs} | ${record.latency.p50Ms}/${record.latency.p95Ms} | ${record.latency.samples} | ${record.failures.count}/${record.failures.retryCount}/${record.failures.exhaustedCount} | ${formatCoverage(record)} | ${record.evidenceClass} | ${entry.run.reckonComplete ? "YES" : "NO"} |`;
  });
  return [header, separator, ...rows].join("\n");
}

/** The canonical named-gaps table (friction categories per level). */
export function renderLadderWaveBGapsTable(runs: readonly LadderWaveBRun[]): string {
  const header = "| Level | Capability | Friction | Detail |";
  const separator = "|---|---|---|---|";
  const rows: string[] = [];
  for (const entry of runs) {
    for (const gap of entry.run.record.gaps) {
      const detail = (gap.detail ?? "").replace(/\|/g, "/").replace(/\r?\n/g, " ");
      rows.push(`| ${entry.run.record.ladderLevel} | ${gap.capability} | ${gap.friction} | ${detail} |`);
    }
  }
  if (rows.length === 0) {
    rows.push("| — | — | — | no gaps recorded in the declared profiles |");
  }
  return [header, separator, ...rows].join("\n");
}

/** Canonical wave summary line (for the doc's scorecard section). */
export function renderLadderWaveBScorecardSummary(scorecard: IntegrationEffortScorecard): string {
  const aggregate = scorecard.aggregate;
  return [
    `- scorecardId: \`${scorecard.scorecardId}\``,
    `- runCount: ${aggregate.runCount}; distinctHosts: ${aggregate.distinctHosts}; distinctLevels: ${aggregate.distinctLevels}`,
    `- medianGlueLoc: ${aggregate.medianGlueLoc}; p95GlueLoc: ${aggregate.p95GlueLoc}`,
    `- medianFirstDecisionMs: ${aggregate.medianFirstDecisionMs}; medianFullLoopMs: ${aggregate.medianFullLoopMs}`,
    `- medianLatencyP50Ms: ${aggregate.medianLatencyP50Ms}; p95LatencyP95Ms: ${aggregate.p95LatencyP95Ms}`,
    `- meanCapabilityCoverageRatio: ${aggregate.meanCapabilityCoverageRatio.toFixed(3)}`,
    `- totalFailures: ${aggregate.totalFailures}; totalRetries: ${aggregate.totalRetries}`,
    `- recurringGaps (this wave only): ${scorecard.recurringGaps.length === 0 ? "none" : scorecard.recurringGaps.map((gap) => `${gap.capability}|${gap.friction} (domains ${gap.ladderLevels.join("+")}, runs ${gap.runCount}, platformUpgradeCandidate ${gap.platformUpgradeCandidate})`).join("; ")}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// The cross-wave 3-domain analysis (the Wave B mandate)
// ---------------------------------------------------------------------------

/**
 * Compose the CROSS-WAVE record set and group its gaps by
 * (capability, friction) across distinct ladder levels — the ladder's
 * 3-domain law evaluated over Wave A + Wave B together. The caller
 * supplies the Wave A level records (1–4, canonical), the SIM-003
 * integration-case records (5–8), and the Wave B records (9–12); the
 * aggregation is the SAME frozen machinery the scorecard uses, so the
 * register is the honest machine-checked trigger list.
 */
export function crossWaveRecurringGaps(recordGroups: {
  readonly waveALevels: readonly IntegrationEffortRecord[];
  readonly sim003IntegrationCases: readonly IntegrationEffortRecord[];
  readonly waveB: readonly IntegrationEffortRecord[];
}): readonly ScorecardRecurringGap[] {
  const records = [
    ...recordGroups.waveALevels,
    ...recordGroups.sim003IntegrationCases,
    ...recordGroups.waveB,
  ];
  if (records.length === 0) {
    throw new Error("crossWaveRecurringGaps: at least one record is required");
  }
  const scorecard = aggregateIntegrationEffortScorecard(records, {
    scorecardId: "scorecard-sim-004-cross-wave-analysis",
    generatedAt: Math.max(...records.map((record) => record.completedAt)),
  });
  return scorecard.recurringGaps;
}

/** The cross-wave 3-domain trigger register (machine-generated doc table). */
export function renderCrossWaveRecurringGapsTable(
  recurringGaps: readonly ScorecardRecurringGap[],
): string {
  const header = "| Capability | Friction | Domains (ladder levels) | Domain count | Run count | Platform-upgrade candidate |";
  const separator = "|---|---|---|---|---|---|";
  const rows = recurringGaps.map((gap) => {
    const detail = gap.ladderLevels.join(", ");
    return `| ${gap.capability} | ${gap.friction} | [${detail}] | ${gap.domainCount} | ${gap.runCount} | ${gap.platformUpgradeCandidate ? "TRUE" : "false"} |`;
  });
  if (rows.length === 0) {
    rows.push("| — | — | — | — | — | no recurring gaps |");
  }
  return [header, separator, ...rows].join("\n");
}
