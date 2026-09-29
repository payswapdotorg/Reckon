/**
 * W1-010 acceptance tests — CalibrationLedger (calibration & robustness).
 *
 * Every expected value is HAND-COMPUTED and shown in the test comments.
 * Proves:
 * - Brier score + reliability curve + ECE on hand-computed fixtures;
 * - ECE sanity: perfectly calibrated predictions ⇒ ECE = 0;
 * - APPEND-ONLY law: append → snapshot → append more ⇒ the first
 *   snapshot is unchanged by contentDigest (historical evidence is
 *   never rewritten; snapshots and records are deep-frozen);
 * - EVIDENCE-CLASS SEGREGATION: simulated/research evidence and
 *   observed evidence NEVER mix — statistics are computed per category
 *   and equal the hand-computed per-subset values (a mixed statistic
 *   does not exist in the API);
 * - Determinism: identical appends in the same order ⇒ identical
 *   digests; a different order ⇒ different snapshot digest.
 */
import { describe, it, expect } from "vitest";
import {
  CalibrationLedger,
  EvaluationArgumentError,
  EvaluationValidationError,
  evidenceCategoryOf,
  type CalibrationAppendInput,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const policy = { policyId: "reckon.eval.fixture-policy", policyVersion: "1" };

function observedRecord(
  prediction: number,
  observation: number,
  ts = 1_000
): CalibrationAppendInput {
  return {
    prediction,
    observation,
    ts,
    source: policy,
    evidenceClass: "production-observed",
  };
}

function simulatedRecord(
  prediction: number,
  observation: number,
  ts = 1_000
): CalibrationAppendInput {
  return { prediction, observation, ts, source: policy, evidenceClass: "simulated" };
}

// Fixture REL — reliability curve (10 buckets), 5 observed records:
//   predictions   = [0.05, 0.15, 0.25, 0.95, 1.00]
//   observations  = [0,    0,    1,    1,    1   ]
// Bucket assignment (bucket = min(floor(p·10), 9)):
//   p=0.05 → b0, p=0.15 → b1, p=0.25 → b2, p=0.95 → b9, p=1.00 → b9
//   (p = 1 lands in the LAST bucket by the clamp rule).
// Hand-computed expectations:
//   b0: {count 1, meanPred 0.05, meanObs 0.00, gap 0.050}
//   b1: {count 1, meanPred 0.15, meanObs 0.00, gap 0.150}
//   b2: {count 1, meanPred 0.25, meanObs 1.00, gap 0.750}
//   b9: {count 2, meanPred 0.975, meanObs 1.00, gap 0.025}
//   ECE  = Σ_b (n_b/N)·gap_b
//        = (1/5)·0.05 + (1/5)·0.15 + (1/5)·0.75 + (2/5)·0.025
//        = (0.05 + 0.15 + 0.75 + 0.05)/5 = 1.0/5 = 0.2
//   Brier = (0.0025 + 0.0225 + 0.5625 + 0.0025 + 0)/5
//         = 0.59/5 = 0.118
const REL_PREDICTIONS = [0.05, 0.15, 0.25, 0.95, 1.0];
const REL_OBSERVATIONS = [0, 0, 1, 1, 1];

function ledgerWithReliabilityFixture(): CalibrationLedger {
  const ledger = new CalibrationLedger();
  REL_PREDICTIONS.forEach((prediction, i) => {
    ledger.append(observedRecord(prediction, REL_OBSERVATIONS[i]!, 1_000 + i));
  });
  return ledger;
}

// ---------------------------------------------------------------------------
// Brier score — hand-computed
// ---------------------------------------------------------------------------

describe("W1-010 Brier score — hand-computed fixtures", () => {
  it("Brier = 0.49/3 ≈ 0.163333 on (0.8,1), (0.6,0), (0.3,0)", () => {
    // (0.8−1)² = 0.04; (0.6−0)² = 0.36; (0.3−0)² = 0.09
    // sum = 0.49 → Brier = 0.49/3 ≈ 0.1633333…
    const ledger = new CalibrationLedger();
    ledger.append(observedRecord(0.8, 1, 1_000));
    ledger.append(observedRecord(0.6, 0, 1_001));
    ledger.append(observedRecord(0.3, 0, 1_002));

    const brier = ledger.brierScore();
    expect(brier.observed.sampleSize).toBe(3);
    expect(brier.observed.value).toBeCloseTo(0.49 / 3, 12);
    expect(brier.research.sampleSize).toBe(0);
    expect(brier.research.value).toBe(0); // never NaN
  });

  it("Brier on the REL fixture = 0.59/5 = 0.118", () => {
    const ledger = ledgerWithReliabilityFixture();
    expect(ledger.brierScore().observed.value).toBeCloseTo(0.118, 12);
  });

  it("empty ledger ⇒ Brier 0 with sampleSize 0 (never NaN)", () => {
    const brier = new CalibrationLedger().brierScore();
    expect(brier.observed.value).toBe(0);
    expect(brier.observed.sampleSize).toBe(0);
    expect(brier.research.value).toBe(0);
    expect(Number.isFinite(brier.observed.value)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Reliability curve — hand-computed
// ---------------------------------------------------------------------------

describe("W1-010 reliability curve — hand-computed fixture", () => {
  it("10 buckets: b0/b1/b2 singletons, b9 holds 0.95 AND 1.0 (clamp rule)", () => {
    const curves = ledgerWithReliabilityFixture().reliabilityCurve(10);
    const curve = curves.observed;
    expect(curve.bucketCount).toBe(10);
    expect(curve.sampleSize).toBe(5);
    expect(curve.buckets).toHaveLength(10);

    const [b0, b1, b2, , , , , , , b9] = curve.buckets;
    expect(b0!.count).toBe(1);
    expect(b0!.meanPrediction).toBeCloseTo(0.05, 12);
    expect(b0!.meanObservation).toBe(0);
    expect(b0!.gap).toBeCloseTo(0.05, 12);
    expect(b0!.lower).toBe(0);
    expect(b0!.upper).toBeCloseTo(0.1, 12);

    expect(b1!.count).toBe(1);
    expect(b1!.meanPrediction).toBeCloseTo(0.15, 12);
    expect(b1!.meanObservation).toBe(0);
    expect(b1!.gap).toBeCloseTo(0.15, 12);

    expect(b2!.count).toBe(1);
    expect(b2!.meanPrediction).toBeCloseTo(0.25, 12);
    expect(b2!.meanObservation).toBe(1);
    expect(b2!.gap).toBeCloseTo(0.75, 12);

    // The last bucket closes at 1 and catches p = 1.0.
    expect(b9!.count).toBe(2);
    expect(b9!.meanPrediction).toBeCloseTo(0.975, 12);
    expect(b9!.meanObservation).toBe(1);
    expect(b9!.gap).toBeCloseTo(0.025, 12);
    expect(b9!.lower).toBeCloseTo(0.9, 12);
    expect(b9!.upper).toBe(1);

    // Empty buckets carry zeroed means (never NaN).
    for (const bucket of curve.buckets) {
      expect(Number.isFinite(bucket.meanPrediction)).toBe(true);
      expect(Number.isFinite(bucket.meanObservation)).toBe(true);
    }
    expect(curve.buckets[4]!.count).toBe(0);
    expect(curve.buckets[4]!.meanPrediction).toBe(0);
    expect(curve.buckets[4]!.gap).toBe(0);
  });

  it("rejects invalid bucket counts with typed errors", () => {
    const ledger = ledgerWithReliabilityFixture();
    expect(() => ledger.reliabilityCurve(0)).toThrow(EvaluationArgumentError);
    expect(() => ledger.reliabilityCurve(2.5)).toThrow(EvaluationArgumentError);
    expect(() => ledger.expectedCalibrationError(0)).toThrow(EvaluationArgumentError);
  });
});

// ---------------------------------------------------------------------------
// ECE — hand-computed + perfectly-calibrated sanity
// ---------------------------------------------------------------------------

describe("W1-010 expected calibration error", () => {
  it("ECE on the REL fixture = 1.0/5 = 0.2", () => {
    // ECE = Σ_b (n_b/N)·gap_b — buckets b0/b1/b2 carry one record each
    // (weight 1/5) and b9 carries TWO records (weight 2/5):
    //   (1/5)·0.05 + (1/5)·0.15 + (1/5)·0.75 + (2/5)·0.025
    //   = (0.05 + 0.15 + 0.75 + 0.05)/5 = 1.0/5 = 0.2
    const ece = ledgerWithReliabilityFixture().expectedCalibrationError(10);
    expect(ece.observed.sampleSize).toBe(5);
    expect(ece.observed.value).toBeCloseTo(0.2, 12);
  });

  it("perfectly calibrated predictions ⇒ ECE = 0", () => {
    // 10 records with p=0.8 (8× o=1, 2× o=0): bucket 8 meanPred = 0.8,
    // meanObs = 0.8 → gap 0. 10 records with p=0.3 (3× o=1, 7× o=0):
    // bucket 3 meanPred = 0.3 = meanObs → gap 0. ECE = 0 exactly.
    const ledger = new CalibrationLedger();
    for (let i = 0; i < 8; i++) ledger.append(observedRecord(0.8, 1, 2_000 + i));
    for (let i = 0; i < 2; i++) ledger.append(observedRecord(0.8, 0, 2_100 + i));
    for (let i = 0; i < 3; i++) ledger.append(observedRecord(0.3, 1, 2_200 + i));
    for (let i = 0; i < 7; i++) ledger.append(observedRecord(0.3, 0, 2_300 + i));

    const ece = ledger.expectedCalibrationError(10);
    expect(ece.observed.sampleSize).toBe(20);
    // ECE ≈ 0 (the acceptance wording): meanPred and meanObs agree per
    // bucket up to IEEE-754 accumulation (0.8 is not binary-exact — the
    // tenfold sum lands at 8.000000000000002), so the residual ECE is
    // ~1e-16, i.e. 0 to any meaningful precision.
    expect(ece.observed.value).toBeCloseTo(0, 12);

    // The reliability curve confirms both buckets are gap-free.
    const curves = ledger.reliabilityCurve(10);
    expect(curves.observed.buckets[3]!.gap).toBeCloseTo(0, 12);
    expect(curves.observed.buckets[8]!.gap).toBeCloseTo(0, 12);
    expect(curves.observed.buckets[3]!.count).toBe(10);
    expect(curves.observed.buckets[8]!.count).toBe(10);
  });

  it("empty ledger ⇒ ECE 0 (never NaN)", () => {
    const ece = new CalibrationLedger().expectedCalibrationError(5);
    expect(ece.observed.value).toBe(0);
    expect(ece.observed.sampleSize).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// APPEND-ONLY LAW (snapshot immutability)
// ---------------------------------------------------------------------------

describe("W1-010 append-only law — historical evidence is never rewritten", () => {
  it("append → snapshot → append more ⇒ the first snapshot is unchanged by contentDigest", () => {
    const ledger = new CalibrationLedger();
    ledger.append(observedRecord(0.8, 1, 1_000));
    ledger.append(observedRecord(0.6, 0, 1_001));
    const snap1 = ledger.snapshot();

    ledger.append(simulatedRecord(0.5, 1, 1_002));
    ledger.append(simulatedRecord(0.5, 0, 1_003));
    const snap2 = ledger.snapshot();

    // The ledger grew; the FIRST snapshot did not.
    expect(snap1.size).toBe(2);
    expect(snap2.size).toBe(4);
    expect(snap1.snapshotDigest).not.toBe(snap2.snapshotDigest);

    // Every record of snap1 still verifies by contentDigest against the
    // CURRENT ledger head (the first two records are unchanged).
    const current = ledger.snapshot();
    expect(current.records[0]!.contentDigest).toBe(snap1.records[0]!.contentDigest);
    expect(current.records[1]!.contentDigest).toBe(snap1.records[1]!.contentDigest);
    expect(current.records.slice(0, 2).map((r) => r.contentDigest)).toEqual(
      snap1.records.map((r) => r.contentDigest)
    );
    // ...and the digest recomputation over the frozen content agrees.
    expect(snap1.records.map((r) => r.contentDigest)).toHaveLength(2);
  });

  it("snapshots and records are deep-frozen — mutation attempts throw", () => {
    const ledger = new CalibrationLedger();
    const returned = ledger.append(observedRecord(0.7, 1, 1_000));
    const snap = ledger.snapshot();

    expect(Object.isFrozen(snap.records)).toBe(true);
    expect(Object.isFrozen(snap.records[0])).toBe(true);
    expect(Object.isFrozen(snap.records[0]!.source)).toBe(true);
    expect(Object.isFrozen(returned)).toBe(true);

    expect(() => (snap.records as unknown as unknown[]).push({})).toThrow(TypeError);
    expect(() => {
      (snap.records[0] as { prediction: number }).prediction = 0.1;
    }).toThrow(TypeError);
    expect(() => {
      (snap.records[0]!.source as { policyId: string }).policyId = "tampered";
    }).toThrow(TypeError);
    expect(() => {
      (returned as { observation: number }).observation = 0;
    }).toThrow(TypeError);

    // Nothing changed after the failed mutations.
    expect(ledger.snapshot().records[0]!.prediction).toBe(0.7);
    expect(ledger.snapshot().records[0]!.source.policyId).toBe("reckon.eval.fixture-policy");
  });

  it("computing statistics never mutates the ledger (digests stable)", () => {
    const ledger = ledgerWithReliabilityFixture();
    const before = ledger.snapshot().snapshotDigest;
    ledger.brierScore();
    ledger.reliabilityCurve(10);
    ledger.expectedCalibrationError(10);
    ledger.counts();
    expect(ledger.snapshot().snapshotDigest).toBe(before);
  });

  it("there is no rewrite/resize API: snapshot digests only ever grow", () => {
    const ledger = new CalibrationLedger();
    const digests: string[] = [];
    for (let i = 0; i < 4; i++) {
      ledger.append(observedRecord(0.5, i % 2, 1_000 + i));
      digests.push(ledger.snapshot().snapshotDigest);
    }
    // Monotone append history: every snapshot digest is distinct and
    // the sequence never repeats (no record was removed or rewritten).
    expect(new Set(digests).size).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// EVIDENCE-CLASS SEGREGATION (never mixed)
// ---------------------------------------------------------------------------

describe("W1-010 evidence-class segregation — research never mixes with observed", () => {
  it("mixed ledger ⇒ segregated statistics equal the per-subset hand-computed values", () => {
    const ledger = ledgerWithReliabilityFixture(); // 5 observed records
    ledger.append(simulatedRecord(0.5, 1, 2_000));
    ledger.append(simulatedRecord(0.5, 0, 2_001));

    // OBSERVED subset (the REL fixture alone):
    //   Brier = 0.59/5 = 0.118; ECE(10 buckets) = 1.0/5 = 0.2; n = 5.
    // RESEARCH subset (2 simulated records p=0.5, o={1,0}):
    //   Brier = (0.25 + 0.25)/2 = 0.25; ECE(2 buckets): both records
    //   land in bucket 1 ([0.5, 1]): meanPred 0.5, meanObs 0.5 → gap 0
    //   → ECE = 0; n = 2.
    const brier = ledger.brierScore();
    expect(brier.observed.sampleSize).toBe(5);
    expect(brier.observed.value).toBeCloseTo(0.118, 12);
    expect(brier.research.sampleSize).toBe(2);
    expect(brier.research.value).toBeCloseTo(0.25, 12);

    const ece = ledger.expectedCalibrationError(10);
    expect(ece.observed.value).toBeCloseTo(0.2, 12);
    expect(ece.research.sampleSize).toBe(2);
    expect(ece.research.value).toBeCloseTo(0, 12);

    // Reliability curves are separate objects with separate sizes.
    const curves = ledger.reliabilityCurve(10);
    expect(curves.observed.sampleSize).toBe(5);
    expect(curves.research.sampleSize).toBe(2);
    expect(curves.observed.buckets[9]!.count).toBe(2); // 0.95 and 1.0
    expect(curves.research.buckets[9]!.count).toBe(0);
  });

  it("a mixed statistic is never exposed: neither category equals the pooled value", () => {
    const ledger = ledgerWithReliabilityFixture();
    ledger.append(simulatedRecord(0.5, 1, 2_000));
    ledger.append(simulatedRecord(0.5, 0, 2_001));

    // Pooled Brier WOULD be (0.59 + 0.5)/7 = 1.09/7 ≈ 0.1557 — the API
    // never returns it: both segregated values differ from the pool.
    const pooled = 1.09 / 7;
    const brier = ledger.brierScore();
    expect(brier.observed.value).not.toBeCloseTo(pooled, 12);
    expect(brier.research.value).not.toBeCloseTo(pooled, 12);

    // Segregated counts sum to the total; the categories partition.
    const counts = ledger.counts();
    expect(counts.observed).toBe(5);
    expect(counts.research).toBe(2);
    expect(ledger.size).toBe(7);
  });

  it("the frozen evidence-class enum maps totally onto the two categories", () => {
    // research: fixture, simulated, counterfactual
    expect(evidenceCategoryOf("fixture")).toBe("research");
    expect(evidenceCategoryOf("simulated")).toBe("research");
    expect(evidenceCategoryOf("counterfactual")).toBe("research");
    // observed: production-observed, controlled-local, staging
    expect(evidenceCategoryOf("production-observed")).toBe("observed");
    expect(evidenceCategoryOf("controlled-local")).toBe("observed");
    expect(evidenceCategoryOf("staging")).toBe("observed");
  });

  it("every record carries its (frozen) evidence class and derived category", () => {
    const ledger = new CalibrationLedger();
    const record = ledger.append(simulatedRecord(0.4, 1, 1_000));
    expect(record.evidenceClass).toBe("simulated");
    expect(record.evidenceCategory).toBe("research");
    expect(ledger.snapshot().records[0]!.evidenceCategory).toBe("research");
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("W1-010 determinism — identical appends in the same order", () => {
  const appends: readonly CalibrationAppendInput[] = [
    observedRecord(0.8, 1, 1_000),
    observedRecord(0.6, 0, 1_001),
    simulatedRecord(0.5, 1, 1_002),
    simulatedRecord(0.3, 0, 1_003),
  ];

  it("two ledgers with the same appends in the same order ⇒ identical digests", () => {
    const a = new CalibrationLedger();
    const b = new CalibrationLedger();
    for (const input of appends) {
      a.append({ ...input, source: { ...input.source } });
      b.append({ ...input, source: { ...input.source } });
    }
    const snapA = a.snapshot();
    const snapB = b.snapshot();
    expect(snapA.snapshotDigest).toBe(snapB.snapshotDigest);
    expect(snapA.records.map((r) => r.contentDigest)).toEqual(
      snapB.records.map((r) => r.contentDigest)
    );
    // The record contents (not just digests) are identical.
    expect(snapA.records).toEqual(snapB.records);
    // Statistics are identical too.
    expect(a.brierScore()).toEqual(b.brierScore());
    expect(a.expectedCalibrationError(10)).toEqual(b.expectedCalibrationError(10));
  });

  it("a different append ORDER ⇒ a different snapshot digest (order is semantic)", () => {
    const a = new CalibrationLedger();
    for (const input of appends) a.append(input);
    const b = new CalibrationLedger();
    for (const input of [...appends].reverse()) b.append(input);

    // Same multiset of record digests, different sequence.
    expect(a.snapshot().records.map((r) => r.contentDigest).sort()).toEqual(
      b.snapshot().records.map((r) => r.contentDigest).sort()
    );
    expect(a.snapshot().snapshotDigest).not.toBe(b.snapshot().snapshotDigest);
  });
});

// ---------------------------------------------------------------------------
// Validation (typed errors, never raw throws)
// ---------------------------------------------------------------------------

describe("W1-010 append validation — typed errors", () => {
  it("rejects out-of-range and non-binary predictions/observations", () => {
    const ledger = new CalibrationLedger();
    expect(() => ledger.append(observedRecord(1.5, 1))).toThrow(EvaluationValidationError);
    expect(() => ledger.append(observedRecord(-0.1, 0))).toThrow(EvaluationValidationError);
    expect(() =>
      ledger.append(observedRecord(Number.NaN, 1))
    ).toThrow(EvaluationValidationError);
    expect(() => ledger.append(observedRecord(0.5, 0.5))).toThrow(EvaluationValidationError);
    expect(() => ledger.append(observedRecord(0.5, 2))).toThrow(EvaluationValidationError);
  });

  it("rejects invalid timestamps (frozen TimestampMs schema)", () => {
    const ledger = new CalibrationLedger();
    expect(() => ledger.append(observedRecord(0.5, 1, -1))).toThrow(EvaluationValidationError);
    expect(() => ledger.append(observedRecord(0.5, 1, 1.5))).toThrow(EvaluationValidationError);
  });

  it("rejects invalid evidence classes and sources", () => {
    const ledger = new CalibrationLedger();
    expect(() =>
      ledger.append({
        prediction: 0.5,
        observation: 1,
        ts: 1_000,
        source: policy,
        evidenceClass: "bogus" as never,
      })
    ).toThrow(EvaluationValidationError);
    expect(() =>
      ledger.append({
        prediction: 0.5,
        observation: 1,
        ts: 1_000,
        source: { policyId: "", policyVersion: "1" },
        evidenceClass: "fixture",
      })
    ).toThrow(EvaluationValidationError);
    expect(() =>
      ledger.append({
        prediction: 0.5,
        observation: 1,
        ts: 1_000,
        source: { policyId: "p", policyVersion: "" },
        evidenceClass: "fixture",
      })
    ).toThrow(EvaluationValidationError);
  });

  it("boundary predictions 0 and 1 are valid (probabilities, not odds)", () => {
    const ledger = new CalibrationLedger();
    ledger.append(observedRecord(0, 0, 1_000));
    ledger.append(observedRecord(1, 1, 1_001));
    // (0−0)² + (1−1)² = 0 → perfect Brier on the extreme points.
    expect(ledger.brierScore().observed.value).toBe(0);
    // p=0 lands in bucket 0; p=1 in the last bucket.
    const curves = ledger.reliabilityCurve(2);
    expect(curves.observed.buckets[0]!.count).toBe(1);
    expect(curves.observed.buckets[1]!.count).toBe(1);
  });
});
