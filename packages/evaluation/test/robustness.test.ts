/**
 * W1-010 acceptance tests — RobustnessHarness (calibration & robustness).
 *
 * Every expected value is HAND-COMPUTED and shown in the test comments.
 * Proves:
 * - propensity perturbations: SNIPS drift is bounded on fixtures (and
 *   EXACTLY invariant under uniform multiplicative propensity noise);
 *   the stability flag fires when the declared tolerance is exceeded;
 * - feature-family dropout: monotone information removal ⇒ estimate
 *   variance non-decreasing over the tested k range (with the
 *   documented exception for k = F, where a single subset remains);
 * - seed ensembles: variance > 0 for seed-dependent evaluations (both
 *   an offline jittered policy and a seeded bandit run);
 * - determinism: identical configs ⇒ identical robustnessDigest (the
 *   injected-clock timestamp is excluded from the digest);
 * - purity: the harness never mutates the task's records;
 * - typed validation errors for bad configs/tasks.
 */
import { describe, it, expect } from "vitest";
import type { Objective, TenantScope } from "@reckon/contracts";
import {
  RobustnessHarness,
  createEpsilonGreedyBanditPolicy,
  createRng,
  createStationaryBanditWorld,
  deriveSeed,
  estimateSNIPS,
  runContextualBanditEvaluation,
  EvaluationArgumentError,
  type RobustnessTask,
  type RobustnessHarnessConfig,
  type RobustnessReport,
  type StochasticTargetPolicy,
  type LoggedBanditRecord,
  type FeatureFamiliesShape,
} from "../src/index.js";

const tenant: TenantScope = { tenantId: "tenant-a" };

const objective: Objective = {
  objectiveId: "fixture-objective",
  version: "1",
  kind: "custom",
  customKind: "robustness-evaluation",
  params: {},
};

const plainContext: FeatureFamiliesShape = {
  families: { bias: [1] },
  names: { bias: ["bias"] },
  digest: "fixture-context",
};

function record(overrides: Partial<LoggedBanditRecord> = {}): LoggedBanditRecord {
  return {
    decisionId: "d-1",
    tenant,
    context: plainContext,
    actionSpace: ["A", "B"],
    chosenAction: "A",
    loggedPropensity: 0.5,
    reward: 1,
    occurredAt: 1_000,
    ...overrides,
  };
}

/** Target policy: deterministic on action "A" (context-independent). */
const targetOnA: StochasticTargetPolicy = {
  actionProbability: (_record, action) => (action === "A" ? 1 : 0),
};

const snipsTask = (
  records: readonly LoggedBanditRecord[],
  policy: StochasticTargetPolicy = targetOnA
): RobustnessTask => ({
  label: "snips-fixture",
  records,
  run: (rs, _seed) => estimateSNIPS(tenant, rs, policy).estimate,
});

// ---------------------------------------------------------------------------
// Fixture A — 2 actions, uniform logging p = 0.5, 4 records (target on A).
//   weights: 2, 2, 0, 0 → SNIPS = (2·1 + 2·0)/(2+2) = 0.5.
// ---------------------------------------------------------------------------
const fixtureA: readonly LoggedBanditRecord[] = [
  record({ decisionId: "d-1", chosenAction: "A", reward: 1, loggedPropensity: 0.5 }),
  record({ decisionId: "d-2", chosenAction: "A", reward: 0, loggedPropensity: 0.5 }),
  record({ decisionId: "d-3", chosenAction: "B", reward: 1, loggedPropensity: 0.5 }),
  record({ decisionId: "d-4", chosenAction: "B", reward: 0, loggedPropensity: 0.5 }),
];

// ---------------------------------------------------------------------------
// (a) Propensity perturbations
// ---------------------------------------------------------------------------

describe("W1-010 propensity perturbations — SNIPS drift bounded", () => {
  it("uniform propensity noise leaves SNIPS EXACTLY invariant (drift 0, stable)", () => {
    // Baseline: w = (2, 2, 0, 0) → SNIPS = 2/4 = 0.5.
    // shrink ×0.8: every p 0.5 → 0.4 → w = (2.5, 2.5, 0, 0);
    //   SNIPS = 2.5/5 = 0.5 (self-normalization cancels the uniform scale).
    // shrink ×1.25: p 0.5 → 0.625 → w = (1.6, 1.6, 0, 0) → SNIPS = 1.6/3.2 = 0.5.
    // clip 0.3: p 0.5 → 0.3 → w = (10/3, 10/3, 0, 0) → SNIPS = 0.5.
    // clip 0.6: p 0.5 unchanged (cap does not bind) → SNIPS = 0.5.
    const harness = new RobustnessHarness({
      tolerance: 1e-9,
      seed: "propensity-uniform",
      clock: () => 1_000,
      propensity: { clips: [0.3, 0.6], shrinkFactors: [0.8, 1.25] },
    });
    const report = harness.run(snipsTask(fixtureA));

    expect(report.baselineEstimate).toBeCloseTo(0.5, 12);
    expect(report.results).toHaveLength(4);
    for (const result of report.results) {
      expect(result.estimate).toBeCloseTo(0.5, 12);
      expect(result.delta).toBeCloseTo(0, 10);
      expect(result.stable).toBe(true);
      expect(result.sampleCount).toBe(1);
    }
    expect(report.stabilityFlags).toEqual([]);
    expect(report.robust).toBe(true);
  });

  it("binding clip on heterogeneous propensities drifts SNIPS: 9/14 → 1/2, flag fires", () => {
    // Records: u-1 (A, r=1, p=0.5) → w = 2; u-2 (A, r=0, p=0.9) → w = 10/9.
    //   Baseline SNIPS = 2·1/(2 + 10/9) = 2/(28/9) = 18/28 = 9/14 ≈ 0.642857.
    // clip 0.5 binds on u-2 only: p 0.9 → 0.5 → w = 2 for BOTH records:
    //   SNIPS = (2·1 + 2·0)/(2+2) = 0.5 → delta = 0.5 − 9/14 = −1/7 ≈ −0.1429.
    // shrink ×0.9 is multiplicatively uniform on the used records
    //   (w scales by 10/9 on both) → SNIPS stays 9/14 → delta 0.
    const heterogeneous: readonly LoggedBanditRecord[] = [
      record({ decisionId: "u-1", chosenAction: "A", reward: 1, loggedPropensity: 0.5 }),
      record({ decisionId: "u-2", chosenAction: "A", reward: 0, loggedPropensity: 0.9 }),
    ];

    // Tight tolerance: the binding clip EXCEEDS it → flag fires.
    const strict = new RobustnessHarness({
      tolerance: 0.01,
      seed: "propensity-hetero",
      clock: () => 1_000,
      propensity: { clips: [0.5], shrinkFactors: [0.9] },
    });
    const report = strict.run(snipsTask(heterogeneous));

    expect(report.baselineEstimate).toBeCloseTo(9 / 14, 12);

    const clip = report.results.find((r) => r.label === "clip:0.5")!;
    expect(clip.kind).toBe("propensity-clip");
    expect(clip.estimate).toBeCloseTo(0.5, 12);
    expect(clip.delta).toBeCloseTo(-1 / 7, 12);
    expect(clip.stable).toBe(false); // |−1/7| > 0.01

    const shrink = report.results.find((r) => r.label === "shrink:0.9")!;
    expect(shrink.estimate).toBeCloseTo(9 / 14, 12);
    expect(shrink.delta).toBeCloseTo(0, 10);
    expect(shrink.stable).toBe(true);

    expect(report.stabilityFlags).toEqual(["clip:0.5"]);
    expect(report.robust).toBe(false);

    // Declared tolerance ABOVE the drift: the same perturbation is stable.
    const loose = new RobustnessHarness({
      tolerance: 0.2,
      seed: "propensity-hetero",
      clock: () => 1_000,
      propensity: { clips: [0.5], shrinkFactors: [0.9] },
    });
    const stableReport = loose.run(snipsTask(heterogeneous));
    expect(stableReport.stabilityFlags).toEqual([]);
    expect(stableReport.robust).toBe(true);
  });

  it("records with missing/zero propensities keep their skip semantics under perturbation", () => {
    // c-1 (A, r=1, p missing), c-2 (A, r=1, p=0): neither is perturbed
    // (clip/shrink only touch present positive propensities) — both stay
    // skipped, so the estimate over the single usable record is 1·r/N.
    const sparse: readonly LoggedBanditRecord[] = [
      record({ decisionId: "c-1", reward: 1, loggedPropensity: undefined }),
      record({ decisionId: "c-2", reward: 1, loggedPropensity: 0 }),
      record({ decisionId: "c-3", reward: 1, loggedPropensity: 0.5 }),
    ];
    const harness = new RobustnessHarness({
      tolerance: 1,
      seed: "propensity-sparse",
      clock: () => 1_000,
      propensity: { clips: [0.25], shrinkFactors: [0.5] },
    });
    const report = harness.run(snipsTask(sparse));
    // Baseline SNIPS: single used record (w=2, r=1) → 2/2 = 1.
    // clip 0.25 → w = 4 → SNIPS = 4·1/4 = 1 (uniform on the used record).
    expect(report.baselineEstimate).toBeCloseTo(1, 12);
    for (const result of report.results) {
      expect(result.estimate).toBeCloseTo(1, 12);
    }
  });
});

// ---------------------------------------------------------------------------
// (b) Feature-family dropout — monotone information removal
// ---------------------------------------------------------------------------

describe("W1-010 feature-family dropout — monotone variance", () => {
  /**
   * Fixture: F = 3 families {noiseA, noiseB, signal} on 2 records
   * (chosen action A, p = 0.5). The target policy reads the "signal"
   * family VALUE: π(A) = clamp(signal, 0.05, 0.95), defaulting to 0.5
   * when the family is dropped.
   *   r1: signal 0.8, reward 1 → π = 0.8 → w = 1.6
   *   r2: signal 0.2, reward 0 → π = 0.2 → w = 0.4
   *   Baseline SNIPS = 1.6·1/(1.6+0.4) = 0.8.
   * C(3, k) ≤ 64 ⇒ every subset is ENUMERATED (lexicographic):
   *   k=0: [[]]                       → estimates [0.8]
   *   k=1: [noiseA] [noiseB] [signal] → estimates [0.8, 0.8, 0.5]
   *   k=2: [noiseA,noiseB] [noiseA,signal] [noiseB,signal]
   *                                  → estimates [0.8, 0.5, 0.5]
   * Hand-computed per-k statistics:
   *   k=0: mean 0.8, delta 0,   variance 0
   *   k=1: mean 2.1/3 = 0.7, delta −0.1, variance (0.01+0.01+0.04)/3 = 0.02
   *   k=2: mean 1.8/3 = 0.6, delta −0.2, variance (0.04+0.01+0.01)/3 = 0.02
   * Monotone information removal: variance is NON-DECREASING over the
   * tested k range (0 ≤ 0.02 ≤ 0.02).
   *
   * DOCUMENTED EXCEPTION: at k = 3 = F only a single subset remains
   * (every family dropped) and the variance collapses to 0 by
   * construction — monotonicity is asserted over k ∈ {0, 1, 2} where
   * multiple subsets exist.
   */
  function signalContext(signal: number): FeatureFamiliesShape {
    return {
      families: { signal: [signal], noiseA: [0.1], noiseB: [0.1] },
      names: { signal: ["signal.v0"], noiseA: ["noiseA.v0"], noiseB: ["noiseB.v0"] },
      digest: `signal-fixture-${signal}`,
    };
  }

  const signalTarget: StochasticTargetPolicy = {
    actionProbability: (record, action) => {
      if (action !== "A") return 0;
      const signal = record.context.families["signal"];
      if (signal === undefined || signal.length === 0) return 0.5;
      return Math.min(0.95, Math.max(0.05, signal[0]!));
    },
  };

  const signalFixture: readonly LoggedBanditRecord[] = [
    record({
      decisionId: "s-1",
      context: signalContext(0.8),
      reward: 1,
      loggedPropensity: 0.5,
    }),
    record({
      decisionId: "s-2",
      context: signalContext(0.2),
      reward: 0,
      loggedPropensity: 0.5,
    }),
  ];

  it("drop-k variance is non-decreasing in k with hand-computed means/deltas", () => {
    const harness = new RobustnessHarness({
      tolerance: 0.25,
      seed: "dropout-signal",
      clock: () => 1_000,
      featureDropout: { dropCounts: [0, 1, 2] },
    });
    const report = harness.run(snipsTask(signalFixture, signalTarget));

    expect(report.baselineEstimate).toBeCloseTo(0.8, 12);

    const dropoutResults = report.results.filter((r) => r.kind === "feature-dropout");
    expect(dropoutResults.map((r) => r.label)).toEqual(["drop-k:0", "drop-k:1", "drop-k:2"]);

    // Hand-computed means: 0.8, 0.7, 0.6; deltas: 0, −0.1, −0.2.
    expect(dropoutResults[0]!.estimate).toBeCloseTo(0.8, 12);
    expect(dropoutResults[0]!.delta).toBeCloseTo(0, 12);
    expect(dropoutResults[1]!.estimate).toBeCloseTo(2.1 / 3, 12);
    expect(dropoutResults[1]!.delta).toBeCloseTo(-0.1, 12);
    expect(dropoutResults[2]!.estimate).toBeCloseTo(1.8 / 3, 12);
    expect(dropoutResults[2]!.delta).toBeCloseTo(-0.2, 12);

    // Enumerated subset counts: 1, 3, 3.
    expect(dropoutResults.map((r) => r.sampleCount)).toEqual([1, 3, 3]);

    // MONOTONE: variance(k) is non-decreasing over the tested range.
    const variances = dropoutResults.map((r) => r.variance!);
    expect(variances[0]).toBeCloseTo(0, 12);
    expect(variances[1]).toBeCloseTo(0.02, 12);
    expect(variances[2]).toBeCloseTo(0.02, 12);
    expect(variances[1]).toBeGreaterThan(variances[0]);
    expect(variances[2]).toBeGreaterThanOrEqual(variances[1] - 1e-12);

    // All within the declared tolerance → robust.
    expect(report.robust).toBe(true);
    expect(report.stabilityFlags).toEqual([]);
  });

  it("exceeding k = F is a typed argument error", () => {
    const harness = new RobustnessHarness({
      tolerance: 0.25,
      seed: "dropout-signal",
      clock: () => 1_000,
      featureDropout: { dropCounts: [4] }, // F = 3
    });
    expect(() => harness.run(snipsTask(signalFixture, signalTarget))).toThrow(
      EvaluationArgumentError
    );
  });
});

// ---------------------------------------------------------------------------
// (c) Seed ensembles
// ---------------------------------------------------------------------------

describe("W1-010 seed ensembles — variance > 0 for seed-dependent evaluations", () => {
  it("offline task with per-record seeded jitter: ensemble variance > 0", () => {
    // The target policy jitters π(A) per record from the RUN seed:
    // π_i(A) = clamp(0.3 + 0.4·u(seed, decisionId)) ∈ [0.3, 0.7].
    // SNIPS = π_1·r_1/(π_1 + π_2) over the two A-records — it moves with
    // the seed, so the n-seed ensemble has strictly positive variance.
    const jitterTask: RobustnessTask = {
      label: "snips-jitter",
      records: fixtureA,
      run: (records, seed) => {
        const policy: StochasticTargetPolicy = {
          actionProbability: (record, action) => {
            if (action !== "A") return 0;
            const rng = createRng(deriveSeed(seed, "jitter", record.decisionId));
            return Math.min(0.9, Math.max(0.1, 0.3 + 0.4 * rng.nextFloat()));
          },
        };
        return estimateSNIPS(tenant, records, policy).estimate;
      },
    };
    const harness = new RobustnessHarness({
      tolerance: 1,
      seed: "ensemble-jitter",
      clock: () => 1_000,
      seedEnsemble: { size: 8 },
    });
    const report = harness.run(jitterTask);

    const ensemble = report.results.find((r) => r.kind === "seed-ensemble")!;
    expect(ensemble.label).toBe("ensemble:8");
    expect(ensemble.sampleCount).toBe(8);
    expect(ensemble.variance!).toBeGreaterThan(0);
    expect(Number.isFinite(ensemble.estimate)).toBe(true);
    // The jittered estimates stay inside the achievable SNIPS range.
    expect(ensemble.estimate).toBeGreaterThan(0);
    expect(ensemble.estimate).toBeLessThan(1);
  });

  it("bandit evaluation task: ensemble variance > 0 across seeded worlds", () => {
    // A bandit task: the run seed derives BOTH the world seed and the
    // policy seed, so each ensemble member replays a different seeded
    // evaluation (records are unused — only the ensemble suite runs).
    const banditTask: RobustnessTask = {
      label: "bandit-mean-reward",
      records: [],
      run: (_records, seed) => {
        const world = createStationaryBanditWorld({
          seed: deriveSeed(seed, "world"),
          armCount: 3,
          contextDim: 2,
          noiseScale: 0.3,
          horizon: 60,
          armBiases: [0.4, 0.0, -0.2],
          weightScale: 0.05,
        });
        const policy = createEpsilonGreedyBanditPolicy({
          epsilon: 0.2,
          seed: deriveSeed(seed, "policy"),
        });
        const report = runContextualBanditEvaluation({
          world,
          policy,
          objective,
          horizon: 60,
          windowCount: 1,
        });
        return report.perStep.reduce((acc, step) => acc + step.reward, 0) / report.perStep.length;
      },
    };
    const harness = new RobustnessHarness({
      tolerance: 1,
      seed: "ensemble-bandit",
      clock: () => 1_000,
      seedEnsemble: { size: 6 },
    });
    const report = harness.run(banditTask);

    const ensemble = report.results.find((r) => r.kind === "seed-ensemble")!;
    expect(ensemble.sampleCount).toBe(6);
    expect(ensemble.variance!).toBeGreaterThan(0);
    expect(report.robust).toBe(true); // |mean drift| ≤ tolerance 1

    // Determinism: the same seeded task replays identically.
    const again = harness.run(banditTask);
    expect(again.robustnessDigest).toBe(report.robustnessDigest);
  });
});

// ---------------------------------------------------------------------------
// Determinism + purity + injected clock
// ---------------------------------------------------------------------------

describe("W1-010 determinism, purity and the injected clock", () => {
  const signalContext = (signal: number): FeatureFamiliesShape => ({
    families: { signal: [signal], noiseA: [0.1], noiseB: [0.1] },
    names: { signal: ["signal.v0"], noiseA: ["noiseA.v0"], noiseB: ["noiseB.v0"] },
    digest: `signal-fixture-${signal}`,
  });
  const signalFixture: readonly LoggedBanditRecord[] = [
    record({ decisionId: "s-1", context: signalContext(0.8), reward: 1 }),
    record({ decisionId: "s-2", context: signalContext(0.2), reward: 0 }),
  ];
  const signalTarget: StochasticTargetPolicy = {
    actionProbability: (record, action) => {
      if (action !== "A") return 0;
      const signal = record.context.families["signal"];
      if (signal === undefined || signal.length === 0) return 0.5;
      return Math.min(0.95, Math.max(0.05, signal[0]!));
    },
  };
  const fullConfig = {
    tolerance: 0.25,
    seed: "full-suite",
    clock: () => 5_000,
    propensity: { clips: [0.5], shrinkFactors: [0.9] },
    featureDropout: { dropCounts: [0, 1, 2] },
    seedEnsemble: { size: 4 },
  } as const;

  it("identical configs ⇒ identical reports and identical robustnessDigest", () => {
    const task = snipsTask(signalFixture, signalTarget);
    const reportA = new RobustnessHarness(fullConfig).run(task);
    const reportB = new RobustnessHarness(fullConfig).run(task);
    const reportC = new RobustnessHarness(fullConfig).run(task);

    expect(reportA.robustnessDigest).toBe(reportB.robustnessDigest);
    expect(reportA).toEqual(reportB); // deep equality including ts (fixed clock)
    expect(reportC).toEqual(reportA);
    // The full suite ran: 2 propensity + 3 dropout + 1 ensemble = 6 results.
    expect(reportA.results).toHaveLength(6);
  });

  it("the digest EXCLUDES the injected-clock ts: different clocks, same digest", () => {
    const task = snipsTask(signalFixture, signalTarget);
    const reportA = new RobustnessHarness({ ...fullConfig, clock: () => 111 }).run(task);
    const reportB = new RobustnessHarness({ ...fullConfig, clock: () => 222_222 }).run(task);
    expect(reportA.ts).toBe(111);
    expect(reportB.ts).toBe(222_222);
    expect(reportB.robustnessDigest).toBe(reportA.robustnessDigest);
  });

  it("a different tolerance changes the digest (config is semantically part of it)", () => {
    const task = snipsTask(signalFixture, signalTarget);
    const reportA = new RobustnessHarness(fullConfig).run(task);
    const reportB = new RobustnessHarness({ ...fullConfig, tolerance: 0.3 }).run(task);
    expect(reportB.robustnessDigest).not.toBe(reportA.robustnessDigest);
  });

  it("the harness never mutates the task's records (purity)", () => {
    const snapshot = structuredClone(signalFixture as unknown as LoggedBanditRecord[]);
    const harness = new RobustnessHarness(fullConfig);
    harness.run(snipsTask(signalFixture, signalTarget));
    expect(signalFixture).toEqual(snapshot);
    // Contexts are untouched too (perturbations built fresh copies).
    expect(signalFixture[0]!.context.families["signal"]).toEqual([0.8]);
    expect(signalFixture[0]!.context.digest).toBe("signal-fixture-0.8");
  });

  it("reports are frozen (append-only discipline for robustness evidence)", () => {
    const report: RobustnessReport = new RobustnessHarness(fullConfig).run(
      snipsTask(signalFixture, signalTarget)
    );
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.results)).toBe(true);
    expect(Object.isFrozen(report.results[0])).toBe(true);
    expect(() => (report as { tolerance: number }).tolerance = 99).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// Validation (typed errors, never raw throws)
// ---------------------------------------------------------------------------

describe("W1-010 robustness harness validation — typed errors", () => {
  const base = { seed: "validation", clock: () => 1_000 };

  it("rejects invalid config values", () => {
    expect(
      () => new RobustnessHarness({ ...base, tolerance: -1, seedEnsemble: { size: 2 } })
    ).toThrow(EvaluationArgumentError);
    expect(
      () =>
        new RobustnessHarness({
          ...base,
          tolerance: Number.NaN,
          seedEnsemble: { size: 2 },
        })
    ).toThrow(EvaluationArgumentError);
    expect(
      () =>
        new RobustnessHarness({
          ...base,
          tolerance: 0.1,
          propensity: { clips: [0] },
        })
    ).toThrow(EvaluationArgumentError);
    expect(
      () =>
        new RobustnessHarness({
          ...base,
          tolerance: 0.1,
          propensity: { clips: [1.5] },
        })
    ).toThrow(EvaluationArgumentError);
    expect(
      () =>
        new RobustnessHarness({
          ...base,
          tolerance: 0.1,
          propensity: { shrinkFactors: [0] },
        })
    ).toThrow(EvaluationArgumentError);
    expect(
      () => new RobustnessHarness({ ...base, tolerance: 0.1 })
    ).toThrow(EvaluationArgumentError); // no perturbation suite at all
    expect(
      () => new RobustnessHarness({ ...base, tolerance: 0.1, propensity: {} })
    ).toThrow(EvaluationArgumentError); // empty propensity suite
    expect(
      () =>
        new RobustnessHarness({
          ...base,
          tolerance: 0.1,
          featureDropout: { dropCounts: [-1] },
        })
    ).toThrow(EvaluationArgumentError);
    expect(
      () =>
        new RobustnessHarness({ ...base, tolerance: 0.1, seedEnsemble: { size: 0 } })
    ).toThrow(EvaluationArgumentError);
    expect(
      () =>
        new RobustnessHarness({
          tolerance: 0.1,
          seed: "no-clock",
          seedEnsemble: { size: 2 },
        } as unknown as RobustnessHarnessConfig)
    ).toThrow(EvaluationArgumentError); // clock must be injected
  });

  it("rejects invalid tasks and non-finite estimates", () => {
    const harness = new RobustnessHarness({
      ...base,
      tolerance: 0.1,
      seedEnsemble: { size: 2 },
    });
    expect(() => harness.run({ label: "", records: [], run: () => 1 })).toThrow(
      EvaluationArgumentError
    );
    expect(() =>
      harness.run({ label: "x", records: "nope" as unknown as [], run: () => 1 })
    ).toThrow(EvaluationArgumentError);
    expect(() =>
      harness.run({ label: "x", records: [], run: "not-a-function" as unknown as () => 1 })
    ).toThrow(EvaluationArgumentError);
    expect(() =>
      harness.run({ label: "x", records: [], run: () => Number.NaN })
    ).toThrow(EvaluationArgumentError);
    // Record-perturbation suites require at least one logged record.
    const recordHarness = new RobustnessHarness({
      ...base,
      tolerance: 0.1,
      propensity: { shrinkFactors: [0.9] },
    });
    expect(() =>
      recordHarness.run({ label: "x", records: [], run: () => 1 })
    ).toThrow(EvaluationArgumentError);
  });
});
