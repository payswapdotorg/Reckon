/**
 * W1-009 acceptance tests — sequential RL environment.
 *
 * Proves: seeded-episode equality (determinism under seed), reward-spec
 * compliance (terms traceable, bindings required, no hardcoded
 * engagement), termination edge cases (budget exhaustion, fatigue
 * threshold, maxSteps truncation, closed-episode typed errors),
 * observation-features derivation, virtual-clock usage (no wall time),
 * and structural composition with the W1-006 simulator seam.
 */
import { describe, it, expect } from "vitest";
import type {
  OutcomeEvent,
  RewardSpec,
  SubjectReference,
  TenantScope,
} from "@reckon/contracts";
import {
  asSimulatedOutcomeModel,
  budgetFractionBinding,
  constantBinding,
  createRng,
  createSequentialRLEnvironment,
  fatigueBinding,
  metricBinding,
  metricBindingsForRewardSpec,
  RL_ENVIRONMENT_VERSION,
  ActionUnknownError,
  EnvironmentConfigInvalidError,
  EpisodeClosedError,
  EpisodeNotResetError,
  LearningArgumentError,
  RewardBindingMissingError,
  RewardBindingInvalidError,
  type RLEnvironmentConfig,
  type RLActionSpec,
  type SimulatedOutcomeModelInputShape,
} from "../src/index.js";

const tenant: TenantScope = { tenantId: "tenant-a" };
const subject: SubjectReference = { kind: "user", ref: "user-7" };

const ACTIONS: readonly RLActionSpec[] = [
  { actionId: "light", costMs: 10_000, valueQuality: 0.4, fatigueDelta: 0.05 },
  { actionId: "heavy", costMs: 40_000, valueQuality: 0.9, fatigueDelta: 0.3 },
  { actionId: "rest", costMs: 5_000, valueQuality: 0.1, fatigueDelta: 0.0 },
];

const rewardSpec: RewardSpec = {
  rewardId: "fixture.reward",
  version: "1",
  terms: [
    { termId: "value-term", version: "1", kind: "satisfaction-proxy", weight: 2, params: {} },
    { termId: "fatigue-term", version: "1", kind: "interruption-regret", weight: -1, params: {} },
  ],
};

/** Explicit bindings — the harness declares where each term reads. */
const rewardBindings = {
  "value-term": metricBinding("env.value"),
  "fatigue-term": fatigueBinding(),
} as const;

function makeConfig(overrides: Partial<RLEnvironmentConfig> = {}): RLEnvironmentConfig {
  return {
    environmentId: "fixture.env",
    tenant,
    subject,
    actions: ACTIONS,
    reward: rewardSpec,
    rewardBindings,
    maxSteps: 10,
    attentionBudgetMs: 100_000,
    fatigueThreshold: 0.9,
    ...overrides,
  };
}

/** Drive a fixed action sequence; collect everything. */
function runEpisode(
  config: RLEnvironmentConfig,
  seed: string,
  actions: readonly string[]
) {
  const env = createSequentialRLEnvironment(config);
  const firstObservation = env.reset(seed);
  const steps = actions.map((actionId) => env.step({ actionId }));
  return { env, firstObservation, steps };
}

describe("W1-009 — seeded-episode equality (determinism)", () => {
  const SCRIPT = ["light", "heavy", "light", "rest", "heavy"] as const;

  it("same seed + same action sequence ⇒ identical observations, rewards, metrics, events", () => {
    const a = runEpisode(makeConfig(), "424242", SCRIPT);
    const b = runEpisode(makeConfig(), "424242", SCRIPT);
    expect(a.steps.length).toBe(b.steps.length);
    for (let i = 0; i < a.steps.length; i++) {
      const sa = a.steps[i]!;
      const sb = b.steps[i]!;
      expect(sa.observation.features).toEqual(sb.observation.features);
      expect(sa.observation.features.digest).toBe(sb.observation.features.digest);
      expect(sa.reward).toEqual(sb.reward);
      expect(sa.metrics).toEqual(sb.metrics);
      expect(sa.events).toEqual(sb.events);
      expect(sa.clock).toBe(sb.clock);
      expect(sa.terminated).toBe(sb.terminated);
      expect(sa.truncated).toBe(sb.truncated);
    }
    expect(a.firstObservation).toEqual(b.firstObservation);
  });

  it("different seeds ⇒ different stochastic episodes (with noise), identical noiseless dynamics", () => {
    const withNoise = runEpisode(makeConfig({ noiseScale: 0.1 }), "1", SCRIPT);
    const otherNoise = runEpisode(makeConfig({ noiseScale: 0.1 }), "2", SCRIPT);
    // Noiseless quantities (budget, fatigue, clock) match; values differ.
    expect(withNoise.steps[0]!.metrics["env.costMs"]).toBe(otherNoise.steps[0]!.metrics["env.costMs"]);
    expect(withNoise.steps[0]!.metrics["env.fatigue"]).toBe(otherNoise.steps[0]!.metrics["env.fatigue"]);
    expect(withNoise.steps[0]!.metrics["env.value"]).not.toBe(otherNoise.steps[0]!.metrics["env.value"]);

    // With noiseScale 0 the dynamics are seed-independent (values equal).
    const a = runEpisode(makeConfig(), "1", SCRIPT);
    const b = runEpisode(makeConfig(), "999", SCRIPT);
    expect(a.steps.map((s) => s.metrics)).toEqual(b.steps.map((s) => s.metrics));
  });

  it("replays are independent of wall time (no Date.now anywhere)", async () => {
    const a = runEpisode(makeConfig({ noiseScale: 0.1 }), "77", SCRIPT);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const b = runEpisode(makeConfig({ noiseScale: 0.1 }), "77", SCRIPT);
    expect(a.steps.map((s) => s.reward)).toEqual(b.steps.map((s) => s.reward));
  });
});

describe("W1-009 — observations derived from feature families", () => {
  it("observation features carry parallel families/names and a content digest", () => {
    const env = createSequentialRLEnvironment(makeConfig());
    const obs = env.reset("5");
    expect(obs.step).toBe(0);
    expect(obs.features.families.state.length).toBe(obs.features.names.state.length);
    expect(obs.features.names.state).toEqual([
      "state.step",
      "state.budgetFraction",
      "state.fatigue",
      "state.lastValue",
      "state.cumulativeValue",
    ]);
    expect(obs.features.families.bias).toEqual([1]);
    expect(obs.features.digest).toMatch(/^[0-9a-f]{64}$/);

    const step = env.step({ actionId: "light" });
    expect(step.observation.step).toBe(1);
    expect(step.observation.features.families.state[0]).toBe(1);
    // Budget fraction drops by costMs / attentionBudgetMs.
    expect(step.observation.features.families.state[1]).toBeCloseTo(0.9, 6);
    expect(step.observation.features.digest).not.toBe(obs.features.digest);
  });

  it("feature digests are state- and seed-scoped", () => {
    const a = createSequentialRLEnvironment(makeConfig()).reset("5");
    const b = createSequentialRLEnvironment(makeConfig()).reset("6");
    expect(a.features.digest).not.toBe(b.features.digest);
  });
});

describe("W1-009 — reward-spec compliance (traceable, never hardcoded)", () => {
  it("computes every declared term with traceable source and contribution = weight × value", () => {
    const { steps } = runEpisode(makeConfig(), "11", ["heavy"]);
    const reward = steps[0]!.reward;
    expect(reward.rewardVersion).toBe("fixture.reward@1");
    expect(reward.terms).toHaveLength(2);

    const valueTerm = reward.terms.find((t) => t.termId === "value-term")!;
    const fatigueTerm = reward.terms.find((t) => t.termId === "fatigue-term")!;
    expect(valueTerm.kind).toBe("satisfaction-proxy");
    expect(valueTerm.weight).toBe(2);
    expect(valueTerm.source).toBe("binding(value-term)");
    expect(valueTerm.value).toBe(steps[0]!.metrics["env.value"]);
    expect(valueTerm.contribution).toBe(2 * valueTerm.value);
    // Negative weight for the regret term — host-declared semantics.
    expect(fatigueTerm.weight).toBe(-1);
    expect(fatigueTerm.value).toBe(steps[0]!.metrics["env.fatigue"]);
    expect(fatigueTerm.contribution).toBe(-1 * fatigueTerm.value);
    expect(reward.total).toBe(valueTerm.contribution + fatigueTerm.contribution);
  });

  it("construction fails fast when a declared term has no binding (typed error)", () => {
    expect(() =>
      createSequentialRLEnvironment(
        makeConfig({ rewardBindings: { "value-term": metricBinding("env.value") } })
      )
    ).toThrow(RewardBindingMissingError);
  });

  it("runtime binding values must be finite (typed error)", () => {
    const badBindings = {
      "value-term": metricBinding("env.value"),
      "fatigue-term": () => Number.NaN,
    };
    const env = createSequentialRLEnvironment(makeConfig({ rewardBindings: badBindings }));
    env.reset("1");
    expect(() => env.step({ actionId: "light" })).toThrow(RewardBindingInvalidError);
  });

  it("kind-based metric bindings are an explicit research convenience (weights stay host-declared)", () => {
    const env = createSequentialRLEnvironment(
      makeConfig({ rewardBindings: metricBindingsForRewardSpec(rewardSpec) })
    );
    env.reset("3");
    const step = env.step({ actionId: "light" });
    const valueTerm = step.reward.terms.find((t) => t.termId === "value-term")!;
    const fatigueTerm = step.reward.terms.find((t) => t.termId === "fatigue-term")!;
    // satisfaction-proxy → env.value; interruption-regret → env.fatigue.
    expect(valueTerm.value).toBe(step.metrics["env.value"]);
    expect(fatigueTerm.value).toBe(step.metrics["env.fatigue"]);
  });

  it("supports constant and budget-fraction bindings", () => {
    const env = createSequentialRLEnvironment(
      makeConfig({
        rewardBindings: {
          "value-term": constantBinding(0.25),
          "fatigue-term": budgetFractionBinding(),
        },
      })
    );
    env.reset("3");
    const step = env.step({ actionId: "light" });
    const valueTerm = step.reward.terms.find((t) => t.termId === "value-term")!;
    const fatigueTerm = step.reward.terms.find((t) => t.termId === "fatigue-term")!;
    expect(valueTerm.value).toBe(0.25);
    expect(fatigueTerm.value).toBeCloseTo(0.9, 6); // 90k / 100k remaining
  });
});

describe("W1-009 — termination edge cases", () => {
  it("terminates when the attention budget is exhausted", () => {
    const { steps } = runEpisode(makeConfig(), "1", ["heavy", "heavy", "heavy"]);
    // 3 × 40k = 120k > 100k budget: the third step empties the budget.
    const third = steps[2]!;
    expect(third.metrics["env.budgetRemainingMs"]).toBeLessThanOrEqual(0);
    expect(third.terminated).toBe(true);
    expect(third.truncated).toBe(false);
  });

  it("terminates when the fatigue threshold is reached", () => {
    // fatigueThreshold 0.5; heavy adds 0.3 with saturation damping:
    // f1 = 0.3, f2 = 0.3 + 0.3·0.7 = 0.51 ≥ 0.5 → terminated on step 2.
    const { steps } = runEpisode(
      makeConfig({ fatigueThreshold: 0.5, attentionBudgetMs: 1_000_000 }),
      "1",
      ["heavy", "heavy"]
    );
    expect(steps[0]!.terminated).toBe(false);
    expect(steps[1]!.terminated).toBe(true);
  });

  it("truncates at maxSteps without termination", () => {
    const { steps } = runEpisode(
      makeConfig({ maxSteps: 3, attentionBudgetMs: 10_000_000, fatigueThreshold: 1 }),
      "1",
      ["light", "light", "light"]
    );
    expect(steps[2]!.truncated).toBe(true);
    expect(steps[2]!.terminated).toBe(false);
  });

  it("rejects stepping a closed episode (typed) and allows reset to reopen", () => {
    const env = createSequentialRLEnvironment(
      makeConfig({ maxSteps: 2, attentionBudgetMs: 1_000_000 })
    );
    env.reset("9");
    env.step({ actionId: "light" });
    env.step({ actionId: "light" }); // reaches maxSteps → truncated
    expect(() => env.step({ actionId: "light" })).toThrow(EpisodeClosedError);

    const reopened = env.reset("10"); // reset reopens the episode
    expect(reopened.step).toBe(0);
    expect(() => env.step({ actionId: "light" })).not.toThrow();
  });

  it("rejects step() before reset() (typed error)", () => {
    const env = createSequentialRLEnvironment(makeConfig());
    expect(() => env.step({ actionId: "light" })).toThrow(EpisodeNotResetError);
  });

  it("rejects unknown actions (typed error)", () => {
    const env = createSequentialRLEnvironment(makeConfig());
    env.reset("1");
    expect(() => env.step({ actionId: "nope" })).toThrow(ActionUnknownError);
  });
});

describe("W1-009 — simulated evidence + virtual clock", () => {
  it("emits exactly one simulated-class event per step with a virtual timestamp", () => {
    const { steps } = runEpisode(
      makeConfig({ baseClockMs: 1_000_000, stepDurationMs: 30_000 }),
      "1",
      ["light", "heavy"]
    );
    expect(steps[0]!.events).toHaveLength(1);
    expect(steps[1]!.events).toHaveLength(1);
    for (const step of steps) {
      const event = step.events[0]!;
      expect(event.evidenceClass).toBe("simulated");
      expect(event.provenance?.system).toBe("@reckon/learning");
      expect(event.provenance?.version).toBe(RL_ENVIRONMENT_VERSION);
      expect(event.customEventType).toBe("rl-env-step");
      expect(event.occurredAt).toBe(step.clock);
    }
    // Virtual clock: base + step × stepDuration (not wall time).
    expect(steps[0]!.clock).toBe(1_030_000);
    expect(steps[1]!.clock).toBe(1_060_000);
    // Monotonic.
    expect(steps[1]!.clock).toBeGreaterThan(steps[0]!.clock);
    // The event carries the neutral metrics payload.
    expect(steps[0]!.events[0]!.metrics["env.value"]).toBe(steps[0]!.metrics["env.value"]);
  });
});

describe("W1-009 — configuration validation (typed errors)", () => {
  it("rejects invalid configurations at construction", () => {
    expect(() => createSequentialRLEnvironment(makeConfig({ actions: [] }))).toThrow(
      EnvironmentConfigInvalidError
    );
    expect(() =>
      createSequentialRLEnvironment(
        makeConfig({
          actions: [{ actionId: "x", costMs: -1, valueQuality: 0.5, fatigueDelta: 0.1 }],
        })
      )
    ).toThrow(EnvironmentConfigInvalidError);
    expect(() => createSequentialRLEnvironment(makeConfig({ maxSteps: 0 }))).toThrow(
      EnvironmentConfigInvalidError
    );
    expect(() => createSequentialRLEnvironment(makeConfig({ attentionBudgetMs: 0 }))).toThrow(
      EnvironmentConfigInvalidError
    );
    expect(() => createSequentialRLEnvironment(makeConfig({ fatigueThreshold: 0 }))).toThrow(
      EnvironmentConfigInvalidError
    );
    expect(() =>
      createSequentialRLEnvironment(
        makeConfig({
          actions: [
            { actionId: "a", costMs: 1, valueQuality: 0.5, fatigueDelta: 0.1 },
            { actionId: "a", costMs: 1, valueQuality: 0.5, fatigueDelta: 0.1 },
          ],
        })
      )
    ).toThrow(EnvironmentConfigInvalidError);
  });

  it("rejects invalid seeds (typed error)", () => {
    const env = createSequentialRLEnvironment(makeConfig());
    expect(() => env.reset("not-a-seed")).toThrow(LearningArgumentError);
    expect(() => env.reset(-1)).toThrow(LearningArgumentError);
  });
});

describe("W1-009 — composition with the W1-006 simulator (structural seam)", () => {
  /** Local structural mirror of the simulator's seam usage. */
  function simulateWithHarness(
    model: { simulate(input: SimulatedOutcomeModelInputShape): unknown },
    input: SimulatedOutcomeModelInputShape
  ): unknown {
    return model.simulate(input);
  }

  function makeSeamInput(
    overrides: Partial<SimulatedOutcomeModelInputShape> = {}
  ): SimulatedOutcomeModelInputShape {
    return {
      action: { kind: "present", experienceId: "exp-heavy" },
      tenant,
      subject,
      contextId: "ctx-1",
      clockStart: 500_000,
      clockEnd: 560_000,
      step: 1,
      stateDigest: "a".repeat(64),
      featuresDigest: "b".repeat(64),
      stochastic: true,
      rng: createRng("123"),
      ...overrides,
    };
  }

  it("adapts the environment to the SimulatedOutcomeModel shape deterministically", () => {
    const env = createSequentialRLEnvironment(makeConfig());
    const model = asSimulatedOutcomeModel(env, {
      actionForExperience: { "exp-light": "light", "exp-heavy": "heavy" },
    });

    env.reset("31337");
    const a = simulateWithHarness(model, makeSeamInput());
    env.reset("31337");
    const b = simulateWithHarness(model, makeSeamInput());
    expect(a).toEqual(b);

    const result = a as {
      events: readonly OutcomeEvent[];
      metrics: Record<string, number>;
      modelVersion: string;
      terminated: boolean;
    };
    expect(result.events).toHaveLength(1);
    // The adapter re-stamps the event into the simulator's window.
    expect(result.events[0]!.occurredAt).toBe(500_000);
    expect(result.events[0]!.evidenceClass).toBe("simulated");
    expect(result.metrics["env.value"]).toBeDefined();
    expect(result.modelVersion).toContain("outcome-model-adapter");
  });

  it("end action terminates; unmapped experience is a typed error; hold emits no events", () => {
    const env = createSequentialRLEnvironment(makeConfig());
    const model = asSimulatedOutcomeModel(env, {
      actionForExperience: { "exp-light": "light" },
    });
    env.reset("1");

    const ended = simulateWithHarness(model, makeSeamInput({ action: { kind: "end" } })) as {
      terminated: boolean;
      events: readonly OutcomeEvent[];
    };
    expect(ended.terminated).toBe(true);
    expect(ended.events).toHaveLength(0);

    const held = simulateWithHarness(model, makeSeamInput({ action: { kind: "hold" } })) as {
      terminated: boolean;
      events: readonly OutcomeEvent[];
      metrics: Record<string, number>;
    };
    expect(held.terminated).toBe(false);
    expect(held.events).toHaveLength(0);
    expect(held.metrics["rl.hold"]).toBe(1);

    expect(() =>
      simulateWithHarness(model, makeSeamInput({ action: { kind: "present", experienceId: "nope" } }))
    ).toThrow(LearningArgumentError);
  });

  it("the episode's closed state propagates through the adapter (typed error)", () => {
    const env = createSequentialRLEnvironment(
      makeConfig({ maxSteps: 1, attentionBudgetMs: 1_000_000 })
    );
    const model = asSimulatedOutcomeModel(env, { actionForExperience: { "exp-light": "light" } });
    env.reset("1");
    const present = makeSeamInput({ action: { kind: "present", experienceId: "exp-light" } });
    simulateWithHarness(model, present); // reaches maxSteps
    expect(() => simulateWithHarness(model, present)).toThrow(EpisodeClosedError);
  });
});
