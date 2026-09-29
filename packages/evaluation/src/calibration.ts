/**
 * CalibrationLedger (W1-010) — append-only prediction-vs-observation
 * records with SEGREGATED calibration statistics.
 *
 * A `CalibrationLedger` records probabilistic predictions against binary
 * observations and computes the classic probabilistic-calibration
 * statistics over them:
 *
 * - Brier score      = (1/N) Σ (p_i − o_i)²
 * - reliability curve = per-bucket meanPrediction vs meanObservation
 *   (k equal-width buckets over [0, 1]; p = 1 lands in the LAST bucket)
 * - ECE              = Σ_b (n_b / N) · |meanPred_b − meanObs_b| over
 *   non-empty buckets
 *
 * CALIBRATION LAW (worker-1 handoff, AGENTS.md evidence discipline):
 * - APPEND-ONLY: records are frozen on append; NO method mutates,
 *   rewrites, reorders or removes historical evidence. `snapshot()`
 *   returns a deep-frozen view whose content survives later appends
 *   unchanged (enforced by tests: append → snapshot → append more →
 *   first snapshot still verifies by contentDigest).
 * - EVIDENCE-CLASS SEGREGATION: every record carries a frozen
 *   `evidenceClass` (the frozen @reckon/contracts enum). Records whose
 *   class is research evidence (`fixture`, `simulated`,
 *   `counterfactual`) are SEGREGATED from observed evidence
 *   (`production-observed`, `controlled-local`, `staging`): every
 *   statistic is computed per category and the API NEVER exposes a
 *   mixed statistic (separate curves — never mixed).
 * - DETERMINISM: the record `contentDigest` is the sha256 of the
 *   canonical JSON of the record content WITHOUT the digest field (the
 *   @reckon/observability precedent). The same appends in the same
 *   order produce identical digests and identical snapshot digests.
 *
 * Laws: no Math.random, no Date.now / wall-clock reads — timestamps
 * (`ts`) are caller-supplied (contracts.md #4); tenant scoping is the
 * host's append discipline (records carry their source policy lineage).
 */
import {
  EvidenceClassSchema,
  TimestampMsSchema,
  contentDigest,
  type EvidenceClass,
  type TimestampMs,
} from "@reckon/contracts";
import {
  EvaluationArgumentError,
  EvaluationValidationError,
  toEvaluationIssues,
} from "./errors.js";

// ---------------------------------------------------------------------------
// Evidence-class segregation
// ---------------------------------------------------------------------------

/**
 * Calibration evidence category. Research evidence (fixture/simulated/
 * counterfactual) is segregated from observed evidence
 * (production-observed/controlled-local/staging): statistics are
 * computed per category and never mixed.
 */
export const CALIBRATION_EVIDENCE_CATEGORIES = ["observed", "research"] as const;
export type CalibrationEvidenceCategory = (typeof CALIBRATION_EVIDENCE_CATEGORIES)[number];

/** Frozen evidence classes that count as RESEARCH (not observed) evidence. */
export const RESEARCH_EVIDENCE_CLASSES: readonly EvidenceClass[] = [
  "fixture",
  "simulated",
  "counterfactual",
];

/** Frozen evidence classes that count as OBSERVED evidence. */
export const OBSERVED_EVIDENCE_CLASSES: readonly EvidenceClass[] = [
  "production-observed",
  "controlled-local",
  "staging",
];

/**
 * Documented mapping from the frozen evidence-class enum to the
 * calibration category. Total: every enum value maps to exactly one
 * category (segregation is exhaustive — no record is ever unclassified).
 */
export function evidenceCategoryOf(evidenceClass: EvidenceClass): CalibrationEvidenceCategory {
  return RESEARCH_EVIDENCE_CLASSES.includes(evidenceClass) ? "research" : "observed";
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** Source lineage of a prediction: which policy (and version) made it. */
export interface CalibrationSource {
  readonly policyId: string;
  readonly policyVersion: string;
}

/** What callers append to the ledger (digest is stamped by the ledger). */
export interface CalibrationAppendInput {
  /** Predicted probability of the binary event. Must lie in [0, 1]. */
  readonly prediction: number;
  /** Realized binary outcome of the event. Must be exactly 0 or 1. */
  readonly observation: number;
  /** Caller-supplied occurrence time (deterministic replay; contracts #4). */
  readonly ts: TimestampMs;
  /** Policy lineage of the prediction. */
  readonly source: CalibrationSource;
  /** Frozen evidence-class label (drives segregation). */
  readonly evidenceClass: EvidenceClass;
}

/**
 * One append-only calibration record: prediction vs observation with
 * source lineage and the sha256 `contentDigest` over the record content
 * WITHOUT the digest field (observability precedent).
 */
export interface CalibrationLedgerRecord {
  readonly prediction: number;
  readonly observation: number;
  readonly ts: TimestampMs;
  readonly source: CalibrationSource;
  readonly evidenceClass: EvidenceClass;
  /** sha256 of canonical JSON {evidenceClass, observation, prediction, source, ts}. */
  readonly contentDigest: string;
  /** The category this record is segregated into (derived, never re-labeled). */
  readonly evidenceCategory: CalibrationEvidenceCategory;
}

/** Deep-frozen view of the ledger at an instant (survives later appends). */
export interface CalibrationSnapshot {
  readonly size: number;
  /** Deep-frozen record copies — historical evidence, never rewritten. */
  readonly records: readonly CalibrationLedgerRecord[];
  /** sha256 over the ordered sequence of record contentDigests. */
  readonly snapshotDigest: string;
}

// ---------------------------------------------------------------------------
// Segregated statistics
// ---------------------------------------------------------------------------

/** One scalar statistic over one evidence category (never mixed). */
export interface CalibrationStatistic {
  readonly category: CalibrationEvidenceCategory;
  /** Records of this category in the statistic (0 ⇒ value 0, never NaN). */
  readonly sampleSize: number;
  readonly value: number;
}

/**
 * Segregated statistic pair: the observed-evidence value and the
 * research-evidence value. A mixed value does not exist in this API.
 */
export interface SegregatedCalibrationStatistic {
  readonly observed: CalibrationStatistic;
  readonly research: CalibrationStatistic;
}

/** One equal-width reliability bucket over [0, 1]. */
export interface ReliabilityBucket {
  /** Bucket interval [lower, upper); the last bucket closes at 1. */
  readonly lower: number;
  readonly upper: number;
  readonly count: number;
  /** 0 (not NaN) when count = 0. */
  readonly meanPrediction: number;
  /** Empirical event frequency in the bucket (0 when count = 0). */
  readonly meanObservation: number;
  /** |meanPrediction − meanObservation| (0 when count = 0). */
  readonly gap: number;
}

/** Reliability curve for ONE evidence category (never mixed). */
export interface ReliabilityCurve {
  readonly category: CalibrationEvidenceCategory;
  readonly bucketCount: number;
  readonly buckets: readonly ReliabilityBucket[];
  readonly sampleSize: number;
}

/** Segregated reliability curves: separate observed/research curves. */
export interface SegregatedReliabilityCurves {
  readonly observed: ReliabilityCurve;
  readonly research: ReliabilityCurve;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validationError(message: string, path: string, input: unknown): EvaluationValidationError {
  return new EvaluationValidationError(
    message,
    [{ path, message, code: "invalid_type" }],
    input
  );
}

function validateSource(source: unknown): CalibrationSource {
  if (source === null || typeof source !== "object") {
    throw validationError("calibration source must be {policyId, policyVersion}", "source", source);
  }
  const rec = source as Record<string, unknown>;
  if (typeof rec.policyId !== "string" || rec.policyId.length === 0) {
    throw validationError("calibration source.policyId must be a non-empty string", "source.policyId", source);
  }
  if (typeof rec.policyVersion !== "string" || rec.policyVersion.length === 0) {
    throw validationError("calibration source.policyVersion must be a non-empty string", "source.policyVersion", source);
  }
  return { policyId: rec.policyId, policyVersion: rec.policyVersion };
}

// ---------------------------------------------------------------------------
// CalibrationLedger
// ---------------------------------------------------------------------------

/**
 * Append-only ledger of prediction-vs-observation records.
 *
 * LAWS (enforced by tests):
 * - `append` is the ONLY way to add evidence; there is no update,
 *   rewrite, reorder or delete — historical records are frozen forever.
 * - `snapshot()` returns a deep-frozen view; later appends never change
 *   an earlier snapshot (verified by contentDigest).
 * - Every statistic method returns SEGREGATED per-category results;
 *   observed evidence and research evidence never mix.
 * - Deterministic: identical appends in the same order ⇒ identical
 *   record digests and identical snapshot digests.
 */
export class CalibrationLedger {
  readonly #records: CalibrationLedgerRecord[] = [];

  /** Append one record: validate, stamp digest, freeze, store. */
  append(input: CalibrationAppendInput): CalibrationLedgerRecord {
    if (input === null || typeof input !== "object") {
      throw validationError("calibration record must be an object", "", input);
    }
    const rec = input as unknown as Record<string, unknown>;
    if (
      typeof rec.prediction !== "number" ||
      !Number.isFinite(rec.prediction) ||
      rec.prediction < 0 ||
      rec.prediction > 1
    ) {
      throw validationError(
        "calibration prediction must be a finite number in [0, 1]",
        "prediction",
        input
      );
    }
    if (
      typeof rec.observation !== "number" ||
      !Number.isFinite(rec.observation) ||
      (rec.observation !== 0 && rec.observation !== 1)
    ) {
      throw validationError(
        "calibration observation must be exactly 0 or 1 (binary event outcome)",
        "observation",
        input
      );
    }
    const at = TimestampMsSchema.safeParse(rec.ts);
    if (!at.success) {
      throw new EvaluationValidationError(
        "calibration ts failed the frozen TimestampMs schema",
        toEvaluationIssues(at.error),
        input
      );
    }
    const evidence = EvidenceClassSchema.safeParse(rec.evidenceClass);
    if (!evidence.success) {
      throw new EvaluationValidationError(
        "calibration evidenceClass failed the frozen EvidenceClass enum",
        toEvaluationIssues(evidence.error),
        input
      );
    }
    const source = validateSource(rec.source);

    const evidenceClass = evidence.data;
    const record: CalibrationLedgerRecord = {
      prediction: rec.prediction,
      observation: rec.observation,
      ts: at.data,
      source,
      evidenceClass,
      evidenceCategory: evidenceCategoryOf(evidenceClass),
      // Digest over the record content WITHOUT the digest-derived and
      // category fields (category is a pure function of evidenceClass).
      contentDigest: contentDigest({
        evidenceClass,
        observation: rec.observation,
        prediction: rec.prediction,
        source,
        ts: at.data,
      }),
    };
    this.#records.push(deepFreeze(record));
    return record;
  }

  /** Total records appended so far (both categories). */
  get size(): number {
    return this.#records.length;
  }

  /** Per-category record counts (segregated sizes). */
  counts(): SegregatedCalibrationCounts {
    let observed = 0;
    let research = 0;
    for (const record of this.#records) {
      if (record.evidenceCategory === "observed") observed += 1;
      else research += 1;
    }
    return Object.freeze({ observed, research });
  }

  /**
   * Deep-frozen snapshot of the ledger NOW. Later appends never change
   * this view: the records are frozen copies and the snapshotDigest is
   * over the record sequence at snapshot time.
   */
  snapshot(): CalibrationSnapshot {
    const records = Object.freeze(this.#records.map((record) => deepFreeze({ ...record, source: { ...record.source } })));
    const snapshotDigest = contentDigest(this.#records.map((record) => record.contentDigest));
    return Object.freeze({ size: this.#records.length, records, snapshotDigest });
  }

  // -------------------------------------------------------------------------
  // Segregated statistics (never mixed)
  // -------------------------------------------------------------------------

  /**
   * Brier score per evidence category:
   * (1/N) Σ (prediction − observation)². Value 0 (never NaN) when a
   * category has no records.
   */
  brierScore(): SegregatedCalibrationStatistic {
    const sums = { observed: { n: 0, sum: 0 }, research: { n: 0, sum: 0 } };
    for (const record of this.#records) {
      const cell = sums[record.evidenceCategory];
      const delta = record.prediction - record.observation;
      cell.n += 1;
      cell.sum += delta * delta;
    }
    return Object.freeze({
      observed: Object.freeze({
        category: "observed",
        sampleSize: sums.observed.n,
        value: sums.observed.n > 0 ? sums.observed.sum / sums.observed.n : 0,
      }),
      research: Object.freeze({
        category: "research",
        sampleSize: sums.research.n,
        value: sums.research.n > 0 ? sums.research.sum / sums.research.n : 0,
      }),
    });
  }

  /**
   * Reliability curve per evidence category: k equal-width buckets over
   * [0, 1] (prediction 1 lands in the LAST bucket). Empty buckets carry
   * count 0 and zeroed means (never NaN).
   */
  reliabilityCurve(buckets: number): SegregatedReliabilityCurves {
    if (!Number.isInteger(buckets) || buckets < 1) {
      throw new EvaluationArgumentError(
        `bucket count must be an integer >= 1, got ${buckets}`
      );
    }

    interface BucketAcc {
      n: number;
      sumPrediction: number;
      sumObservation: number;
    }
    const makeAcc = (): BucketAcc[] =>
      Array.from({ length: buckets }, () => ({ n: 0, sumPrediction: 0, sumObservation: 0 }));
    const acc = { observed: makeAcc(), research: makeAcc() };
    const sizes = { observed: 0, research: 0 };

    for (const record of this.#records) {
      // p = 1 must land in the last bucket: clamp floor(p·k) to k−1.
      const index = Math.min(Math.floor(record.prediction * buckets), buckets - 1);
      const cell = acc[record.evidenceCategory][index]!;
      cell.n += 1;
      cell.sumPrediction += record.prediction;
      cell.sumObservation += record.observation;
      sizes[record.evidenceCategory] += 1;
    }

    const curveOf = (category: CalibrationEvidenceCategory): ReliabilityCurve => {
      const cells = acc[category];
      const curve = cells.map((cell, index) => {
        const meanPrediction = cell.n > 0 ? cell.sumPrediction / cell.n : 0;
        const meanObservation = cell.n > 0 ? cell.sumObservation / cell.n : 0;
        return Object.freeze({
          lower: index / buckets,
          upper: index === buckets - 1 ? 1 : (index + 1) / buckets,
          count: cell.n,
          meanPrediction,
          meanObservation,
          gap: cell.n > 0 ? Math.abs(meanPrediction - meanObservation) : 0,
        });
      });
      return Object.freeze({
        category,
        bucketCount: buckets,
        buckets: Object.freeze(curve),
        sampleSize: sizes[category],
      });
    };

    return Object.freeze({
      observed: curveOf("observed"),
      research: curveOf("research"),
    });
  }

  /**
   * Expected calibration error per evidence category:
   * ECE = Σ_b (n_b / N) · |meanPred_b − meanObs_b| over non-empty
   * buckets. Value 0 (never NaN) when a category has no records.
   */
  expectedCalibrationError(buckets: number): SegregatedCalibrationStatistic {
    // Reuse the reliability machinery; bucket-count validation happens
    // inside reliabilityCurve.
    const curves = this.reliabilityCurve(buckets);
    const eceOf = (curve: ReliabilityCurve): CalibrationStatistic => {
      if (curve.sampleSize === 0) {
        return Object.freeze({ category: curve.category, sampleSize: 0, value: 0 });
      }
      let ece = 0;
      for (const bucket of curve.buckets) {
        if (bucket.count === 0) continue;
        ece += (bucket.count / curve.sampleSize) * bucket.gap;
      }
      return Object.freeze({ category: curve.category, sampleSize: curve.sampleSize, value: ece });
    };
    return Object.freeze({
      observed: eceOf(curves.observed),
      research: eceOf(curves.research),
    });
  }
}

/** Segregated record counts. */
export interface SegregatedCalibrationCounts {
  readonly observed: number;
  readonly research: number;
}

// ---------------------------------------------------------------------------
// Freeze utilities (same discipline as @reckon/observability recorder)
// ---------------------------------------------------------------------------

/** Recursively freeze a record tree (append-only guarantee). */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
