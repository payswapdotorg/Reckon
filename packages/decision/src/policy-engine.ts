/**
 * W2-002 — the policy engine implementation (the frozen port in
 * `policy-port.ts`).
 *
 * Laws enforced here:
 * - NO-LLM LAW (architecture-lock #6, ADR-002): the kernel is pure,
 *   synchronous, deterministic TypeScript. No network, no filesystem,
 *   no clocks, no model adapters — ever.
 * - CONSTRAINT/REWARD SEPARATION (lock #21): hard constraints gate
 *   eligibility (excluded experiences never receive a score); reward
 *   terms only shape preference among ELIGIBLE experiences.
 * - NO DEFAULT ENGAGEMENT REWARD (lock #22): when no `RewardSpec` is
 *   declared, scoring uses declared objective-fit evidence ONLY and the
 *   detail result carries `rewardApplied: false`. Engagement is never
 *   implicitly rewarded.
 * - HONEST EVIDENCE: scores are computed ONLY from host-declared
 *   numbers. Absent evidence contributes 0 (never a fabricated neutral
 *   value) and is disclosed via `Uncertainty` (evidence-sparsity
 *   confidence). Confidence is never invented.
 * - DEFENSE IN DEPTH: the request-level `constraints` AND each
 *   experience's own `constraints` are re-applied here (the same
 *   kernel-evaluable kinds as W2-003, same fail-closed semantics);
 *   constraint-failing experiences are excluded with typed reasons.
 *
 * Scoring formulas (documented, deterministic):
 * - objectiveFit(E) =
 *     0                when E.objectiveFit.objective.objectiveId is
 *                      declared and differs from the request objective
 *                      (declared to serve a different objective);
 *     fitScore         when E.objectiveFit.fitScore is declared
 *                      (clamped to [0,1]);
 *     0                otherwise (no declared evidence — never
 *                      fabricated; disclosed as missing evidence).
 * - rewardScore(E) = Σᵢ wᵢ·vᵢ(E) / Σᵢ |wᵢ| over the terms EVALUATED for
 *   E (0 when no term is evaluated, or when the evaluated weight sum is
 *   0). With vᵢ ∈ [0,1] and any finite weights, rewardScore ∈ [-1,1].
 *   Term values come ONLY from declared reward params (opaque host
 *   records interpreted as):
 *     `params.values`: Record<experienceId, number> — host-declared
 *       per-experience term value (missing id ⇒ term unevaluated);
 *     `params.value`: number — host-declared constant for every
 *       experience;
 *     neither ⇒ the term is unevaluated for every experience.
 *   Values are clamped to [0,1]. Unevaluated terms are disclosed via
 *   uncertainty, never guessed.
 * - score(E) = objectiveFit(E)                          (no reward spec)
 *   score(E) = ½·objectiveFit(E) + ½·rewardScore(E)      (reward spec)
 *   The ½/½ mix keeps the objective-fit and reward channels on equal
 *   footing (documented constant, not tuned per call).
 * - Ordering: score DESC, then experienceId ASC (UTF-16 code units) —
 *   deterministic stable tie-breaking.
 * - Uncertainty: confidence = present evidence channels / total
 *   evidence channels (1 objective-fit channel + 1 per reward term
 *   when a reward spec is declared), method
 *   "policy-engine.evidence-sparsity.v1". This is a REAL measure of
 *   input sparsity, not fabricated confidence; spread/disagreement/
 *   oodScore are omitted because a single deterministic scorer cannot
 *   quantify them.
 *
 * Kernel-evaluable constraint kinds (same as W2-003, fail-closed on
 * undeclared values; `time-window`, `max-cost`, `max-latency`,
 * `catalog-rule`, `policy-rights` and `custom` are request-scoped or
 * host-evaluated and pass through):
 * min-duration, max-duration, format-required, format-forbidden,
 * locale-required, device-class-required. ISO-8601 duration strings
 * are not interpreted (undeclared for gating purposes).
 */
import {
  ExperienceSchema,
  HardConstraintSchema,
  ObjectiveSchema,
  RewardSpecSchema,
  type Experience,
  type HardConstraint,
  type Id,
  type Objective,
  type RewardSpec,
  type Uncertainty,
} from "@reckon/contracts";
import type { Result } from "./errors.js";
import { invalidInput } from "./errors.js";
import type { PolicyEngine, PolicyScoreInput, ScoredExperience } from "./policy-port.js";

/** Mix weight of the objective-fit channel when a reward spec is
 *  declared. The reward channel receives `1 - OBJECTIVE_FIT_WEIGHT`. */
export const OBJECTIVE_FIT_WEIGHT = 0.5;

const UNCERTAINTY_METHOD = "policy-engine.evidence-sparsity.v1";

/** A constraint-failing experience with typed exclusion reasons
 *  (defense in depth: never scored, never ranked). */
export interface PolicyExclusion {
  experienceId: Id;
  /** Failing gate codes in deterministic (input constraint order, then
   *  per-experience constraint order) order. */
  reasons: { code: string; message: string }[];
}

/** The full policy evaluation detail. The frozen `PolicyEngine` port
 *  returns only `scored`; this richer result (composition, not a seam
 *  change) additionally carries the exclusion reasons and whether a
 *  reward spec was applied. */
export interface PolicyEvaluationDetail {
  /** Eligible experiences, scored and deterministically ranked. */
  scored: ScoredExperience[];
  /** Constraint-failing experiences with exclusion reasons. */
  excluded: PolicyExclusion[];
  /** True iff a RewardSpec was declared (and therefore applied). */
  rewardApplied: boolean;
  policyId: string;
  policyVersion: string;
}

export type PolicyEvaluationResult = Result<PolicyEvaluationDetail>;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateScoreInput(input: PolicyScoreInput): { issues: { path: string; message: string }[] } {
  const issues: { path: string; message: string }[] = [];
  if (!isObject(input)) {
    return { issues: [{ path: "input", message: "must be an object" }] };
  }
  const parsedObjective = ObjectiveSchema.safeParse(input.objective);
  if (!parsedObjective.success) {
    issues.push(
      ...parsedObjective.error.issues.map((i) => ({
        path: `objective.${i.path.join(".")}`,
        message: i.message,
      })),
    );
  }
  if (input.reward !== undefined) {
    const parsedReward = RewardSpecSchema.safeParse(input.reward);
    if (!parsedReward.success) {
      issues.push(
        ...parsedReward.error.issues.map((i) => ({
          path: `reward.${i.path.join(".")}`,
          message: i.message,
        })),
      );
    }
  }
  if (input.constraints !== undefined) {
    if (!Array.isArray(input.constraints)) {
      issues.push({ path: "constraints", message: "must be an array" });
    } else {
      input.constraints.forEach((constraint, index) => {
        const parsed = HardConstraintSchema.safeParse(constraint);
        if (!parsed.success) {
          issues.push({
            path: `constraints[${index}]`,
            message: parsed.error.issues.map((i) => i.message).join("; "),
          });
        }
      });
    }
  }
  if (!Array.isArray(input.experiences)) {
    issues.push({ path: "experiences", message: "must be an array" });
  } else {
    const seen = new Set<string>();
    input.experiences.forEach((experience, index) => {
      const parsed = ExperienceSchema.safeParse(experience);
      if (!parsed.success) {
        issues.push({
          path: `experiences[${index}]`,
          message: parsed.error.issues.map((i) => i.message).join("; "),
        });
        return;
      }
      const id = parsed.data.experienceId;
      if (seen.has(id)) {
        issues.push({
          path: `experiences[${index}]`,
          message: `duplicate experienceId ${id} — deterministic tie-breaking requires unique ids`,
        });
      }
      seen.add(id);
    });
  }
  if (typeof input.policyId !== "string" || input.policyId.length < 1 || input.policyId.length > 128) {
    issues.push({ path: "policyId", message: "must be a non-empty string (max 128)" });
  }
  if (
    typeof input.policyVersion !== "string" ||
    input.policyVersion.length < 1 ||
    input.policyVersion.length > 64
  ) {
    issues.push({ path: "policyVersion", message: "must be a non-empty string (max 64)" });
  }
  return { issues };
}

// ---------------------------------------------------------------------------
// Objective-fit channel
// ---------------------------------------------------------------------------

interface FitEvidence {
  value: number;
  present: boolean;
}

/** objectiveFit(E) per the documented formula. */
function objectiveFit(experience: Experience, objective: Objective): FitEvidence {
  const declared = experience.objectiveFit;
  if (declared === undefined) return { value: 0, present: false };
  const declaredObjective = declared.objective;
  if (
    declaredObjective !== undefined &&
    declaredObjective.objectiveId !== objective.objectiveId
  ) {
    // Declared to serve a different objective: zero fit (declared
    // negative evidence, not missing evidence).
    return { value: 0, present: true };
  }
  const fitScore = declared.fitScore;
  if (typeof fitScore !== "number" || !Number.isFinite(fitScore)) {
    return { value: 0, present: false };
  }
  return { value: clamp01(fitScore), present: true };
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

// ---------------------------------------------------------------------------
// Reward channel
// ---------------------------------------------------------------------------

interface TermEvidence {
  /** Declared term value for the experience (clamped to [0,1]); present
   *  iff the term was evaluated for this experience. */
  value: number;
  present: boolean;
}

/** Resolve one reward term's declared value for one experience (never
 *  guessed). Documented interpretation of the opaque `params`. */
function termValue(
  term: RewardSpec["terms"][number],
  experience: Experience,
): TermEvidence {
  const params = term.params;
  const byExperience = params?.["values"];
  if (isObject(byExperience)) {
    const declared = (byExperience as Record<string, unknown>)[experience.experienceId];
    if (typeof declared === "number" && Number.isFinite(declared)) {
      return { value: clamp01(declared), present: true };
    }
    return { value: 0, present: false };
  }
  const constant = params?.["value"];
  if (typeof constant === "number" && Number.isFinite(constant)) {
    return { value: clamp01(constant), present: true };
  }
  return { value: 0, present: false };
}

interface RewardEvidence {
  value: number;
  /** Number of terms evaluated for this experience. */
  evaluated: number;
}

/** rewardScore(E) per the documented weighted-mean formula. */
function rewardScore(
  reward: RewardSpec,
  experience: Experience,
): RewardEvidence {
  let weightedSum = 0;
  let weightMagnitudeSum = 0;
  let evaluated = 0;
  for (const term of reward.terms) {
    const evidence = termValue(term, experience);
    if (!evidence.present) continue;
    weightedSum += term.weight * evidence.value;
    weightMagnitudeSum += Math.abs(term.weight);
    evaluated += 1;
  }
  if (evaluated === 0 || weightMagnitudeSum === 0) {
    // No declared reward evidence (or all-zero evaluated weights):
    // the channel cannot discriminate — 0, never guessed.
    return { value: 0, evaluated };
  }
  return { value: weightedSum / weightMagnitudeSum, evaluated };
}

// ---------------------------------------------------------------------------
// Uncertainty (evidence sparsity — real, never fabricated)
// ---------------------------------------------------------------------------

function uncertaintyFor(
  fitPresent: boolean,
  reward: RewardSpec | undefined,
  evaluatedTerms: number,
): Uncertainty {
  const totalChannels = 1 + (reward !== undefined ? reward.terms.length : 0);
  const presentChannels = (fitPresent ? 1 : 0) + evaluatedTerms;
  const confidence = totalChannels === 0 ? 0 : presentChannels / totalChannels;
  return {
    confidence: clamp01(confidence),
    method: UNCERTAINTY_METHOD,
  };
}

// ---------------------------------------------------------------------------
// Constraint re-application (defense in depth)
// ---------------------------------------------------------------------------

/** Duration in seconds for constraint evaluation. ISO-8601 duration
 *  strings are NOT interpreted (undeclared ⇒ duration gates fail
 *  closed). Same documented rule as W2-003. */
function durationSeconds(experience: Experience): number | undefined {
  const duration = experience.duration;
  if (duration === undefined) return undefined;
  if (typeof duration === "number") return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
  return undefined;
}

/** Evaluate the kernel-owned constraint kinds. Fail-closed on
 *  undeclared values; opaque/request-scoped kinds pass through
 *  (time-window, max-cost, max-latency, catalog-rule, policy-rights,
 *  custom). Same semantics as W2-003 (defense in depth = the same
 *  gates, re-applied). */
function evaluateConstraint(
  experience: Experience,
  constraint: HardConstraint,
): { code: string; message: string } | null {
  switch (constraint.kind) {
    case "min-duration": {
      const duration = durationSeconds(experience);
      if (duration === undefined || duration < constraint.seconds) {
        return {
          code: "min-duration",
          message:
            duration === undefined
              ? `duration undeclared; cannot verify min-duration ${constraint.seconds}s`
              : `duration ${duration}s < min-duration ${constraint.seconds}s`,
        };
      }
      return null;
    }
    case "max-duration": {
      const duration = durationSeconds(experience);
      if (duration === undefined || duration > constraint.seconds) {
        return {
          code: "max-duration",
          message:
            duration === undefined
              ? `duration undeclared; cannot verify max-duration ${constraint.seconds}s`
              : `duration ${duration}s > max-duration ${constraint.seconds}s`,
        };
      }
      return null;
    }
    case "format-required": {
      const matches =
        experience.format.kind === constraint.format ||
        experience.format.customKind === constraint.format;
      if (!matches) {
        return {
          code: "format-required",
          message: `format ${experience.format.kind} != required ${constraint.format}`,
        };
      }
      return null;
    }
    case "format-forbidden": {
      const matches =
        experience.format.kind === constraint.format ||
        experience.format.customKind === constraint.format;
      if (matches) {
        return {
          code: "format-forbidden",
          message: `format ${experience.format.kind} is forbidden`,
        };
      }
      return null;
    }
    case "locale-required": {
      if (experience.locale !== constraint.locale) {
        return {
          code: "locale-required",
          message: `locale ${experience.locale ?? "undeclared"} != required ${constraint.locale}`,
        };
      }
      return null;
    }
    case "device-class-required": {
      const classes = experience.requirements?.deviceClass ?? [];
      if (!classes.includes(constraint.deviceClass)) {
        return {
          code: "device-class-required",
          message: `device classes [${classes.join(", ")}] do not include ${constraint.deviceClass}`,
        };
      }
      return null;
    }
    default:
      // time-window, max-cost, max-latency, catalog-rule, policy-rights,
      // custom — request-scoped or host-evaluated: pass through.
      return null;
  }
}

// ---------------------------------------------------------------------------
// Kernel
// ---------------------------------------------------------------------------

/** Deterministic output ordering: score DESC, then experienceId ASC
 *  (UTF-16 code units, locale-independent). */
function compareScored(a: ScoredExperience, b: ScoredExperience): number {
  if (a.score !== b.score) return b.score - a.score;
  const idA = a.experience.experienceId;
  const idB = b.experience.experienceId;
  return idA < idB ? -1 : idA > idB ? 1 : 0;
}

/**
 * The full policy evaluation (pure, total, deterministic, LLM-free).
 * Constraint-failing experiences are excluded with typed reasons;
 * eligible experiences are scored against the declared objective and
 * (when declared) the versioned reward spec, with evidence-sparsity
 * uncertainty. The frozen `PolicyEngine` port is the `scored` channel
 * of this result.
 */
export function evaluatePolicy(input: PolicyScoreInput): PolicyEvaluationResult {
  const { issues } = validateScoreInput(input);
  if (issues.length > 0) {
    return invalidInput("evaluatePolicy: invalid input", issues);
  }

  const objective = ObjectiveSchema.parse(input.objective);
  const reward =
    input.reward !== undefined ? RewardSpecSchema.parse(input.reward) : undefined;
  const requestConstraints = (input.constraints ?? []) as HardConstraint[];

  const scored: ScoredExperience[] = [];
  const excluded: PolicyExclusion[] = [];

  for (const rawExperience of input.experiences) {
    const experience = ExperienceSchema.parse(rawExperience);

    // Defense in depth: re-apply the request constraints AND the
    // experience's own constraints (kernel-evaluable kinds only).
    const reasons: { code: string; message: string }[] = [];
    for (const constraint of requestConstraints) {
      const failure = evaluateConstraint(experience, constraint);
      if (failure) reasons.push(failure);
    }
    for (const constraint of experience.constraints) {
      const failure = evaluateConstraint(experience, constraint);
      if (failure) reasons.push(failure);
    }
    if (reasons.length > 0) {
      excluded.push({ experienceId: experience.experienceId, reasons });
      continue; // constraint-failing experiences are never scored
    }

    const fit = objectiveFit(experience, objective);
    let score: number;
    let evaluatedTerms = 0;
    if (reward === undefined) {
      // NO DEFAULT ENGAGEMENT REWARD: objective-fit only.
      score = fit.value;
    } else {
      const rewardEvidence = rewardScore(reward, experience);
      evaluatedTerms = rewardEvidence.evaluated;
      score = OBJECTIVE_FIT_WEIGHT * fit.value + (1 - OBJECTIVE_FIT_WEIGHT) * rewardEvidence.value;
    }
    scored.push({
      experience,
      score,
      uncertainty: uncertaintyFor(fit.present, reward, evaluatedTerms),
    });
  }

  scored.sort(compareScored);

  return {
    ok: true,
    value: {
      scored,
      excluded,
      rewardApplied: reward !== undefined,
      policyId: input.policyId,
      policyVersion: input.policyVersion,
    },
  };
}

/**
 * The frozen `PolicyEngine` port implementation (W2-002). Returns the
 * scored eligible experiences; exclusion reasons and `rewardApplied`
 * are available via `evaluatePolicy` (composition — the seam itself is
 * unchanged). Pure, synchronous, deterministic — zero LLM calls.
 */
export function createPolicyEngine(): PolicyEngine {
  return {
    score(input: PolicyScoreInput) {
      const evaluation = evaluatePolicy(input);
      if (!evaluation.ok) return evaluation;
      return { ok: true, value: evaluation.value.scored };
    },
  };
}
