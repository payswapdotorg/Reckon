/**
 * Contextual-bandit evaluation harness (W1-008).
 *
 * A deterministic evaluation loop over a SEEDED stationary contextual
 * bandit world (FIXTURE evidence — this is a research harness, never
 * production evidence):
 *
 *   for t = 0 … T−1:
 *     context_t (feature families) → policy.score(arms as experiences)
 *     → choose (stable argmax; exploration is policy-internal, seeded)
 *     → world.realizeReward(t, arm) (seeded noise)
 *     → policy.observe(arm, reward) (learning update)
 *     → append calibration record (prediction vs observation)
 *
 * Outputs: per-step logs, cumulative + windowed regret estimates,
 * per-arm statistics, append-only calibration records, report digest.
 *
 * LAWS:
 * - NO Math.random / Date.now: every stochastic component (world noise,
 *   epsilon-greedy exploration, Thompson-style sampling) draws from
 *   seeded SplitMix64 generators with documented seed derivation.
 * - CALIBRATION IS APPEND-ONLY (worker-1 handoff): prediction-vs-
 *   observation records are appended and frozen, never rewritten.
 * - The policy seam mirrors the `PolicyEngine.score` input shapes of
 *   @reckon/decision (W2-002) STRUCTURALLY — field-compatible types,
 *   no workspace dependency (frozen lockfile; same precedent as
 *   @reckon/features/port.ts). Contexts are feature-family vectors
 *   (structural FeatureFamiliesShape, field-compatible with
 *   @reckon/features FeatureVector).
 */
import {
  contentDigest,
  type Experience,
  type HardConstraint,
  type Objective,
  type RewardSpec,
  type Uncertainty,
} from "@reckon/contracts";
import { createRng, deriveSeed, type Rng } from "./rng.js";
import {
  EvaluationArgumentError,
  EvaluationValidationError,
} from "./errors.js";
import type { FeatureFamiliesShape } from "./offline.js";

// ---------------------------------------------------------------------------
// Structural seam mirrors (field-compatible with @reckon/decision)
// ---------------------------------------------------------------------------

/**
 * Structural mirror of `ScoredExperience` (@reckon/decision policy-port).
 * Field-compatible; real W2-002 scored experiences are assignable to it.
 */
export interface BanditScoredExperience {
  readonly experience: Experience;
  readonly score: number;
  readonly uncertainty?: Uncertainty;
}

/**
 * Structural mirror of `PolicyScoreInput` (@reckon/decision policy-port):
 * the scoring seam the evaluator uses. Field-compatible with the real
 * `PolicyScoreInput`; a real PolicyEngine can be adapted with a trivial
 * lambda (composition root's job — no dependency here).
 */
export interface BanditPolicyScoreInput {
  readonly experiences: readonly Experience[];
  readonly objective: Objective;
  readonly constraints: readonly HardConstraint[];
  readonly reward?: RewardSpec;
  readonly policyId: string;
  readonly policyVersion: string;
}

/**
 * A bandit policy: a scoring function (the PolicyEngine.score seam) plus
 * a learning update plus a point estimate (used for calibration
 * predictions). Implementations MUST be deterministic given their seed.
 */
export interface BanditPolicy {
  readonly policyId: string;
  readonly policyVersion: string;
  /** Score every arm; exploration is encoded in the scores. */
  score(input: BanditPolicyScoreInput): BanditScoredExperience[];
  /** Learning update after the realized reward of an action. */
  observe(actionId: string, reward: number): void;
  /** Current point estimate for an arm (pre-update prediction). */
  estimate(actionId: string): number;
}

// ---------------------------------------------------------------------------
// Stationary contextual bandit world (FIXTURE evidence)
// ---------------------------------------------------------------------------

export interface StationaryBanditWorldSpec {
  /** World seed — determines arm weights, contexts and reward noise. */
  readonly seed: string;
  /** Number of arms (>= 2). */
  readonly armCount: number;
  /** Context dimension (>= 1). */
  readonly contextDim: number;
  /** Reward noise scale (sd, >= 0; 0 = deterministic rewards). */
  readonly noiseScale: number;
  /** Default horizon for evaluations (>= 1). */
  readonly horizon: number;
  /**
   * Optional per-arm additive bias on the reward mean (fixture-declared
   * reward structure). Defaults to zeros. A bias-separated fixture has
   * a stable dominant arm while the (seeded) linear term keeps it
   * genuinely contextual.
   */
  readonly armBiases?: readonly number[];
  /** Scale of the random linear weights (default 1). */
  readonly weightScale?: number;
}

export interface BanditArm {
  readonly armId: string;
  /** Synthetic arm experience (fixture evidence, provider-neutral). */
  readonly experience: Experience;
  /** True weight vector of the arm's linear reward mean. */
  readonly trueWeights: readonly number[];
}

export interface BanditWorldOptimum {
  readonly armId: string;
  readonly meanReward: number;
}

/**
 * Deterministic stationary contextual bandit world. All draws derive
 * from the documented seed tree:
 *   arms:   deriveSeed(seed, "arms")
 *   ctx t:  deriveSeed(seed, "ctx", t)
 *   reward: deriveSeed(seed, "reward", t, armIndex)
 */
export interface StationaryBanditWorld {
  readonly spec: StationaryBanditWorldSpec;
  readonly arms: readonly BanditArm[];
  /** Context feature vector at step t (0-based). */
  contextAt(step: number): FeatureFamiliesShape;
  /** Noiseless mean reward of an arm in the context at step t. */
  meanReward(step: number, armId: string): number;
  /** Optimal arm (noiseless) and its mean reward at step t. */
  optimalAction(step: number): BanditWorldOptimum;
  /** Realized reward: mean + seeded gaussian noise (clamped to noiseScale=0). */
  realizeReward(step: number, armId: string): number;
}

function fixtureArmExperience(armIndex: number): Experience {
  return {
    schema: "reckon.experience",
    schemaVersion: "0.1.0",
    experienceId: `arm-${armIndex}`,
    itemId: `fixture-arm-item-${armIndex}`,
    realizationId: `fixture-arm-realization-${armIndex}`,
    format: { kind: "custom", customKind: "bandit-arm", params: { armIndex } },
    transformations: [],
    constraints: [],
  } as Experience;
}

/** Create the deterministic stationary bandit world (fixture evidence). */
export function createStationaryBanditWorld(spec: StationaryBanditWorldSpec): StationaryBanditWorld {
  if (!Number.isInteger(spec.armCount) || spec.armCount < 2) {
    throw new EvaluationArgumentError(`armCount must be an integer >= 2, got ${spec.armCount}`);
  }
  if (!Number.isInteger(spec.contextDim) || spec.contextDim < 1) {
    throw new EvaluationArgumentError(`contextDim must be an integer >= 1, got ${spec.contextDim}`);
  }
  if (!(spec.noiseScale >= 0) || !Number.isFinite(spec.noiseScale)) {
    throw new EvaluationArgumentError(`noiseScale must be a finite number >= 0`);
  }
  if (!Number.isInteger(spec.horizon) || spec.horizon < 1) {
    throw new EvaluationArgumentError(`horizon must be an integer >= 1, got ${spec.horizon}`);
  }
  const armBiases = spec.armBiases ?? new Array<number>(spec.armCount).fill(0);
  if (armBiases.length !== spec.armCount) {
    throw new EvaluationArgumentError(
      `armBiases length (${armBiases.length}) must equal armCount (${spec.armCount})`
    );
  }
  for (const bias of armBiases) {
    if (typeof bias !== "number" || !Number.isFinite(bias)) {
      throw new EvaluationArgumentError("armBiases must be finite numbers");
    }
  }
  const weightScale = spec.weightScale ?? 1;
  if (typeof weightScale !== "number" || !Number.isFinite(weightScale) || weightScale < 0) {
    throw new EvaluationArgumentError(`weightScale must be a finite number >= 0`);
  }

  // Arm weights: deterministic from the world seed.
  const armRng = createRng(deriveSeed(spec.seed, "arms"));
  const arms: BanditArm[] = [];
  for (let k = 0; k < spec.armCount; k++) {
    const trueWeights: number[] = [];
    for (let d = 0; d < spec.contextDim; d++) {
      trueWeights.push(round6((armRng.nextFloat() * 2 - 1) * weightScale));
    }
    arms.push({
      armId: `arm-${k}`,
      experience: fixtureArmExperience(k),
      trueWeights,
    });
  }

  const contextVector = (step: number): number[] => {
    const ctxRng = createRng(deriveSeed(spec.seed, "ctx", step));
    const vector: number[] = [];
    for (let d = 0; d < spec.contextDim; d++) {
      vector.push(round6(ctxRng.nextFloat() * 2 - 1));
    }
    return vector;
  };

  const meanRewardOf = (vector: readonly number[], armIndex: number): number => {
    const weights = arms[armIndex]!.trueWeights;
    let sum = armBiases[armIndex]!;
    for (let d = 0; d < vector.length; d++) {
      sum += vector[d]! * weights[d]!;
    }
    return round6(sum);
  };

  const armIndexOf = (armId: string): number => {
    const index = arms.findIndex((arm) => arm.armId === armId);
    if (index < 0) {
      throw new EvaluationArgumentError(`unknown arm id "${armId}"`);
    }
    return index;
  };

  return {
    spec,
    arms,
    contextAt(step: number): FeatureFamiliesShape {
      if (!Number.isInteger(step) || step < 0) {
        throw new EvaluationArgumentError(`step must be a non-negative integer, got ${step}`);
      }
      const vector = contextVector(step);
      return {
        families: { context: [...vector], bias: [1] },
        names: {
          context: vector.map((_, d) => `context.x${d}`),
          bias: ["bias"],
        },
        digest: contentDigest({ step, vector }),
      };
    },
    meanReward(step: number, armId: string): number {
      return meanRewardOf(contextVector(step), armIndexOf(armId));
    },
    optimalAction(step: number): BanditWorldOptimum {
      const vector = contextVector(step);
      let bestIndex = 0;
      let bestMean = meanRewardOf(vector, 0);
      for (let k = 1; k < arms.length; k++) {
        const mean = meanRewardOf(vector, k);
        if (mean > bestMean) {
          bestMean = mean;
          bestIndex = k;
        }
      }
      return { armId: arms[bestIndex]!.armId, meanReward: bestMean };
    },
    realizeReward(step: number, armId: string): number {
      const armIndex = armIndexOf(armId);
      const mean = meanRewardOf(contextVector(step), armIndex);
      if (spec.noiseScale === 0) return mean;
      const rewardRng = createRng(deriveSeed(spec.seed, "reward", step, armIndex));
      return round6(mean + rewardRng.nextNormal() * spec.noiseScale);
    },
  };
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

// ---------------------------------------------------------------------------
// Append-only calibration log
// ---------------------------------------------------------------------------

/** One prediction-vs-observation calibration record (append-only). */
export interface CalibrationRecord {
  /** 0-based step at which the prediction was made. */
  readonly step: number;
  readonly armId: string;
  /** Policy point estimate BEFORE the learning update. */
  readonly predicted: number;
  /** Realized reward observed afterwards. */
  readonly observed: number;
}

/**
 * Append-only calibration log: records are frozen on append, the
 * history is never rewritten, and `records()` returns a fresh frozen
 * snapshot (mutation of the snapshot cannot touch the log).
 */
export class AppendOnlyCalibrationLog {
  private readonly recordsList: CalibrationRecord[] = [];

  /** Append one record (frozen copy). Returns the new size. */
  append(record: CalibrationRecord): number {
    if (record === null || typeof record !== "object") {
      throw new EvaluationValidationError(
        "calibration record must be an object",
        [{ path: "", message: "must be an object", code: "invalid_type" }],
        record
      );
    }
    if (typeof record.predicted !== "number" || !Number.isFinite(record.predicted)) {
      throw new EvaluationValidationError(
        "calibration record `predicted` must be a finite number",
        [{ path: "predicted", message: "must be a finite number", code: "invalid_type" }],
        record
      );
    }
    if (typeof record.observed !== "number" || !Number.isFinite(record.observed)) {
      throw new EvaluationValidationError(
        "calibration record `observed` must be a finite number",
        [{ path: "observed", message: "must be a finite number", code: "invalid_type" }],
        record
      );
    }
    this.recordsList.push(Object.freeze({ ...record }));
    return this.recordsList.length;
  }

  get size(): number {
    return this.recordsList.length;
  }

  /** Frozen snapshot of all records (historical records never change). */
  records(): readonly CalibrationRecord[] {
    return Object.freeze([...this.recordsList]);
  }

  /** Record at an index (typed error when out of range). */
  at(index: number): CalibrationRecord {
    const record = this.recordsList[index];
    if (record === undefined) {
      throw new EvaluationArgumentError(`no calibration record at index ${index}`);
    }
    return record;
  }
}

// ---------------------------------------------------------------------------
// Evaluation run
// ---------------------------------------------------------------------------

export interface ContextualBanditEvaluationConfig {
  readonly world: StationaryBanditWorld;
  readonly policy: BanditPolicy;
  /** Host-declared objective (passed through to the score seam). */
  readonly objective: Objective;
  readonly reward?: RewardSpec;
  readonly constraints?: readonly HardConstraint[];
  /** Horizon override (defaults to world.spec.horizon). */
  readonly horizon?: number;
  /** Number of contiguous regret windows (default 4). */
  readonly windowCount?: number;
}

export interface BanditStepLog {
  readonly step: number;
  readonly context: FeatureFamiliesShape;
  readonly chosenArm: string;
  /** Policy point estimate BEFORE the update (calibration prediction). */
  readonly predicted: number;
  /** Realized (seeded-noise) reward of the chosen arm. */
  readonly reward: number;
  readonly optimalArm: string;
  readonly optimalMeanReward: number;
  /** Noiseless regret: optimal mean − chosen-arm mean. */
  readonly regret: number;
  readonly cumulativeRegret: number;
}

export interface ArmStatistic {
  readonly armId: string;
  readonly pulls: number;
  readonly meanRealizedReward: number;
  readonly finalEstimate: number;
  readonly shareOfPulls: number;
  readonly isEmpiricalBest: boolean;
}

export interface ContextualBanditReport {
  readonly policyId: string;
  readonly policyVersion: string;
  readonly worldSeed: string;
  readonly horizon: number;
  readonly perStep: readonly BanditStepLog[];
  readonly cumulativeRegret: number;
  /** Mean per-step regret per contiguous window (monotone-improvement check). */
  readonly windowedMeanRegret: readonly number[];
  readonly perArm: readonly ArmStatistic[];
  readonly calibration: readonly CalibrationRecord[];
  /** sha256 over the canonical report content (determinism check). */
  readonly reportDigest: string;
}

function assertFinite(value: number, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new EvaluationArgumentError(`${what} must be a finite number, got ${value}`);
  }
  return value;
}

/** Run the deterministic contextual-bandit evaluation loop. */
export function runContextualBanditEvaluation(
  config: ContextualBanditEvaluationConfig
): ContextualBanditReport {
  const { world, policy } = config;
  const horizon = config.horizon ?? world.spec.horizon;
  const windowCount = config.windowCount ?? 4;
  if (!Number.isInteger(horizon) || horizon < 1) {
    throw new EvaluationArgumentError(`horizon must be an integer >= 1, got ${horizon}`);
  }
  if (!Number.isInteger(windowCount) || windowCount < 1 || windowCount > horizon) {
    throw new EvaluationArgumentError(
      `windowCount must be an integer in [1, horizon], got ${windowCount}`
    );
  }
  if (typeof policy.policyId !== "string" || policy.policyId.length === 0) {
    throw new EvaluationArgumentError("policy.policyId must be a non-empty string");
  }
  if (typeof policy.policyVersion !== "string" || policy.policyVersion.length === 0) {
    throw new EvaluationArgumentError("policy.policyVersion must be a non-empty string");
  }

  const armIds = world.arms.map((arm) => arm.armId);
  const armIndexOf = new Map(armIds.map((armId, index) => [armId, index]));
  const calibrationLog = new AppendOnlyCalibrationLog();
  const perStep: BanditStepLog[] = [];
  let cumulativeRegret = 0;

  for (let step = 0; step < horizon; step++) {
    const context = world.contextAt(step);

    // 1. Score through the seam.
    const scored = policy.score({
      experiences: world.arms.map((arm) => arm.experience),
      objective: config.objective,
      constraints: config.constraints ?? [],
      reward: config.reward,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
    });

    // 2. Stable argmax over the arm set (tie → lowest arm index).
    const scoreByArm = new Map<string, number>();
    for (const entry of scored) {
      if (entry === null || typeof entry !== "object" || !entry.experience) {
        throw new EvaluationValidationError(
          "policy returned a malformed scored experience",
          [{ path: "scored", message: "must be { experience, score }", code: "invalid_type" }],
          entry
        );
      }
      const armId = entry.experience.experienceId;
      if (!armIndexOf.has(armId)) {
        throw new EvaluationArgumentError(
          `policy scored an unknown arm "${armId}" (not part of the world)`
        );
      }
      assertFinite(entry.score, `score for arm ${armId}`);
      scoreByArm.set(armId, entry.score);
    }
    if (scoreByArm.size !== armIds.length) {
      throw new EvaluationArgumentError(
        `policy scored ${scoreByArm.size} arms, world has ${armIds.length} — the arm set must be scored exactly`
      );
    }
    let chosenIndex = 0;
    let bestScore = scoreByArm.get(armIds[0]!)!;
    for (let k = 1; k < armIds.length; k++) {
      const score = scoreByArm.get(armIds[k]!)!;
      if (score > bestScore) {
        bestScore = score;
        chosenIndex = k;
      }
    }
    const chosenArm = armIds[chosenIndex]!;

    // 3. Realize reward (seeded world), compute noiseless regret.
    const predicted = assertFinite(policy.estimate(chosenArm), `estimate for arm ${chosenArm}`);
    const reward = assertFinite(world.realizeReward(step, chosenArm), "realized reward");
    const optimum = world.optimalAction(step);
    const regret = round6(optimum.meanReward - world.meanReward(step, chosenArm));
    cumulativeRegret = round6(cumulativeRegret + regret);

    // 4. Learn + calibrate (append-only, pre-update prediction).
    policy.observe(chosenArm, reward);
    calibrationLog.append({ step, armId: chosenArm, predicted, observed: reward });

    perStep.push({
      step,
      context,
      chosenArm,
      predicted,
      reward,
      optimalArm: optimum.armId,
      optimalMeanReward: optimum.meanReward,
      regret,
      cumulativeRegret,
    });
  }

  // 5. Windowed mean regret (contiguous greedy chunks; last takes the remainder).
  const windowSize = Math.floor(horizon / windowCount);
  const windowedMeanRegret: number[] = [];
  let windowStart = 0;
  for (let w = 0; w < windowCount; w++) {
    const windowEnd = w === windowCount - 1 ? horizon : windowStart + windowSize;
    const windowSteps = perStep.slice(windowStart, windowEnd);
    const mean =
      windowSteps.reduce((acc, entry) => acc + entry.regret, 0) / Math.max(1, windowSteps.length);
    windowedMeanRegret.push(mean);
    windowStart = windowEnd;
  }

  // 6. Per-arm statistics (empirical best computed before freezing).
  const armStats = world.arms.map((arm) => {
    const stepsOfArm = perStep.filter((entry) => entry.chosenArm === arm.armId);
    const pulls = stepsOfArm.length;
    const meanRealizedReward =
      pulls === 0 ? 0 : stepsOfArm.reduce((acc, entry) => acc + entry.reward, 0) / pulls;
    return {
      armId: arm.armId,
      pulls,
      meanRealizedReward: round6(meanRealizedReward),
      finalEstimate: policy.estimate(arm.armId),
      shareOfPulls: pulls / horizon,
    };
  });
  const bestMean = Math.max(...armStats.map((stat) => stat.meanRealizedReward));
  const perArm: ArmStatistic[] = armStats.map((stat) => ({
    ...stat,
    isEmpiricalBest: stat.meanRealizedReward === bestMean,
  }));

  // 7. Deterministic report digest.
  const reportDigest = contentDigest({
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    worldSeed: world.spec.seed,
    horizon,
    perStep: perStep.map((entry) => ({
      step: entry.step,
      contextDigest: entry.context.digest,
      chosenArm: entry.chosenArm,
      predicted: entry.predicted,
      reward: entry.reward,
      regret: entry.regret,
      cumulativeRegret: entry.cumulativeRegret,
    })),
    perArm,
  });

  return Object.freeze({
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    worldSeed: world.spec.seed,
    horizon,
    perStep: Object.freeze(perStep),
    cumulativeRegret,
    windowedMeanRegret: Object.freeze(windowedMeanRegret),
    perArm: Object.freeze(perArm),
    calibration: calibrationLog.records(),
    reportDigest,
  });
}

// ---------------------------------------------------------------------------
// Seeded learning policies (no Math.random anywhere)
// ---------------------------------------------------------------------------

export interface EpsilonGreedyOptions {
  /** Initial exploration rate in [0, 1]. */
  readonly epsilon: number;
  /** Policy seed (drives the exploration draws). */
  readonly seed: string | number;
  /** Initial per-arm estimate before any pull (default 0). */
  readonly initialEstimate?: number;
  /**
   * Per-step multiplicative decay of the exploration rate
   * (ε_t = epsilon · decay^t). Default 1 (constant ε). Must lie in
   * (0, 1] for a decaying schedule.
   */
  readonly decay?: number;
}

/**
 * ε-greedy bandit policy with SEEDED exploration (optionally decaying:
 * ε_t = epsilon · decay^t). Exploration is encoded in the SCORES: with
 * probability ε_t a uniformly drawn arm is boosted above every
 * estimate, so the evaluator's stable-argmax choice realizes the
 * exploration. The RNG is a single SplitMix64 stream derived via
 * `deriveSeed(seed, "epsilon-greedy")`; the step counter advances per
 * score() call, making the schedule deterministic.
 */
export function createEpsilonGreedyBanditPolicy(options: EpsilonGreedyOptions): BanditPolicy {
  if (!(options.epsilon >= 0 && options.epsilon <= 1)) {
    throw new EvaluationArgumentError(`epsilon must be in [0, 1], got ${options.epsilon}`);
  }
  const decay = options.decay ?? 1;
  if (!(decay > 0 && decay <= 1)) {
    throw new EvaluationArgumentError(`decay must be in (0, 1], got ${decay}`);
  }
  const initialEstimate = options.initialEstimate ?? 0;
  const rng: Rng = createRng(deriveSeed(String(options.seed), "epsilon-greedy"));
  const estimates = new Map<string, number>();
  const counts = new Map<string, number>();
  let stepCount = 0;

  const estimateOf = (armId: string): number =>
    estimates.get(armId) ?? initialEstimate;

  return {
    policyId: "reckon.eval.epsilon-greedy",
    policyVersion: "1",
    score(input: BanditPolicyScoreInput): BanditScoredExperience[] {
      if (input.experiences.length === 0) {
        throw new EvaluationArgumentError("epsilon-greedy: empty experience set");
      }
      const scores = input.experiences.map((experience) => ({
        experience,
        score: estimateOf(experience.experienceId),
      }));
      const effectiveEpsilon = options.epsilon * Math.pow(decay, stepCount);
      stepCount += 1;
      if (rng.nextFloat() < effectiveEpsilon) {
        // Explore: boost one uniformly drawn arm above every estimate.
        const index = rng.nextBelow(input.experiences.length);
        const maxScore = Math.max(...scores.map((entry) => entry.score));
        scores[index] = {
          experience: input.experiences[index]!,
          score: maxScore + 1,
        };
      }
      return scores;
    },
    observe(actionId: string, reward: number): void {
      assertFinite(reward, "epsilon-greedy observe reward");
      const count = counts.get(actionId) ?? 0;
      const mean = estimates.get(actionId) ?? initialEstimate;
      counts.set(actionId, count + 1);
      // Incremental mean — deterministic.
      estimates.set(actionId, mean + (reward - mean) / (count + 1));
    },
    estimate(actionId: string): number {
      return estimateOf(actionId);
    },
  };
}

export interface ThompsonSamplingOptions {
  readonly seed: string | number;
  /** Prior variance of the per-arm mean (default 1). */
  readonly priorVariance?: number;
  /** Observation noise variance (default 1). */
  readonly noiseVariance?: number;
}

/**
 * Thompson-style sampling policy with GAUSSIAN posteriors: each arm's
 * mean has prior N(0, priorVariance); after n observations with
 * empirical mean m̄ the posterior is N(μ_n, σ_n²) with
 * σ_n² = 1 / (1/priorVariance + n/noiseVariance), μ_n = σ_n² ·
 * (n·m̄/noiseVariance). Scores are SEEDED posterior samples
 * (mean + sd · standardNormal via Box–Muller) — the classic
 * Thompson-style exploration, fully deterministic given the seed.
 */
export function createThompsonSamplingBanditPolicy(
  options: ThompsonSamplingOptions
): BanditPolicy {
  const priorVariance = options.priorVariance ?? 1;
  const noiseVariance = options.noiseVariance ?? 1;
  if (!(priorVariance > 0) || !Number.isFinite(priorVariance)) {
    throw new EvaluationArgumentError("priorVariance must be a positive finite number");
  }
  if (!(noiseVariance > 0) || !Number.isFinite(noiseVariance)) {
    throw new EvaluationArgumentError("noiseVariance must be a positive finite number");
  }
  const rng: Rng = createRng(deriveSeed(String(options.seed), "thompson"));
  const sums = new Map<string, number>();
  const counts = new Map<string, number>();

  const posteriorOf = (armId: string): { mean: number; variance: number } => {
    const n = counts.get(armId) ?? 0;
    const sum = sums.get(armId) ?? 0;
    const posteriorVariance = 1 / (1 / priorVariance + n / noiseVariance);
    const posteriorMean = posteriorVariance * (sum / noiseVariance);
    return { mean: posteriorMean, variance: posteriorVariance };
  };

  return {
    policyId: "reckon.eval.thompson-gaussian",
    policyVersion: "1",
    score(input: BanditPolicyScoreInput): BanditScoredExperience[] {
      return input.experiences.map((experience) => {
        const posterior = posteriorOf(experience.experienceId);
        const sample = posterior.mean + Math.sqrt(posterior.variance) * rng.nextNormal();
        return { experience, score: sample };
      });
    },
    observe(actionId: string, reward: number): void {
      assertFinite(reward, "thompson observe reward");
      sums.set(actionId, (sums.get(actionId) ?? 0) + reward);
      counts.set(actionId, (counts.get(actionId) ?? 0) + 1);
    },
    estimate(actionId: string): number {
      return posteriorOf(actionId).mean;
    },
  };
}
