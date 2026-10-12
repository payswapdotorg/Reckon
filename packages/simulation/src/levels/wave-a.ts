/**
 * SIM-002 — Wave A: the canonical fixture runs for ladder Levels 1–4
 * (W1's wave per the ladder doc's parallel waves: "Wave A: W1 Levels
 * 1–4"), the wave scorecard, and the machine-generated evidence table
 * embedded in docs/simulations/sim-002-levels-1-4.md.
 *
 * DETERMINISM CONTRACT: the canonical fixtures fix (seed, steps, fault
 * config, clock) per level. The same fixture + a fresh host factory ⇒
 * byte-identical IntegrationEffortRecords, verdicts, and call logs.
 * The markdown table below is a PURE function of those runs — the
 * doc-drift gate (tests/conformance/fixtures/ladder-wave-a.test.ts) re-renders
 * it and compares it against the marked section of the report doc, so
 * the documented numbers can never silently drift from the measured ones.
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
import type { IntegrationEffortRecord, IntegrationEffortScorecard, ReckonCompleteProfileDeclarationInput } from "@reckon/contracts";
import { finalizeReckonCompleteProfile, type ReckonCompleteProfileDeclaration } from "@reckon/contracts";
import {
  createLevel1StaticCatalogHost,
  level1StaticCatalogProfile,
  level1StaticCatalogMeta,
} from "./level-1-static-catalog.js";
import {
  createLevel2ContentFeedHost,
  level2ContentFeedProfile,
  level2ContentFeedMeta,
} from "./level-2-content-feed.js";
import {
  createLevel3StorefrontHost,
  level3StorefrontProfile,
  level3StorefrontMeta,
} from "./level-3-storefront.js";
import {
  createLevel4NotificationsHost,
  level4NotificationsProfile,
  level4NotificationsMeta,
} from "./level-4-notifications.js";

/** One canonical ladder-level fixture: the fixed deterministic inputs. */
export interface LadderLevelFixture {
  readonly level: number;
  readonly name: string;
  readonly seed: string;
  readonly steps: number;
  readonly faultRate: number;
  readonly maxRetries: number;
  readonly clock: { readonly startMs: number; readonly stepMs: number };
}

/** Ensemble seeds for aggregate-stability fixtures (3 seeds × 4 levels). */
export const LADDER_WAVE_A_ENSEMBLE_SEEDS: readonly string[] = ["1101", "2211", "3322"] as const;

/** The canonical Wave A fixtures (Levels 1–4; zero injected faults). */
export const LADDER_WAVE_A_FIXTURES: readonly LadderLevelFixture[] = [
  { level: 1, name: "Static catalog picker", seed: "1101", steps: 5, faultRate: 0, maxRetries: 2, clock: { startMs: 0, stepMs: 1000 } },
  { level: 2, name: "Simple content feed", seed: "1102", steps: 8, faultRate: 0, maxRetries: 2, clock: { startMs: 0, stepMs: 1000 } },
  { level: 3, name: "E-commerce storefront", seed: "1103", steps: 6, faultRate: 0, maxRetries: 2, clock: { startMs: 0, stepMs: 1000 } },
  { level: 4, name: "Notification system", seed: "1104", steps: 9, faultRate: 0, maxRetries: 2, clock: { startMs: 0, stepMs: 1000 } },
] as const;

/** The wave-A level case registry entry (profile + host factory + metadata). */
export interface LadderLevelCase {
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

/** The four Wave A level cases, ordered by ladder level. */
export const LADDER_WAVE_A_CASES = [
  {
    level: 1,
    name: "Static catalog picker",
    profileInput: level1StaticCatalogProfile,
    createHost: createLevel1StaticCatalogHost,
    meta: level1StaticCatalogMeta,
  },
  {
    level: 2,
    name: "Simple content feed",
    profileInput: level2ContentFeedProfile,
    createHost: createLevel2ContentFeedHost,
    meta: level2ContentFeedMeta,
  },
  {
    level: 3,
    name: "E-commerce storefront",
    profileInput: level3StorefrontProfile,
    createHost: createLevel3StorefrontHost,
    meta: level3StorefrontMeta,
  },
  {
    level: 4,
    name: "Notification system",
    profileInput: level4NotificationsProfile,
    createHost: createLevel4NotificationsHost,
    meta: level4NotificationsMeta,
  },
] as const;

/** One canonical level run (record + verdict + scorecard-facing fields). */
export interface LadderWaveRun {
  readonly fixture: LadderLevelFixture;
  readonly run: SimulationRunResult;
  readonly profile: ReckonCompleteProfileDeclaration;
}

/** The canonical Wave A result: four runs + the sealed scorecard. */
export interface LadderWaveAResult {
  readonly runs: readonly LadderWaveRun[];
  readonly scorecard: IntegrationEffortScorecard;
  readonly markdownTable: string;
  readonly markdownGapsTable: string;
}

/** Run one canonical level fixture (fresh host ⇒ deterministic). */
export async function runLadderLevelFixture(
  fixture: LadderLevelFixture,
  seedOverride?: string,
): Promise<LadderWaveRun> {
  const caseEntry = LADDER_WAVE_A_CASES.find((entry) => entry.level === fixture.level);
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

/** Run the canonical Wave A (Levels 1–4) + aggregate the wave scorecard. */
export async function runCanonicalLadderWaveA(): Promise<LadderWaveAResult> {
  const runs: LadderWaveRun[] = [];
  for (const fixture of LADDER_WAVE_A_FIXTURES) {
    runs.push(await runLadderLevelFixture(fixture));
  }
  const records: IntegrationEffortRecord[] = runs.map((entry) => entry.run.record);
  const generatedAt = Math.max(...records.map((record) => record.completedAt));
  const scorecard = aggregateIntegrationEffortScorecard(records, {
    scorecardId: "scorecard-sim-002-wave-a",
    generatedAt,
  });
  return {
    runs,
    scorecard,
    markdownTable: renderLadderWaveAMarkdownTable(runs),
    markdownGapsTable: renderLadderWaveAGapsTable(runs),
  };
}

function formatCoverage(record: IntegrationEffortRecord): string {
  const { satisfied, required } = record.capabilityCoverage;
  const ratio = required === 0 ? 0 : satisfied / required;
  return `${satisfied}/${required} (${ratio.toFixed(3)})`;
}

/** The canonical evidence table (pure function of the canonical runs). */
export function renderLadderWaveAMarkdownTable(runs: readonly LadderWaveRun[]): string {
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
export function renderLadderWaveAGapsTable(runs: readonly LadderWaveRun[]): string {
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
export function renderLadderWaveAScorecardSummary(scorecard: IntegrationEffortScorecard): string {
  const aggregate = scorecard.aggregate;
  return [
    `- scorecardId: \`${scorecard.scorecardId}\``,
    `- runCount: ${aggregate.runCount}; distinctHosts: ${aggregate.distinctHosts}; distinctLevels: ${aggregate.distinctLevels}`,
    `- medianGlueLoc: ${aggregate.medianGlueLoc}; p95GlueLoc: ${aggregate.p95GlueLoc}`,
    `- medianFirstDecisionMs: ${aggregate.medianFirstDecisionMs}; medianFullLoopMs: ${aggregate.medianFullLoopMs}`,
    `- medianLatencyP50Ms: ${aggregate.medianLatencyP50Ms}; p95LatencyP95Ms: ${aggregate.p95LatencyP95Ms}`,
    `- meanCapabilityCoverageRatio: ${aggregate.meanCapabilityCoverageRatio.toFixed(3)}`,
    `- totalFailures: ${aggregate.totalFailures}; totalRetries: ${aggregate.totalRetries}`,
    `- recurringGaps: ${scorecard.recurringGaps.length === 0 ? "none" : scorecard.recurringGaps.map((gap) => `${gap.capability}|${gap.friction} (domains ${gap.ladderLevels.join("+")}, runs ${gap.runCount}, platformUpgradeCandidate ${gap.platformUpgradeCandidate})`).join("; ")}`,
  ].join("\n");
}
