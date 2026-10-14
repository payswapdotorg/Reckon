/**
 * SIM-006 — Wave C: the canonical fixture runs for ladder Levels 17–20
 * (W2's wave per the ladder doc's parallel waves: "Wave C: … W2 Levels
 * 17–20 agent/runtime behavior"), the wave scorecard, and the
 * machine-generated evidence tables embedded in the SIM-006 case docs.
 *
 * DETERMINISM CONTRACT: the canonical fixtures fix (seed, steps, fault
 * config, clock) per level. The same fixture + a fresh host factory ⇒
 * byte-identical IntegrationEffortRecords, verdicts, and call logs.
 * The markdown tables below are PURE functions of those runs.
 *
 * THE WAVE SHAPE: every level carries
 * - a CANONICAL baseline run (the standard 12-capability profile) that
 *   completes Reckon-Complete through the six standard-loop public
 *   operations — Level 20's canonical run additionally injects
 *   transport faults (faultRate 0.25, maxRetries 3) so provider
 *   failure/recovery is MEASURED, not asserted; and
 * - the level's law-mandated auxiliary runs:
 *   · Level 17: the MANDATORY single-agent baseline (architecture law:
 *     every multi-agent case carries its single-agent baseline run) +
 *     the agent-delegation capability probe (honest COMPOSITION_GAP);
 *   · Level 18: the webhook-delivery capability probe (realtime push is
 *     wanted but not composed — honest COMPOSITION_GAP);
 *   · Level 20: the capability-churn phase (manifest v1, preference
 *     provider outage — preference-feedback declared as an honest GAP,
 *     honestly incomplete; recovery = the canonical v2 run).
 *
 * THE 3-DOMAIN LAW: within this wave each named gap appears in exactly
 * one domain (agent-delegation|COMPOSITION_GAP at 17,
 * webhook-delivery|COMPOSITION_GAP at 18, preference-feedback|
 * ADAPTER_GAP at 20) — no new platform-upgrade candidate fires inside
 * Wave C alone. The cross-wave composition (Wave A 1–4 + SIM-003 5–8 +
 * Wave B 9–12 + W1's levels 13–16 + Wave C 17–20) is TL3/SIM-007's
 * reconciliation; the merged-wave candidates already on record
 * (context-snapshots|API_GAP, plan-management|COMPOSITION_GAP) are
 * unchanged by this wave.
 *
 * EVIDENCE HONESTY: every canonical and auxiliary run uses the scripted
 * fixture responder (createFixtureReckonPort) — evidenceClass
 * "fixture". The wave scorecard therefore aggregates fixture-class
 * evidence only and can never present itself as production evidence.
 */
import { runSimulation } from "../harness/driver.js";
import { createFixtureReckonPort } from "../harness/responder.js";
import { aggregateIntegrationEffortScorecard } from "../harness/scorecard.js";
import type { SimulationRunResult } from "../harness/driver.js";
import type {
  IntegrationEffortRecord,
  IntegrationEffortScorecard,
  ReckonCompleteProfileDeclarationInput,
} from "@reckon/contracts";
import { finalizeReckonCompleteProfile, type ReckonCompleteProfileDeclaration } from "@reckon/contracts";
import type { SimulationHostAdapter } from "../harness/host-adapter.js";
import {
  createLevel17MultiAgentHost,
  level17MultiAgentProfile,
  level17MultiAgentMeta,
  createLevel17SingleAgentBaselineHost,
  level17SingleAgentBaselineProfile,
  createLevel17AgentDelegationProbeHost,
  level17AgentDelegationProbeProfile,
} from "./level-17-multi-agent.js";
import {
  createLevel18MultiSurfaceHost,
  level18MultiSurfaceProfile,
  level18MultiSurfaceMeta,
  createLevel18WebhookDeliveryProbeHost,
  level18WebhookDeliveryProbeProfile,
} from "./level-18-multi-surface.js";
import {
  createLevel19ResourceConstrainedHost,
  level19ResourceConstrainedProfile,
  level19ResourceConstrainedMeta,
} from "./level-19-resource-constrained.js";
import {
  createLevel20StormwatchHost,
  level20AdversarialProfile,
  level20AdversarialMeta,
} from "./level-20-adversarial.js";

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
export const LADDER_WAVE_D_ENSEMBLE_SEEDS: readonly string[] = ["7744", "8855", "9966"] as const;

/**
 * The canonical Wave C fixtures (Levels 17–20). Level 20's canonical run
 * injects transport faults (the adversarial level: provider failure and
 * recovery are MEASURED through the harness's own fault injection).
 */
export const LADDER_WAVE_D_FIXTURES: readonly LadderLevelFixture[] = [
  { level: 17, name: "Multi-agent operations", seed: "2117", steps: 8, faultRate: 0, maxRetries: 2, clock: { startMs: 0, stepMs: 1000 } },
  { level: 18, name: "Multi-surface realtime system", seed: "2118", steps: 8, faultRate: 0, maxRetries: 2, clock: { startMs: 0, stepMs: 1000 } },
  { level: 19, name: "Resource-constrained adaptive system", seed: "2119", steps: 8, faultRate: 0, maxRetries: 2, clock: { startMs: 0, stepMs: 1000 } },
  { level: 20, name: "Adversarial/uncertain environment", seed: "2120", steps: 8, faultRate: 0.25, maxRetries: 3, clock: { startMs: 0, stepMs: 1000 } },
] as const;

/** The wave-C level case registry entry (profile + host factory + metadata). */
interface LadderLevelCase {
  readonly level: number;
  readonly name: string;
  readonly profileInput: ReckonCompleteProfileDeclarationInput;
  readonly createHost: () => { readonly host: SimulationHostAdapter };
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

/** The four Wave C canonical level cases, ordered by ladder level. */
export const LADDER_WAVE_D_CASES = [
  {
    level: 17,
    name: "Multi-agent operations",
    profileInput: level17MultiAgentProfile,
    createHost: createLevel17MultiAgentHost,
    meta: level17MultiAgentMeta,
  },
  {
    level: 18,
    name: "Multi-surface realtime system",
    profileInput: level18MultiSurfaceProfile,
    createHost: createLevel18MultiSurfaceHost,
    meta: level18MultiSurfaceMeta,
  },
  {
    level: 19,
    name: "Resource-constrained adaptive system",
    profileInput: level19ResourceConstrainedProfile,
    createHost: createLevel19ResourceConstrainedHost,
    meta: level19ResourceConstrainedMeta,
  },
  {
    level: 20,
    name: "Adversarial/uncertain environment",
    profileInput: level20AdversarialProfile,
    createHost: createLevel20StormwatchHost,
    meta: level20AdversarialMeta,
  },
] as const;

/** The auxiliary run kinds a level's laws mandate. */
export type LadderWaveDAuxKind =
  | "single-agent-baseline"
  | "capability-probe"
  | "capability-churn";

/** One auxiliary wave-C case: the kind + the fixed deterministic inputs. */
export interface LadderWaveDAuxCase {
  readonly kind: LadderWaveDAuxKind;
  readonly caseKey: string;
  readonly level: number;
  readonly name: string;
  readonly seed: string;
  readonly steps: number;
  readonly faultRate: number;
  readonly maxRetries: number;
  readonly clock: { readonly startMs: number; readonly stepMs: number };
}

/** The law-mandated auxiliary cases (Level 17 baseline + probes + churn). */
export const LADDER_WAVE_D_AUX_CASES: readonly LadderWaveDAuxCase[] = [
  {
    kind: "single-agent-baseline",
    caseKey: "level17-single-agent-baseline",
    level: 17,
    name: "Multi-agent operations — mandatory single-agent baseline",
    seed: "2121",
    steps: 8,
    faultRate: 0,
    maxRetries: 2,
    clock: { startMs: 0, stepMs: 1000 },
  },
  {
    kind: "capability-probe",
    caseKey: "level17-probe-agent-delegation",
    level: 17,
    name: "Multi-agent operations — agent-delegation probe",
    seed: "2122",
    steps: 8,
    faultRate: 0,
    maxRetries: 2,
    clock: { startMs: 0, stepMs: 1000 },
  },
  {
    kind: "capability-probe",
    caseKey: "level18-probe-webhook-delivery",
    level: 18,
    name: "Multi-surface realtime system — webhook-delivery probe",
    seed: "2123",
    steps: 8,
    faultRate: 0,
    maxRetries: 2,
    clock: { startMs: 0, stepMs: 1000 },
  },
  {
    kind: "capability-churn",
    caseKey: "level20-churn-degraded",
    level: 20,
    name: "Adversarial/uncertain environment — churn phase (manifest v1)",
    seed: "2124",
    steps: 8,
    faultRate: 0,
    maxRetries: 2,
    clock: { startMs: 0, stepMs: 1000 },
  },
] as const;

/** One canonical level run (record + verdict + scorecard-facing fields). */
export interface LadderWaveDRun {
  readonly fixture: LadderLevelFixture;
  readonly run: SimulationRunResult;
  readonly profile: ReckonCompleteProfileDeclaration;
}

/** One auxiliary level run (baseline / probe / churn phase). */
export interface LadderWaveDAuxRun {
  readonly auxCase: LadderWaveDAuxCase;
  readonly run: SimulationRunResult;
  readonly profile: ReckonCompleteProfileDeclaration;
}

/** The canonical Wave C result: four runs + aux runs + the sealed scorecard. */
export interface LadderWaveDResult {
  readonly runs: readonly LadderWaveDRun[];
  readonly auxRuns: readonly LadderWaveDAuxRun[];
  readonly scorecard: IntegrationEffortScorecard;
  readonly markdownTable: string;
  readonly markdownGapsTable: string;
  readonly markdownAuxTable: string;
}

/** Run one canonical level fixture (fresh host ⇒ deterministic). */
export async function runLadderWaveDLevelFixture(
  fixture: LadderLevelFixture,
  seedOverride?: string,
): Promise<LadderWaveDRun> {
  const caseEntry = LADDER_WAVE_D_CASES.find((entry) => entry.level === fixture.level);
  if (caseEntry === undefined) {
    throw new Error(`runLadderWaveDLevelFixture: unknown ladder level ${fixture.level}`);
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

/** The host + profile an auxiliary case runs (kind-dispatched). */
function auxHostAndProfile(
  auxCase: LadderWaveDAuxCase,
): {
  readonly profileInput: ReckonCompleteProfileDeclarationInput;
  readonly createHost: () => { readonly host: SimulationHostAdapter };
} {
  switch (auxCase.caseKey) {
    case "level17-single-agent-baseline":
      return {
        profileInput: level17SingleAgentBaselineProfile,
        createHost: createLevel17SingleAgentBaselineHost,
      };
    case "level17-probe-agent-delegation":
      return {
        profileInput: level17AgentDelegationProbeProfile,
        createHost: createLevel17AgentDelegationProbeHost,
      };
    case "level18-probe-webhook-delivery":
      return {
        profileInput: level18WebhookDeliveryProbeProfile,
        createHost: createLevel18WebhookDeliveryProbeHost,
      };
    case "level20-churn-degraded":
      return {
        profileInput: level20AdversarialProfile,
        createHost: () => createLevel20StormwatchHost({ capabilityPhase: "degraded" }),
      };
    default:
      throw new Error(`runLadderWaveDAuxCase: unknown auxiliary case key ${auxCase.caseKey}`);
  }
}

/** Run one auxiliary case (baseline / probe / churn phase). */
export async function runLadderWaveDAuxCase(
  auxCase: LadderWaveDAuxCase,
  seedOverride?: string,
): Promise<LadderWaveDAuxRun> {
  const { profileInput, createHost } = auxHostAndProfile(auxCase);
  const profile = finalizeReckonCompleteProfile(profileInput);
  const { host } = createHost();
  const run = await runSimulation(
    {
      seed: seedOverride ?? auxCase.seed,
      port: createFixtureReckonPort().port,
      faultRate: auxCase.faultRate,
      maxRetries: auxCase.maxRetries,
      clock: auxCase.clock,
    },
    { host, profile, steps: auxCase.steps },
  );
  return { auxCase, run, profile };
}

/** Run the canonical Wave C (Levels 17–20 + auxiliary cases + scorecard). */
export async function runCanonicalLadderWaveD(): Promise<LadderWaveDResult> {
  const runs: LadderWaveDRun[] = [];
  for (const fixture of LADDER_WAVE_D_FIXTURES) {
    runs.push(await runLadderWaveDLevelFixture(fixture));
  }
  const auxRuns: LadderWaveDAuxRun[] = [];
  for (const auxCase of LADDER_WAVE_D_AUX_CASES) {
    auxRuns.push(await runLadderWaveDAuxCase(auxCase));
  }
  const records: IntegrationEffortRecord[] = [
    ...runs.map((entry) => entry.run.record),
    ...auxRuns.map((entry) => entry.run.record),
  ];
  const generatedAt = Math.max(...records.map((record) => record.completedAt));
  const scorecard = aggregateIntegrationEffortScorecard(records, {
    scorecardId: "scorecard-sim-006-wave-c",
    generatedAt,
  });
  return {
    runs,
    auxRuns,
    scorecard,
    markdownTable: renderLadderWaveDMarkdownTable(runs),
    markdownGapsTable: renderLadderWaveDGapsTable(runs, auxRuns),
    markdownAuxTable: renderLadderWaveDAuxTable(auxRuns),
  };
}

function formatCoverage(record: IntegrationEffortRecord): string {
  const { satisfied, required } = record.capabilityCoverage;
  const ratio = required === 0 ? 0 : satisfied / required;
  return `${satisfied}/${required} (${ratio.toFixed(3)})`;
}

/** The canonical evidence table (pure function of the canonical runs). */
export function renderLadderWaveDMarkdownTable(runs: readonly LadderWaveDRun[]): string {
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

/** The named-gaps table over ALL wave-C records (canonical + auxiliary). */
export function renderLadderWaveDGapsTable(
  runs: readonly LadderWaveDRun[],
  auxRuns: readonly LadderWaveDAuxRun[],
): string {
  const header = "| Level | Run | Capability | Friction | Detail |";
  const separator = "|---|---|---|---|---|";
  const rows: string[] = [];
  for (const entry of runs) {
    for (const gap of entry.run.record.gaps) {
      const detail = (gap.detail ?? "").replace(/\|/g, "/").replace(/\r?\n/g, " ");
      rows.push(`| ${entry.run.record.ladderLevel} | canonical | ${gap.capability} | ${gap.friction} | ${detail} |`);
    }
  }
  for (const entry of auxRuns) {
    for (const gap of entry.run.record.gaps) {
      const detail = (gap.detail ?? "").replace(/\|/g, "/").replace(/\r?\n/g, " ");
      rows.push(`| ${entry.run.record.ladderLevel} | ${entry.auxCase.kind} | ${gap.capability} | ${gap.friction} | ${detail} |`);
    }
  }
  if (rows.length === 0) {
    rows.push("| — | — | — | — | no gaps recorded in the declared profiles |");
  }
  return [header, separator, ...rows].join("\n");
}

/** The auxiliary-runs table (baselines, probes, churn — the honest tiers). */
export function renderLadderWaveDAuxTable(auxRuns: readonly LadderWaveDAuxRun[]): string {
  const header =
    "| Level | Kind | Case | Host adapter | Steps | Seed | Verdict (satisfied/partial/missing) | Reckon-Complete | Record gaps |";
  const separator = "|---|---|---|---|---|---|---|---|---|";
  const rows = auxRuns.map((entry) => {
    const record = entry.run.record;
    const gaps =
      record.gaps.length === 0
        ? "—"
        : record.gaps.map((gap) => `${gap.capability}|${gap.friction}`).join("; ");
    return `| ${record.ladderLevel} | ${entry.auxCase.kind} | ${entry.auxCase.caseKey} | ${record.hostAdapterId} | ${entry.auxCase.steps} | ${entry.auxCase.seed} | ${record.capabilityCoverage.satisfied}/${record.capabilityCoverage.partial}/${record.capabilityCoverage.missing} | ${entry.run.reckonComplete ? "YES" : "NO"} | ${gaps} |`;
  });
  return [header, separator, ...rows].join("\n");
}

/** The per-level case-doc sections (machine-generated evidence slices). */
export interface LadderWaveDLevelDocTables {
  /** The canonical evidence table (header + this level's row). */
  readonly canonical: string;
  /** The auxiliary-runs table for this level ("" when none). */
  readonly aux: string;
  /** The named-gaps table for this level ("" when none). */
  readonly gaps: string;
}

/**
 * The per-level slices embedded in the SIM-006 case docs
 * (docs/simulations/integration-cases/level17-20-*.md) — pure functions
 * of the canonical + auxiliary runs, byte-verified by the conformance
 * doc-drift gate.
 */
export function renderLadderWaveDLevelDocTables(
  runs: readonly LadderWaveDRun[],
  auxRuns: readonly LadderWaveDAuxRun[],
  level: number,
): LadderWaveDLevelDocTables {
  const levelRuns = runs.filter((entry) => entry.run.record.ladderLevel === level);
  if (levelRuns.length === 0) {
    throw new Error(`renderLadderWaveDLevelDocTables: no canonical run for level ${level}`);
  }
  const canonical = renderLadderWaveDMarkdownTable(levelRuns);
  const levelAux = auxRuns.filter((entry) => entry.run.record.ladderLevel === level);
  const aux = levelAux.length === 0 ? "" : renderLadderWaveDAuxTable(levelAux);
  const gapRows: string[] = [];
  for (const entry of levelRuns) {
    for (const gap of entry.run.record.gaps) {
      const detail = (gap.detail ?? "").replace(/\|/g, "/").replace(/\r?\n/g, " ");
      gapRows.push(`| ${level} | canonical | ${gap.capability} | ${gap.friction} | ${detail} |`);
    }
  }
  for (const entry of levelAux) {
    for (const gap of entry.run.record.gaps) {
      const detail = (gap.detail ?? "").replace(/\|/g, "/").replace(/\r?\n/g, " ");
      gapRows.push(`| ${level} | ${entry.auxCase.kind} | ${gap.capability} | ${gap.friction} | ${detail} |`);
    }
  }
  const gaps =
    gapRows.length === 0
      ? ""
      : ["| Level | Run | Capability | Friction | Detail |", "|---|---|---|---|---|", ...gapRows].join("\n");
  return { canonical, aux, gaps };
}

/** Canonical wave summary line (for the scorecard doc section). */
export function renderLadderWaveDScorecardSummary(scorecard: IntegrationEffortScorecard): string {
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
