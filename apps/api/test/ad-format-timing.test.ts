/**
 * AD-004 — FORMAT/TIMING through the EXISTING experience + scheduler
 * kernels: ad formats (banner / in-feed / interstitial …) expand as
 * experience variants on the ONE expansion surface; per-ad constraints
 * (e.g. a 6-second bumper max-duration) gate at expansion with typed
 * exclusions; timing windows ride the experience's frozen timing fields;
 * defer/queue and interruption/switch behavior for ad experiences flows
 * through the scheduler's existing action + interruption model.
 *
 * Evidence class: controlled-local (kernel-level, in-process).
 */
import { describe, expect, it } from "vitest";
import type { CatalogItem, Realization, RewardSpec } from "@reckon/contracts";
import { normalizeCandidates, evaluatePolicy } from "@reckon/decision";
import { expandExperiences } from "@reckon/experience";
import { decide, evaluateInterruptionOpportunity, type PlanState } from "@reckon/scheduler";

/* ------------------------------------------------------------------ *
 * Fixtures — one ad item with three realizations (format lanes)
 * ------------------------------------------------------------------ */

const AT = 10_000;

const adItem: CatalogItem = {
  schema: "reckon.catalog-item",
  schemaVersion: "0.1.0",
  itemId: "ad-bumper",
  kind: "advertising",
  labels: ["travel"],
  attributes: {},
  availableFrom: 5_000,
  availableUntil: 50_000,
};

const adRealizations: Realization[] = [
  {
    schema: "reckon.realization",
    schemaVersion: "0.1.0",
    realizationId: "real-ad-display",
    itemId: "ad-bumper",
    kind: "display",
    constraints: { formats: ["banner", "in-feed"], durationSeconds: 5 },
  },
  {
    schema: "reckon.realization",
    schemaVersion: "0.1.0",
    realizationId: "real-ad-interstitial",
    itemId: "ad-bumper",
    kind: "interstitial",
    constraints: { formats: ["interstitial"], durationSeconds: 30, deviceClasses: ["phone"] },
  },
];

const organicItem: CatalogItem = {
  schema: "reckon.catalog-item",
  schemaVersion: "0.1.0",
  itemId: "vid-news",
  kind: "media",
  labels: [],
  attributes: {},
};

const organicRealization: Realization = {
  schema: "reckon.realization",
  schemaVersion: "0.1.0",
  realizationId: "real-vid-news",
  itemId: "vid-news",
  kind: "stream",
  constraints: { formats: ["full"], durationSeconds: 600 },
};

const OBJECTIVE = { objectiveId: "obj-stay-informed", version: "1", kind: "stay-informed" as const, params: {} };

function expandAds(input: { itemConstraints?: Record<string, readonly unknown[]>; requestConstraints?: readonly unknown[] } = {}) {
  const normalized = normalizeCandidates({
    candidates: {
      setId: "cs-ad-formats",
      candidates: [
        { itemId: "ad-bumper", realizationIds: ["real-ad-display", "real-ad-interstitial"], source: "reckon.ad-availability.current" },
        { itemId: "vid-news", realizationIds: ["real-vid-news"], source: "host-retrieval" },
      ],
    },
    items: [adItem, organicItem],
    realizations: [...adRealizations, organicRealization],
    tenant: { tenantId: "tenant-a" },
  });
  if (!normalized.ok) throw new Error(normalized.error.message);
  const expansion = expandExperiences({
    candidates: normalized.value,
    items: [adItem, organicItem],
    realizations: [...adRealizations, organicRealization],
    formatPolicy: { allowedFormats: ["full", "banner", "in-feed", "interstitial"] },
    objective: OBJECTIVE,
    constraints: (input.requestConstraints ?? []) as never,
    ...(input.itemConstraints !== undefined ? { itemConstraints: input.itemConstraints as never } : {}),
  });
  if (!expansion.ok) throw new Error(expansion.error.message);
  return expansion.value;
}

/* ------------------------------------------------------------------ *
 * FORMAT — placement as experience attributes on the ONE expansion surface
 * ------------------------------------------------------------------ */

describe("AD-004 ad format/placement (experience expansion surface)", () => {
  it("expands the ad into banner / in-feed / interstitial variants with the realization's format params carried", () => {
    const expansion = expandAds();
    const adFormats = expansion.experiences
      .filter((e) => e.experience.itemId === "ad-bumper")
      .map((e) => e.experience.format.kind)
      .sort();
    expect(adFormats).toEqual(["banner", "in-feed", "interstitial"]);
    // Requirements (placement attributes) carry from the realization.
    const interstitial = expansion.experiences.find((e) => e.experience.format.kind === "interstitial");
    expect(interstitial?.experience.requirements?.deviceClass).toEqual(["phone"]);
    expect(interstitial?.experience.duration).toBe(30);
  });

  it("carries the ad's availability window on the experience's frozen timing fields", () => {
    const expansion = expandAds();
    for (const entry of expansion.experiences.filter((e) => e.experience.itemId === "ad-bumper")) {
      expect(entry.experience.timing?.earliestMs).toBe(5_000);
      expect(entry.experience.timing?.latestMs).toBe(50_000);
    }
  });

  it("per-item max-duration constraint (a 6s bumper policy) excludes the 30s interstitial with a typed exclusion", () => {
    const expansion = expandAds({
      itemConstraints: { "ad-bumper": [{ kind: "max-duration", seconds: 6 }] },
    });
    const adFormats = expansion.experiences
      .filter((e) => e.experience.itemId === "ad-bumper")
      .map((e) => e.experience.format.kind);
    expect(adFormats.sort()).toEqual(["banner", "in-feed"]);
    const excluded = expansion.exclusions.find((x) => x.kind === "experience-excluded" && x.realizationId === "real-ad-interstitial");
    expect(excluded).toBeDefined();
    expect(excluded?.excludedBy).toBe("max-duration");
    // The surviving experiences CARRY the constraint (frozen per-experience
    // surface) for the policy engine's defense-in-depth re-application.
    const banner = expansion.experiences.find((e) => e.experience.format.kind === "banner");
    expect(banner?.experience.constraints).toEqual([{ kind: "max-duration", seconds: 6 }]);
  });

  it("request-level format-forbidden (no interstitials this placement) excludes only that format", () => {
    const expansion = expandAds({ requestConstraints: [{ kind: "format-forbidden", format: "interstitial" }] });
    expect(expansion.experiences.filter((e) => e.experience.format.kind === "interstitial")).toHaveLength(0);
    expect(expansion.experiences.filter((e) => e.experience.format.kind === "banner")).toHaveLength(1);
  });

  it("per-item time-window constraints (flight windows) ride verbatim — host-evaluated kinds pass through disclosed", () => {
    const expansion = expandAds({
      itemConstraints: { "ad-bumper": [{ kind: "time-window", fromMs: 8_000, untilMs: 20_000 }] },
    });
    const banner = expansion.experiences.find((e) => e.experience.format.kind === "banner");
    expect(banner?.experience.constraints).toContainEqual({ kind: "time-window", fromMs: 8_000, untilMs: 20_000 });
  });
});

/* ------------------------------------------------------------------ *
 * TIMING — defer/queue and interruption through the scheduler kernel
 * ------------------------------------------------------------------ */

function scoredAds(reward?: RewardSpec) {
  const expansion = expandAds();
  const policy = evaluatePolicy({
    experiences: expansion.experiences.map((e) => e.experience),
    objective: OBJECTIVE,
    constraints: [],
    ...(reward !== undefined ? { reward } : {}),
    policyId: "greedy-v1",
    policyVersion: "1",
  });
  if (!policy.ok) throw new Error(policy.error.message);
  return policy.value.scored;
}

function decideWith(input: {
  state: PlanState;
  scored: ReturnType<typeof scoredAds>;
  style?: "mindful" | "balanced";
  switchInput?: Parameters<typeof decide>[0]["switch"];
  opportunity?: Parameters<typeof decide>[0]["opportunity"];
  interruptRequested?: boolean;
  currentExperience?: { experienceId: string; itemId: string; realizationId: string; format: { kind: string; params: Record<string, unknown> } };
}) {
  const result = decide({
    currentState: input.state,
    request: {
      schema: "reckon.decision-request",
      schemaVersion: "0.1.0",
      requestId: "req-ad-timing",
      tenant: { tenantId: "tenant-a" },
      subject: { kind: "user", ref: "user-9" },
      objective: OBJECTIVE,
      attentionPolicy: { policyId: "ap-1", version: "1", style: input.style ?? "balanced", params: {} },
      context: { contextId: "ctx-1" },
      candidates: { setId: "cs-ad-formats", candidates: [{ itemId: "ad-bumper", realizationIds: [], source: "reckon.ad-availability.current" }] },
      constraints: [],
      ...(input.currentExperience !== undefined ? { currentExperience: input.currentExperience as never } : {}),
      policySelector: { policyId: "greedy-v1", version: "1" },
      at: AT,
      idempotencyKey: "idem-ad-timing",
    },
    scored: input.scored,
    ...(input.switchInput !== undefined ? { switch: input.switchInput } : {}),
    ...(input.opportunity !== undefined ? { opportunity: input.opportunity } : {}),
    ...(input.interruptRequested !== undefined ? { interruptRequested: input.interruptRequested } : {}),
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe("AD-004 ad timing — defer/queue through the scheduler", () => {
  it("balanced policy: the best ad candidate is QUEUEd (defer — never auto-plays from idle)", () => {
    const decision = decideWith({
      state: { status: "idle", queue: [], resumeCheckpoints: [] },
      scored: scoredAds(),
    });
    expect(decision.action).toBe("QUEUE");
    expect(decision.selectedExperience?.itemId).toBe("ad-bumper");
    expect(decision.scheduleDelta.enqueue).toEqual([decision.selectedExperienceId]);
  });

  it("mindful policy: the ad is SUGGESTed, not auto-started (attention law)", () => {
    const decision = decideWith({
      state: { status: "idle", queue: [], resumeCheckpoints: [] },
      scored: scoredAds(),
      style: "mindful",
    });
    expect(decision.action).toBe("SUGGEST");
    expect(decision.selectedExperience?.itemId).toBe("ad-bumper");
  });

  it("CONTINUE from queued dequeues the ad as the plan head", () => {
    const scored = scoredAds();
    const head = scored[0]!.experience.experienceId;
    const decision = decideWith({
      state: { status: "queued", queue: [head], resumeCheckpoints: [] },
      scored,
    });
    expect(decision.action).toBe("CONTINUE");
    expect(decision.selectedExperienceId).toBe(head);
    expect(decision.scheduleDelta.dequeue).toEqual([head]);
  });
});

describe("AD-004 ad interruption — through the switch evaluator + interruption policy", () => {
  const scored = scoredAds();
  const adCandidate = scored[0]!;
  const currentExperience = {
    experienceId: "exp-current-news",
    itemId: "vid-news",
    realizationId: "real-vid-news",
    format: { kind: "full", params: {} },
  };
  const playingState: PlanState = {
    status: "playing",
    currentExperienceId: "exp-current-news",
    queue: [],
    resumeCheckpoints: [],
  };

  it("a net-positive switch TO an ad is emitted when the interruption opportunity is present", () => {
    const decision = decideWith({
      state: playingState,
      scored,
      currentExperience,
      switchInput: {
        currentExperienceId: "exp-current-news",
        candidateExperienceId: adCandidate.experience.experienceId,
        expectedImprovement: 0.6,
        interruptionCost: 0.2,
        uncertaintyPenalty: 0.05,
        resumeLoss: 0.1,
        switchThreshold: 0.1,
        suggestThreshold: 0.02,
      },
      opportunity: {
        opportunity: true,
        reasons: [{ code: "attention-ok", message: "attention available" }],
        urgency: 0.7,
        estimatedTerms: {
          expectedImprovement: 0.6,
          interruptionCost: 0.2,
          uncertaintyPenalty: 0.05,
          resumeLoss: 0.1,
        },
      },
    });
    expect(decision.action).toBe("SWITCH");
    expect(decision.selectedExperience?.itemId).toBe("ad-bumper");
    // RESUME LAW: switching away records a checkpoint slot for the organic experience.
    expect(decision.resumeCheckpointSlot?.experienceId).toBe("exp-current-news");
  });

  it("the SAME net-positive switch is GATED when the interruption policy reports no opportunity (attention exhausted)", () => {
    const decision = decideWith({
      state: playingState,
      scored,
      currentExperience,
      switchInput: {
        currentExperienceId: "exp-current-news",
        candidateExperienceId: adCandidate.experience.experienceId,
        expectedImprovement: 0.6,
        interruptionCost: 0.2,
        uncertaintyPenalty: 0.05,
        resumeLoss: 0.1,
        switchThreshold: 0.1,
        suggestThreshold: 0.02,
      },
      opportunity: {
        opportunity: false,
        reasons: [{ code: "attention-exhausted", message: "available attention 10000ms < 30000ms minimum budget" }],
        urgency: 0,
        estimatedTerms: {
          expectedImprovement: 0.6,
          interruptionCost: 0.2,
          uncertaintyPenalty: 0.05,
          resumeLoss: 0.1,
        },
      },
    });
    expect(decision.action).toBe("CONTINUE");
    expect(decision.reasons.map((r) => r.code)).toContain("switch-gated-no-opportunity");
  });

  it("host-requested interruption of the current experience checkpoints and interrupts (no ad needed)", () => {
    const decision = decideWith({
      state: playingState,
      scored,
      currentExperience,
      interruptRequested: true,
    });
    expect(decision.action).toBe("INTERRUPT");
    expect(decision.nextState.status).toBe("interrupted");
    expect(decision.resumeCheckpointSlot?.experienceId).toBe("exp-current-news");
  });

  it("the interruption-opportunity policy's fatigue gates evaluate ad-bearing moments exactly like organic ones (one policy)", () => {
    const context = {
      schema: "reckon.context-snapshot",
      schemaVersion: "0.1.0",
      contextId: "ctx-1",
      at: AT,
      attention: { availableMs: 5_000 },
      fatigue: { recentInterruptions: 4 },
      activity: [],
      extra: {},
    };
    const plan = {
      schema: "reckon.experience-plan",
      schemaVersion: "0.1.0",
      planId: "plan-1",
      version: 1,
      tenant: { tenantId: "tenant-a" },
      subject: { kind: "user", ref: "user-9" },
      objective: OBJECTIVE,
      attentionPolicy: { policyId: "ap-1", version: "1", style: "balanced", params: {} },
      queuedExperiences: [adCandidate.experience],
      replanTriggers: [],
      resumeCheckpoints: [],
      createdAt: 0,
      updatedAt: 1,
    };
    const evaluation = evaluateInterruptionOpportunity({
      context: context as never,
      currentExperience: currentExperience as never,
      plan: plan as never,
      policyRef: { policyId: "interruption-v1", version: "1" },
    });
    if (!evaluation.ok) throw new Error(evaluation.error.message);
    expect(evaluation.value.opportunity).toBe(false);
    expect(evaluation.value.reasons.map((r) => r.code)).toContain("attention-exhausted");
    expect(evaluation.value.reasons.map((r) => r.code)).toContain("interruption-fatigue");
    // The best queued candidate the estimates refer to IS the ad.
    expect(evaluation.value.estimatedTerms.candidateExperienceId).toBe(adCandidate.experience.experienceId);
  });
});
