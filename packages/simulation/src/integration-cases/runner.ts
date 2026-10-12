/**
 * SIM-003 — the integration-case runner (W2 lane).
 *
 * Runs ladder integration-case scenarios on the SIM-001 common harness and
 * aggregates the resulting `IntegrationEffortRecord`s into scorecards:
 *
 *   runIntegrationCase(scenario)     → one SimulationRunResult (+ the
 *                                      scenario host instance with its
 *                                      deterministic observation log)
 *   runIntegrationCaseSuite(scenarios) → every run + the wave scorecard
 *
 * Conventions (frozen for SIM-003, documented in
 * docs/simulations/integration-cases/README.md):
 * - the seed of a scenario run is DERIVED from (level, scenarioId) via the
 *   harness's own `deriveSeed` — documented, deterministic, reproducible;
 * - every run uses the scripted fixture responder (`createFixtureReckonPort`)
 *   ⇒ evidence class `fixture` (never observed evidence);
 * - the suite scorecard's `generatedAt` is the max `completedAt` of the
 *   contributing records (a pure function of the runs — deterministic).
 */
import {
  aggregateIntegrationEffortScorecard,
} from "../harness/scorecard.js";
import { createFixtureReckonPort } from "../harness/responder.js";
import { runSimulation, type SimulationRunResult } from "../harness/driver.js";
import type { ReckonPublicPort } from "../harness/port.js";
import type { ReckonCompleteProfileDeclarationInput } from "@reckon/contracts";
import type { IntegrationEffortRecord, IntegrationEffortScorecard } from "@reckon/contracts";
import { deriveSeed } from "../rng.js";
import type { ScenarioHostInstance } from "./scenario.js";

/** The ladder levels owned by the SIM-003 integration-case wave. */
export type IntegrationCaseLevel = 5 | 6 | 7 | 8;

/** The integration archetypes a scenario may exercise (the W2 work-order set). */
export const INTEGRATION_CASE_ARCHETYPES = [
  "interruption",
  "switching",
  "resume",
  "replan",
] as const;
export type IntegrationCaseArchetype = (typeof INTEGRATION_CASE_ARCHETYPES)[number];

/**
 * One integration-case scenario definition — a level, a scenario id, the
 * fresh-host factory, the target profile, and the run configuration.
 */
export interface IntegrationCaseScenario {
  /** The ladder level (5 media · 6 ad-supported media · 7 marketplace · 8 travel/booking). */
  readonly level: IntegrationCaseLevel;
  /** Stable scenario id, e.g. "switching", "pacing", "uncertain-inventory". */
  readonly scenarioId: string;
  readonly description: string;
  /** The integration archetypes this scenario exercises. */
  readonly archetypes: readonly IntegrationCaseArchetype[];
  /** Fresh host per run (independent observation log; identical behavior). */
  readonly createHost: () => ScenarioHostInstance;
  /** The profile this run targets (baseline or capability probe). */
  readonly profile: ReckonCompleteProfileDeclarationInput;
  /** Decision-loop steps (must equal the script's step count). */
  readonly steps: number;
  /** Derived from (level, scenarioId) when omitted. */
  readonly seed?: string;
  /** Injected transport-fault rate (resilience runs; default 0). */
  readonly faultRate?: number;
  /** Retry budget after the first attempt (default 2). */
  readonly maxRetries?: number;
  /** The honest completion expectation (probe runs declare false). */
  readonly expectReckonComplete: boolean;
}

/** The documented, deterministic seed derivation for a scenario run. */
export function integrationCaseSeed(level: number, scenarioId: string): string {
  return deriveSeed("sim-003", level, scenarioId);
}

/** One executed scenario: the definition, the host instance, the run. */
export interface IntegrationCaseRun {
  readonly scenario: IntegrationCaseScenario;
  readonly instance: ScenarioHostInstance;
  readonly run: SimulationRunResult;
}

export interface IntegrationCaseRunOptions {
  /** The Reckon public-surface port (default: the scripted fixture responder). */
  readonly port?: ReckonPublicPort;
}

/** Run one integration-case scenario on the common harness. */
export async function runIntegrationCase(
  scenario: IntegrationCaseScenario,
  options?: IntegrationCaseRunOptions,
): Promise<IntegrationCaseRun> {
  const port = options?.port ?? createFixtureReckonPort().port;
  const instance = scenario.createHost();
  const run = await runSimulation(
    {
      seed: scenario.seed ?? integrationCaseSeed(scenario.level, scenario.scenarioId),
      port,
      faultRate: scenario.faultRate ?? 0,
      maxRetries: scenario.maxRetries ?? 2,
      clock: { startMs: 0, stepMs: 1_000 },
    },
    { host: instance.host, profile: scenario.profile, steps: scenario.steps },
  );
  return { scenario, instance, run };
}

export interface IntegrationCaseSuiteResult {
  readonly runs: readonly IntegrationCaseRun[];
  readonly records: readonly IntegrationEffortRecord[];
  readonly scorecard: IntegrationEffortScorecard;
}

export interface IntegrationCaseSuiteOptions extends IntegrationCaseRunOptions {
  readonly scorecardId: string;
}

/**
 * Run a suite of integration-case scenarios and aggregate the records into
 * a sealed scorecard (the 3-domain recurring-gap law applies to the whole
 * suite). `generatedAt` = max record completedAt — deterministic.
 */
export async function runIntegrationCaseSuite(
  scenarios: readonly IntegrationCaseScenario[],
  options: IntegrationCaseSuiteOptions,
): Promise<IntegrationCaseSuiteResult> {
  if (scenarios.length === 0) {
    throw new Error("runIntegrationCaseSuite: at least one scenario is required");
  }
  const runs: IntegrationCaseRun[] = [];
  for (const scenario of scenarios) {
    runs.push(await runIntegrationCase(scenario, options));
  }
  const records = runs.map((run) => run.run.record);
  const generatedAt = records.reduce((max, record) => Math.max(max, record.completedAt), 0);
  const scorecard = aggregateIntegrationEffortScorecard(records, {
    scorecardId: options.scorecardId,
    generatedAt,
  });
  return { runs, records, scorecard };
}
