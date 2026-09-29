/**
 * SequentialRLEnvironment — Gym-style sequential RL environment port
 * (W1-009).
 *
 * ```ts
 * const env = createSequentialRLEnvironment(config);
 * const obs = env.reset(seed);          // ⇒ Observation
 * const step = env.step({ actionId });  // ⇒ { observation, reward, terminated, truncated }
 * ```
 *
 * LAWS:
 * - DETERMINISM UNDER SEED: same seed + same action sequence ⇒
 *   byte-identical observations, rewards, metrics and events (no
 *   Math.random, no Date.now / wall-clock reads — the episode clock is
 *   a VIRTUAL clock derived from the config, never the system clock).
 * - OBSERVATIONS ARE DERIVED FROM FEATURE FAMILIES: every observation
 *   carries a structural feature vector (families/names/digest;
 *   field-compatible with @reckon/features FeatureVector — no
 *   workspace dependency, frozen lockfile, same precedent as
 *   @reckon/features/port.ts).
 * - REWARDS COME FROM THE DECLARED RewardSpec (never a hardcoded
 *   engagement reward): every term of the host-declared spec MUST have
 *   an explicit binding at construction (typed error otherwise), and
 *   every emitted reward term is fully TRACEABLE (termId, kind, weight,
 *   source, value, contribution).
 * - EPISODE TERMINATION IS EXPLICIT: `terminated` = budget exhausted
 *   or fatigue threshold reached; `truncated` = maxSteps reached
 *   without termination; stepping a closed episode is a typed error.
 * - EVIDENCE CLASS: emitted outcome events are ALWAYS
 *   `evidenceClass: "simulated"` (research evidence — architecture
 *   lock #20, ADR-004).
 * - NO LLM / NETWORK DEPENDENCY anywhere in this package (the fast
 *   runtime must not require an LLM, and neither must research
 *   infrastructure).
 *
 * COMPOSITION WITH W1-006 (interface, not inheritance): the
 * `asSimulatedOutcomeModel` adapter at the bottom of this file exposes
 * the environment through a STRUCTURAL mirror of the
 * `SimulatedOutcomeModel` seam of @reckon/simulation — the TL3
 * composition root can pass it to `createSimulator({ outcomeModel })`
 * directly (no workspace dependency: the lockfile is frozen).
 */
import {
  OutcomeEventSchema,
  RewardSpecSchema,
  SubjectReferenceSchema,
  TenantScopeSchema,
  contentDigest,
  digestBytes,
  type OutcomeEvent,
  type RewardSpec,
  type RewardTerm,
  type SubjectReference,
  type TenantScope,
  type TimestampMs,
} from "@reckon/contracts";
import { createRng, deriveSeed, normalizeSeed, type Rng, type SeedString } from "./rng.js";
import {
  ActionUnknownError,
  EnvironmentConfigInvalidError,
  EpisodeClosedError,
  EpisodeNotResetError,
  LearningArgumentError,
  LearningValidationError,
  RewardBindingInvalidError,
  RewardBindingMissingError,
  toLearningIssues,
} from "./errors.js";

/** Version of the environment implementation. */
export const RL_ENVIRONMENT_VERSION = "reckon.rl-env/0.1.0";

// ---------------------------------------------------------------------------
// Structural feature-vector shape (field-compatible with @reckon/features)
// ---------------------------------------------------------------------------

export interface FeatureFamiliesShape {
  readonly families: Readonly<Record<string, readonly number[]>>;
  readonly names: Readonly<Record<string, readonly string[]>>;
  readonly digest: string;
}

// ---------------------------------------------------------------------------
// Gym-style port
// ---------------------------------------------------------------------------

export interface RLAction {
  readonly actionId: string;
}

export interface RLObservation {
  /** 0 on reset; 1-based after each step. */
  readonly step: number;
  /** Observation features (structural feature-family vector). */
  readonly features: FeatureFamiliesShape;
  readonly terminated: boolean;
  readonly truncated: boolean;
}

export interface RLRewardTerm {
  readonly termId: string;
  readonly kind: RewardTerm["kind"];
  readonly weight: number;
  /** Traceable source the binding read (e.g. metric name). */
  readonly source: string;
  readonly value: number;
  readonly contribution: number;
}

export interface RLReward {
  readonly total: number;
  readonly terms: readonly RLRewardTerm[];
  readonly rewardVersion: string;
}

export interface RLStepResult {
  readonly observation: RLObservation;
  readonly reward: RLReward;
  readonly terminated: boolean;
  readonly truncated: boolean;
  /** Simulated outcome events of this step (research evidence class). */
  readonly events: readonly OutcomeEvent[];
  /** Named metrics emitted by this step (reward-binding inputs). */
  readonly metrics: Readonly<Record<string, number>>;
  /** Virtual clock AFTER the step (ms, config-derived origin). */
  readonly clock: TimestampMs;
}

/** Gym-style sequential RL environment port. */
export interface SequentialRLEnvironment {
  readonly environmentVersion: string;
  readonly environmentId: string;
  readonly actionSpace: readonly RLAction[];
  reset(seed: string | number): RLObservation;
  step(action: RLAction): RLStepResult;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** A neutral action declaration (fixture/research semantics). */
export interface RLActionSpec {
  readonly actionId: string;
  /** Attention budget consumed by the action (virtual ms, > 0). */
  readonly costMs: number;
  /** Neutral outcome quality of the action in [0, 1]. */
  readonly valueQuality: number;
  /** Fatigue increment of the action in [0, 1]. */
  readonly fatigueDelta: number;
}

/** Read-only view of the internal state handed to reward bindings. */
export interface RewardBindingStateView {
  readonly step: number;
  readonly budgetRemainingMs: number;
  readonly budgetFraction: number;
  readonly fatigue: number;
}

/** Everything a reward binding may read. */
export interface RewardBindingContext {
  readonly action: RLActionSpec;
  readonly metrics: Readonly<Record<string, number>>;
  readonly state: RewardBindingStateView;
}

/** A reward-term binding: derives the term's value from the step. */
export type RewardTermBinding = (context: RewardBindingContext) => number;

export interface RLEnvironmentConfig {
  readonly environmentId: string;
  readonly tenant: TenantScope;
  readonly subject: SubjectReference;
  /** Action declarations (>= 1, unique actionIds). */
  readonly actions: readonly RLActionSpec[];
  /** Host-declared, versioned reward spec (never defaulted). */
  readonly reward: RewardSpec;
  /** termId → binding. EVERY term of `reward` must be bound. */
  readonly rewardBindings: Readonly<Record<string, RewardTermBinding>>;
  /** Truncation threshold: steps without termination (int >= 1). */
  readonly maxSteps: number;
  /** Termination criterion 1: attention budget (ms, > 0). */
  readonly attentionBudgetMs: number;
  /** Termination criterion 2: fatigue threshold (in (0, 1]). */
  readonly fatigueThreshold: number;
  /** Seeded noise scale on the realized value (default 0 = none). */
  readonly noiseScale?: number;
  /** Virtual ms per step (default 60_000). */
  readonly stepDurationMs?: number;
  /** Virtual clock origin (default 0). */
  readonly baseClockMs?: number;
}

// ---------------------------------------------------------------------------
// Binding helpers (explicit, research-fixture conveniences)
// ---------------------------------------------------------------------------

/** Bind a term to a named metric emitted by the environment. */
export function metricBinding(metricName: string): RewardTermBinding {
  return (context) => context.metrics[metricName] ?? 0;
}

/** Bind a term to a constant value (traceable source "constant"). */
export function constantBinding(value: number): RewardTermBinding {
  return () => value;
}

/** Bind a term to the post-step fatigue level. */
export function fatigueBinding(): RewardTermBinding {
  return (context) => context.state.fatigue;
}

/** Bind a term to the post-step remaining-budget fraction. */
export function budgetFractionBinding(): RewardTermBinding {
  return (context) => context.state.budgetFraction;
}

/**
 * Convenience mapping of reward-term KINDS to the environment's neutral
 * metrics, for research fixtures that want "every declared term reads
 * the neutral realized value". This is NOT an engagement default: the
 * term set, weights and semantics remain fully host-declared by the
 * RewardSpec — this helper only names where each term READS.
 */
export const ENV_METRIC_FOR_TERM_KIND: Readonly<
  Record<RewardTerm["kind"], string>
> = Object.freeze({
  "satisfaction-proxy": "env.value",
  "task-success": "env.value",
  "qualified-engagement": "env.value",
  conversion: "env.value",
  revenue: "env.value",
  retention: "env.value",
  "discovery-value": "env.value",
  serendipity: "env.value",
  continuity: "env.budgetFraction",
  "interruption-regret": "env.fatigue",
  "inference-cost": "env.costMs",
  latency: "env.costMs",
  bandwidth: "env.costMs",
  "policy-risk": "env.fatigue",
  custom: "env.value",
});

/** Build kind-based metric bindings for every term of a reward spec. */
export function metricBindingsForRewardSpec(
  reward: RewardSpec
): Readonly<Record<string, RewardTermBinding>> {
  const bindings: Record<string, RewardTermBinding> = {};
  for (const term of reward.terms) {
    bindings[term.termId] = metricBinding(ENV_METRIC_FOR_TERM_KIND[term.kind]);
  }
  return bindings;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

interface EnvState {
  seed: SeedString;
  step: number;
  budgetRemainingMs: number;
  fatigue: number;
  cumulativeValue: number;
  lastValue: number;
  terminated: boolean;
  truncated: boolean;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Create a deterministic sequential RL environment. */
export function createSequentialRLEnvironment(config: RLEnvironmentConfig): SequentialRLEnvironment {
  // ---- Construction-time validation (fail fast, typed errors) ----
  if (typeof config.environmentId !== "string" || config.environmentId.length === 0) {
    throw new EnvironmentConfigInvalidError("environmentId must be a non-empty string");
  }
  const tenant = TenantScopeSchema.safeParse(config.tenant);
  if (!tenant.success) {
    throw new LearningValidationError(
      "environment tenant failed its frozen schema",
      toLearningIssues(tenant.error),
      config.tenant
    );
  }
  const subject = SubjectReferenceSchema.safeParse(config.subject);
  if (!subject.success) {
    throw new LearningValidationError(
      "environment subject failed its frozen schema",
      toLearningIssues(subject.error),
      config.subject
    );
  }
  if (!Array.isArray(config.actions) || config.actions.length === 0) {
    throw new EnvironmentConfigInvalidError("actions must be a non-empty array");
  }
  const actionIds = new Set<string>();
  for (const action of config.actions) {
    if (action === null || typeof action !== "object") {
      throw new EnvironmentConfigInvalidError("every action must be an object");
    }
    if (typeof action.actionId !== "string" || action.actionId.length === 0) {
      throw new EnvironmentConfigInvalidError("action.actionId must be a non-empty string");
    }
    if (actionIds.has(action.actionId)) {
      throw new EnvironmentConfigInvalidError(`duplicate actionId "${action.actionId}"`);
    }
    actionIds.add(action.actionId);
    if (!Number.isFinite(action.costMs) || action.costMs <= 0) {
      throw new EnvironmentConfigInvalidError(
        `action ${action.actionId}: costMs must be a positive finite number`
      );
    }
    if (!(action.valueQuality >= 0 && action.valueQuality <= 1)) {
      throw new EnvironmentConfigInvalidError(
        `action ${action.actionId}: valueQuality must be in [0, 1]`
      );
    }
    if (!(action.fatigueDelta >= 0 && action.fatigueDelta <= 1)) {
      throw new EnvironmentConfigInvalidError(
        `action ${action.actionId}: fatigueDelta must be in [0, 1]`
      );
    }
  }
  const reward = (() => {
    const parsed = RewardSpecSchema.safeParse(config.reward);
    if (!parsed.success) {
      throw new LearningValidationError(
        "environment reward spec failed its frozen schema",
        toLearningIssues(parsed.error),
        config.reward
      );
    }
    return parsed.data;
  })();
  for (const term of reward.terms) {
    const binding = config.rewardBindings[term.termId];
    if (typeof binding !== "function") {
      throw new RewardBindingMissingError(term.termId, term.kind);
    }
  }
  if (!Number.isInteger(config.maxSteps) || config.maxSteps < 1) {
    throw new EnvironmentConfigInvalidError(`maxSteps must be an integer >= 1`);
  }
  if (!Number.isFinite(config.attentionBudgetMs) || config.attentionBudgetMs <= 0) {
    throw new EnvironmentConfigInvalidError("attentionBudgetMs must be a positive finite number");
  }
  if (!(config.fatigueThreshold > 0 && config.fatigueThreshold <= 1)) {
    throw new EnvironmentConfigInvalidError("fatigueThreshold must be in (0, 1]");
  }
  const noiseScale = config.noiseScale ?? 0;
  if (!(noiseScale >= 0) || !Number.isFinite(noiseScale)) {
    throw new EnvironmentConfigInvalidError("noiseScale must be a finite number >= 0");
  }
  const stepDurationMs = config.stepDurationMs ?? 60_000;
  if (!Number.isInteger(stepDurationMs) || stepDurationMs <= 0) {
    throw new EnvironmentConfigInvalidError("stepDurationMs must be a positive integer");
  }
  const baseClockMs = config.baseClockMs ?? 0;
  if (!Number.isInteger(baseClockMs) || baseClockMs < 0) {
    throw new EnvironmentConfigInvalidError("baseClockMs must be a non-negative integer");
  }

  const actionsById = new Map(config.actions.map((action) => [action.actionId, action]));
  let state: EnvState | undefined; // undefined until reset()
  let rng: Rng | undefined;

  const observationOf = (current: EnvState): RLObservation => {
    const budgetFraction = round6(clamp01(current.budgetRemainingMs / config.attentionBudgetMs));
    const values = [
      current.step,
      budgetFraction,
      round6(current.fatigue),
      round6(current.lastValue),
      round6(current.cumulativeValue),
    ];
    const names = [
      "state.step",
      "state.budgetFraction",
      "state.fatigue",
      "state.lastValue",
      "state.cumulativeValue",
    ];
    return {
      step: current.step,
      features: {
        families: { state: values, bias: [1] },
        names: { state: names, bias: ["bias"] },
        digest: contentDigest({ seed: current.seed, step: current.step, values }),
      },
      terminated: current.terminated,
      truncated: current.truncated,
    };
  };

  const buildEvent = (
    current: EnvState,
    action: RLActionSpec,
    metrics: Readonly<Record<string, number>>,
    clock: TimestampMs
  ): OutcomeEvent => {
    const eventId = `rl-${digestBytes(`${current.seed}|${current.step}|${action.actionId}`).slice(0, 24)}`;
    const candidate = {
      schema: "reckon.outcome-event" as const,
      schemaVersion: "0.1.0",
      eventId,
      tenant: tenant.data,
      subject: subject.data,
      eventType: "custom" as const,
      customEventType: "rl-env-step",
      occurredAt: clock,
      provenance: { system: "@reckon/learning", version: RL_ENVIRONMENT_VERSION },
      evidenceClass: "simulated" as const,
      metrics: { ...metrics },
      idempotencyKey: `rl:${current.seed.slice(0, 16)}:${current.step}`,
    };
    const parsed = OutcomeEventSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new LearningValidationError(
        "environment emitted a schema-invalid event",
        toLearningIssues(parsed.error),
        candidate
      );
    }
    return parsed.data;
  };

  return {
    environmentVersion: RL_ENVIRONMENT_VERSION,
    environmentId: config.environmentId,
    actionSpace: config.actions.map((action) => ({ actionId: action.actionId })),

    reset(seed: string | number): RLObservation {
      let normalized: SeedString;
      try {
        normalized = normalizeSeed(seed);
      } catch (error) {
        throw new LearningArgumentError(`invalid environment seed: ${(error as Error).message}`);
      }
      state = {
        seed: normalized,
        step: 0,
        budgetRemainingMs: config.attentionBudgetMs,
        fatigue: 0,
        cumulativeValue: 0,
        lastValue: 0,
        terminated: false,
        truncated: false,
      };
      rng = createRng(deriveSeed(normalized, "rl-env"));
      return observationOf(state);
    },

    step(action: RLAction): RLStepResult {
      if (state === undefined || rng === undefined) {
        throw new EpisodeNotResetError();
      }
      if (state.terminated || state.truncated) {
        throw new EpisodeClosedError(
          state.terminated ? "terminated" : `truncated at maxSteps=${config.maxSteps}`
        );
      }
      if (action === null || typeof action !== "object" || typeof action.actionId !== "string") {
        throw new LearningArgumentError("action must be { actionId: string }");
      }
      const spec = actionsById.get(action.actionId);
      if (spec === undefined) {
        throw new ActionUnknownError(action.actionId, config.environmentId);
      }

      // 1. Deterministic dynamics (seeded noise only).
      const budgetRemainingMs = state.budgetRemainingMs - spec.costMs;
      const fatigue = clamp01(state.fatigue + spec.fatigueDelta * (1 - state.fatigue));
      const budgetFraction = clamp01(budgetRemainingMs / config.attentionBudgetMs);
      const noise = noiseScale > 0 ? rng.nextNormal() * noiseScale : 0;
      const value = round6(
        clamp01(spec.valueQuality * (1 - fatigue) * budgetFraction + noise)
      );

      // 2. Neutral named metrics (reward-binding inputs).
      const metrics: Record<string, number> = {
        "env.value": value,
        "env.costMs": spec.costMs,
        "env.fatigue": round6(fatigue),
        "env.budgetFraction": round6(clamp01(budgetRemainingMs / config.attentionBudgetMs)),
        "env.budgetRemainingMs": Math.max(0, Math.round(budgetRemainingMs)),
        "env.cumulativeValue": round6(state.cumulativeValue + value),
      };

      const nextStep = state.step + 1;
      const nextState: EnvState = {
        ...state,
        step: nextStep,
        budgetRemainingMs,
        fatigue,
        cumulativeValue: round6(state.cumulativeValue + value),
        lastValue: value,
      };

      // 3. EXPLICIT termination criteria.
      nextState.terminated = budgetRemainingMs <= 0 || fatigue >= config.fatigueThreshold;
      nextState.truncated = !nextState.terminated && nextStep >= config.maxSteps;

      // 4. Traceable reward from the declared spec.
      const bindingContext: RewardBindingContext = {
        action: spec,
        metrics,
        state: {
          step: nextStep,
          budgetRemainingMs,
          budgetFraction,
          fatigue,
        },
      };
      const terms: RLRewardTerm[] = [];
      let total = 0;
      for (const term of reward.terms) {
        const binding = config.rewardBindings[term.termId]!;
        const bound = binding(bindingContext);
        if (typeof bound !== "number" || !Number.isFinite(bound)) {
          throw new RewardBindingInvalidError(term.termId, bound);
        }
        const contribution = term.weight * bound;
        terms.push({
          termId: term.termId,
          kind: term.kind,
          weight: term.weight,
          source: bindingSourceOf(term),
          value: bound,
          contribution,
        });
        total += contribution;
      }

      // 5. Virtual clock + simulated event (research evidence class).
      const clock = baseClockMs + nextStep * stepDurationMs;
      const events = [buildEvent(nextState, spec, metrics, clock)];

      state = nextState;
      return {
        observation: observationOf(nextState),
        reward: {
          total: round6(total),
          terms,
          rewardVersion: `${reward.rewardId}@${reward.version}`,
        },
        terminated: nextState.terminated,
        truncated: nextState.truncated,
        events,
        metrics,
        clock,
      };
    },
  };
}

/** Human-readable source label of a binding (traceability). */
function bindingSourceOf(term: RewardTerm): string {
  return `binding(${term.termId})`;
}

// ---------------------------------------------------------------------------
// W1-006 composition seam — structural mirror of the simulator's
// SimulatedOutcomeModel (see packages/simulation/src/simulator.ts).
// Field-compatible on purpose: the TL3 composition root can hand the
// adapter returned below straight to `createSimulator({ outcomeModel })`.
// ---------------------------------------------------------------------------

/** Structural mirror of @reckon/simulation's Rng interface. */
export interface RngLike {
  nextUint64(): bigint;
  nextFloat(): number;
  nextBelow(n: number): number;
  nextIndex(weights: readonly number[]): number;
  nextNormal(): number;
}

/** Structural mirror of the simulator action union. */
export type SimulatorActionShape =
  | { readonly kind: "present"; readonly experienceId: string }
  | { readonly kind: "hold" }
  | { readonly kind: "end" };

/** Structural mirror of `SimulatedOutcomeModelInput` (W1-006). */
export interface SimulatedOutcomeModelInputShape {
  readonly action: SimulatorActionShape;
  readonly experience?: import("@reckon/contracts").Experience;
  readonly tenant: TenantScope;
  readonly subject: SubjectReference;
  readonly contextId: string;
  readonly clockStart: TimestampMs;
  readonly clockEnd: TimestampMs;
  readonly step: number;
  readonly stateDigest: string;
  readonly featuresDigest: string;
  readonly stochastic: boolean;
  readonly rng: RngLike;
}

/** Structural mirror of `SimulatedOutcomeModelResult` (W1-006). */
export interface SimulatedOutcomeModelResultShape {
  readonly events: readonly OutcomeEvent[];
  readonly metrics: Readonly<Record<string, number>>;
  readonly modelVersion: string;
  readonly terminated: boolean;
}

/** Structural mirror of the `SimulatedOutcomeModel` seam (W1-006). */
export interface SimulatedOutcomeModelShape {
  simulate(input: SimulatedOutcomeModelInputShape): SimulatedOutcomeModelResultShape;
}

export interface SimulatedOutcomeModelAdapterOptions {
  /** experienceId → environment actionId for `present` actions. */
  readonly actionForExperience: Readonly<Record<string, string>>;
  /** Optional action used for `hold` (default: hold emits no events). */
  readonly holdActionId?: string;
  /**
   * Whether a `present` of an unmapped experienceId is an error
   * (default true — typed LearningArgumentError).
   */
  readonly strictMapping?: boolean;
}

/**
 * Adapt a `SequentialRLEnvironment` to the simulator's outcome-model
 * seam (composition via interface, not inheritance). The adapter owns
 * world-clock alignment: emitted env events are re-stamped at
 * `clockStart + ordinal` inside the simulator's step window
 * (deterministic affine mapping, documented).
 */
export function asSimulatedOutcomeModel(
  env: SequentialRLEnvironment,
  options: SimulatedOutcomeModelAdapterOptions
): SimulatedOutcomeModelShape {
  const adapterVersion = `${RL_ENVIRONMENT_VERSION}+outcome-model-adapter/1`;
  return {
    simulate(input: SimulatedOutcomeModelInputShape): SimulatedOutcomeModelResultShape {
      if (input.action.kind === "end") {
        return { events: [], metrics: {}, modelVersion: adapterVersion, terminated: true };
      }
      if (input.action.kind === "hold" && options.holdActionId === undefined) {
        return {
          events: [],
          metrics: { "rl.hold": 1 },
          modelVersion: adapterVersion,
          terminated: false,
        };
      }
      let actionId: string;
      if (input.action.kind === "hold") {
        actionId = options.holdActionId!;
      } else {
        const mapped = options.actionForExperience[input.action.experienceId];
        if (mapped === undefined) {
          if (options.strictMapping !== false) {
            throw new LearningArgumentError(
              `no environment action mapped for experienceId "${input.action.experienceId}"`
            );
          }
          return {
            events: [],
            metrics: { "rl.unmapped": 1 },
            modelVersion: adapterVersion,
            terminated: false,
          };
        }
        actionId = mapped;
      }

      const result = env.step({ actionId });

      // Re-stamp the env's events into the simulator's step window:
      // clockStart + ordinal (deterministic; adapter owns alignment —
      // the env's internal virtual clock stays its own).
      const events = result.events.map(
        (event, ordinal) => ({ ...event, occurredAt: input.clockStart + ordinal }) as OutcomeEvent
      );
      return {
        events,
        metrics: { ...result.metrics },
        modelVersion: adapterVersion,
        terminated: result.terminated || result.truncated,
      };
    },
  };
}
