/**
 * Offline policy evaluation (W1-007) — IPS, SNIPS and doubly-robust
 * estimators over logged DecisionResult-derived records.
 *
 * All estimators are DETERMINISTIC, PURE functions of
 * `(tenant, logs, targetPolicy, options)` — records are processed in
 * the given order (fixed), no randomness, no wall-clock reads.
 *
 * TENANT ISOLATION (contracts.md #5): every evaluation takes the
 * tenant scope EXPLICITLY as its first argument; a log record from
 * another tenant is a typed rejection — cross-tenant evidence can
 * never silently mix into an estimate.
 *
 * PROPENSITY SEMANTICS (documented, exact):
 * - `loggedPropensity` is the probability the LOGGING policy assigned
 *   to the action it actually chose (derived from the stored
 *   DecisionResult of that decision).
 * - A record with a MISSING or ZERO propensity is SKIPPED and counted
 *   (`skippedMissingPropensity` / `skippedZeroPropensity`) — the
 *   estimators never divide by zero and never impute a propensity.
 * - A record whose `chosenAction` is not part of its declared action
 *   space is skipped and counted (`skippedUnknownAction`).
 * - Weight w_i = π_target(a_i | x_i) / p_i, optionally clipped to
 *   `maxWeight` (clipped draws counted in `clippedCount`).
 * - IPS  = (Σ_used w_i · r_i) / N_total  (skipped records contribute 0).
 * - SNIPS = Σ_used w_i · r_i / Σ_used w_i (0 when Σ w = 0 — recorded,
 *   not an error).
 * - DR   = (1/N) Σ_all μ̂(x_i, a_i) + (1/N) Σ_used w_i (r_i − μ̂(x_i, a_i)):
 *   skipped records still contribute their direct-method prediction
 *   (the doubly-robust benefit); DR REQUIRES a direct-method model
 *   (typed error otherwise).
 * - Effective sample size ESS = (Σ w)² / Σ w² over used records
 *   (0 when no usable records).
 */
import {
  TenantScopeSchema,
  TimestampMsSchema,
  type TimestampMs,
  type TenantScope,
} from "@reckon/contracts";
import {
  DirectMethodRequiredError,
  EvaluationArgumentError,
  EvaluationTenantMismatchError,
  EvaluationValidationError,
  toEvaluationIssues,
} from "./errors.js";

// ---------------------------------------------------------------------------
// Structural shapes (field-compatible with sibling W1 packages)
// ---------------------------------------------------------------------------

/**
 * Structural feature-vector shape (see @reckon/features FeatureVector
 * and @reckon/simulation FeatureVectorShape). The frozen lockfile
 * forbids a workspace dependency; shapes are structural on purpose
 * (same precedent as @reckon/features/port.ts).
 */
export interface FeatureFamiliesShape {
  readonly families: Readonly<Record<string, readonly number[]>>;
  readonly names: Readonly<Record<string, readonly string[]>>;
  readonly digest: string;
}

// ---------------------------------------------------------------------------
// Logged records + policy seams
// ---------------------------------------------------------------------------

/**
 * One logged bandit decision, derived by the host from a stored
 * DecisionResult plus its outcome events: the action space seen at
 * decision time, the chosen action, the logging propensity of that
 * action, and the realized reward for it.
 */
export interface LoggedBanditRecord {
  /** DecisionResult.decisionId — the record's identity. */
  readonly decisionId: string;
  readonly tenant: TenantScope;
  /** Context features at decision time (structural FeatureVectorShape). */
  readonly context: FeatureFamiliesShape;
  /** Action space visible at decision time (arm/experience ids). */
  readonly actionSpace: readonly string[];
  /** The action the logging policy actually chose. */
  readonly chosenAction: string;
  /** Probability the LOGGING policy assigned to `chosenAction`. */
  readonly loggedPropensity?: number;
  /** Realized reward of the chosen action (host-computed, scalar). */
  readonly reward: number;
  /** Optional occurrence time (ordering/diagnostics only). */
  readonly occurredAt?: TimestampMs;
}

/**
 * Stochastic target policy seam: the probability the TARGET policy
 * assigns to `action` given the logged context. Pure and
 * deterministic.
 */
export interface StochasticTargetPolicy {
  actionProbability(record: LoggedBanditRecord, action: string): number;
}

/** Direct-method reward model seam: μ̂(context, action) → predicted reward. */
export interface DirectMethodModel {
  predict(record: LoggedBanditRecord, action: string): number;
}

// ---------------------------------------------------------------------------
// Diagnostics + estimates
// ---------------------------------------------------------------------------

/** Deterministic diagnostics shared by all off-policy estimators. */
export interface OffPolicyDiagnostics {
  /** Total records passed to the estimator. */
  readonly sampleSize: number;
  /** Records that entered the weighted sum (weight may be 0). */
  readonly usedCount: number;
  readonly skippedMissingPropensity: number;
  readonly skippedZeroPropensity: number;
  readonly skippedUnknownAction: number;
  readonly clippedCount: number;
  readonly sumWeights: number;
  readonly sumWeightSquares: number;
  readonly maxWeight: number;
  /** Kish effective sample size: (Σw)² / Σw² (0 when no used records). */
  readonly effectiveSampleSize: number;
}

export interface OffPolicyEstimate {
  readonly estimator: "ips" | "snips" | "dr";
  readonly estimate: number;
  readonly diagnostics: OffPolicyDiagnostics;
}

export interface OffPolicyOptions {
  /** Optional upper clip on importance weights (must be > 0). */
  readonly maxWeight?: number;
}

// ---------------------------------------------------------------------------
// Shared machinery
// ---------------------------------------------------------------------------

function tenantKey(tenant: TenantScope): string {
  return `${tenant.tenantId}|${tenant.workspaceId ?? ""}`;
}

interface PreparedRecord {
  readonly record: LoggedBanditRecord;
  readonly weight: number;
}

/**
 * Validate scope + records, compute importance weights. Pure; returns
 * the used records with their (clipped) weights plus diagnostics
 * counters. Records missing a direct-method prediction path are NOT
 * skipped here (DR uses them differently — see estimator functions).
 */
function prepare(
  tenant: TenantScope,
  records: readonly LoggedBanditRecord[],
  targetPolicy: StochasticTargetPolicy,
  options: OffPolicyOptions
): { used: PreparedRecord[]; diagnostics: OffPolicyDiagnostics; totalWeight: number } {
  const scope = TenantScopeSchema.safeParse(tenant);
  if (!scope.success) {
    throw new EvaluationValidationError(
      "evaluation tenant scope failed its frozen schema",
      toEvaluationIssues(scope.error),
      tenant
    );
  }
  if (options.maxWeight !== undefined && (!(options.maxWeight > 0) || !Number.isFinite(options.maxWeight))) {
    throw new EvaluationArgumentError(`maxWeight must be > 0, got ${options.maxWeight}`);
  }

  const expectedTenantKey = tenantKey(scope.data);
  const used: PreparedRecord[] = [];
  let skippedMissingPropensity = 0;
  let skippedZeroPropensity = 0;
  let skippedUnknownAction = 0;
  let clippedCount = 0;
  let sumWeights = 0;
  let sumWeightSquares = 0;
  let maxWeight = 0;

  for (const record of records) {
    if (record === null || typeof record !== "object") {
      throw new EvaluationValidationError(
        "logged record must be an object",
        [{ path: "", message: "must be an object", code: "invalid_type" }],
        record
      );
    }
    const recordTenantKey = tenantKey(record.tenant);
    if (recordTenantKey !== expectedTenantKey) {
      throw new EvaluationTenantMismatchError(expectedTenantKey, recordTenantKey, record.decisionId);
    }
    if (record.occurredAt !== undefined) {
      const at = TimestampMsSchema.safeParse(record.occurredAt);
      if (!at.success) {
        throw new EvaluationValidationError(
          `logged record ${record.decisionId} has an invalid occurredAt`,
          toEvaluationIssues(at.error),
          record
        );
      }
    }
    if (typeof record.reward !== "number" || !Number.isFinite(record.reward)) {
      throw new EvaluationValidationError(
        `logged record ${record.decisionId} has a non-finite reward`,
        [{ path: "reward", message: "must be a finite number", code: "invalid_type" }],
        record
      );
    }
    if (!Array.isArray(record.actionSpace) || record.actionSpace.length === 0) {
      throw new EvaluationValidationError(
        `logged record ${record.decisionId} must declare a non-empty actionSpace`,
        [{ path: "actionSpace", message: "must be a non-empty array", code: "invalid_type" }],
        record
      );
    }

    // Skip semantics (documented): unknown action first (no propensity
    // interpretation possible), then missing, then zero propensity.
    if (!record.actionSpace.includes(record.chosenAction)) {
      skippedUnknownAction += 1;
      continue;
    }
    const propensity = record.loggedPropensity;
    if (propensity === undefined) {
      skippedMissingPropensity += 1;
      continue;
    }
    if (typeof propensity !== "number" || !Number.isFinite(propensity) || propensity < 0) {
      throw new EvaluationValidationError(
        `logged record ${record.decisionId} has an invalid loggedPropensity`,
        [{ path: "loggedPropensity", message: "must be a finite number >= 0", code: "invalid_type" }],
        record
      );
    }
    if (propensity === 0) {
      skippedZeroPropensity += 1;
      continue; // never divide by zero
    }

    const targetProbability = targetPolicy.actionProbability(record, record.chosenAction);
    if (typeof targetProbability !== "number" || !Number.isFinite(targetProbability) || targetProbability < 0) {
      throw new EvaluationArgumentError(
        `target policy returned an invalid probability for record ${record.decisionId}`,
        { decisionId: record.decisionId, targetProbability }
      );
    }

    let weight = targetProbability / propensity;
    if (options.maxWeight !== undefined && weight > options.maxWeight) {
      weight = options.maxWeight;
      clippedCount += 1;
    }
    used.push({ record, weight });
    sumWeights += weight;
    sumWeightSquares += weight * weight;
    if (weight > maxWeight) maxWeight = weight;
  }

  const effectiveSampleSize =
    sumWeightSquares > 0 ? (sumWeights * sumWeights) / sumWeightSquares : 0;

  return {
    used,
    totalWeight: sumWeights,
    diagnostics: {
      sampleSize: records.length,
      usedCount: used.length,
      skippedMissingPropensity,
      skippedZeroPropensity,
      skippedUnknownAction,
      clippedCount,
      sumWeights,
      sumWeightSquares,
      maxWeight,
      effectiveSampleSize,
    },
  };
}

// ---------------------------------------------------------------------------
// Estimators (pure, deterministic)
// ---------------------------------------------------------------------------

/**
 * Inverse Propensity Scoring:
 * V_IPS = (1/N) Σ_used w_i · r_i  — skipped records contribute 0.
 */
export function estimateIPS(
  tenant: TenantScope,
  records: readonly LoggedBanditRecord[],
  targetPolicy: StochasticTargetPolicy,
  options: OffPolicyOptions = {}
): OffPolicyEstimate {
  const { used, diagnostics } = prepare(tenant, records, targetPolicy, options);
  let weightedRewardSum = 0;
  for (const { record, weight } of used) {
    weightedRewardSum += weight * record.reward;
  }
  // Degenerate empty input: 0 (never NaN).
  const estimate = diagnostics.sampleSize > 0 ? weightedRewardSum / diagnostics.sampleSize : 0;
  return { estimator: "ips", estimate, diagnostics };
}

/**
 * Self-Normalized IPS:
 * V_SNIPS = Σ_used w_i · r_i / Σ_used w_i  — 0 when the weight mass is 0.
 */
export function estimateSNIPS(
  tenant: TenantScope,
  records: readonly LoggedBanditRecord[],
  targetPolicy: StochasticTargetPolicy,
  options: OffPolicyOptions = {}
): OffPolicyEstimate {
  const { used, diagnostics } = prepare(tenant, records, targetPolicy, options);
  let weightedRewardSum = 0;
  for (const { record, weight } of used) {
    weightedRewardSum += weight * record.reward;
  }
  const estimate = diagnostics.sumWeights > 0 ? weightedRewardSum / diagnostics.sumWeights : 0;
  return { estimator: "snips", estimate, diagnostics };
}

/**
 * Doubly-Robust (DM combinator):
 * V_DR = (1/N) Σ_all μ̂(x_i, a_i) + (1/N) Σ_used w_i (r_i − μ̂(x_i, a_i)).
 *
 * Skipped records (missing/zero propensity, unknown action) still
 * contribute their direct-method prediction — that is the doubly-robust
 * benefit. A direct-method model is REQUIRED (typed error otherwise).
 */
export function estimateDoublyRobust(
  tenant: TenantScope,
  records: readonly LoggedBanditRecord[],
  targetPolicy: StochasticTargetPolicy,
  directMethod: DirectMethodModel,
  options: OffPolicyOptions = {}
): OffPolicyEstimate {
  if (directMethod === undefined || directMethod === null) {
    throw new DirectMethodRequiredError();
  }
  const { used, diagnostics } = prepare(tenant, records, targetPolicy, options);

  const dmOf = new Map<string, number>();
  const dmFor = (record: LoggedBanditRecord): number => {
    const cached = dmOf.get(record.decisionId);
    if (cached !== undefined) return cached;
    const prediction = directMethod.predict(record, record.chosenAction);
    if (typeof prediction !== "number" || !Number.isFinite(prediction)) {
      throw new EvaluationArgumentError(
        `direct-method model returned a non-finite prediction for record ${record.decisionId}`,
        { decisionId: record.decisionId, prediction }
      );
    }
    dmOf.set(record.decisionId, prediction);
    return prediction;
  };

  // DM average over ALL records (deterministic, in input order) —
  // every validated record contributes its DM prediction, even the
  // skipped ones (that is the doubly-robust benefit).
  let dmSum = 0;
  for (const record of records) {
    dmSum += dmFor(record);
  }

  // Correction term over used records only.
  let correctionSum = 0;
  for (const { record, weight } of used) {
    correctionSum += weight * (record.reward - dmFor(record));
  }

  const n = diagnostics.sampleSize;
  const estimate = n > 0 ? dmSum / n + correctionSum / n : 0;
  return {
    estimator: "dr",
    estimate,
    diagnostics,
  };
}
