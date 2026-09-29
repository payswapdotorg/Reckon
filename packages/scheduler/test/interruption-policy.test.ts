/**
 * W2-005 acceptance tests — the interruption-opportunity policy.
 *
 * Proves: opportunity gating (no opportunity when attention is
 * exhausted / attention already interrupted / fatigue high /
 * interruption fatigue / format unsuitable), documented-formula outputs
 * (urgency, expected improvement, interruption cost, resume loss,
 * uncertainty penalty), determinism (digests), typed errors, and the
 * scheduler composition — the final SWITCH/CONTINUE decision changes
 * with vs without an opportunity while SUGGEST is never gated and the
 * switch numbers stay caller-supplied.
 */
import { describe, expect, it } from "vitest";
import {
  contentDigest,
  ContextSnapshotSchema,
  DecisionRequestSchema,
  ExperiencePlanSchema,
  ExperienceSchema,
  type ContextSnapshot,
  type DecisionRequest,
  type Experience,
  type ExperiencePlan,
  type InterruptionPolicyRef,
} from "@reckon/contracts";
import type { ScoredExperience } from "../../decision/src/index.js";
import {
  createInterruptionOpportunityPolicy,
  evaluateInterruptionOpportunity,
  FATIGUE_REPETITION_THRESHOLD,
  MIN_ATTENTION_BUDGET_MS,
  RECENT_INTERRUPTIONS_LIMIT,
  RESUME_LOSS_WITHOUT_CHECKPOINT,
  type InterruptionOpportunityInput,
  type InterruptionOpportunityResult,
} from "../src/index.js";
import { decide, type PlanState } from "../src/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const policyRef: InterruptionPolicyRef = { policyId: "interruption-default", version: "1" };

function context(overrides: Record<string, unknown> = {}): ContextSnapshot {
  return ContextSnapshotSchema.parse({
    contextId: "ctx-1",
    at: 1_000,
    attention: { availableMs: 300_000, quality: "partial" },
    fatigue: { repetitionLevel: 0.1, recentInterruptions: 0 },
    ...overrides,
  });
}

function currentExperience(overrides: Record<string, unknown> = {}): Experience {
  return ExperienceSchema.parse({
    experienceId: "exp-1",
    itemId: "item-1",
    realizationId: "real-1",
    format: { kind: "clip", params: {} },
    objectiveFit: { objective: { objectiveId: "obj-1", kind: "relax", params: {} }, fitScore: 0.6, notes: [] },
    ...overrides,
  });
}

function queued(experienceId: string, fitScore: number): Experience {
  return ExperienceSchema.parse({
    experienceId,
    itemId: `item-${experienceId}`,
    realizationId: `real-${experienceId}`,
    format: { kind: "clip", params: {} },
    objectiveFit: { objective: { objectiveId: "obj-1", kind: "relax", params: {} }, fitScore, notes: [] },
  });
}

function plan(overrides: Record<string, unknown> = {}): ExperiencePlan {
  return ExperiencePlanSchema.parse({
    planId: "plan-1",
    tenant: { tenantId: "t-1" },
    subject: { kind: "user", ref: "user-9" },
    objective: { objectiveId: "obj-1", kind: "relax", params: {} },
    attentionPolicy: { policyId: "ap-1", style: "balanced", params: {} },
    queuedExperiences: [queued("exp-2", 0.9)],
    resumeCheckpoints: [],
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  });
}

function opportunityInput(overrides: Partial<InterruptionOpportunityInput> = {}): InterruptionOpportunityInput {
  return {
    context: context(),
    currentExperience: currentExperience(),
    plan: plan(),
    policyRef,
    ...overrides,
  };
}

const policy = createInterruptionOpportunityPolicy();

// ---------------------------------------------------------------------------
// Opportunity gating
// ---------------------------------------------------------------------------

describe("W2-005 interruption policy: gating", () => {
  it("a good moment IS an opportunity (attention available, low fatigue, breakable format)", () => {
    const result = policy.evaluate(opportunityInput());
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.opportunity).toBe(true);
    expect(result.value.reasons.map((r) => r.code)).toEqual([
      "attention-ok",
      "fatigue-ok",
      "format-suitable",
    ]);
  });

  it("NO opportunity when attention is exhausted (availableMs below the minimum budget)", () => {
    const result = evaluateInterruptionOpportunity(
      opportunityInput({ context: context({ attention: { availableMs: MIN_ATTENTION_BUDGET_MS - 1 } }) }),
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.opportunity).toBe(false);
    expect(result.value.reasons).toContainEqual(
      expect.objectContaining({ code: "attention-exhausted" }),
    );
    expect(result.value.urgency).toBe(0);
  });

  it("NO opportunity when attention quality is already interrupted", () => {
    const result = evaluateInterruptionOpportunity(
      opportunityInput({ context: context({ attention: { quality: "interrupted" } }) }),
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.opportunity).toBe(false);
    expect(result.value.reasons).toContainEqual(
      expect.objectContaining({ code: "attention-already-interrupted" }),
    );
  });

  it("NO opportunity when fatigue is high (repetitionLevel ≥ threshold)", () => {
    const result = evaluateInterruptionOpportunity(
      opportunityInput({
        context: context({ fatigue: { repetitionLevel: FATIGUE_REPETITION_THRESHOLD, recentInterruptions: 0 } }),
      }),
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.opportunity).toBe(false);
    expect(result.value.reasons).toContainEqual(expect.objectContaining({ code: "fatigue-high" }));
  });

  it("NO opportunity on interruption fatigue (recentInterruptions ≥ limit)", () => {
    const result = evaluateInterruptionOpportunity(
      opportunityInput({
        context: context({ fatigue: { repetitionLevel: 0.1, recentInterruptions: RECENT_INTERRUPTIONS_LIMIT } }),
      }),
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.opportunity).toBe(false);
    expect(result.value.reasons).toContainEqual(
      expect.objectContaining({ code: "interruption-fatigue" }),
    );
  });

  it("NO opportunity when the current format is unsuitable (full / interactive)", () => {
    for (const kind of ["full", "interactive"]) {
      const result = evaluateInterruptionOpportunity(
        opportunityInput({ currentExperience: currentExperience({ format: { kind, params: {} } }) }),
      );
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.opportunity).toBe(false);
      expect(result.value.reasons).toContainEqual(expect.objectContaining({ code: "format-unsuitable" }));
    }
  });

  it("absent attention/fatigue fields do NOT block (absence is not evidence of exhaustion)", () => {
    const result = evaluateInterruptionOpportunity(
      opportunityInput({ context: ContextSnapshotSchema.parse({ contextId: "ctx-2", at: 1_000 }) }),
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.opportunity).toBe(true);
    expect(result.value.reasons.map((r) => r.code)).toEqual([
      "attention-ok",
      "fatigue-ok",
      "format-suitable",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Documented formulas
// ---------------------------------------------------------------------------

describe("W2-005 interruption policy: documented formulas", () => {
  it("urgency = ½·attentionHeadroom + ½·(1 − fatiguePressure) on a good moment", () => {
    // availableMs 300_000 / REFERENCE 600_000 = 0.5 headroom;
    // repetitionLevel 0.1, recentInterruptions 0 ⇒ fatiguePressure 0.1.
    const result = policy.evaluate(opportunityInput());
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.urgency).toBeCloseTo(0.5 * 0.5 + 0.5 * (1 - 0.1), 12);
  });

  it("expectedImprovement = fit(bestQueued) − fit(current); best queued picked by fit then id", () => {
    const multi = plan({
      queuedExperiences: [queued("exp-3", 0.4), queued("exp-2", 0.9), queued("exp-2b", 0.9)],
    });
    const result = policy.evaluate(opportunityInput({ plan: multi }));
    if (!result.ok) throw new Error(result.error.message);
    // fit(current) = 0.6 (declared); best = exp-2 (0.9; tie with exp-2b broken by id)
    expect(result.value.estimatedTerms.candidateExperienceId).toBe("exp-2");
    expect(result.value.estimatedTerms.expectedImprovement).toBeCloseTo(0.3, 12);
  });

  it("expectedImprovement = 0 with an empty queue and no candidate is named", () => {
    const result = policy.evaluate(opportunityInput({ plan: plan({ queuedExperiences: [] }) }));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.estimatedTerms.candidateExperienceId).toBeUndefined();
    expect(result.value.estimatedTerms.expectedImprovement).toBe(0);
  });

  it("undeclared fit evidence uses the documented neutral prior (0.5) for differences", () => {
    const neutralCurrent = currentExperience({ objectiveFit: undefined });
    const result = policy.evaluate(opportunityInput({ currentExperience: neutralCurrent }));
    if (!result.ok) throw new Error(result.error.message);
    // fit(current) neutral 0.5; best queued 0.9 ⇒ improvement 0.4
    expect(result.value.estimatedTerms.expectedImprovement).toBeCloseTo(0.4, 12);
  });

  it("a candidate declared for a DIFFERENT objective scores fit 0", () => {
    const otherObjective = queued("exp-9", 0.95);
    otherObjective.objectiveFit!.objective = {
      objectiveId: "obj-other",
      kind: "learn",
      version: "1",
      params: {},
    };
    const result = policy.evaluate(
      opportunityInput({ plan: plan({ queuedExperiences: [otherObjective] }) }),
    );
    if (!result.ok) throw new Error(result.error.message);
    // fit(candidate) = 0 (declared mismatch); fit(current) = 0.6 ⇒ improvement −0.6
    expect(result.value.estimatedTerms.expectedImprovement).toBeCloseTo(-0.6, 12);
  });

  it("interruptionCost = 0.2 base (+0.3 non-interruptible format) (+0.5·history pressure)", () => {
    // breakable format, no recent interruptions ⇒ 0.2
    const base = policy.evaluate(opportunityInput());
    if (!base.ok) throw new Error(base.error.message);
    expect(base.value.estimatedTerms.interruptionCost).toBeCloseTo(0.2, 12);

    // non-interruptible format ⇒ 0.5
    const immersive = policy.evaluate(
      opportunityInput({ currentExperience: currentExperience({ format: { kind: "full", params: {} } }) }),
    );
    if (!immersive.ok) throw new Error(immersive.error.message);
    expect(immersive.value.estimatedTerms.interruptionCost).toBeCloseTo(0.5, 12);

    // breakable format + 3 recent interruptions ⇒ 0.2 + 0.5·1 = 0.7
    const history = policy.evaluate(
      opportunityInput({
        context: context({ fatigue: { repetitionLevel: 0, recentInterruptions: 3 } }),
      }),
    );
    if (!history.ok) throw new Error(history.error.message);
    expect(history.value.estimatedTerms.interruptionCost).toBeCloseTo(0.7, 12);
  });

  it("resumeLoss is low with a checkpoint for the current experience, high without", () => {
    const without = policy.evaluate(opportunityInput());
    if (!without.ok) throw new Error(without.error.message);
    expect(without.value.estimatedTerms.resumeLoss).toBe(RESUME_LOSS_WITHOUT_CHECKPOINT);

    const withCheckpoint = policy.evaluate(
      opportunityInput({
        plan: plan({
          resumeCheckpoints: [
            { experienceId: "exp-1", resumeToken: "token-1", position: {}, savedAt: 900 },
          ],
        }),
      }),
    );
    if (!withCheckpoint.ok) throw new Error(withCheckpoint.error.message);
    expect(withCheckpoint.value.estimatedTerms.resumeLoss).toBe(0.1);
  });

  it("uncertaintyPenalty = 0.2 × (missing fit-evidence channels / 2)", () => {
    // current declares fit; candidate declares fit ⇒ 0
    const full = policy.evaluate(opportunityInput());
    if (!full.ok) throw new Error(full.error.message);
    expect(full.value.estimatedTerms.uncertaintyPenalty).toBeCloseTo(0, 12);

    // current undeclared ⇒ 0.2 × 1/2
    const missingCurrent = policy.evaluate(
      opportunityInput({ currentExperience: currentExperience({ objectiveFit: undefined }) }),
    );
    if (!missingCurrent.ok) throw new Error(missingCurrent.error.message);
    expect(missingCurrent.value.estimatedTerms.uncertaintyPenalty).toBeCloseTo(0.1, 12);

    // current undeclared + no queue (no candidate channel) ⇒ 0.2 × 1/2 (single missing channel)
    const noQueue = policy.evaluate(
      opportunityInput({
        currentExperience: currentExperience({ objectiveFit: undefined }),
        plan: plan({ queuedExperiences: [] }),
      }),
    );
    if (!noQueue.ok) throw new Error(noQueue.error.message);
    expect(noQueue.value.estimatedTerms.uncertaintyPenalty).toBeCloseTo(0.1, 12);
  });
});

// ---------------------------------------------------------------------------
// Determinism + typed errors
// ---------------------------------------------------------------------------

describe("W2-005 interruption policy: determinism and errors", () => {
  it("same input twice ⇒ digest-identical output", () => {
    const input = opportunityInput();
    const first = evaluateInterruptionOpportunity(input);
    const second = evaluateInterruptionOpportunity(input);
    if (!first.ok || !second.ok) throw new Error("expected ok");
    expect(contentDigest(first.value)).toBe(contentDigest(second.value));
  });

  it("invalid context ⇒ typed INVALID_INPUT", () => {
    const result = evaluateInterruptionOpportunity(
      opportunityInput({ context: { contextId: "", at: -1 } as unknown as ContextSnapshot }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });

  it("invalid plan ⇒ typed INVALID_INPUT", () => {
    const result = evaluateInterruptionOpportunity(
      opportunityInput({ plan: { planId: "plan-1" } as unknown as ExperiencePlan }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });

  it("invalid policyRef ⇒ typed INVALID_INPUT", () => {
    const result = evaluateInterruptionOpportunity(
      opportunityInput({ policyRef: { policyId: "" } as InterruptionPolicyRef }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });

  it("non-object input ⇒ typed INVALID_INPUT", () => {
    const result = evaluateInterruptionOpportunity(null as never);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scheduler composition (with vs without opportunity)
// ---------------------------------------------------------------------------

function makeRequest(overrides: Record<string, unknown> = {}): DecisionRequest {
  return DecisionRequestSchema.parse({
    requestId: "req-1",
    tenant: { tenantId: "t-1" },
    subject: { kind: "user", ref: "user-9" },
    objective: { objectiveId: "obj-1", kind: "relax", params: {} },
    attentionPolicy: { policyId: "ap-1", style: "balanced", params: {} },
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

function scoredExperiences(): ScoredExperience[] {
  return [
    { experience: queued("exp-2", 0.9), score: 0.9 },
    { experience: currentExperience(), score: 0.6 },
  ];
}

function playingState(): PlanState {
  return {
    status: "playing",
    currentExperienceId: "exp-1",
    queue: [],
    resumeCheckpoints: [],
  };
}

function netPositiveSwitch() {
  return {
    currentExperienceId: "exp-1",
    candidateExperienceId: "exp-2",
    expectedImprovement: 0.5,
    interruptionCost: 0.1,
    uncertaintyPenalty: 0.05,
    resumeLoss: 0.05,
    switchThreshold: 0.2,
    suggestThreshold: 0.1,
  };
}

describe("W2-005 scheduler composition: SWITCH gating", () => {
  it("WITHOUT opportunity supplied: a net-positive switch SWITCHes (W2-004 behavior unchanged)", () => {
    const result = decide({
      currentState: playingState(),
      request: makeRequest({ currentExperience: currentExperience() }),
      scored: scoredExperiences(),
      switch: netPositiveSwitch(),
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.action).toBe("SWITCH");
    expect(result.value.selectedExperienceId).toBe("exp-2");
  });

  it("WITH opportunity present: a net-positive switch SWITCHes (and the reason records the opportunity)", () => {
    const evaluation = policy.evaluate(opportunityInput());
    if (!evaluation.ok) throw new Error(evaluation.error.message);
    const result = decide({
      currentState: playingState(),
      request: makeRequest({ currentExperience: currentExperience() }),
      scored: scoredExperiences(),
      switch: netPositiveSwitch(),
      opportunity: evaluation.value,
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.action).toBe("SWITCH");
    expect(result.value.reasons.map((r) => r.code)).toContain("interruption-opportunity");
  });

  it("WITH NO opportunity: the same net-positive switch is gated to CONTINUE — the decision changes", () => {
    const noOpportunity = policy.evaluate(
      opportunityInput({
        context: context({ attention: { availableMs: MIN_ATTENTION_BUDGET_MS - 1 } }),
      }),
    );
    if (!noOpportunity.ok) throw new Error(noOpportunity.error.message);
    expect(noOpportunity.value.opportunity).toBe(false);

    const result = decide({
      currentState: playingState(),
      request: makeRequest({ currentExperience: currentExperience() }),
      scored: scoredExperiences(),
      switch: netPositiveSwitch(),
      opportunity: noOpportunity.value,
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.action).toBe("CONTINUE");
    expect(result.value.nextState.currentExperienceId).toBe("exp-1");
    expect(result.value.reasons.map((r) => r.code)).toContain("switch-gated-no-opportunity");
    // the gate reason carries the opportunity policy's own reasons
    expect(result.value.reasons.map((r) => r.code)).toContain("opportunity-attention-exhausted");
  });

  it("SUGGEST is never gated (non-binding: it does not interrupt)", () => {
    const noOpportunity = policy.evaluate(
      opportunityInput({
        context: context({ fatigue: { repetitionLevel: 0.9, recentInterruptions: 0 } }),
      }),
    );
    if (!noOpportunity.ok) throw new Error(noOpportunity.error.message);
    const result = decide({
      currentState: playingState(),
      request: makeRequest({ currentExperience: currentExperience() }),
      scored: scoredExperiences(),
      switch: {
        ...netPositiveSwitch(),
        // net = 0.15 ∈ [suggest 0.1, switch 0.2] ⇒ SUGGEST band
        expectedImprovement: 0.35,
        interruptionCost: 0.1,
        uncertaintyPenalty: 0.05,
        resumeLoss: 0.05,
      },
      opportunity: noOpportunity.value,
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.action).toBe("SUGGEST");
    expect(result.value.selectedExperienceId).toBe("exp-2");
  });

  it("from `interrupted`: a gated SWITCH falls back to RESUME instead of switching", () => {
    const noOpportunity = policy.evaluate(
      opportunityInput({ context: context({ attention: { quality: "interrupted" } }) }),
    );
    if (!noOpportunity.ok) throw new Error(noOpportunity.error.message);
    const state: PlanState = {
      status: "interrupted",
      interruptedExperienceId: "exp-1",
      queue: [],
      resumeCheckpoints: [
        { experienceId: "exp-1", resumeToken: "token-1", position: {}, savedAt: 900 },
      ],
    };
    const result = decide({
      currentState: state,
      request: makeRequest({ currentExperience: currentExperience() }),
      scored: scoredExperiences(),
      switch: netPositiveSwitch(),
      opportunity: noOpportunity.value,
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.action).toBe("RESUME");
    expect(result.value.reasons.map((r) => r.code)).toContain("switch-gated-no-opportunity");
  });

  it("host-requested INTERRUPT is never gated by the opportunity (host-driven)", () => {
    const noOpportunity = policy.evaluate(
      opportunityInput({ context: context({ attention: { quality: "interrupted" } }) }),
    );
    if (!noOpportunity.ok) throw new Error(noOpportunity.error.message);
    const result = decide({
      currentState: playingState(),
      request: makeRequest({ currentExperience: currentExperience() }),
      scored: scoredExperiences(),
      interruptRequested: true,
      opportunity: noOpportunity.value,
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.action).toBe("INTERRUPT");
  });

  it("a malformed opportunity evaluation ⇒ typed INVALID_INPUT (never silently ignored)", () => {
    const result = decide({
      currentState: playingState(),
      request: makeRequest({ currentExperience: currentExperience() }),
      scored: scoredExperiences(),
      switch: netPositiveSwitch(),
      opportunity: { opportunity: "yes", reasons: [], urgency: 0.5 } as unknown as InterruptionOpportunityResult,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });

  it("urgency out of [0,1] ⇒ typed INVALID_INPUT", () => {
    const result = decide({
      currentState: playingState(),
      request: makeRequest({ currentExperience: currentExperience() }),
      scored: scoredExperiences(),
      switch: netPositiveSwitch(),
      opportunity: {
        opportunity: true,
        reasons: [],
        estimatedTerms: {
          expectedImprovement: 0,
          interruptionCost: 0,
          uncertaintyPenalty: 0,
          resumeLoss: 0,
        },
        urgency: 1.5,
      } as unknown as InterruptionOpportunityResult,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });

  it("the scheduler never derives switch numbers from the opportunity (caller-supplied switch required)", () => {
    const evaluation = policy.evaluate(opportunityInput());
    if (!evaluation.ok) throw new Error(evaluation.error.message);
    // Opportunity alone (with highly-scored candidates, no switch input):
    // CONTINUE — the opportunity is not a switch decision.
    const result = decide({
      currentState: playingState(),
      request: makeRequest({ currentExperience: currentExperience() }),
      scored: scoredExperiences(),
      opportunity: evaluation.value,
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.action).toBe("CONTINUE");
    expect(result.value.reasons.map((r) => r.code)).toContain("no-switch-input");
  });
});
