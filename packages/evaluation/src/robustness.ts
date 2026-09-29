/**
 * RobustnessHarness (W1-010) — runs an evaluation against PERTURBED
 * inputs and reports estimate drift, stability flags and a digest.
 *
 * Perturbation suites (all DETERMINISTIC under the fixed seed config):
 * - (a) logged-propensity noise: clip the recorded propensity to a cap
 *   (min(p, cap)) or shrink it by a multiplicative factor
 *   (min(p·f, 1)); the estimator is re-run on the perturbed log.
 * - (b) feature-family dropout: drop k feature families from every
 *   logged context and re-run; when C(F, k) ≤ maxSubsets every subset
 *   is ENUMERATED (lexicographic order), otherwise `drawsPerCount`
 *   seeded subsets are drawn from deriveSeed(seed, "feature-dropout",
 *   k, draw). Reports the mean estimate (drift) and the variance
 *   across subsets.
 * - (c) seed ensembles: run the evaluation under n derived seeds
 *   deriveSeed(seed, "ensemble", i); reports mean, drift and the
 *   population variance across seeds.
 *
 * Output: `RobustnessReport` — per-perturbation estimate deltas,
 * stability flags (|drift| beyond the declared tolerance) and an
 * overall `robustnessDigest` (sha256 over the report content EXCLUDING
 * the injected-clock timestamp, so identical configs ⇒ identical
 * digests).
 *
 * LAWS: no Math.random, no Date.now / wall-clock reads (the clock is
 * INJECTED); the harness is PURE — it never mutates the task's records
 * (perturbations build fresh copies); every failure is a typed
 * @reckon/evaluation error.
 */
import { contentDigest, type TimestampMs } from "@reckon/contracts";
import { createRng, deriveSeed, type Rng } from "./rng.js";
import { EvaluationArgumentError } from "./errors.js";
import type { FeatureFamiliesShape, LoggedBanditRecord } from "./offline.js";

// ---------------------------------------------------------------------------
// Task seam
// ---------------------------------------------------------------------------

/**
 * The evaluation under robustness test. `run` MUST be deterministic
 * given (records, seed) and return a finite scalar estimate — offline
 * IPS/SNIPS/DR estimators ignore the seed; bandit-style evaluations
 * derive their world/policy seeds from it.
 *
 * Propensity and feature-dropout suites perturb `records`; a bandit
 * task that owns no logged records supplies an empty array and
 * configures only the seed-ensemble suite.
 */
export interface RobustnessTask {
  /** Human-readable label (appears in the report and its digest). */
  readonly label: string;
  /** The unperturbed log the perturbations derive from. */
  readonly records: readonly LoggedBanditRecord[];
  /**
   * Run the evaluation over (possibly perturbed) records under a run
   * seed. Pure; deterministic; returns a finite number.
   */
  readonly run: (records: readonly LoggedBanditRecord[], seed: string) => number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** (a) Logged-propensity perturbations. */
export interface PropensityPerturbationSpec {
  /** Clip recorded propensities to at most `cap` (each cap in (0, 1]). */
  readonly clips?: readonly number[];
  /** Shrink recorded propensities by these factors (each > 0; p' = min(p·f, 1)). */
  readonly shrinkFactors?: readonly number[];
}

/** (b) Feature-family dropout perturbations. */
export interface FeatureDropoutSpec {
  /** Numbers of families k to drop (each an integer in [0, F]). */
  readonly dropCounts: readonly number[];
  /**
   * Enumerate every C(F, k) subset when it is at most this many
   * (default 64); beyond that, seeded sampling takes over.
   */
  readonly maxSubsets?: number;
  /** Seeded subset draws per k in the sampling branch (default 32). */
  readonly drawsPerCount?: number;
}

/** (c) Seed ensemble. */
export interface SeedEnsembleSpec {
  /** Number of derived seeds n (integer >= 1). */
  readonly size: number;
}

export interface RobustnessHarnessConfig {
  /** Declared absolute tolerance on estimate drift (>= 0). */
  readonly tolerance: number;
  /** Base seed — every derived seed in the harness descends from it. */
  readonly seed: string;
  /** INJECTED clock (epoch ms) — the harness never reads the wall clock. */
  readonly clock: () => TimestampMs;
  readonly propensity?: PropensityPerturbationSpec;
  readonly featureDropout?: FeatureDropoutSpec;
  readonly seedEnsemble?: SeedEnsembleSpec;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export const PERTURBATION_KINDS = [
  "propensity-clip",
  "propensity-shrink",
  "feature-dropout",
  "seed-ensemble",
] as const;
export type PerturbationKind = (typeof PERTURBATION_KINDS)[number];

/** One perturbation's effect on the estimate. */
export interface PerturbationResult {
  readonly kind: PerturbationKind;
  /** Stable machine label, e.g. "clip:0.5", "shrink:0.8", "drop-k:2", "ensemble:8". */
  readonly label: string;
  /** Perturbation draws (subsets or seeds); 1 for scalar perturbations. */
  readonly sampleCount: number;
  readonly baselineEstimate: number;
  /** Perturbed estimate (mean across draws for multi-draw perturbations). */
  readonly estimate: number;
  /** estimate − baselineEstimate (drift). */
  readonly delta: number;
  /** Population variance across draws (multi-draw perturbations only). */
  readonly variance: number | undefined;
  /** |delta| ≤ tolerance. */
  readonly stable: boolean;
}

export interface RobustnessReport {
  readonly label: string;
  /** Injected-clock time of the report (EXCLUDED from the digest). */
  readonly ts: TimestampMs;
  readonly tolerance: number;
  readonly baselineEstimate: number;
  readonly results: readonly PerturbationResult[];
  /** Labels of perturbations whose drift exceeded the tolerance. */
  readonly stabilityFlags: readonly string[];
  /** True iff stabilityFlags is empty. */
  readonly robust: boolean;
  /**
   * sha256 over {baseline, label, results, tolerance} — the timestamp
   * is excluded so identical configs produce identical digests.
   */
  readonly robustnessDigest: string;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function assertFiniteNumber(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new EvaluationArgumentError(`${what} must be a finite number, got ${value}`);
  }
  return value;
}

function assertNonEmptyString(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new EvaluationArgumentError(`${what} must be a non-empty string`);
  }
  return value;
}

/** binomial C(n, k), bailing out once it exceeds `cap` (overflow-safe). */
function binomialAtMost(n: number, k: number, cap: number): number {
  if (k < 0 || k > n) return 0;
  const symmetricK = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= symmetricK; i++) {
    result = (result * (n - symmetricK + i)) / i;
    if (result > cap) return cap + 1;
  }
  return result;
}

/** All k-subsets of `items` in lexicographic order (deterministic). */
function combinations<T>(items: readonly T[], k: number): T[][] {
  const out: T[][] = [];
  const pick: T[] = [];
  const walk = (start: number): void => {
    if (pick.length === k) {
      out.push([...pick]);
      return;
    }
    const remaining = k - pick.length;
    for (let i = start; i <= items.length - remaining; i++) {
      pick.push(items[i]!);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  return out;
}

/** Draw k distinct items (seeded, uniform without replacement), sorted. */
function sampleSubset(rng: Rng, items: readonly string[], k: number): string[] {
  const pool = [...items];
  const chosen: string[] = [];
  for (let i = 0; i < k; i++) {
    const index = rng.nextBelow(pool.length);
    chosen.push(pool.splice(index, 1)[0]!);
  }
  return chosen.sort();
}

// ---------------------------------------------------------------------------
// Perturbations (pure: always fresh copies, inputs never mutated)
// ---------------------------------------------------------------------------

/**
 * Clip recorded propensities: p' = min(p, cap). Records with a missing
 * or zero propensity keep their skip semantics (untouched).
 */
function clipPropensities(
  records: readonly LoggedBanditRecord[],
  cap: number
): LoggedBanditRecord[] {
  return records.map((record) => {
    const p = record.loggedPropensity;
    if (p === undefined || p <= 0) return record;
    const clipped = Math.min(p, cap);
    if (clipped === p) return record;
    return { ...record, loggedPropensity: clipped };
  });
}

/**
 * Shrink recorded propensities: p' = min(p · factor, 1) (a factor > 1
 * GROWS the propensity, still clamped to 1).
 */
function shrinkPropensities(
  records: readonly LoggedBanditRecord[],
  factor: number
): LoggedBanditRecord[] {
  return records.map((record) => {
    const p = record.loggedPropensity;
    if (p === undefined || p <= 0) return record;
    const shrunk = Math.min(p * factor, 1);
    if (shrunk === p) return record;
    return { ...record, loggedPropensity: shrunk };
  });
}

/** Sorted union of the family names across all records' contexts. */
function familyNamesOf(records: readonly LoggedBanditRecord[]): string[] {
  const names = new Set<string>();
  for (const record of records) {
    for (const family of Object.keys(record.context.families)) {
      names.add(family);
    }
  }
  return [...names].sort();
}

/**
 * Drop the named feature families from every record's context. The
 * perturbed context keeps its families/names key order sorted and gets
 * a fresh contentDigest over the perturbed families/names.
 */
function dropFamilies(
  records: readonly LoggedBanditRecord[],
  dropped: readonly string[]
): LoggedBanditRecord[] {
  const droppedSet = new Set(dropped);
  return records.map((record) => {
    const families: Record<string, readonly number[]> = {};
    const names: Record<string, readonly string[]> = {};
    for (const family of Object.keys(record.context.families).sort()) {
      if (droppedSet.has(family)) continue;
      families[family] = record.context.families[family]!;
      names[family] = record.context.names[family] ?? [];
    }
    const context: FeatureFamiliesShape = {
      families,
      names,
      digest: contentDigest({ families, names }),
    };
    return { ...record, context };
  });
}

/** Population variance over the values (0 for a single value). */
function populationVariance(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let mean = 0;
  for (const value of values) mean += value;
  mean /= values.length;
  let sumSquares = 0;
  for (const value of values) sumSquares += (value - mean) * (value - mean);
  return sumSquares / values.length;
}

// ---------------------------------------------------------------------------
// RobustnessHarness
// ---------------------------------------------------------------------------

/**
 * Deterministic robustness harness: construct once with a validated
 * config, run any number of tasks. Pure with respect to (config,
 * task): identical configs + identical tasks ⇒ identical reports
 * (identical robustnessDigest), no matter the wall-clock.
 */
export class RobustnessHarness {
  readonly #tolerance: number;
  readonly #seed: string;
  readonly #clock: () => TimestampMs;
  readonly #clips: readonly number[];
  readonly #shrinkFactors: readonly number[];
  readonly #dropCounts: readonly number[];
  readonly #maxSubsets: number;
  readonly #drawsPerCount: number;
  readonly #ensembleSize: number | undefined;
  readonly #hasRecordPerturbations: boolean;

  constructor(config: RobustnessHarnessConfig) {
    if (config === null || typeof config !== "object") {
      throw new EvaluationArgumentError("robustness harness config must be an object");
    }
    this.#tolerance = assertFiniteNumber(config.tolerance, "tolerance");
    if (this.#tolerance < 0) {
      throw new EvaluationArgumentError(`tolerance must be >= 0, got ${config.tolerance}`);
    }
    this.#seed = assertNonEmptyString(config.seed, "seed");
    if (typeof config.clock !== "function") {
      throw new EvaluationArgumentError("robustness harness requires an injected clock function");
    }
    this.#clock = config.clock;

    this.#clips = config.propensity?.clips ?? [];
    for (const cap of this.#clips) {
      assertFiniteNumber(cap, "propensity clip cap");
      if (!(cap > 0) || cap > 1) {
        throw new EvaluationArgumentError(`propensity clip caps must lie in (0, 1], got ${cap}`);
      }
    }
    this.#shrinkFactors = config.propensity?.shrinkFactors ?? [];
    for (const factor of this.#shrinkFactors) {
      assertFiniteNumber(factor, "propensity shrink factor");
      if (!(factor > 0)) {
        throw new EvaluationArgumentError(`propensity shrink factors must be > 0, got ${factor}`);
      }
    }
    const propensityConfigured =
      config.propensity !== undefined &&
      this.#clips.length + this.#shrinkFactors.length > 0;
    if (config.propensity !== undefined && !propensityConfigured) {
      throw new EvaluationArgumentError(
        "propensity suite configured with no clips or shrink factors"
      );
    }

    this.#dropCounts = config.featureDropout?.dropCounts ?? [];
    this.#maxSubsets = config.featureDropout?.maxSubsets ?? 64;
    this.#drawsPerCount = config.featureDropout?.drawsPerCount ?? 32;
    for (const k of this.#dropCounts) {
      if (!Number.isInteger(k) || k < 0) {
        throw new EvaluationArgumentError(
          `feature-dropout dropCounts must be non-negative integers, got ${k}`
        );
      }
    }
    if (!Number.isInteger(this.#maxSubsets) || this.#maxSubsets < 1) {
      throw new EvaluationArgumentError(`maxSubsets must be an integer >= 1, got ${this.#maxSubsets}`);
    }
    if (!Number.isInteger(this.#drawsPerCount) || this.#drawsPerCount < 1) {
      throw new EvaluationArgumentError(
        `drawsPerCount must be an integer >= 1, got ${this.#drawsPerCount}`
      );
    }
    const dropoutConfigured = config.featureDropout !== undefined && this.#dropCounts.length > 0;

    this.#ensembleSize = config.seedEnsemble?.size;
    if (this.#ensembleSize !== undefined) {
      if (!Number.isInteger(this.#ensembleSize) || this.#ensembleSize < 1) {
        throw new EvaluationArgumentError(
          `seed-ensemble size must be an integer >= 1, got ${this.#ensembleSize}`
        );
      }
    }
    const ensembleConfigured = this.#ensembleSize !== undefined;

    this.#hasRecordPerturbations = propensityConfigured || dropoutConfigured;
    if (!propensityConfigured && !dropoutConfigured && !ensembleConfigured) {
      throw new EvaluationArgumentError(
        "robustness harness requires at least one perturbation suite (propensity, featureDropout or seedEnsemble)"
      );
    }
  }

  /** Run the task against every configured perturbation. */
  run(task: RobustnessTask): RobustnessReport {
    if (task === null || typeof task !== "object") {
      throw new EvaluationArgumentError("robustness task must be an object");
    }
    const label = assertNonEmptyString(task.label, "task.label");
    if (!Array.isArray(task.records)) {
      throw new EvaluationArgumentError("task.records must be an array of logged records");
    }
    if (typeof task.run !== "function") {
      throw new EvaluationArgumentError("task.run must be a function");
    }
    if (this.#hasRecordPerturbations && task.records.length === 0) {
      throw new EvaluationArgumentError(
        "propensity/feature-dropout perturbations require at least one logged record"
      );
    }

    const runTask = (records: readonly LoggedBanditRecord[], seed: string): number => {
      const estimate = task.run(records, seed);
      if (typeof estimate !== "number" || !Number.isFinite(estimate)) {
        throw new EvaluationArgumentError(
          `task "${label}" returned a non-finite estimate under seed ${seed}`
        );
      }
      return estimate;
    };

    // Baseline: unperturbed records under the documented baseline seed.
    const baselineSeed = deriveSeed(this.#seed, "robustness-baseline");
    const baselineEstimate = runTask(task.records, baselineSeed);

    const results: PerturbationResult[] = [];

    // (a) logged-propensity perturbations — run under the baseline seed.
    for (const cap of this.#clips) {
      const estimate = runTask(clipPropensities(task.records, cap), baselineSeed);
      const delta = estimate - baselineEstimate;
      results.push(
        freezeResult({
          kind: "propensity-clip",
          label: `clip:${cap}`,
          sampleCount: 1,
          baselineEstimate,
          estimate,
          delta,
          variance: undefined,
          stable: Math.abs(delta) <= this.#tolerance,
        })
      );
    }
    for (const factor of this.#shrinkFactors) {
      const estimate = runTask(shrinkPropensities(task.records, factor), baselineSeed);
      const delta = estimate - baselineEstimate;
      results.push(
        freezeResult({
          kind: "propensity-shrink",
          label: `shrink:${factor}`,
          sampleCount: 1,
          baselineEstimate,
          estimate,
          delta,
          variance: undefined,
          stable: Math.abs(delta) <= this.#tolerance,
        })
      );
    }

    // (b) feature-family dropout — enumerate or seeded-sample subsets.
    if (this.#dropCounts.length > 0) {
      const families = familyNamesOf(task.records);
      for (const k of this.#dropCounts) {
        if (k > families.length) {
          throw new EvaluationArgumentError(
            `feature-dropout k=${k} exceeds the available family count (${families.length})`
          );
        }
        const subsets: string[][] = [];
        if (binomialAtMost(families.length, k, this.#maxSubsets) <= this.#maxSubsets) {
          subsets.push(...combinations(families, k));
        } else {
          for (let draw = 0; draw < this.#drawsPerCount; draw++) {
            const rng = createRng(deriveSeed(this.#seed, "feature-dropout", k, draw));
            subsets.push(sampleSubset(rng, families, k));
          }
        }
        const estimates = subsets.map((subset) =>
          runTask(dropFamilies(task.records, subset), baselineSeed)
        );
        const estimate =
          estimates.reduce((acc, value) => acc + value, 0) / Math.max(1, estimates.length);
        const delta = estimate - baselineEstimate;
        results.push(
          freezeResult({
            kind: "feature-dropout",
            label: `drop-k:${k}`,
            sampleCount: estimates.length,
            baselineEstimate,
            estimate,
            delta,
            variance: populationVariance(estimates),
            stable: Math.abs(delta) <= this.#tolerance,
          })
        );
      }
    }

    // (c) seed ensemble — n derived run seeds over the unperturbed records.
    if (this.#ensembleSize !== undefined) {
      const estimates: number[] = [];
      for (let i = 0; i < this.#ensembleSize; i++) {
        const runSeed = deriveSeed(this.#seed, "ensemble", i);
        estimates.push(runTask(task.records, runSeed));
      }
      const estimate =
        estimates.reduce((acc, value) => acc + value, 0) / Math.max(1, estimates.length);
      const delta = estimate - baselineEstimate;
      results.push(
        freezeResult({
          kind: "seed-ensemble",
          label: `ensemble:${this.#ensembleSize}`,
          sampleCount: estimates.length,
          baselineEstimate,
          estimate,
          delta,
          variance: populationVariance(estimates),
          stable: Math.abs(delta) <= this.#tolerance,
        })
      );
    }

    const stabilityFlags = results.filter((result) => !result.stable).map((result) => result.label);
    // Digest over the deterministic content ONLY (ts excluded):
    // identical configs + identical tasks ⇒ identical digest.
    const robustnessDigest = contentDigest({
      baselineEstimate,
      label,
      results: results.map((result) => ({
        baselineEstimate: result.baselineEstimate,
        delta: result.delta,
        estimate: result.estimate,
        kind: result.kind,
        label: result.label,
        sampleCount: result.sampleCount,
        stable: result.stable,
        variance: result.variance ?? null,
      })),
      tolerance: this.#tolerance,
    });

    return Object.freeze({
      label,
      ts: this.#clock(),
      tolerance: this.#tolerance,
      baselineEstimate,
      results: Object.freeze(results),
      stabilityFlags: Object.freeze(stabilityFlags),
      robust: stabilityFlags.length === 0,
      robustnessDigest,
    });
  }
}

function freezeResult(result: PerturbationResult): PerturbationResult {
  return Object.freeze(result);
}
