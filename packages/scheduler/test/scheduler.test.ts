/**
 * W2-004 acceptance tests — decide() policy, SEPARATION LAW, RESUME LAW,
 * switch-evaluator thresholds (net-value boundary tests on both sides),
 * and determinism digests.
 */
import { describe, expect, it } from "vitest";
import {
  contentDigest,
  DecisionRequestSchema,
  ExperienceSchema,
  type DecisionRequest,
  type Experience,
} from "@reckon/contracts";
import type { ScoredExperience } from "../../decision/src/index.js";
import {
  createScheduler,
  createSwitchEvaluator,
  decide,
  type PlanState,
  type PlanStatus,
  type SwitchEvaluationInput,
} from "../src/index.js";

const scheduler = createScheduler();
const switchEvaluator = createSwitchEvaluator();

function makeRequest(overrides: Record<string, unknown> = {}): DecisionRequest {
  return DecisionRequestSchema.parse({
    requestId: "req-1",
    tenant: { tenantId: "t-1" },
    subject: { kind: "user", ref: "user-9" },
    objective: { objectiveId: "obj-1", kind: "relax" },
    attentionPolicy: { policyId: "ap-1", style: "balanced" },
    context: { contextId: "ctx-1" },
    candidates: {
      setId: "cs-1",
      candidates: [{ itemId: "item-1", realizationIds: [], source: "host-retrieval" }],
    },
    policySelector: { policyId: "p1", version: "1" },
    idempotencyKey: "idem-1",
    ...overrides,
  });
}

function experience(experienceId: string): Experience {
  return ExperienceSchema.parse({
    experienceId,
    itemId: "item-1",
    realizationId: "real-1",
    format: { kind: "full", params: {} },
  });
}

function scored(entries: { id: string; score: number }[]): ScoredExperience[] {
  return entries.map((e) => ({ experience: experience(e.id), score: e.score }));
}

function stateWith(status: PlanStatus, overrides: Partial<PlanState> = {}): PlanState {
  return {
    status,
    queue: [],
    resumeCheckpoints: [],
    ...(status === "playing" ? { currentExperienceId: "exp-1" } : {}),
    ...(status === "interrupted" ? { interruptedExperienceId: "exp-1" } : {}),
    ...overrides,
  };
}

function switchInput(overrides: Partial<SwitchEvaluationInput> = {}): SwitchEvaluationInput {
  return {
    currentExperienceId: "exp-1",
    candidateExperienceId: "exp-2",
    expectedImprovement: 0.5,
    interruptionCost: 0.1,
    uncertaintyPenalty: 0.05,
    resumeLoss: 0.05,
    switchThreshold: 0.2,
    suggestThreshold: 0.1,
    ...overrides,
  };
}

describe("W2-004 decide(): playing state — SEPARATION LAW", () => {
  it("CONTINUEs the current experience when no switch evaluation is supplied, however high the candidate score", () => {
    const result = scheduler.decide({
      currentState: stateWith("playing"),
      request: makeRequest(),
      scored: scored([
        { id: "exp-2", score: 999 },
        { id: "exp-3", score: 500 },
      ]),
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.action).toBe("CONTINUE");
    expect(result.value.transition).toMatchObject({
      fromStatus: "playing",
      action: "CONTINUE",
      toStatus: "playing",
      legal: true,
    });
    expect(result.value.nextState.currentExperienceId).toBe("exp-1");
    expect(result.value.reasons.map((r) => r.code)).toContain("no-switch-input");
  });

  it("never derives switch numbers from rank or score (evaluator inputs are caller-supplied)", () => {
    // Same very high scores, but switch evaluation says HOLD.
    const result = scheduler.decide({
      currentState: stateWith("playing"),
      request: makeRequest(),
      scored: scored([{ id: "exp-2", score: 9999 }]),
      switch: switchInput({
        expectedImprovement: 0.05,
        interruptionCost: 0.4,
        uncertaintyPenalty: 0.1,
        resumeLoss: 0.1,
        switchThreshold: 0.2,
        suggestThreshold: 0.1,
      }), // net = -0.55 → HOLD verdict → CONTINUE
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.action).toBe("CONTINUE");
    expect(result.value.reasons.map((r) => r.code)).toContain("switch-below-threshold");
  });

  it("SWITCHes when net value strictly exceeds the switch threshold", () => {
    const result = scheduler.decide({
      currentState: stateWith("playing"),
      request: makeRequest({ at: 5_000 }),
      scored: scored([{ id: "exp-2", score: 0.8 }]),
      switch: switchInput(), // net 0.3 > 0.2 → SWITCH
      resumeTokens: { "exp-1": "host-token-1" },
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.action).toBe("SWITCH");
    expect(result.value.selectedExperience?.experienceId).toBe("exp-2");
    expect(result.value.nextState.status).toBe("playing");
    expect(result.value.nextState.currentExperienceId).toBe("exp-2");
    expect(result.value.resumeCheckpointSlot).toEqual({
      experienceId: "exp-1",
      resumeToken: "host-token-1",
      source: "SWITCH",
    });
    // Token + timestamp supplied ⇒ full checkpoint materialized.
    expect(result.value.nextState.resumeCheckpoints).toEqual([
      { experienceId: "exp-1", resumeToken: "host-token-1", position: {}, savedAt: 5_000 },
    ]);
    expect(result.value.scheduleDelta.resumeCheckpoint).toEqual({
      experienceId: "exp-1",
      resumeToken: "host-token-1",
    });
    expect(result.value.transition).toMatchObject({ fromStatus: "playing", action: "SWITCH", toStatus: "playing" });
  });

  it("SUGGESTs (never switches) when net value sits in [suggestThreshold, switchThreshold]", () => {
    const result = scheduler.decide({
      currentState: stateWith("playing"),
      request: makeRequest(),
      scored: scored([{ id: "exp-2", score: 0.8 }]),
      switch: switchInput({
        expectedImprovement: 0.35,
        interruptionCost: 0.1,
        uncertaintyPenalty: 0.05,
        resumeLoss: 0.05,
        switchThreshold: 0.2,
        suggestThreshold: 0.1,
      }), // net 0.15 ∈ [0.1, 0.2] → SUGGEST
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.action).toBe("SUGGEST");
    expect(result.value.selectedExperience?.experienceId).toBe("exp-2");
    expect(result.value.nextState.status).toBe("playing");
    expect(result.value.nextState.currentExperienceId).toBe("exp-1");
  });

  it("rejects a switch evaluation whose candidate is not in the scored list (typed error)", () => {
    const result = scheduler.decide({
      currentState: stateWith("playing"),
      request: makeRequest(),
      scored: scored([{ id: "exp-2", score: 0.8 }]),
      switch: switchInput({ candidateExperienceId: "exp-ghost" }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });

  it("rejects a switch evaluation that names a different current experience (typed error)", () => {
    const result = scheduler.decide({
      currentState: stateWith("playing"),
      request: makeRequest(),
      scored: scored([{ id: "exp-2", score: 0.8 }]),
      switch: switchInput({ currentExperienceId: "exp-other" }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });
});

describe("W2-004 decide(): RESUME LAW — checkpoint slots", () => {
  it("records a checkpoint SLOT with a NULL token when the caller supplied none (never invented)", () => {
    const result = scheduler.decide({
      currentState: stateWith("playing"),
      request: makeRequest({ at: 5_000 }),
      scored: scored([{ id: "exp-2", score: 0.8 }]),
      switch: switchInput(),
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.resumeCheckpointSlot).toEqual({
      experienceId: "exp-1",
      resumeToken: null,
      source: "SWITCH",
    });
    // No token ⇒ no materialized checkpoint, no delta checkpoint.
    expect(result.value.nextState.resumeCheckpoints).toEqual([]);
    expect(result.value.scheduleDelta.resumeCheckpoint).toBeUndefined();
    expect(result.value.reasons.map((r) => r.code)).toContain("resume-token-not-supplied");
  });

  it("records the slot but does not materialize a checkpoint without a caller-supplied timestamp", () => {
    const result = scheduler.decide({
      currentState: stateWith("playing"),
      request: makeRequest(), // no `at`
      scored: scored([{ id: "exp-2", score: 0.8 }]),
      switch: switchInput(),
      resumeTokens: { "exp-1": "host-token-1" },
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.resumeCheckpointSlot?.resumeToken).toBe("host-token-1");
    expect(result.value.nextState.resumeCheckpoints).toEqual([]);
    expect(result.value.scheduleDelta.resumeCheckpoint).toBeUndefined();
    expect(result.value.reasons.map((r) => r.code)).toContain("resume-timestamp-not-supplied");
  });

  it("INTERRUPT records a checkpoint slot and moves to interrupted", () => {
    const result = scheduler.decide({
      currentState: stateWith("playing"),
      request: makeRequest({ at: 7_000 }),
      scored: [],
      interruptRequested: true,
      resumeTokens: { "exp-1": "host-token-1" },
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.action).toBe("INTERRUPT");
    expect(result.value.transition).toMatchObject({
      fromStatus: "playing",
      action: "INTERRUPT",
      toStatus: "interrupted",
    });
    expect(result.value.nextState).toMatchObject({
      status: "interrupted",
      interruptedExperienceId: "exp-1",
    });
    expect(result.value.resumeCheckpointSlot).toEqual({
      experienceId: "exp-1",
      resumeToken: "host-token-1",
      source: "INTERRUPT",
    });
    expect(result.value.nextState.resumeCheckpoints).toEqual([
      { experienceId: "exp-1", resumeToken: "host-token-1", position: {}, savedAt: 7_000 },
    ]);
  });

  it("RESUMEs an interrupted plan from the checkpoint (token comes from the checkpoint)", () => {
    const state = stateWith("interrupted", {
      resumeCheckpoints: [
        { experienceId: "exp-1", resumeToken: "token-1", position: { offset: 120 }, savedAt: 1_000 },
      ],
    });
    const result = scheduler.decide({
      currentState: state,
      request: makeRequest(),
      scored: scored([{ id: "exp-1", score: 0.5 }]),
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.action).toBe("RESUME");
    expect(result.value.resume).toEqual({
      experienceId: "exp-1",
      resumeToken: "token-1",
      position: { offset: 120 },
    });
    expect(result.value.nextState).toMatchObject({
      status: "playing",
      currentExperienceId: "exp-1",
    });
    expect(result.value.transition).toMatchObject({
      fromStatus: "interrupted",
      action: "RESUME",
      toStatus: "playing",
    });
  });

  it("HOLDs an interrupted plan with no checkpoints (typed policy, not a crash)", () => {
    const result = scheduler.decide({
      currentState: stateWith("interrupted"),
      request: makeRequest(),
      scored: [],
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.action).toBe("HOLD");
    expect(result.value.transition).toMatchObject({ fromStatus: "interrupted", toStatus: "interrupted" });
  });

  it("SWITCHes away from an interrupted experience, reusing its existing checkpoint (no duplicate)", () => {
    const state = stateWith("interrupted", {
      resumeCheckpoints: [
        { experienceId: "exp-1", resumeToken: "token-1", position: {}, savedAt: 1_000 },
      ],
    });
    const result = scheduler.decide({
      currentState: state,
      request: makeRequest({ at: 9_000 }),
      scored: scored([{ id: "exp-2", score: 0.9 }]),
      switch: switchInput(), // net 0.3 > 0.2 → SWITCH from interrupted
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.action).toBe("SWITCH");
    expect(result.value.resumeCheckpointSlot).toEqual({
      experienceId: "exp-1",
      resumeToken: "token-1", // reused from the existing (caller-supplied) checkpoint
      source: "SWITCH",
    });
    expect(result.value.nextState.resumeCheckpoints).toHaveLength(1); // not duplicated
    expect(result.value.nextState.currentExperienceId).toBe("exp-2");
  });

  it("RESUME from idle works when checkpoints exist (matrix-legal path)", () => {
    const state = stateWith("idle", {
      resumeCheckpoints: [
        { experienceId: "exp-9", resumeToken: "token-9", position: {}, savedAt: 500 },
      ],
    });
    const result = scheduler.decide({
      currentState: state,
      request: makeRequest(),
      scored: scored([{ id: "exp-9", score: 0.5 }]),
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.action).toBe("RESUME");
    expect(result.value.nextState).toMatchObject({ status: "playing", currentExperienceId: "exp-9" });
  });
});

describe("W2-004 decide(): idle/queued — priming and attention policy", () => {
  it("QUEUEs the best scored candidate from idle (non-mindful)", () => {
    const result = scheduler.decide({
      currentState: stateWith("idle"),
      request: makeRequest(),
      scored: scored([
        { id: "exp-2", score: 0.4 },
        { id: "exp-3", score: 0.9 },
      ]),
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.action).toBe("QUEUE");
    expect(result.value.selectedExperienceId).toBe("exp-3"); // best by score
    expect(result.value.nextState).toMatchObject({ status: "queued", queue: ["exp-3"] });
    expect(result.value.scheduleDelta.enqueue).toEqual(["exp-3"]);
    expect(result.value.transition).toMatchObject({ fromStatus: "idle", action: "QUEUE", toStatus: "queued" });
  });

  it("SUGGESTs instead of auto-queueing under a mindful attention policy", () => {
    const result = scheduler.decide({
      currentState: stateWith("idle"),
      request: makeRequest({
        attentionPolicy: { policyId: "ap-1", style: "mindful" },
      }),
      scored: scored([{ id: "exp-3", score: 0.9 }]),
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.action).toBe("SUGGEST");
    expect(result.value.nextState.status).toBe("idle");
    expect(result.value.reasons.map((r) => r.code)).toContain("mindful-suggest");
  });

  it("HOLDs from idle with no scored candidates", () => {
    const result = scheduler.decide({
      currentState: stateWith("idle"),
      request: makeRequest(),
      scored: [],
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.action).toBe("HOLD");
  });

  it("CONTINUEs from queued with the queue head when nothing new arrives", () => {
    const result = scheduler.decide({
      currentState: stateWith("queued", { queue: ["exp-5", "exp-6"] }),
      request: makeRequest(),
      scored: [],
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.action).toBe("CONTINUE");
    expect(result.value.selectedExperienceId).toBe("exp-5");
    expect(result.value.nextState).toMatchObject({
      status: "playing",
      currentExperienceId: "exp-5",
      queue: ["exp-6"],
    });
    expect(result.value.scheduleDelta.dequeue).toEqual(["exp-5"]);
  });

  it("HOLDs from queued with no new candidates under a mindful policy", () => {
    const result = scheduler.decide({
      currentState: stateWith("queued", { queue: ["exp-5"] }),
      request: makeRequest({ attentionPolicy: { policyId: "ap-1", style: "mindful" } }),
      scored: [],
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.action).toBe("HOLD");
  });

  it("ENDs from any non-terminal state when the host requests it", () => {
    for (const status of ["idle", "queued", "playing", "interrupted"] as PlanStatus[]) {
      const state = stateWith(status, status === "queued" ? { queue: ["exp-5"] } : {});
      const result = scheduler.decide({
        currentState: state,
        request: makeRequest(),
        scored: [],
        endRequested: true,
      });
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.action).toBe("END");
      expect(result.value.nextState.status).toBe("ended");
      expect(result.value.transition).toMatchObject({ fromStatus: status, action: "END", toStatus: "ended" });
    }
  });
});

describe("W2-004 decide(): input validation (typed errors)", () => {
  it("rejects a request that fails the frozen contract schema", () => {
    const result = decide({
      currentState: stateWith("idle"),
      request: { nope: true } as never,
      scored: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === "INVALID_INPUT") {
      expect(result.error.issues?.[0]?.path).toContain("request");
    }
  });

  it("rejects scored entries with non-finite scores or invalid experiences", () => {
    const badScore = decide({
      currentState: stateWith("idle"),
      request: makeRequest(),
      scored: [{ experience: experience("exp-2"), score: Number.NaN }],
    });
    expect(badScore.ok).toBe(false);

    const badExperience = decide({
      currentState: stateWith("idle"),
      request: makeRequest(),
      scored: [{ experience: {} as never, score: 1 }],
    });
    expect(badExperience.ok).toBe(false);
  });

  it("rejects contradictory request.currentExperience vs plan state (typed error)", () => {
    const result = decide({
      currentState: stateWith("playing"), // current exp-1
      request: makeRequest({ currentExperience: experience("exp-OTHER") }),
      scored: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });

  it("rejects malformed resume tokens (typed error)", () => {
    const result = decide({
      currentState: stateWith("playing"),
      request: makeRequest(),
      scored: [],
      resumeTokens: { "exp-1": "" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });
});

describe("W2-004 decide(): determinism (digest)", () => {
  const input = {
    currentState: stateWith("playing"),
    request: makeRequest({ at: 5_000 }),
    scored: scored([
      { id: "exp-2", score: 0.4 },
      { id: "exp-3", score: 0.9 },
    ]),
    switch: switchInput(),
    resumeTokens: { "exp-1": "token-1" },
  };

  it("produces byte-identical decisions (same digest) for identical inputs", () => {
    const a = scheduler.decide(input);
    const b = scheduler.decide(input);
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(contentDigest(a.value)).toBe(contentDigest(b.value));
  });

  it("is invariant to scored-list order (canonical best-by-score selection)", () => {
    const a = scheduler.decide(input);
    const b = scheduler.decide({ ...input, scored: [...input.scored].reverse() });
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(contentDigest(a.value)).toBe(contentDigest(b.value));
  });
});

describe("W2-004 switch evaluator: net-value boundaries (both sides)", () => {
  const base: SwitchEvaluationInput = {
    currentExperienceId: "exp-1",
    candidateExperienceId: "exp-2",
    expectedImprovement: 0.5,
    interruptionCost: 0.1,
    uncertaintyPenalty: 0.05,
    resumeLoss: 0.05,
    switchThreshold: 0.3,
    suggestThreshold: 0.2,
  }; // net = 0.3 exactly

  it("computes net = improvement − interruptionCost − uncertaintyPenalty − resumeLoss", () => {
    const result = switchEvaluator.evaluate(base);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.netValue).toBeCloseTo(0.3, 12);
    expect(result.value.terms).toEqual({
      expectedImprovement: 0.5,
      interruptionCost: 0.1,
      uncertaintyPenalty: 0.05,
      resumeLoss: 0.05,
    });
  });

  it("emits SUGGEST at net == switchThreshold (SWITCH requires STRICTLY greater)", () => {
    // Zero cost terms keep the arithmetic exact so net === switchThreshold
    // holds bit-for-bit (floating-point boundary semantics are the point).
    const atBoundary = switchEvaluator.evaluate({
      ...base,
      expectedImprovement: 0.3,
      interruptionCost: 0,
      uncertaintyPenalty: 0,
      resumeLoss: 0,
    });
    if (!atBoundary.ok) throw new Error(atBoundary.error.message);
    expect(atBoundary.value.netValue).toBe(0.3);
    expect(atBoundary.value.verdict).toBe("SUGGEST");
  });

  it("emits SWITCH just above the switch threshold", () => {
    const above = switchEvaluator.evaluate({
      ...base,
      expectedImprovement: 0.3 + 1e-9,
      interruptionCost: 0,
      uncertaintyPenalty: 0,
      resumeLoss: 0,
    });
    if (!above.ok) throw new Error(above.error.message);
    expect(above.value.verdict).toBe("SWITCH");
  });

  it("emits SUGGEST at net == suggestThreshold (inclusive lower bound)", () => {
    const atSuggest = switchEvaluator.evaluate({
      ...base,
      expectedImprovement: 0.2,
      interruptionCost: 0,
      uncertaintyPenalty: 0,
      resumeLoss: 0,
    });
    if (!atSuggest.ok) throw new Error(atSuggest.error.message);
    expect(atSuggest.value.netValue).toBe(0.2);
    expect(atSuggest.value.verdict).toBe("SUGGEST");
  });

  it("emits HOLD just below the suggest threshold", () => {
    const below = switchEvaluator.evaluate({
      ...base,
      expectedImprovement: 0.2 - 1e-9,
      interruptionCost: 0,
      uncertaintyPenalty: 0,
      resumeLoss: 0,
    });
    if (!below.ok) throw new Error(below.error.message);
    expect(below.value.verdict).toBe("HOLD");
  });

  it("emits HOLD for strongly negative net values (interruption never justified by rank alone)", () => {
    const result = switchEvaluator.evaluate({
      ...base,
      expectedImprovement: 0.0,
      interruptionCost: 0.9,
      uncertaintyPenalty: 0.2,
      resumeLoss: 0.3,
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.netValue).toBeCloseTo(-1.4, 12);
    expect(result.value.verdict).toBe("HOLD");
  });

  it("returns typed errors for non-finite inputs and inverted thresholds", () => {
    const nonFinite = switchEvaluator.evaluate({
      ...base,
      expectedImprovement: Number.NaN,
    });
    expect(nonFinite.ok).toBe(false);
    if (!nonFinite.ok) expect(nonFinite.error.code).toBe("INVALID_INPUT");

    const inverted = switchEvaluator.evaluate({
      ...base,
      suggestThreshold: 0.5,
      switchThreshold: 0.2,
    });
    expect(inverted.ok).toBe(false);
    if (!inverted.ok) expect(inverted.error.code).toBe("INVALID_INPUT");
  });

  it("is deterministic (same digest for the same evaluation)", () => {
    const a = switchEvaluator.evaluate(base);
    const b = switchEvaluator.evaluate(base);
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(contentDigest(a.value)).toBe(contentDigest(b.value));
  });
});
