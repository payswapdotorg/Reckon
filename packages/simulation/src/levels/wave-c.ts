/**
 * SIM-005 — Wave C-1 (W1): the canonical fixture runs for ladder
 * Levels 13–16 (healthcare information, education, B2B SaaS
 * workspace, enterprise workflow orchestration), the wave scorecard,
 * the CROSS-WAVE 3-domain recurring-gap analysis extended through
 * Wave C, and the machine-generated evidence tables embedded in
 * docs/simulations/sim-005-levels-13-16.md.
 *
 * DETERMINISM CONTRACT: the canonical fixtures fix (seed, steps, fault
 * config, clock) per level. The same fixture + a fresh host factory ⇒
 * byte-identical IntegrationEffortRecords, verdicts, and call logs.
 * The markdown tables below are PURE functions of those runs — the
 * doc-drift gate (tests/conformance/fixtures/ladder-wave-c.test.ts)
 * re-renders them and compares them against the marked sections of
 * the report doc, so the documented numbers can never silently drift
 * from the measured ones.
 *
 * THE 3-DOMAIN LAW (through Wave C): the ladder law — "When the same
 * gap appears in at least three domains, upgrade the common platform
 * primitive and replay earlier levels" — is evaluated on the
 * CROSS-WAVE record set (Wave A levels 1–8 + Wave B levels 9–12 +
 * Wave C levels 13–16). `crossWaveRecurringGapsThroughWaveC` composes
 * the Wave A canonical records (levels 1–4, SIM-002) + the SIM-003
 * integration-case records (levels 5–8) + the Wave B canonical
 * records (levels 9–12, SIM-004) + the Wave C canonical records
 * (levels 13–16, SIM-005), then groups every record gap by
 * (capability, friction) across DISTINCT ladder levels using the SAME
 * frozen scorecard machinery (`aggregateIntegrationEffortScorecard` —
 * the union-compatible aggregation: Wave C records join Waves A+B
 * without altering their entries; the composition is strictly
 * additive). The expected register after Wave C:
 * - context-snapshots|API_GAP {2, 4, 10} — the existing Wave-B
 *   candidate (unchanged; Wave C declares no context-snapshots gap);
 * - plan-management|COMPOSITION_GAP {5, 8, 9, 14, 16} — the existing
 *   candidate gains the education (14) and enterprise-workflow (16)
 *   domains;
 * - evidence-retrieval|COMPOSITION_GAP {12, 13, 16} — finance (12) +
 *   healthcare (13) + enterprise workflow (16): the NEW 3-domain
 *   trigger recorded by this wave (domainCount 3 ⇒ candidate true).
 * SIM-005 records the candidates; it does NOT upgrade the platform
 * (that is SIM-008/TL3 via the Architecture Change Record process).
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
  createLevel13HealthcareHost,
  level13HealthcareProfile,
  level13HealthcareMeta,
} from "./level-13-healthcare.js";
import {
  createLevel14EducationHost,
  level14EducationProfile,
  level14EducationMeta,
} from "./level-14-education.js";
import {
  createLevel15B2bSaasHost,
  level15B2bSaasProfile,
  level15B2bSaasMeta,
} from "./level-15-b2b-saas.js";
import {
  createLevel16EnterpriseWorkflowHost,
  level16EnterpriseWorkflowProfile,
  level16EnterpriseWorkflowMeta,
} from "./level-16-enterprise-workflow.js";

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
export const LADDER_WAVE_C_ENSEMBLE_SEEDS: readonly string[] = ["7714", "8825", "9936"] as const;

/** The canonical Wave C-1 fixtures (Levels 13–16; zero injected faults). */
export const LADDER_WAVE_C_FIXTURES: readonly LadderLevelFixture[] = [
  { level: 13, name: "Healthcare information", seed: "2113", steps: 7, faultRate: 0, maxRetries: 2, clock: { startMs: 0, stepMs: 1000 } },
  { level: 14, name: "Education", seed: "2114", steps: 9, faultRate: 0, maxRetries: 2, clock: { startMs: 0, stepMs: 1000 } },
  { level: 15, name: "B2B SaaS workspace", seed: "2115", steps: 8, faultRate: 0, maxRetries: 2, clock: { startMs: 0, stepMs: 1000 } },
  { level: 16, name: "Enterprise workflow orchestration", seed: "2116", steps: 10, faultRate: 0, maxRetries: 2, clock: { startMs: 0, stepMs: 1000 } },
] as const;

/** The wave-C level case registry entry (profile + host factory + metadata). */
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

/** The four Wave C-1 level cases, ordered by ladder level. */
export const LADDER_WAVE_C_CASES = [
  {
    level: 13,
    name: "Healthcare information",
    profileInput: level13HealthcareProfile,
    createHost: createLevel13HealthcareHost,
    meta: level13HealthcareMeta,
  },
  {
    level: 14,
    name: "Education",
    profileInput: level14EducationProfile,
    createHost: createLevel14EducationHost,
    meta: level14EducationMeta,
  },
  {
    level: 15,
    name: "B2B SaaS workspace",
    profileInput: level15B2bSaasProfile,
    createHost: createLevel15B2bSaasHost,
    meta: level15B2bSaasMeta,
  },
  {
    level: 16,
    name: "Enterprise workflow orchestration",
    profileInput: level16EnterpriseWorkflowProfile,
    createHost: createLevel16EnterpriseWorkflowHost,
    meta: level16EnterpriseWorkflowMeta,
  },
] as const;

/** One canonical level run (record + verdict + scorecard-facing fields). */
export interface LadderWaveCRun {
  readonly fixture: LadderLevelFixture;
  readonly run: SimulationRunResult;
  readonly profile: ReckonCompleteProfileDeclaration;
}

/** The canonical Wave C-1 result: four runs + the sealed scorecard. */
export interface LadderWaveCResult {
  readonly runs: readonly LadderWaveCRun[];
  readonly scorecard: IntegrationEffortScorecard;
  readonly markdownTable: string;
  readonly markdownGapsTable: string;
}

/** Run one canonical level fixture (fresh host ⇒ deterministic). */
export async function runLadderWaveCLevelFixture(
  fixture: LadderLevelFixture,
  seedOverride?: string,
): Promise<LadderWaveCRun> {
  const caseEntry = LADDER_WAVE_C_CASES.find((entry) => entry.level === fixture.level);
  if (caseEntry === undefined) {
    throw new Error(`runLadderWaveCLevelFixture: unknown ladder level ${fixture.level}`);
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

/** Run the canonical Wave C-1 (Levels 13–16) + aggregate the wave scorecard. */
export async function runCanonicalLadderWaveC(): Promise<LadderWaveCResult> {
  const runs: LadderWaveCRun[] = [];
  for (const fixture of LADDER_WAVE_C_FIXTURES) {
    runs.push(await runLadderWaveCLevelFixture(fixture));
  }
  const records: IntegrationEffortRecord[] = runs.map((entry) => entry.run.record);
  const generatedAt = Math.max(...records.map((record) => record.completedAt));
  const scorecard = aggregateIntegrationEffortScorecard(records, {
    scorecardId: "scorecard-sim-005-wave-c",
    generatedAt,
  });
  return {
    runs,
    scorecard,
    markdownTable: renderLadderWaveCMarkdownTable(runs),
    markdownGapsTable: renderLadderWaveCGapsTable(runs),
  };
}

function formatCoverage(record: IntegrationEffortRecord): string {
  const { satisfied, required } = record.capabilityCoverage;
  const ratio = required === 0 ? 0 : satisfied / required;
  return `${satisfied}/${required} (${ratio.toFixed(3)})`;
}

/** The canonical evidence table (pure function of the canonical runs). */
export function renderLadderWaveCMarkdownTable(runs: readonly LadderWaveCRun[]): string {
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
export function renderLadderWaveCGapsTable(runs: readonly LadderWaveCRun[]): string {
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
export function renderLadderWaveCScorecardSummary(scorecard: IntegrationEffortScorecard): string {
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
// The cross-wave 3-domain analysis, extended through Wave C
// ---------------------------------------------------------------------------

/**
 * Compose the CROSS-WAVE record set through Wave C and group its gaps
 * by (capability, friction) across distinct ladder levels — the
 * ladder's 3-domain law evaluated over Wave A (levels 1–8: the SIM-002
 * canonical levels 1–4 + the SIM-003 integration cases 5–8) + Wave B
 * (levels 9–12) + Wave C (levels 13–16) together. The aggregation is
 * the SAME frozen machinery the scorecard uses, so the register is the
 * honest machine-checked trigger list — and the composition is purely
 * additive: the Waves A+B entries keep their domains and run counts,
 * Wave C records only JOIN them.
 */
export function crossWaveRecurringGapsThroughWaveC(recordGroups: {
  readonly waveALevels: readonly IntegrationEffortRecord[];
  readonly sim003IntegrationCases: readonly IntegrationEffortRecord[];
  readonly waveB: readonly IntegrationEffortRecord[];
  readonly waveC: readonly IntegrationEffortRecord[];
}): readonly ScorecardRecurringGap[] {
  const records = [
    ...recordGroups.waveALevels,
    ...recordGroups.sim003IntegrationCases,
    ...recordGroups.waveB,
    ...recordGroups.waveC,
  ];
  if (records.length === 0) {
    throw new Error("crossWaveRecurringGapsThroughWaveC: at least one record is required");
  }
  const scorecard = aggregateIntegrationEffortScorecard(records, {
    scorecardId: "scorecard-sim-005-cross-wave-through-wave-c",
    generatedAt: Math.max(...records.map((record) => record.completedAt)),
  });
  return scorecard.recurringGaps;
}

/** The cross-wave 3-domain trigger register through Wave C (machine-generated doc table). */
export function renderCrossWaveRecurringGapsThroughWaveCTable(
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
