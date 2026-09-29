/**
 * W1-008 acceptance tests — contextual-bandit evaluation harness.
 *
 * Proves: regret decreases monotonically (windowed) on a synthetic
 * stationary bandit fixture, calibration records are append-only
 * (never rewritten, frozen), all exploration is deterministically
 * seeded (no Math.random), the score seam matches the
 * PolicyEngine.score input shapes, and per-arm statistics are sound.
 */
import { describe, it, expect } from "vitest";
import type { Experience, Objective, RewardSpec } from "@reckon/contracts";
import {
  AppendOnlyCalibrationLog,
  createEpsilonGreedyBanditPolicy,
  createStationaryBanditWorld,
  createThompsonSamplingBanditPolicy,
  runContextualBanditEvaluation,
  EvaluationArgumentError,
  EvaluationValidationError,
  type BanditPolicy,
  type BanditPolicyScoreInput,
  type StationaryBanditWorldSpec,
} from "../src/index.js";

const objective: Objective = {
  objectiveId: "fixture-objective",
  version: "1",
  kind: "custom",
  customKind: "bandit-evaluation",
  params: {},
};

const rewardSpec: RewardSpec = {
  rewardId: "fixture.reward",
  version: "1",
  terms: [{ termId: "t", version: "1", kind: "satisfaction-proxy", weight: 1, params: {} }],
};

const WORLD_SPEC: StationaryBanditWorldSpec = {
  seed: "20260101",
  armCount: 4,
  contextDim: 3,
  noiseScale: 0.1,
  horizon: 600,
  // Bias-separated fixture: arm-0 dominates, arm-3 is worst; the
  // seeded linear term keeps the world genuinely contextual.
  armBiases: [0.6, 0.2, 0.0, -0.4],
  weightScale: 0.05,
};

function makeWorld(spec: Partial<StationaryBanditWorldSpec> = {}) {
  return createStationaryBanditWorld({ ...WORLD_SPEC, ...spec });
}

describe("W1-008 stationary bandit world (fixture)", () => {
  it("is deterministic under its seed: contexts, optima and rewards replay identically", () => {
    const a = makeWorld();
    const b = makeWorld();
    for (const step of [0, 1, 7, 42, 599]) {
      expect(a.contextAt(step)).toEqual(b.contextAt(step));
      expect(a.optimalAction(step)).toEqual(b.optimalAction(step));
      expect(a.realizeReward(step, "arm-1")).toBe(b.realizeReward(step, "arm-1"));
    }
  });

  it("a different world seed produces different contexts", () => {
    const a = makeWorld();
    const b = makeWorld({ seed: "999" });
    expect(a.contextAt(0)).not.toEqual(b.contextAt(0));
  });

  it("validates its spec (typed errors)", () => {
    expect(() => makeWorld({ armCount: 1 })).toThrow(EvaluationArgumentError);
    expect(() => makeWorld({ contextDim: 0 })).toThrow(EvaluationArgumentError);
    expect(() => makeWorld({ noiseScale: -1 })).toThrow(EvaluationArgumentError);
    expect(() => makeWorld({ horizon: 0 })).toThrow(EvaluationArgumentError);
  });

  it("arms are synthetic fixture experiences over a neutral vocabulary", () => {
    const world = makeWorld();
    expect(world.arms).toHaveLength(4);
    for (const arm of world.arms) {
      expect(arm.experience.experienceId).toBe(arm.armId);
      expect(arm.experience.format.kind).toBe("custom");
      expect(arm.trueWeights).toHaveLength(3);
    }
  });
});

describe("W1-008 evaluation harness — regret decreases on the stationary fixture", () => {
  it("ε-greedy: windowed mean regret improves monotonically over the horizon", () => {
    const policy = createEpsilonGreedyBanditPolicy({ epsilon: 0.2, seed: "policy-seed-1", decay: 0.995 });
    const report = runContextualBanditEvaluation({
      world: makeWorld(),
      policy,
      objective,
      horizon: 600,
      windowCount: 4, // windows of 150 steps
    });

    expect(report.perStep).toHaveLength(600);
    const [w1, w2, w3, w4] = report.windowedMeanRegret;
    // Learning on a stationary world: each window's mean per-step regret
    // is (weakly) lower than the previous one, and the final window is
    // strictly lower than the first.
    expect(w1!).toBeGreaterThan(w2!);
    expect(w2!).toBeGreaterThanOrEqual(w3!);
    expect(w3!).toBeGreaterThanOrEqual(w4!);
    expect(w4!).toBeLessThan(w1!);
  });

  it("Thompson-style sampling: windowed mean regret improves over the horizon", () => {
    const policy = createThompsonSamplingBanditPolicy({ seed: "thompson-seed-1" });
    const report = runContextualBanditEvaluation({
      world: makeWorld(),
      policy,
      objective,
      horizon: 600,
      windowCount: 4,
    });
    const [w1, , , w4] = report.windowedMeanRegret;
    expect(w4!).toBeLessThan(w1!);
    // Cumulative regret is the exact sum of per-step regrets.
    const sum = report.perStep.reduce((acc, entry) => acc + entry.regret, 0);
    expect(report.cumulativeRegret).toBeCloseTo(sum, 9);
  });

  it("a NON-learning policy shows flat (non-improving) regret", () => {
    // Control group: a fixed uniform-random scorer cannot learn.
    const randomPolicy: BanditPolicy = {
      policyId: "fixture.uniform-random",
      policyVersion: "1",
      score: (input: BanditPolicyScoreInput) =>
        input.experiences.map((experience, index) => ({
          experience,
          score: ((index * 2654435761) % 1000) / 1000,
        })),
      observe: () => undefined,
      estimate: () => 0,
    };
    const report = runContextualBanditEvaluation({
      world: makeWorld(),
      policy: randomPolicy,
      objective,
      horizon: 200,
      windowCount: 2,
    });
    const [w1, w2] = report.windowedMeanRegret;
    // No learning: window means stay in the same band (no improvement).
    expect(Math.abs(w1! - w2!)).toBeLessThan(0.5 * Math.max(w1!, w2!));
  });
});

describe("W1-008 evaluation harness — determinism and seeding", () => {
  it("same world seed + same policy seed ⇒ identical report digest", () => {
    const run = () =>
      runContextualBanditEvaluation({
        world: makeWorld(),
        policy: createEpsilonGreedyBanditPolicy({ epsilon: 0.15, seed: "p-1" }),
        objective,
      });
    const a = run();
    const b = run();
    expect(a.reportDigest).toBe(b.reportDigest);
    expect(a.perStep.map((s) => s.chosenArm)).toEqual(b.perStep.map((s) => s.chosenArm));
  });

  it("different policy seed ⇒ different exploration ⇒ different report (ε > 0)", () => {
    const run = (policySeed: string) =>
      runContextualBanditEvaluation({
        world: makeWorld(),
        policy: createEpsilonGreedyBanditPolicy({ epsilon: 0.3, seed: policySeed }),
        objective,
      });
    const a = run("seed-a");
    const b = run("seed-b");
    expect(a.reportDigest).not.toBe(b.reportDigest);
  });

  it("ε = 0 (greedy) is seed-independent in the policy: identical reports", () => {
    const run = (policySeed: string) =>
      runContextualBanditEvaluation({
        world: makeWorld(),
        policy: createEpsilonGreedyBanditPolicy({ epsilon: 0, seed: policySeed }),
        objective,
      });
    expect(run("x").reportDigest).toBe(run("y").reportDigest);
  });

  it("Thompson sampling is deterministic per seed and varies across seeds", () => {
    const run = (policySeed: string) =>
      runContextualBanditEvaluation({
        world: makeWorld(),
        policy: createThompsonSamplingBanditPolicy({ seed: policySeed }),
        objective,
        horizon: 100,
      });
    expect(run("t-1").reportDigest).toBe(run("t-1").reportDigest);
    expect(run("t-1").reportDigest).not.toBe(run("t-2").reportDigest);
  });
});

describe("W1-008 evaluation harness — score seam shape", () => {
  it("passes PolicyEngine.score-shaped inputs (experiences, objective, constraints, reward, policy ids)", () => {
    const seen: BanditPolicyScoreInput[] = [];
    const spyPolicy: BanditPolicy = {
      policyId: "fixture.spy",
      policyVersion: "7",
      score: (input) => {
        seen.push(input);
        return input.experiences.map((experience) => ({ experience, score: 0 }));
      },
      observe: () => undefined,
      estimate: () => 0,
    };
    runContextualBanditEvaluation({
      world: makeWorld({ horizon: 4 }),
      policy: spyPolicy,
      objective,
      reward: rewardSpec,
      constraints: [],
    });
    expect(seen).toHaveLength(4);
    for (const input of seen) {
      expect(input.experiences).toHaveLength(4);
      expect(input.objective).toEqual(objective);
      expect(input.reward).toEqual(rewardSpec);
      expect(input.policyId).toBe("fixture.spy");
      expect(input.policyVersion).toBe("7");
      // Arms arrive in the world's fixed arm order.
      expect(input.experiences.map((e: Experience) => e.experienceId)).toEqual([
        "arm-0",
        "arm-1",
        "arm-2",
        "arm-3",
      ]);
    }
  });

  it("rejects policies that score unknown or missing arms (typed errors)", () => {
    const unknownArm: BanditPolicy = {
      policyId: "p",
      policyVersion: "1",
      score: (input) => [
        { experience: { ...input.experiences[0]!, experienceId: "arm-99" }, score: 1 },
      ],
      observe: () => undefined,
      estimate: () => 0,
    };
    expect(() =>
      runContextualBanditEvaluation({
        world: makeWorld({ horizon: 2 }),
        policy: unknownArm,
        objective,
      })
    ).toThrow(EvaluationArgumentError);

    const missingArm: BanditPolicy = {
      policyId: "p",
      policyVersion: "1",
      score: (input) => input.experiences.slice(0, 2).map((experience) => ({ experience, score: 1 })),
      observe: () => undefined,
      estimate: () => 0,
    };
    expect(() =>
      runContextualBanditEvaluation({
        world: makeWorld({ horizon: 2 }),
        policy: missingArm,
        objective,
      })
    ).toThrow(EvaluationArgumentError);
  });

  it("rejects non-finite scores and invalid horizons/windows (typed errors)", () => {
    const nanPolicy: BanditPolicy = {
      policyId: "p",
      policyVersion: "1",
      score: (input) =>
        input.experiences.map((experience, index) => ({
          experience,
          score: index === 0 ? Number.NaN : 0,
        })),
      observe: () => undefined,
      estimate: () => 0,
    };
    expect(() =>
      runContextualBanditEvaluation({
        world: makeWorld({ horizon: 2 }),
        policy: nanPolicy,
        objective,
      })
    ).toThrow(EvaluationArgumentError);

    const policy = createEpsilonGreedyBanditPolicy({ epsilon: 0.1, seed: "s" });
    expect(() =>
      runContextualBanditEvaluation({
        world: makeWorld({ horizon: 2 }),
        policy,
        objective,
        windowCount: 5,
      })
    ).toThrow(EvaluationArgumentError);
  });
});

describe("W1-008 evaluation harness — per-arm statistics", () => {
  it("pulls sum to the horizon; shares sum to 1; the empirical best is flagged", () => {
    const report = runContextualBanditEvaluation({
      world: makeWorld({ horizon: 200 }),
      policy: createEpsilonGreedyBanditPolicy({ epsilon: 0.1, seed: "stats-1" }),
      objective,
    });
    expect(report.perArm.reduce((acc, stat) => acc + stat.pulls, 0)).toBe(200);
    expect(report.perArm.reduce((acc, stat) => acc + stat.shareOfPulls, 0)).toBeCloseTo(1, 12);
    expect(report.perArm.filter((stat) => stat.isEmpiricalBest).length).toBeGreaterThanOrEqual(1);
    for (const stat of report.perArm) {
      expect(stat.pulls).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(stat.finalEstimate)).toBe(true);
    }
  });
});

describe("W1-008 calibration records — append-only semantics", () => {
  it("the report carries one calibration record per step, predictions taken pre-update", () => {
    const report = runContextualBanditEvaluation({
      world: makeWorld({ horizon: 25 }),
      policy: createEpsilonGreedyBanditPolicy({ epsilon: 0.1, seed: "cal-1" }),
      objective,
    });
    expect(report.calibration).toHaveLength(25);
    for (let step = 0; step < 25; step++) {
      const record = report.calibration[step]!;
      expect(record.step).toBe(step);
      expect(record.armId).toBe(report.perStep[step]!.chosenArm);
      expect(record.observed).toBe(report.perStep[step]!.reward);
      // The predicted value is exactly the logged pre-update estimate.
      expect(record.predicted).toBe(report.perStep[step]!.predicted);
    }
  });

  it("AppendOnlyCalibrationLog: records are frozen, snapshots defensive, history immutable", () => {
    const log = new AppendOnlyCalibrationLog();
    const first = log.append({ step: 0, armId: "arm-0", predicted: 0.1, observed: 0.2 });
    expect(first).toBe(1);
    log.append({ step: 1, armId: "arm-1", predicted: 0.3, observed: 0.4 });
    expect(log.size).toBe(2);

    const snapshot = log.records();
    expect(snapshot).toHaveLength(2);
    // Historical records are frozen — mutation attempts throw.
    expect(Object.isFrozen(snapshot[0])).toBe(true);
    expect(() => {
      (snapshot[0] as { predicted: number }).predicted = 99;
    }).toThrow();
    // The snapshot array itself is frozen — mutation attempts throw and
    // can never touch the log.
    expect(() => {
      (snapshot as CalibrationRecord[]).length = 0;
    }).toThrow();
    expect(log.records()).toHaveLength(2);

    // Appending NEVER rewrites history: prior records stay byte-equal.
    const before = structuredClone(log.records());
    log.append({ step: 2, armId: "arm-2", predicted: 0.5, observed: 0.6 });
    expect(log.records().slice(0, 2)).toEqual(before);
    expect(log.at(2).observed).toBe(0.6);
    expect(() => log.at(3)).toThrow(EvaluationArgumentError);
  });

  it("rejects malformed calibration records (typed errors)", () => {
    const log = new AppendOnlyCalibrationLog();
    expect(() =>
      log.append({ step: 0, armId: "a", predicted: Number.NaN, observed: 1 })
    ).toThrow(EvaluationValidationError);
    expect(() =>
      log.append({ step: 0, armId: "a", predicted: 0, observed: Number.POSITIVE_INFINITY })
    ).toThrow(EvaluationValidationError);
    expect(log.size).toBe(0);
  });
});

// Local structural alias for snapshot-mutation casts (import would be circular in types).
type CalibrationRecord = { step: number; armId: string; predicted: number; observed: number };
