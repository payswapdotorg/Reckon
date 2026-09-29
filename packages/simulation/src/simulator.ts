/**
 * SequentialSimulator — deterministic sequential simulation kernel (W1-006).
 *
 * Steps a `WorldModelState` forward ONE (simulated) step at a time given
 * a chosen action, producing simulated `OutcomeEvent`s stamped with:
 * - `evidenceClass: "simulated"` (research class — NEVER observed;
 *   architecture-lock #20 / ADR-004),
 * - a MONOTONIC VIRTUAL simulation clock (kept inside the world state,
 *   completely separate from wall time — the simulator performs NO
 *   wall-clock reads; determinism is a pure function of seed + inputs),
 * - seed / configuration / rewardVersion recorded in the state.
 *
 * REPLAY DETERMINISM: same base seed + same action sequence ⇒
 * byte-identical event stream (the per-step RNG is derived from the
 * state seed and the step index via the documented `deriveSeed`).
 *
 * ENSEMBLES: `runEnsemble(state, action, n)` draws n deterministic
 * child seeds `deriveSeed(state.seed, "ensemble", i)` for
 * i ∈ {0, …, n−1} and replays the SAME action from the SAME state
 * under each child seed.
 *
 * REWARD LAW: reward is computed ONLY from a host-declared, versioned
 * `RewardSpec` (contracts.md #7 / lock #21-22) with explicit metric
 * bindings — there is NO default engagement reward. A world without a
 * declared reward yields `total: 0, terms: [], rewardVersion: "unset"`.
 *
 * ALTERNATE WORLDS: the `SimulatedOutcomeModel` seam below is defined
 * over contracts types + primitives ONLY, so the sequential RL
 * environment of @reckon/learning (W1-009) can implement it
 * STRUCTURALLY — composition via interface, not inheritance, wired at
 * the TL3-owned composition root (the frozen lockfile forbids a
 * workspace dependency here).
 */
import {
  OutcomeEventSchema,
  digestBytes,
  type Experience,
  type OutcomeEvent,
  type Provenance,
  type RewardSpec,
  type RewardTerm,
  type SubjectReference,
  type TenantScope,
  type TimestampMs,
} from "@reckon/contracts";
import { createRng, deriveSeed, type Rng, type SeedString } from "./rng.js";
import {
  createWorldModel,
  deepFreeze,
  type WorldModel,
  type WorldModelState,
} from "./world-model.js";
import {
  SimulationActionUnknownError,
  SimulationEpisodeClosedError,
  SimulationRewardBindingMissingError,
  SimulationValidationError,
  toSimulationIssues,
} from "./errors.js";

/** Version of the simulator kernel (recorded in step results). */
export const SIMULATOR_VERSION = "0.1.0";

/** Provenance stamped on every simulated event. */
export const SIMULATION_PROVENANCE: Provenance = Object.freeze({
  system: "@reckon/simulation",
  version: SIMULATOR_VERSION,
}) as Provenance;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** One simulator action. `present` requires an experience of the world. */
export type SimulatorAction =
  | { readonly kind: "present"; readonly experienceId: string }
  | { readonly kind: "hold" }
  | { readonly kind: "end" };

// ---------------------------------------------------------------------------
// Outcome-model seam (alternate worlds — structural, mirrorable)
// ---------------------------------------------------------------------------

/** Input to a `SimulatedOutcomeModel` (contracts types + primitives only). */
export interface SimulatedOutcomeModelInput {
  readonly action: SimulatorAction;
  /** The presented experience (present actions only). */
  readonly experience?: Experience;
  readonly tenant: TenantScope;
  readonly subject: SubjectReference;
  /** World context snapshot id (referenced by emitted events). */
  readonly contextId: string;
  /** Virtual step window: events must be stamped in [clockStart, clockEnd]. */
  readonly clockStart: TimestampMs;
  readonly clockEnd: TimestampMs;
  /** 1-based step index. */
  readonly step: number;
  /** Digest of the PRE-step world state (stable event-id derivation). */
  readonly stateDigest: string;
  /** Digest of the declared feature vector (world conditioning). */
  readonly featuresDigest: string;
  /** Whether stochastic components may draw noise (configuration flag). */
  readonly stochastic: boolean;
  /** Seeded RNG for this step (derived from state seed + step index). */
  readonly rng: Rng;
}

/** Output of a `SimulatedOutcomeModel`. */
export interface SimulatedOutcomeModelResult {
  /** Simulated events (evidenceClass "simulated", virtual timestamps). */
  readonly events: readonly OutcomeEvent[];
  /** Named metrics emitted this step (reward binding source). */
  readonly metrics: Readonly<Record<string, number>>;
  readonly modelVersion: string;
  /** World-internal termination signal (episode is over). */
  readonly terminated: boolean;
}

/**
 * The alternate-world seam. Implement this to plug a different world
 * (e.g. the W1-009 sequential RL environment) into the simulator.
 */
export interface SimulatedOutcomeModel {
  simulate(input: SimulatedOutcomeModelInput): SimulatedOutcomeModelResult;
}

// ---------------------------------------------------------------------------
// Default outcome model — documented NEUTRAL placeholder dynamics
// ---------------------------------------------------------------------------

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Default outcome model. DYNAMICS ARE A RESEARCH PLACEHOLDER, not a
 * product assumption: they generate plausible neutral outcome events
 * from DECLARED inputs only (experience objective-fit score, context
 * fatigue signals) plus seeded noise. They are NOT a reward: reward is
 * computed exclusively from the host-declared RewardSpec.
 */
export function createDefaultOutcomeModel(): SimulatedOutcomeModel {
  return {
    simulate(input: SimulatedOutcomeModelInput): SimulatedOutcomeModelResult {
      const { action, tenant, subject, clockStart, clockEnd, stateDigest, step, rng } = input;

      if (action.kind === "end") {
        return { events: [], metrics: {}, modelVersion: `${SIMULATOR_VERSION}/default`, terminated: true };
      }
      if (action.kind === "hold") {
        return {
          events: [],
          metrics: { "sim.hold": 1 },
          modelVersion: `${SIMULATOR_VERSION}/default`,
          terminated: false,
        };
      }

      const experience = input.experience!;
      const window = Math.max(0, clockEnd - clockStart);
      const event = (
        ordinal: number,
        eventType: OutcomeEvent["eventType"],
        occurredAt: TimestampMs,
        metrics: Readonly<Record<string, number>>
      ): OutcomeEvent => {
        const eventId = `sim-${digestBytes(`${stateDigest}|${step}|${eventType}|${ordinal}`).slice(0, 24)}`;
        return {
          schema: "reckon.outcome-event",
          schemaVersion: "0.1.0",
          eventId,
          tenant,
          subject,
          experienceId: experience.experienceId,
          eventType,
          occurredAt,
          context: { contextId: input.contextId },
          provenance: SIMULATION_PROVENANCE,
          evidenceClass: "simulated",
          metrics: { ...metrics },
          idempotencyKey: `sim:${stateDigest.slice(0, 16)}:${step}:${ordinal}`,
        };
      };

      // --- Neutral dynamics -------------------------------------------------
      // Declared objective fit (host metadata; 0.5 when absent).
      const declaredFit = experience.objectiveFit?.fitScore ?? 0.5;
      // With stochastic disabled the dynamics are a PURE function of the
      // declared inputs (no RNG draws at all — fully seed-independent).
      const noise = input.stochastic ? rng.nextNormal() * 0.05 : 0;
      const satisfaction = clamp01(declaredFit + noise);

      const startProbability = clamp01(0.3 + 0.6 * satisfaction);
      const started = input.stochastic
        ? rng.nextFloat() < startProbability
        : startProbability >= 0.5;
      const completed = input.stochastic
        ? started && rng.nextFloat() < satisfaction
        : started && satisfaction >= 0.5;

      const metrics: Record<string, number> = {
        "sim.impression": 1,
        "sim.satisfaction": round6(satisfaction),
        "sim.taskSuccess": completed ? 1 : 0,
        "sim.qualifiedEngagement": completed ? round6(satisfaction) : 0,
        "sim.completionFraction": completed ? 1 : started ? 0 : 0,
      };

      const events: OutcomeEvent[] = [
        event(1, "impression", clockStart, { "sim.impression": 1 }),
      ];
      if (started) {
        events.push(
          event(2, "start", clockStart + Math.floor(window * 0.25), { "sim.started": 1 })
        );
        events.push(
          completed
            ? event(3, "completion", clockStart + Math.floor(window * 0.75), {
                "sim.completed": 1,
                "sim.satisfaction": metrics["sim.satisfaction"]!,
              })
            : event(3, "abandonment", clockStart + Math.floor(window * 0.75), {
                "sim.abandoned": 1,
              })
        );
      }

      return {
        events,
        metrics,
        modelVersion: `${SIMULATOR_VERSION}/default`,
        terminated: false,
      };
    },
  };
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

// ---------------------------------------------------------------------------
// Reward computation (traceable, never engagement-by-default)
// ---------------------------------------------------------------------------

/** Metric name bound to each reward-term kind by the default binding. */
export const DEFAULT_REWARD_METRIC_BINDINGS: Readonly<
  Record<RewardTerm["kind"], string>
> = Object.freeze({
  "satisfaction-proxy": "sim.satisfaction",
  "task-success": "sim.taskSuccess",
  "qualified-engagement": "sim.qualifiedEngagement",
  conversion: "sim.conversion",
  revenue: "sim.revenue",
  retention: "sim.retention",
  "discovery-value": "sim.discoveryValue",
  serendipity: "sim.serendipity",
  continuity: "sim.continuity",
  "interruption-regret": "sim.interruptionRegret",
  "inference-cost": "sim.inferenceCost",
  latency: "sim.latency",
  bandwidth: "sim.bandwidth",
  "policy-risk": "sim.policyRisk",
  custom: "", // custom terms MUST bind via term.params.metric
});

export type RewardMetricBindings = Readonly<Partial<Record<RewardTerm["kind"], string>>>;

/** One computed reward term (fully traceable: spec + binding + value). */
export interface SimulatedRewardTerm {
  readonly termId: string;
  readonly kind: RewardTerm["kind"];
  readonly weight: number;
  /** Metric name the term was bound to. */
  readonly metric: string;
  /** Metric value this step (0 when the outcome model emitted no such metric). */
  readonly value: number;
  readonly contribution: number;
}

export interface SimulatedReward {
  readonly total: number;
  readonly terms: readonly SimulatedRewardTerm[];
  readonly rewardVersion: string;
}

function computeReward(
  reward: RewardSpec,
  metrics: Readonly<Record<string, number>>,
  bindings: RewardMetricBindings
): SimulatedReward {
  const terms: SimulatedRewardTerm[] = [];
  let total = 0;
  for (const term of reward.terms) {
    let metric: string;
    if (term.kind === "custom") {
      const paramMetric = term.params["metric"];
      if (typeof paramMetric !== "string" || paramMetric.length === 0) {
        throw new SimulationRewardBindingMissingError(term.termId, term.kind);
      }
      metric = paramMetric;
    } else {
      const bound = bindings[term.kind] ?? DEFAULT_REWARD_METRIC_BINDINGS[term.kind];
      if (bound === undefined || bound === "") {
        throw new SimulationRewardBindingMissingError(term.termId, term.kind);
      }
      metric = bound;
    }
    const value = metrics[metric] ?? 0;
    const contribution = term.weight * value;
    terms.push({ termId: term.termId, kind: term.kind, weight: term.weight, metric, value, contribution });
    total += contribution;
  }
  return {
    total: round6(total),
    terms,
    rewardVersion: `${reward.rewardId}@${reward.version}`,
  };
}

// ---------------------------------------------------------------------------
// Step result / ensemble
// ---------------------------------------------------------------------------

export interface SimulatedStepResult {
  /** The advanced world state (input state untouched). */
  readonly state: WorldModelState;
  /** Simulated events of this step (all evidenceClass "simulated"). */
  readonly events: readonly OutcomeEvent[];
  /** Traceable reward computed from the declared RewardSpec. */
  readonly reward: SimulatedReward;
  /** 1-based step index. */
  readonly step: number;
  /** Virtual clock AFTER the step. */
  readonly clock: TimestampMs;
  readonly action: SimulatorAction;
  readonly outcomeModelVersion: string;
  readonly terminated: boolean;
  readonly truncated: boolean;
}

export interface EnsembleRun {
  readonly seed: SeedString;
  readonly result: SimulatedStepResult;
}

export interface EnsembleResult {
  readonly runs: readonly EnsembleRun[];
  /** The derived child seeds, in order (documented derivation). */
  readonly seeds: readonly SeedString[];
  readonly rewardMean: number;
  /** Population variance over the runs. */
  readonly rewardVariance: number;
  readonly rewardStdDev: number;
  readonly eventCountTotal: number;
}

// ---------------------------------------------------------------------------
// SequentialSimulator port + implementation
// ---------------------------------------------------------------------------

export interface SequentialSimulator {
  /** Advance the world by one step. Deterministic in (state, action). */
  step(state: WorldModelState, action: SimulatorAction): SimulatedStepResult;
  /**
   * Replay `action` from `state` under n deterministic child seeds
   * `deriveSeed(state.seed, "ensemble", i)`, i ∈ {0, …, n−1}.
   */
  runEnsemble(state: WorldModelState, action: SimulatorAction, n: number): EnsembleResult;
}

export interface CreateSimulatorOptions {
  /** Alternate world (default: the neutral placeholder model). */
  readonly outcomeModel?: SimulatedOutcomeModel;
  /**
   * Host-declared reward spec. MUST match the world state's
   * `rewardVersion` (typed rejection otherwise): a stepped artifact
   * never mixes a reward spec the state was not built with.
   */
  readonly reward?: RewardSpec;
  /** Overrides of the default term-kind → metric bindings. */
  readonly rewardBindings?: RewardMetricBindings;
}

/** Create a deterministic sequential simulator. */
export function createSimulator(options: CreateSimulatorOptions = {}): SequentialSimulator {
  const outcomeModel = options.outcomeModel ?? createDefaultOutcomeModel();
  const worldModel: WorldModel = createWorldModel();
  const rewardBindings = options.rewardBindings ?? {};

  const stepOf = (state: WorldModelState, action: SimulatorAction): SimulatedStepResult => {
    if (state.stepCount >= state.configuration.maxSteps) {
      throw new SimulationEpisodeClosedError(
        `maxSteps (${state.configuration.maxSteps}) reached — reset the world model`
      );
    }

    // 1. Resolve the action against the world.
    let experience: Experience | undefined;
    if (action.kind === "present") {
      const found = state.experiences.find((e) => e.experienceId === action.experienceId);
      if (found === undefined) {
        throw new SimulationActionUnknownError(action.experienceId, state.stateDigest);
      }
      experience = found;
    }

    // 2. Reward-spec consistency (traceability law).
    const declaredVersion = state.rewardVersion;
    const simulatorVersion = options.reward
      ? `${options.reward.rewardId}@${options.reward.version}`
      : "unset";
    if (declaredVersion !== simulatorVersion) {
      throw new SimulationRewardBindingMissingError(
        `reward-version-mismatch(state=${declaredVersion},simulator=${simulatorVersion})`,
        "version"
      );
    }

    // 3. Deterministic per-step RNG.
    const step = state.stepCount + 1;
    const stepSeed = deriveSeed(
      state.seed,
      "step",
      step,
      action.kind,
      action.kind === "present" ? action.experienceId : ""
    );
    const rng = createRng(stepSeed);

    // 4. Virtual step window ("end" does not advance the clock).
    const clockStart = state.simulationClock;
    const clockEnd =
      action.kind === "end" ? clockStart : clockStart + state.configuration.stepDurationMs;

    // 5. Run the world.
    const world = outcomeModel.simulate({
      action,
      experience,
      tenant: state.tenant,
      subject: state.subject,
      contextId: state.contextSnapshot.contextId,
      clockStart,
      clockEnd,
      step,
      stateDigest: state.stateDigest,
      featuresDigest: state.features.digest,
      stochastic: state.configuration.stochastic,
      rng,
    });

    // 6. Validate the model output (defense in depth; the world-model
    //    advance re-validates everything too).
    for (const rawEvent of world.events) {
      const parsed = OutcomeEventSchema.safeParse(rawEvent);
      if (!parsed.success) {
        throw new SimulationValidationError(
          "outcome model emitted a schema-invalid event",
          toSimulationIssues(parsed.error),
          rawEvent
        );
      }
    }

    // 7. Reward from the declared spec only.
    const reward: SimulatedReward = options.reward
      ? computeReward(options.reward, world.metrics, rewardBindings)
      : { total: 0, terms: [], rewardVersion: "unset" };

    // 8. Fold into the state (evidence-class + clock laws enforced there).
    const nextState = worldModel.advance(state, {
      events: world.events,
      clockAdvanceMs: clockEnd - clockStart,
    });

    const terminated = action.kind === "end" || world.terminated;
    const truncated = !terminated && nextState.stepCount >= state.configuration.maxSteps;

    return deepFreeze({
      state: nextState,
      events: world.events,
      reward,
      step,
      clock: nextState.simulationClock,
      action,
      outcomeModelVersion: world.modelVersion,
      terminated,
      truncated,
    });
  };

  return {
    step: stepOf,
    runEnsemble(state: WorldModelState, action: SimulatorAction, n: number): EnsembleResult {
      if (!Number.isInteger(n) || n < 1) {
        throw new SimulationEpisodeClosedError(`ensemble size must be >= 1, got ${n}`);
      }
      const runs: EnsembleRun[] = [];
      const seeds: SeedString[] = [];
      for (let i = 0; i < n; i++) {
        const childSeed = deriveSeed(state.seed, "ensemble", i);
        seeds.push(childSeed);
        const childState = worldModel.reseed(state, childSeed);
        runs.push({ seed: childSeed, result: stepOf(childState, action) });
      }
      const rewards = runs.map((run) => run.result.reward.total);
      const mean = rewards.reduce((a, b) => a + b, 0) / n;
      const variance =
        rewards.reduce((acc, value) => acc + (value - mean) * (value - mean), 0) / n;
      return deepFreeze({
        runs,
        seeds,
        rewardMean: mean,
        rewardVariance: variance,
        rewardStdDev: Math.sqrt(variance),
        eventCountTotal: runs.reduce((acc, run) => acc + run.result.events.length, 0),
      });
    },
  };
}
