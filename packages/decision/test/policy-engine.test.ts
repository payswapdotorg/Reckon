/**
 * W2-002 acceptance tests — the policy engine implementation.
 *
 * Proves: determinism (identical + permuted inputs ⇒ identical ranked
 * output via digests), constraint exclusion with typed reasons
 * (defense in depth: request-level AND per-experience constraints,
 * fail-closed on undeclared values), reward/objective separation (no
 * default engagement reward; `rewardApplied` flag; reward terms only
 * shape eligible experiences), deterministic tie-breaking (score then
 * experienceId), honest uncertainty (evidence-sparsity confidence,
 * never fabricated), typed errors on invalid input (never raw throws),
 * and LLM-free purity (synchronous kernel, no observable state).
 */
import { describe, expect, it } from "vitest";
import {
  contentDigest,
  type Experience,
  type HardConstraint,
  type Objective,
  type RewardSpec,
} from "@reckon/contracts";
import {
  createPolicyEngine,
  evaluatePolicy,
  type PolicyScoreInput,
} from "../src/index.js";
import type { PolicyEngine } from "../src/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const objective: Objective = {
  objectiveId: "obj-learn-1", params: {},
  kind: "learn",
  version: "1",
};

function experience(
  experienceId: string,
  overrides: Partial<Experience> = {},
): Experience {
  return {
    experienceId,
    itemId: `item-${experienceId}`,
    realizationId: `real-${experienceId}`,
    format: { kind: "full", params: {} },
    transformations: [],
    constraints: [],
    ...overrides,
  } as Experience;
}

function fitExperience(experienceId: string, fitScore: number, objectiveId = objective.objectiveId): Experience {
  return experience(experienceId, {
    objectiveFit: {
      objective: { objectiveId, kind: "learn", version: "1", params: {} },
      fitScore,
      notes: [],
    },
  });
}

function reward(
  terms: RewardSpec["terms"],
  rewardId = "reward-1",
): RewardSpec {
  return { rewardId, version: "1", terms };
}

function input(
  experiences: Experience[],
  overrides: Partial<PolicyScoreInput> = {},
): PolicyScoreInput {
  return {
    experiences,
    objective,
    constraints: [],
    policyId: "policy-default",
    policyVersion: "1",
    ...overrides,
  };
}

const engine: PolicyEngine = createPolicyEngine();

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("W2-002 policy engine: determinism", () => {
  const experiences = [
    fitExperience("exp-a", 0.8),
    fitExperience("exp-b", 0.4),
    fitExperience("exp-c", 0.8),
    fitExperience("exp-d", 0.4),
    experience("exp-e"), // no fit evidence
  ];

  it("same input twice ⇒ byte-identical results (digest-equal)", () => {
    const first = evaluatePolicy(input(experiences));
    const second = evaluatePolicy(input(experiences));
    if (!first.ok || !second.ok) throw new Error("expected ok");
    expect(contentDigest(first.value)).toBe(contentDigest(second.value));
  });

  it("permuted input order ⇒ identical ranked output (permutation invariance)", () => {
    const baseline = evaluatePolicy(input(experiences));
    const permuted = evaluatePolicy(input([...experiences].reverse()));
    if (!baseline.ok || !permuted.ok) throw new Error("expected ok");
    expect(contentDigest(baseline.value.scored)).toBe(contentDigest(permuted.value.scored));
    expect(contentDigest(baseline.value.excluded)).toBe(contentDigest(permuted.value.excluded));
  });

  it("the kernel is synchronous and stateless (LLM-free purity: repeated calls see no drift)", () => {
    const call = () => engine.score(input(experiences));
    const first = call();
    const second = call();
    // Synchronous callability (no await) plus identical results.
    expect(contentDigest(first)).toBe(contentDigest(second));
  });
});

// ---------------------------------------------------------------------------
// Constraint exclusion (defense in depth)
// ---------------------------------------------------------------------------

describe("W2-002 policy engine: constraint exclusion", () => {
  it("excludes request-constraint failures with typed reasons and never scores them", () => {
    const constraints: HardConstraint[] = [
      { kind: "format-required", format: "audio-only" },
    ];
    const result = evaluatePolicy(
      input([fitExperience("exp-a", 0.9), experience("exp-b")], { constraints }),
    );
    if (!result.ok) throw new Error(result.error.message);
    // Both experiences are "full" format ⇒ both excluded.
    expect(result.value.scored).toHaveLength(0);
    expect(result.value.excluded).toHaveLength(2);
    const exclusion = result.value.excluded[0];
    expect(exclusion.experienceId).toBe("exp-a");
    expect(exclusion.reasons[0].code).toBe("format-required");
    // reason message mentions the required format
    expect(exclusion.reasons[0].message).toContain("audio-only");
  });

  it("passes the constraint-satisfying experience and excludes only the failing one", () => {
    const constraints: HardConstraint[] = [{ kind: "min-duration", seconds: 60 }];
    const good = experience("exp-good", { duration: 120 });
    const bad = experience("exp-bad", { duration: 30 });
    const result = evaluatePolicy(input([fitWrap("exp-good", 0.9, { duration: 120 }), fitWrap("exp-bad", 0.9, { duration: 30 })], { constraints }));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.scored.map((s) => s.experience.experienceId)).toEqual(["exp-good"]);
    expect(result.value.excluded.map((e) => e.experienceId)).toEqual(["exp-bad"]);
    expect(result.value.excluded[0].reasons[0].code).toBe("min-duration");
    expect(result.value.excluded[0].reasons[0].message).toContain("30");
  });

  it("fail-closed: min-duration on an undeclared duration excludes the experience", () => {
    const constraints: HardConstraint[] = [{ kind: "min-duration", seconds: 10 }];
    const noDuration = experience("exp-noduration"); // no duration field
    const result = evaluatePolicy(input([noDuration], { constraints }));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.scored).toHaveLength(0);
    expect(result.value.excluded[0].reasons[0].message).toContain("undeclared");
  });

  it("defense in depth: an experience's OWN declared constraint also gates it", () => {
    const ownConstraint: HardConstraint[] = [
      { kind: "max-duration", seconds: 60 },
    ];
    const selfGated = experience("exp-self", {
      duration: 300,
      constraints: ownConstraint,
    });
    const result = evaluatePolicy(input([selfGated])); // no request constraints
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.scored).toHaveLength(0);
    expect(result.value.excluded).toHaveLength(1);
    expect(result.value.excluded[0].reasons[0].code).toBe("max-duration");
  });

  it("request-scoped/opaque constraint kinds pass through (not excluded here)", () => {
    const opaque: HardConstraint[] = [
      { kind: "max-cost", cost: 1 },
      { kind: "time-window", fromMs: 0, untilMs: 1000 },
      { kind: "catalog-rule", ruleId: "rule-1" },
    ];
    const result = evaluatePolicy(input([fitExperience("exp-a", 0.5)], { constraints: opaque }));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.excluded).toHaveLength(0);
    expect(result.value.scored).toHaveLength(1);
  });

  it("all failing gates are listed in deterministic order (request order, then experience order)", () => {
    const constraints: HardConstraint[] = [
      { kind: "format-forbidden", format: "full" },
      { kind: "min-duration", seconds: 60 },
    ];
    const result = evaluatePolicy(input([experience("exp-x")], { constraints }));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.excluded[0].reasons.map((r) => r.code)).toEqual([
      "format-forbidden",
      "min-duration",
    ]);
  });
});

/** Wrap a fit into an experience with extra overrides. */
function fitWrap(id: string, fitScore: number, overrides: Partial<Experience> = {}): Experience {
  return experience(id, {
    objectiveFit: { objective: { objectiveId: objective.objectiveId, kind: "learn", version: "1", params: {} }, fitScore, notes: [] },
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Reward / objective separation
// ---------------------------------------------------------------------------

describe("W2-002 policy engine: reward/objective separation", () => {
  it("NO reward spec ⇒ score = objective fit only, rewardApplied: false (no default engagement reward)", () => {
    const result = evaluatePolicy(input([fitExperience("exp-a", 0.8), fitExperience("exp-b", 0.4)]));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.rewardApplied).toBe(false);
    expect(result.value.scored.map((s) => s.score)).toEqual([0.8, 0.4]);
  });

  it("absent fit evidence is never fabricated: no-reward scores are all 0 (ties broken by id)", () => {
    const result = evaluatePolicy(input([experience("exp-z"), experience("exp-a")]));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.scored.map((s) => s.experience.experienceId)).toEqual(["exp-a", "exp-z"]);
    expect(result.value.scored.every((s) => s.score === 0)).toBe(true);
  });

  it("engagement-like fields (duration, format) never influence the no-reward score", () => {
    const long = experience("exp-long", { duration: 3600 });
    const short = experience("exp-short", { duration: 5 });
    const result = evaluatePolicy(input([long, short]));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.scored.map((s) => s.score)).toEqual([0, 0]);
  });

  it("declared reward spec ⇒ score = ½·fit + ½·weighted reward, rewardApplied: true", () => {
    const spec = reward([
      {
        termId: "satisfaction",
        version: "1",
        kind: "satisfaction-proxy",
        weight: 1,
        params: { values: { "exp-a": 0.6, "exp-b": 0.2 } },
      },
    ]);
    const result = evaluatePolicy(
      input([fitExperience("exp-a", 0.8), fitExperience("exp-b", 0.4)], { reward: spec }),
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.rewardApplied).toBe(true);
    // exp-a: 0.5*0.8 + 0.5*0.6 = 0.7 ; exp-b: 0.5*0.4 + 0.5*0.2 = 0.3
    expect(result.value.scored.find((s) => s.experience.experienceId === "exp-a")?.score).toBeCloseTo(0.7, 12);
    expect(result.value.scored.find((s) => s.experience.experienceId === "exp-b")?.score).toBeCloseTo(0.3, 12);
  });

  it("host-declared constant term value (params.value) applies to every experience", () => {
    const spec = reward([{ termId: "continuity", version: "1", kind: "continuity", weight: 2, params: { value: 0.5 } }]);
    const result = evaluatePolicy(
      input([fitExperience("exp-a", 1), fitExperience("exp-b", 0)] as Experience[], { reward: spec }),
    );
    if (!result.ok) throw new Error(result.error.message);
    const a = result.value.scored.find((s) => s.experience.experienceId === "exp-a")?.score;
    const b = result.value.scored.find((s) => s.experience.experienceId === "exp-b")?.score;
    expect(a).toBeCloseTo(0.75, 12); // 0.5*1 + 0.5*0.5
    expect(b).toBeCloseTo(0.25, 12); // 0.5*0 + 0.5*0.5
  });

  it("negative-weight penalty terms lower the score (policy-risk)", () => {
    const spec = reward([
      { termId: "fit", version: "1", kind: "task-success", weight: 1, params: { value: 1 } },
      { termId: "risk", version: "1", kind: "policy-risk", weight: -1, params: { values: { "exp-risk": 0.8, "exp-safe": 0.1 } } },
    ]);
    const result = evaluatePolicy(
      input([fitExperience("exp-risk", 0.8), fitExperience("exp-safe", 0.8)], { reward: spec }),
    );
    if (!result.ok) throw new Error(result.error.message);
    const risky = result.value.scored.find((s) => s.experience.experienceId === "exp-risk")?.score;
    const safe = result.value.scored.find((s) => s.experience.experienceId === "exp-safe")?.score;
    // exp-risk: rewardScore = (1*1 + (-1)*0.8) / (1+1) = 0.1 ⇒ 0.5*0.8+0.5*0.1 = 0.45
    // exp-safe: rewardScore = (1*1 + (-1)*0.1) / 2 = 0.45 ⇒ 0.5*0.8+0.5*0.45 = 0.625
    expect(risky).toBeCloseTo(0.45, 12);
    expect(safe).toBeCloseTo(0.625, 12);
    expect(result.value.scored[0].experience.experienceId).toBe("exp-safe");
  });

  it("unevaluated terms are ignored by the normalization and disclosed via uncertainty — never guessed", () => {
    const spec = reward([
      { termId: "no-evidence", version: "1", kind: "conversion", weight: 3, params: {} },
      { termId: "declared", version: "1", kind: "retention", weight: 1, params: { value: 1 } },
    ]);
    const result = evaluatePolicy(input([fitExperience("exp-a", 0.6)], { reward: spec }));
    if (!result.ok) throw new Error(result.error.message);
    const entry = result.value.scored[0];
    // Normalization counts EVALUATED terms only: rewardScore = (1*1)/|1| = 1
    // ⇒ score = 0.5*0.6 + 0.5*1 = 0.8. The unevaluated weight-3 term is
    // ignored (missing evidence is never scored as zero evidence) and is
    // disclosed through confidence instead.
    expect(entry.score).toBeCloseTo(0.8, 12);
    // 2 of 3 evidence channels present (fit + declared term; missing term absent)
    expect(entry.uncertainty?.confidence).toBeCloseTo(2 / 3, 12);
    expect(entry.uncertainty?.method).toContain("evidence-sparsity");
  });

  it("reward never rescues a constraint-failing experience (separation)", () => {
    const spec = reward([
      { termId: "conversion", version: "1", kind: "conversion", weight: 1, params: { values: { "exp-bad": 1 } } },
    ]);
    const constraints: HardConstraint[] = [{ kind: "format-forbidden", format: "clip" }];
    const bad = experience("exp-bad", {
      format: { kind: "clip", params: {} },
      objectiveFit: { objective: { objectiveId: objective.objectiveId, kind: "learn", version: "1", params: {} }, fitScore: 1, notes: [] },
    });
    const result = evaluatePolicy(input([bad], { constraints, reward: spec }));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.scored).toHaveLength(0);
    expect(result.value.excluded[0].experienceId).toBe("exp-bad");
  });

  it("an experience declaring fit for a DIFFERENT objective scores 0 on the fit channel", () => {
    const other = fitExperience("exp-other", 0.9, "obj-relax-9");
    const result = evaluatePolicy(input([other, fitExperience("exp-same", 0.2)]));
    if (!result.ok) throw new Error(result.error.message);
    const otherScore = result.value.scored.find((s) => s.experience.experienceId === "exp-other")?.score;
    expect(otherScore).toBe(0);
    expect(result.value.scored[0].experience.experienceId).toBe("exp-same");
  });
});

// ---------------------------------------------------------------------------
// Tie-breaking
// ---------------------------------------------------------------------------

describe("W2-002 policy engine: deterministic tie-breaking", () => {
  it("equal scores are ordered by experienceId ascending (UTF-16)", () => {
    const result = evaluatePolicy(
      input([fitExperience("exp-z", 0.5), fitExperience("exp-a", 0.5), fitExperience("exp-m", 0.5)]),
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.scored.map((s) => s.experience.experienceId)).toEqual([
      "exp-a",
      "exp-m",
      "exp-z",
    ]);
  });

  it("tie-breaking is stable across permutations", () => {
    const experiences = [
      fitExperience("exp-z", 0.5),
      fitExperience("exp-a", 0.5),
      fitExperience("exp-m", 0.5),
    ];
    const first = evaluatePolicy(input(experiences));
    const second = evaluatePolicy(input([...experiences].reverse()));
    if (!first.ok || !second.ok) throw new Error("expected ok");
    expect(first.value.scored.map((s) => s.experience.experienceId)).toEqual(
      second.value.scored.map((s) => s.experience.experienceId),
    );
  });
});

// ---------------------------------------------------------------------------
// Uncertainty honesty
// ---------------------------------------------------------------------------

describe("W2-002 policy engine: uncertainty (evidence sparsity)", () => {
  it("full declared evidence ⇒ confidence 1; missing fit ⇒ lower confidence", () => {
    const withFit = evaluatePolicy(input([fitExperience("exp-a", 0.7)]));
    const withoutFit = evaluatePolicy(input([experience("exp-a")]));
    if (!withFit.ok || !withoutFit.ok) throw new Error("expected ok");
    expect(withFit.value.scored[0].uncertainty?.confidence).toBe(1);
    expect(withoutFit.value.scored[0].uncertainty?.confidence).toBe(0);
  });

  it("per-term evidence is reflected: 1 of 2 terms declared ⇒ confidence 2/3 with fit", () => {
    const spec = reward([
      { termId: "t1", version: "1", kind: "conversion", weight: 1, params: { value: 0.5 } },
      { termId: "t2", version: "1", kind: "revenue", weight: 1, params: {} },
    ]);
    const result = evaluatePolicy(input([fitExperience("exp-a", 0.7)], { reward: spec }));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.scored[0].uncertainty?.confidence).toBeCloseTo(2 / 3, 12);
  });
});

// ---------------------------------------------------------------------------
// Invalid input (typed errors — never raw throws)
// ---------------------------------------------------------------------------

describe("W2-002 policy engine: typed errors", () => {
  it("duplicate experience ids ⇒ typed INVALID_INPUT (ambiguous tie-breaking)", () => {
    const result = evaluatePolicy(input([fitExperience("exp-a", 0.5), fitExperience("exp-a", 0.5)]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_INPUT");
      expect(result.error.issues?.some((i) => i.message.includes("duplicate experienceId"))).toBe(true);
    }
  });

  it("invalid objective ⇒ typed INVALID_INPUT", () => {
    const result = evaluatePolicy(input([fitExperience("exp-a", 0.5)], { objective: { objectiveId: "", kind: "learn" } as Objective }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });

  it("invalid reward spec ⇒ typed INVALID_INPUT", () => {
    const result = evaluatePolicy(
      input([fitExperience("exp-a", 0.5)], { reward: { rewardId: "r", version: "1", terms: [] } as RewardSpec }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });

  it("invalid policy selector ⇒ typed INVALID_INPUT", () => {
    const badId = evaluatePolicy(input([fitExperience("exp-a", 0.5)], { policyId: "" }));
    const badVersion = evaluatePolicy(input([fitExperience("exp-a", 0.5)], { policyVersion: "" }));
    expect(badId.ok).toBe(false);
    expect(badVersion.ok).toBe(false);
  });

  it("non-object input ⇒ typed INVALID_INPUT", () => {
    const result = evaluatePolicy(null as never);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Frozen port conformance
// ---------------------------------------------------------------------------

describe("W2-002 policy engine: frozen port conformance", () => {
  it("createPolicyEngine().score implements the frozen PolicyEngine seam (returns ScoredExperience[])", () => {
    const result = engine.score(input([fitExperience("exp-a", 0.8), fitExperience("exp-b", 0.4)]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Array.isArray(result.value)).toBe(true);
      expect(result.value[0].experience.experienceId).toBe("exp-a");
      expect(typeof result.value[0].score).toBe("number");
    }
  });

  it("the port propagates typed errors from the kernel", () => {
    const result = engine.score(input([fitExperience("dup", 0.5), fitExperience("dup", 0.5)]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });

  it("the port drops constraint-failing experiences from its output (exclusion detail via evaluatePolicy)", () => {
    const constraints: HardConstraint[] = [{ kind: "format-required", format: "full" }];
    const clip = experience("exp-clip", { format: { kind: "clip", params: {} } });
    const port = engine.score(input([clip], { constraints }));
    const detail = evaluatePolicy(input([clip], { constraints }));
    expect(port.ok).toBe(true);
    if (port.ok) expect(port.value).toHaveLength(0);
    if (detail.ok) {
      expect(detail.value.excluded).toHaveLength(1);
      expect(detail.value.excluded[0].reasons[0].code).toBe("format-required");
    }
  });
});
