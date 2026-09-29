/**
 * W1-007 acceptance tests — offline policy evaluation (IPS / SNIPS / DR).
 *
 * Every expected value below is HAND-COMPUTED and shown in the test
 * comments; the assertions document the exact estimator semantics.
 * Also proves: degenerate-input handling (skip + count, never divide
 * by zero), tenant isolation, and determinism/purity.
 */
import { describe, it, expect } from "vitest";
import type { TenantScope } from "@reckon/contracts";
import {
  estimateDoublyRobust,
  estimateIPS,
  estimateSNIPS,
  DirectMethodRequiredError,
  EvaluationTenantMismatchError,
  EvaluationValidationError,
  EvaluationArgumentError,
  type DirectMethodModel,
  type LoggedBanditRecord,
  type StochasticTargetPolicy,
} from "../src/index.js";

const tenant: TenantScope = { tenantId: "tenant-a" };
const otherTenant: TenantScope = { tenantId: "tenant-b" };

const context = {
  families: { bias: [1] },
  names: { bias: ["bias"] },
  digest: "fixture-context",
};

function record(overrides: Partial<LoggedBanditRecord> = {}): LoggedBanditRecord {
  return {
    decisionId: "d-1",
    tenant,
    context,
    actionSpace: ["A", "B"],
    chosenAction: "A",
    loggedPropensity: 0.5,
    reward: 1,
    occurredAt: 1_000,
    ...overrides,
  };
}

/** Target policy: deterministic on action "A". */
const targetOnA: StochasticTargetPolicy = {
  actionProbability: (_record, action) => (action === "A" ? 1 : 0),
};

/** Target policy: uniform over both actions (matches the logging policy). */
const targetUniform: StochasticTargetPolicy = {
  actionProbability: (_record, _action) => 0.5,
};

/** Context-independent direct-method model with a fixed prediction per action. */
function dmWith(predA: number, predB: number): DirectMethodModel {
  return {
    predict: (_record, action) => (action === "A" ? predA : predB),
  };
}

// ---------------------------------------------------------------------------
// Fixture A — 2 actions, uniform logging p = 0.5, 4 records.
// Hand-computed expectations (target = deterministic on A):
//   weights: 2, 2, 0, 0
//   IPS   = (2·1 + 2·0 + 0·1 + 0·0) / 4 = 2/4 = 0.5
//   SNIPS = (2·1 + 2·0) / (2+2+0+0)     = 2/4 = 0.5
//   ESS   = 4² / (2² + 2²)              = 16/8 = 2
// ---------------------------------------------------------------------------

const fixtureA: readonly LoggedBanditRecord[] = [
  record({ decisionId: "d-1", chosenAction: "A", reward: 1, loggedPropensity: 0.5 }),
  record({ decisionId: "d-2", chosenAction: "A", reward: 0, loggedPropensity: 0.5 }),
  record({ decisionId: "d-3", chosenAction: "B", reward: 1, loggedPropensity: 0.5 }),
  record({ decisionId: "d-4", chosenAction: "B", reward: 0, loggedPropensity: 0.5 }),
];

describe("W1-007 IPS — hand-computed fixture", () => {
  it("IPS = 0.5 (weights 2,2,0,0 over N=4)", () => {
    const result = estimateIPS(tenant, fixtureA, targetOnA);
    expect(result.estimator).toBe("ips");
    expect(result.estimate).toBeCloseTo(0.5, 12);
    expect(result.diagnostics.sampleSize).toBe(4);
    expect(result.diagnostics.usedCount).toBe(4);
    expect(result.diagnostics.skippedMissingPropensity).toBe(0);
    expect(result.diagnostics.skippedZeroPropensity).toBe(0);
    expect(result.diagnostics.maxWeight).toBeCloseTo(2, 12);
  });

  it("on-policy target (π = p) ⇒ IPS = mean reward = 0.5, ESS = 4", () => {
    // weights: 1,1,1,1 → IPS = (1+0+1+0)/4 = 0.5; ESS = 4²/4 = 4.
    const result = estimateIPS(tenant, fixtureA, targetUniform);
    expect(result.estimate).toBeCloseTo(0.5, 12);
    expect(result.diagnostics.effectiveSampleSize).toBeCloseTo(4, 12);
  });
});

describe("W1-007 SNIPS — hand-computed fixture", () => {
  it("SNIPS = 0.5 (Σwr = 2, Σw = 4)", () => {
    const result = estimateSNIPS(tenant, fixtureA, targetOnA);
    expect(result.estimator).toBe("snips");
    expect(result.estimate).toBeCloseTo(0.5, 12);
    expect(result.diagnostics.sumWeights).toBeCloseTo(4, 12);
  });

  it("SNIPS degenerates to 0 when the target never matches any logged action (Σw = 0)", () => {
    // Target is deterministic on action "C", which never appears as a
    // chosen action: π_target(chosen) = 0 for every record ⇒ all
    // weights are 0 ⇒ Σw = 0 ⇒ SNIPS = 0 (recorded, not an error).
    const targetOnC: StochasticTargetPolicy = {
      actionProbability: (_record, action) => (action === "C" ? 1 : 0),
    };
    const result = estimateSNIPS(tenant, fixtureA, targetOnC);
    expect(result.diagnostics.sumWeights).toBe(0);
    expect(result.estimate).toBe(0);
  });
});

describe("W1-007 DR — hand-computed fixtures", () => {
  it("DR with an imperfect DM model = 0.4", () => {
    // μ̂(x,A)=0.4, μ̂(x,B)=0.2:
    //   DM average over all 4 records = (0.4+0.4+0.2+0.2)/4 = 0.3
    //   correction = (1/4)·[2(1−0.4) + 2(0−0.4) + 0 + 0] = 0.4/4 = 0.1
    //   DR = 0.3 + 0.1 = 0.4
    const result = estimateDoublyRobust(tenant, fixtureA, targetOnA, dmWith(0.4, 0.2));
    expect(result.estimator).toBe("dr");
    expect(result.estimate).toBeCloseTo(0.4, 12);
  });

  it("DR with the correct DM model = 0.5 (correction vanishes)", () => {
    // μ̂(x,A)=μ̂(x,B)=0.5 (the true means):
    //   DM average = 0.5; correction = (1/4)[2(0.5) + 2(−0.5)] = 0 → DR = 0.5.
    const result = estimateDoublyRobust(tenant, fixtureA, targetOnA, dmWith(0.5, 0.5));
    expect(result.estimate).toBeCloseTo(0.5, 12);
  });

  it("DR requires a direct-method model (typed error)", () => {
    expect(() =>
      estimateDoublyRobust(tenant, fixtureA, targetOnA, undefined as unknown as DirectMethodModel)
    ).toThrow(DirectMethodRequiredError);
  });

  it("DR skip semantics: skipped records still contribute their DM prediction", () => {
    // Records: used (A, r=1, p=0.5) → w=2; skipped-missing (A, r=0);
    // skipped-zero (A, r=1, p=0). DM constant 0.5.
    //   DM average over ALL 3 = 0.5
    //   correction = (1/3)·[2(1−0.5)] = 1/3
    //   DR = 0.5 + 1/3 = 5/6 ≈ 0.833333…
    const records: readonly LoggedBanditRecord[] = [
      record({ decisionId: "u-1", chosenAction: "A", reward: 1, loggedPropensity: 0.5 }),
      record({ decisionId: "s-1", chosenAction: "A", reward: 0, loggedPropensity: undefined }),
      record({ decisionId: "s-2", chosenAction: "A", reward: 1, loggedPropensity: 0 }),
    ];
    const result = estimateDoublyRobust(tenant, records, targetOnA, dmWith(0.5, 0.5));
    expect(result.diagnostics.usedCount).toBe(1);
    expect(result.diagnostics.skippedMissingPropensity).toBe(1);
    expect(result.diagnostics.skippedZeroPropensity).toBe(1);
    expect(result.estimate).toBeCloseTo(0.5 + 1 / 3, 12);
  });
});

// ---------------------------------------------------------------------------
// Fixture C — skips + clipping.
// Records (target deterministic on A, actionSpace {A,B}):
//   1. (A, r=1, p=0.5)        → w=2 (clipped to 1.5 when maxWeight=1.5)
//   2. (A, r=0, p missing)    → skippedMissingPropensity
//   3. (A, r=1, p=0)          → skippedZeroPropensity
//   4. (C, r=1, p=0.5)        → skippedUnknownAction (C ∉ actionSpace)
//   5. (A, r=1, p=0.5)        → w=2 (clipped to 1.5)
// Unclipped: IPS = (2+2)/5 = 0.8. Clipped at 1.5: IPS = (1.5+1.5)/5 = 0.6;
// SNIPS = 3/3 = 1; ESS = 3²/4.5 = 2; clippedCount = 2.
// ---------------------------------------------------------------------------

const fixtureC: readonly LoggedBanditRecord[] = [
  record({ decisionId: "c-1", chosenAction: "A", reward: 1, loggedPropensity: 0.5 }),
  record({ decisionId: "c-2", chosenAction: "A", reward: 0, loggedPropensity: undefined }),
  record({ decisionId: "c-3", chosenAction: "A", reward: 1, loggedPropensity: 0 }),
  record({ decisionId: "c-4", chosenAction: "C", reward: 1, loggedPropensity: 0.5 }),
  record({ decisionId: "c-5", chosenAction: "A", reward: 1, loggedPropensity: 0.5 }),
];

describe("W1-007 — degenerate inputs and clipping", () => {
  it("missing/zero propensity and unknown actions are skipped + counted, never divided by zero", () => {
    const result = estimateIPS(tenant, fixtureC, targetOnA);
    expect(result.diagnostics.sampleSize).toBe(5);
    expect(result.diagnostics.usedCount).toBe(2);
    expect(result.diagnostics.skippedMissingPropensity).toBe(1);
    expect(result.diagnostics.skippedZeroPropensity).toBe(1);
    expect(result.diagnostics.skippedUnknownAction).toBe(1);
    expect(result.estimate).toBeCloseTo(0.8, 12); // (2·1 + 2·1)/5
    expect(Number.isFinite(result.estimate)).toBe(true);
  });

  it("clipping at maxWeight=1.5: IPS = 0.6, SNIPS = 1.0, clippedCount = 2, ESS = 2", () => {
    const ips = estimateIPS(tenant, fixtureC, targetOnA, { maxWeight: 1.5 });
    expect(ips.estimate).toBeCloseTo(0.6, 12);
    expect(ips.diagnostics.clippedCount).toBe(2);
    expect(ips.diagnostics.maxWeight).toBeCloseTo(1.5, 12);

    const snips = estimateSNIPS(tenant, fixtureC, targetOnA, { maxWeight: 1.5 });
    expect(snips.estimate).toBeCloseTo(1.0, 12);
    expect(snips.diagnostics.effectiveSampleSize).toBeCloseTo(2, 12);
  });

  it("DR with clipping = DM average + clipped correction = 0.8", () => {
    // DM constant 0.5 over all 5 records → 0.5;
    // correction = (1/5)·[1.5(1−0.5) + 1.5(1−0.5)] = 1.5/5 = 0.3 → DR = 0.8.
    const result = estimateDoublyRobust(tenant, fixtureC, targetOnA, dmWith(0.5, 0.5), {
      maxWeight: 1.5,
    });
    expect(result.estimate).toBeCloseTo(0.8, 12);
  });

  it("empty log set ⇒ estimate 0 (never NaN), ESS 0", () => {
    const ips = estimateIPS(tenant, [], targetOnA);
    expect(ips.estimate).toBe(0);
    expect(ips.diagnostics.sampleSize).toBe(0);
    expect(ips.diagnostics.effectiveSampleSize).toBe(0);
    const snips = estimateSNIPS(tenant, [], targetOnA);
    expect(snips.estimate).toBe(0);
    const dr = estimateDoublyRobust(tenant, [], targetOnA, dmWith(0.5, 0.5));
    expect(dr.estimate).toBe(0);
  });

  it("all records unusable (missing propensities) ⇒ estimate 0, usedCount 0, ESS 0", () => {
    const records = [
      record({ decisionId: "m-1", loggedPropensity: undefined }),
      record({ decisionId: "m-2", loggedPropensity: undefined }),
    ];
    const result = estimateIPS(tenant, records, targetOnA);
    expect(result.estimate).toBe(0);
    expect(result.diagnostics.usedCount).toBe(0);
    expect(result.diagnostics.effectiveSampleSize).toBe(0);
  });

  it("rejects invalid options and records with typed errors", () => {
    expect(() => estimateIPS(tenant, fixtureA, targetOnA, { maxWeight: 0 })).toThrow(
      EvaluationArgumentError
    );
    expect(() =>
      estimateIPS(tenant, [
        record({ decisionId: "bad-r", reward: Number.NaN }),
      ], targetOnA)
    ).toThrow(EvaluationValidationError);
    expect(() =>
      estimateIPS(tenant, [
        record({ decisionId: "bad-space", actionSpace: [] }),
      ], targetOnA)
    ).toThrow(EvaluationValidationError);
    expect(() =>
      estimateIPS(tenant, [
        record({ decisionId: "bad-prop", loggedPropensity: -0.5 }),
      ], targetOnA)
    ).toThrow(EvaluationValidationError);
  });

  it("rejects a target policy returning invalid probabilities", () => {
    const badPolicy: StochasticTargetPolicy = {
      actionProbability: () => -1,
    };
    expect(() => estimateIPS(tenant, fixtureA, badPolicy)).toThrow(EvaluationArgumentError);
  });
});

describe("W1-007 — tenant isolation", () => {
  it("rejects records from another tenant (typed error, no silent mixing)", () => {
    const foreign = record({ decisionId: "foreign", tenant: otherTenant });
    expect(() => estimateIPS(tenant, [...fixtureA, foreign], targetOnA)).toThrow(
      EvaluationTenantMismatchError
    );
    expect(() => estimateSNIPS(tenant, [foreign], targetOnA)).toThrow(
      EvaluationTenantMismatchError
    );
    expect(() => estimateDoublyRobust(tenant, [foreign], targetOnA, dmWith(0.5, 0.5))).toThrow(
      EvaluationTenantMismatchError
    );
  });

  it("the same records evaluate fine under their own tenant scope", () => {
    const foreign = record({ decisionId: "foreign", tenant: otherTenant });
    const result = estimateIPS(otherTenant, [foreign], targetOnA);
    expect(result.estimate).toBeCloseTo(2, 12); // single used record, w=2, r=1, N=1
  });
});

describe("W1-007 — determinism and purity", () => {
  it("identical inputs ⇒ deeply identical results across invocations", () => {
    const a = estimateIPS(tenant, fixtureA, targetOnA);
    const b = estimateIPS(tenant, fixtureA, targetOnA);
    expect(a).toEqual(b);
    const c = estimateDoublyRobust(tenant, fixtureC, targetOnA, dmWith(0.5, 0.5), {
      maxWeight: 1.5,
    });
    const d = estimateDoublyRobust(tenant, fixtureC, targetOnA, dmWith(0.5, 0.5), {
      maxWeight: 1.5,
    });
    expect(c).toEqual(d);
  });

  it("estimators do not mutate the input records", () => {
    const snapshot = structuredClone(fixtureA);
    estimateIPS(tenant, fixtureA, targetOnA);
    estimateSNIPS(tenant, fixtureA, targetOnA);
    estimateDoublyRobust(tenant, fixtureA, targetOnA, dmWith(0.4, 0.2));
    expect(fixtureA).toEqual(snapshot);
  });
});
