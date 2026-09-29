/**
 * W1-006 acceptance tests — deterministic sequential simulator.
 *
 * Proves: replay determinism (byte-for-byte digest equality of event
 * streams), ensemble statistics sanity (variance > 0 across derived
 * seeds, deterministic across invocations), simulation-clock
 * monotonicity, and the absence of wall-clock influence (identical
 * results across a real-time gap). Reward traceability and the
 * no-default-engagement law are asserted too.
 */
import { describe, it, expect } from "vitest";
import {
  canonicalJson,
  contentDigest,
  type ContextSnapshot,
  type Experience,
  type OutcomeEvent,
  type RewardSpec,
  type SubjectReference,
  type TenantScope,
} from "@reckon/contracts";
import {
  createSimulator,
  createWorldModel,
  deriveSeed,
  DEFAULT_REWARD_METRIC_BINDINGS,
  SIMULATOR_VERSION,
  SimulationActionUnknownError,
  SimulationEpisodeClosedError,
  SimulationRewardBindingMissingError,
  type SimulatorAction,
  type WorldModelInput,
} from "../src/index.js";

const subject: SubjectReference = { kind: "user", ref: "user-7" };
const tenant: TenantScope = { tenantId: "tenant-a" };
const CUTOFF = 10_000;

const contextSnapshot: ContextSnapshot = {
  schema: "reckon.context-snapshot",
  schemaVersion: "0.1.0",
  contextId: "ctx-1",
  at: 9_500,
  activity: [],
  extra: {},
} as ContextSnapshot;

function experience(id: string, fitScore?: number): Experience {
  return {
    schema: "reckon.experience",
    schemaVersion: "0.1.0",
    experienceId: id,
    itemId: `item-${id}`,
    realizationId: `real-${id}`,
    format: { kind: "full", params: {} },
    duration: 253,
    objectiveFit: fitScore === undefined ? undefined : { fitScore, notes: [] },
    transformations: [],
    constraints: [],
  } as Experience;
}

const experiences = [
  experience("exp-fit-high", 0.9),
  experience("exp-fit-low", 0.2),
];

const rewardSpec: RewardSpec = {
  rewardId: "host.reward",
  version: "2",
  terms: [
    { termId: "t-success", version: "1", kind: "task-success", weight: 2, params: {} },
    { termId: "t-satisfaction", version: "1", kind: "satisfaction-proxy", weight: 1, params: {} },
  ],
};

function makeInput(overrides: Partial<WorldModelInput> = {}): WorldModelInput {
  return {
    tenant,
    subject,
    informationCutoff: CUTOFF,
    seed: "123456789",
    contextSnapshot,
    items: [],
    experiences,
    features: {
      families: { context: [1], bias: [1] },
      names: { context: ["x"], bias: ["bias"] },
      digest: "feedfacefeedface",
    },
    ...overrides,
  };
}

function buildState(overrides: Partial<WorldModelInput> = {}) {
  return createWorldModel().build(makeInput(overrides));
}

/** Run a fixed action sequence; return the event stream + final digest. */
function runScenario(seed: string, actions: readonly SimulatorAction[]) {
  const simulator = createSimulator();
  let state = buildState({ seed });
  const events: OutcomeEvent[] = [];
  for (const action of actions) {
    const result = simulator.step(state, action);
    events.push(...result.events);
    state = result.state;
  }
  return { events, finalStateDigest: state.stateDigest, state };
}

const ACTIONS: readonly SimulatorAction[] = [
  { kind: "present", experienceId: "exp-fit-high" },
  { kind: "hold" },
  { kind: "present", experienceId: "exp-fit-low" },
  { kind: "present", experienceId: "exp-fit-high" },
  { kind: "end" },
];

describe("W1-006 SequentialSimulator — replay determinism", () => {
  it("same seed + same action sequence ⇒ byte-identical event stream", () => {
    const a = runScenario("123456789", ACTIONS);
    const b = runScenario("123456789", ACTIONS);
    expect(canonicalJson(a.events)).toBe(canonicalJson(b.events));
    expect(a.finalStateDigest).toBe(b.finalStateDigest);
  });

  it("event stream digest is stable and every event is simulated-class research evidence", () => {
    const run = runScenario("123456789", ACTIONS);
    expect(contentDigest(run.events)).toMatch(/^[0-9a-f]{64}$/);
    expect(run.events.length).toBeGreaterThan(0);
    for (const event of run.events) {
      expect(event.evidenceClass).toBe("simulated");
      expect(event.provenance?.system).toBe("@reckon/simulation");
      expect(event.provenance?.version).toBe(SIMULATOR_VERSION);
      expect(event.occurredAt).toBeGreaterThanOrEqual(CUTOFF);
    }
  });

  it("different base seeds ⇒ different event streams (seeded stochasticity)", () => {
    const a = runScenario("123456789", ACTIONS);
    const b = runScenario("987654321", ACTIONS);
    expect(canonicalJson(a.events)).not.toBe(canonicalJson(b.events));
  });

  it("stochastic:false ⇒ dynamics deterministic regardless of seed", () => {
    const a = runScenarioWithConfig("111111", { stochastic: false });
    const b = runScenarioWithConfig("999999", { stochastic: false });
    // Same dynamics (noise disabled): only ids digests differ (they
    // derive from the seed) — the METRIC payload must be identical.
    const metricsOf = (events: OutcomeEvent[]) =>
      canonicalJson(events.map((e) => [e.eventType, e.metrics]));
    expect(metricsOf(a.events)).toBe(metricsOf(b.events));
  });

  it("no wall-clock influence: identical results across a real-time gap", async () => {
    const first = runScenario("123456789", ACTIONS);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const second = runScenario("123456789", ACTIONS);
    expect(canonicalJson(first.events)).toBe(canonicalJson(second.events));
    expect(first.finalStateDigest).toBe(second.finalStateDigest);
  });
});

function runScenarioWithConfig(seed: string, config: Partial<NonNullable<WorldModelInput["configuration"]>>) {
  const simulator = createSimulator();
  let state = buildState({ seed, configuration: config });
  const events: OutcomeEvent[] = [];
  for (const action of ACTIONS) {
    const result = simulator.step(state, action);
    events.push(...result.events);
    state = result.state;
  }
  return { events, finalStateDigest: state.stateDigest, state };
}

describe("W1-006 SequentialSimulator — virtual clock", () => {
  it("simulation clock is monotonic and separate from wall time", () => {
    const simulator = createSimulator();
    const state = buildState();
    let clock = state.simulationClock;
    let current = state;
    for (let i = 0; i < 5; i++) {
      const result = simulator.step(current, { kind: "present", experienceId: "exp-fit-high" });
      expect(result.clock).toBeGreaterThan(clock);
      for (const event of result.events) {
        expect(event.occurredAt).toBeGreaterThanOrEqual(clock);
        expect(event.occurredAt).toBeLessThanOrEqual(result.clock);
      }
      clock = result.clock;
      current = result.state;
    }
    expect(current.stepCount).toBe(5);
    // Virtual clock advanced by 5 × stepDurationMs from the cutoff.
    expect(current.simulationClock).toBe(CUTOFF + 5 * current.configuration.stepDurationMs);
  });

  it("hold advances the clock without events; end terminates without advancing", () => {
    const simulator = createSimulator();
    const state = buildState();
    const held = simulator.step(state, { kind: "hold" });
    expect(held.events).toHaveLength(0);
    expect(held.clock).toBe(CUTOFF + held.state.configuration.stepDurationMs);
    expect(held.terminated).toBe(false);

    const ended = simulator.step(held.state, { kind: "end" });
    expect(ended.events).toHaveLength(0);
    expect(ended.terminated).toBe(true);
    expect(ended.truncated).toBe(false);
    expect(ended.clock).toBe(held.clock); // end does not advance the clock
  });

  it("truncates at maxSteps and rejects stepping a closed episode", () => {
    const simulator = createSimulator();
    const state = buildState({ configuration: { maxSteps: 2 } });
    const step1 = simulator.step(state, { kind: "present", experienceId: "exp-fit-high" });
    expect(step1.truncated).toBe(false);
    const step2 = simulator.step(step1.state, { kind: "present", experienceId: "exp-fit-low" });
    expect(step2.truncated).toBe(true); // stepCount reached maxSteps
    expect(step2.terminated).toBe(false);
    expect(() =>
      simulator.step(step2.state, { kind: "hold" })
    ).toThrow(SimulationEpisodeClosedError);
  });

  it("rejects presenting an experience that is not part of the world", () => {
    const simulator = createSimulator();
    const state = buildState();
    expect(() =>
      simulator.step(state, { kind: "present", experienceId: "nope" })
    ).toThrow(SimulationActionUnknownError);
  });
});

describe("W1-006 SequentialSimulator — reward traceability", () => {
  it("computes reward ONLY from the declared RewardSpec with traceable terms", () => {
    const simulator = createSimulator({ reward: rewardSpec });
    const state = buildState({ reward: rewardSpec });
    const result = simulator.step(state, { kind: "present", experienceId: "exp-fit-high" });
    expect(result.reward.rewardVersion).toBe("host.reward@2");
    expect(result.reward.terms).toHaveLength(2);
    const byId = new Map(result.reward.terms.map((term) => [term.termId, term]));
    const success = byId.get("t-success")!;
    const satisfaction = byId.get("t-satisfaction")!;
    expect(success.metric).toBe(DEFAULT_REWARD_METRIC_BINDINGS["task-success"]);
    expect(satisfaction.metric).toBe(DEFAULT_REWARD_METRIC_BINDINGS["satisfaction-proxy"]);
    // contribution = weight × value; total = Σ contributions.
    expect(success.contribution).toBe(success.weight * success.value);
    expect(satisfaction.contribution).toBe(satisfaction.weight * satisfaction.value);
    expect(result.reward.total).toBe(success.contribution + satisfaction.contribution);
  });

  it("no declared reward ⇒ zero reward, never a hidden engagement default", () => {
    const simulator = createSimulator();
    const state = buildState(); // rewardVersion "unset"
    const result = simulator.step(state, { kind: "present", experienceId: "exp-fit-high" });
    expect(result.reward.total).toBe(0);
    expect(result.reward.terms).toHaveLength(0);
    expect(result.reward.rewardVersion).toBe("unset");
  });

  it("rejects a simulator reward spec that mismatches the state reward version", () => {
    const simulator = createSimulator({ reward: rewardSpec });
    const state = buildState(); // unset
    expect(() => simulator.step(state, { kind: "hold" })).toThrow(
      SimulationRewardBindingMissingError
    );

    const otherReward: RewardSpec = { ...rewardSpec, version: "99" };
    const simulator2 = createSimulator({ reward: otherReward });
    const stateWithReward = buildState({ reward: rewardSpec });
    expect(() => simulator2.step(stateWithReward, { kind: "hold" })).toThrow(
      SimulationRewardBindingMissingError
    );
  });

  it("custom terms must bind a metric via params.metric (typed error otherwise)", () => {
    const customReward: RewardSpec = {
      rewardId: "host.custom",
      version: "1",
      terms: [{ termId: "c1", version: "1", kind: "custom", weight: 1, params: {} }],
    };
    const simulator = createSimulator({ reward: customReward });
    const state = buildState({ reward: customReward });
    expect(() => simulator.step(state, { kind: "hold" })).toThrow(
      SimulationRewardBindingMissingError
    );
  });

  it("supports overriding the default metric bindings", () => {
    const simulator = createSimulator({
      reward: rewardSpec,
      rewardBindings: { "task-success": "sim.satisfaction" },
    });
    const state = buildState({ reward: rewardSpec });
    const result = simulator.step(state, { kind: "present", experienceId: "exp-fit-high" });
    const success = result.reward.terms.find((term) => term.termId === "t-success")!;
    expect(success.metric).toBe("sim.satisfaction");
  });
});

describe("W1-006 SequentialSimulator — ensembles", () => {
  it("runEnsemble derives n deterministic seeds and replays the action", () => {
    const simulator = createSimulator();
    const state = buildState();
    const ensemble = simulator.runEnsemble(state, { kind: "present", experienceId: "exp-fit-high" }, 8);

    expect(ensemble.runs).toHaveLength(8);
    expect(ensemble.seeds).toHaveLength(8);
    // Documented derivation: deriveSeed(baseSeed, "ensemble", i).
    expect(ensemble.seeds[0]).toBe(deriveSeed("123456789", "ensemble", 0));
    expect(ensemble.seeds[7]).toBe(deriveSeed("123456789", "ensemble", 7));
    // Distinct seeds.
    expect(new Set(ensemble.seeds).size).toBe(8);
    // Every run replays from a re-seeded copy of the same base state.
    for (const run of ensemble.runs) {
      expect(run.result.step).toBe(1);
      expect(run.result.state.seed).toBe(run.seed);
      expect(run.result.state.stepCount).toBe(1);
    }
  });

  it("ensemble statistics: variance > 0 across seeds (stochastic config + declared reward)", () => {
    const simulator = createSimulator({ reward: rewardSpec });
    const state = buildState({ reward: rewardSpec });
    const ensemble = simulator.runEnsemble(state, { kind: "present", experienceId: "exp-fit-high" }, 16);
    expect(ensemble.rewardVariance).toBeGreaterThan(0);
    expect(ensemble.rewardStdDev).toBeGreaterThan(0);
    expect(ensemble.rewardMean).toBeGreaterThanOrEqual(0);
    // Variance equals the population variance of the run rewards.
    const rewards = ensemble.runs.map((run) => run.result.reward.total);
    const mean = rewards.reduce((a, b) => a + b, 0) / rewards.length;
    const variance =
      rewards.reduce((acc, value) => acc + (value - mean) * (value - mean), 0) / rewards.length;
    expect(ensemble.rewardMean).toBe(mean);
    expect(ensemble.rewardVariance).toBe(variance);
  });

  it("ensemble is deterministic across invocations (same seeds, same results)", () => {
    const simulator = createSimulator();
    const state = buildState();
    const a = simulator.runEnsemble(state, { kind: "present", experienceId: "exp-fit-high" }, 8);
    const b = simulator.runEnsemble(state, { kind: "present", experienceId: "exp-fit-high" }, 8);
    expect(a.seeds).toEqual(b.seeds);
    expect(canonicalJson(a.runs.map((run) => run.result.events))).toBe(
      canonicalJson(b.runs.map((run) => run.result.events))
    );
  });

  it("rejects ensemble sizes < 1", () => {
    const simulator = createSimulator();
    const state = buildState();
    expect(() => simulator.runEnsemble(state, { kind: "hold" }, 0)).toThrow();
    expect(() => simulator.runEnsemble(state, { kind: "hold" }, -3)).toThrow();
  });
});

describe("W1-006 SequentialSimulator — alternate worlds (composition seam)", () => {
  it("accepts an injected SimulatedOutcomeModel as the world", () => {
    // A deterministic alternate world: emits exactly one custom metric
    // event per present-action, hold/end emit nothing.
    const altWorld: import("../src/index.js").SimulatedOutcomeModel = {
      simulate(input) {
        if (input.action.kind !== "present") {
          const result: import("../src/index.js").SimulatedOutcomeModelResult = {
            events: [],
            metrics: { "alt.hold": 1 },
            modelVersion: "test/alt-world",
            terminated: input.action.kind === "end",
          };
          return result;
        }
        const event: OutcomeEvent = {
          schema: "reckon.outcome-event",
          schemaVersion: "0.1.0",
          eventId: `alt-${input.stateDigest.slice(0, 8)}-${input.step}`,
          tenant: input.tenant,
          subject: input.subject,
          experienceId: input.action.experienceId,
          eventType: "custom",
          customEventType: "alt-world-step",
          occurredAt: input.clockStart,
          context: { contextId: input.contextId },
          provenance: { system: "test/alt-world", version: "1" },
          evidenceClass: "simulated",
          metrics: { "alt.value": 0.5 },
          idempotencyKey: `alt:${input.step}`,
        };
        const result: import("../src/index.js").SimulatedOutcomeModelResult = {
          events: [event],
          metrics: { "alt.value": 0.5 },
          modelVersion: "test/alt-world",
          terminated: false,
        };
        return result;
      },
    };
    const altReward: RewardSpec = {
      rewardId: "alt.reward",
      version: "1",
      terms: [
        {
          termId: "alt-term",
          version: "1",
          kind: "custom",
          weight: 3,
          params: { metric: "alt.value" },
        },
      ],
    };
    const simulator = createSimulator({ outcomeModel: altWorld, reward: altReward });
    const state = buildState({ reward: altReward });
    const result = simulator.step(state, { kind: "present", experienceId: "exp-fit-high" });

    expect(result.outcomeModelVersion).toBe("test/alt-world");
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.customEventType).toBe("alt-world-step");
    expect(result.reward.terms[0]!.metric).toBe("alt.value");
    expect(result.reward.total).toBe(1.5); // 3 × 0.5
    expect(result.state.simulatedEvents.map((event) => event.eventId)).toContain(
      result.events[0]!.eventId
    );
  });
});
