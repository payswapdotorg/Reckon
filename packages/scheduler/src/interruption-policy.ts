/**
 * W2-005 — the interruption-opportunity policy.
 *
 * SEPARATION LAW (architecture-lock #9): ranking and interruption are
 * SEPARATE policies. This module decides ONLY whether an interruption
 * OPPORTUNITY exists right now (a timing gate on the MOMENT); it never
 * decides to interrupt. The SWITCH/SUGGEST/HOLD decision stays with the
 * switch evaluator (W2-004), whose numbers remain caller-supplied. The
 * scheduler consumes an evaluated opportunity via the optional
 * `SchedulerInput.opportunity` field (composition — no frozen contract
 * schema is changed).
 *
 * Gates (documented; only frozen ContextSnapshot fields are used):
 * - ATTENTION BUDGET: no opportunity when attention is exhausted —
 *   `context.attention.availableMs` declared and < MIN_ATTENTION_BUDGET_MS
 *   (30s: not enough budget to receive anything new), or
 *   `context.attention.quality === "interrupted"` (attention already
 *   fragmented). ABSENT attention fields do NOT block: absence is not
 *   evidence of exhaustion (the switch-evaluator thresholds remain the
 *   binding guard — separation).
 * - FATIGUE: no opportunity when `context.fatigue.repetitionLevel` ≥
 *   FATIGUE_REPETITION_THRESHOLD (0.7) or
 *   `context.fatigue.recentInterruptions` ≥ RECENT_INTERRUPTIONS_LIMIT (3).
 *   Absent fatigue fields do not block.
 * - FORMAT SUITABILITY: no opportunity when the CURRENT experience's
 *   format kind ∈ NONINTERRUPTIBLE_FORMATS (documented set: "full" —
 *   long-form immersive; "interactive" — mid-interaction). Every other
 *   format kind is a naturally breakable moment.
 *
 * Output: `{ opportunity, reasons, urgency }` plus ESTIMATED switch
 * terms. The estimates are documented formulas over declared inputs;
 * the caller MAY feed them into the switch evaluator — the scheduler
 * never auto-feeds them (SEPARATION LAW: switch numbers stay
 * caller-supplied).
 *
 * Formulas (documented):
 * - urgency = 0 when no opportunity; otherwise
 *   urgency = ½ × attentionHeadroom + ½ × (1 − fatiguePressure) where
 *   attentionHeadroom = clamp01(availableMs / REFERENCE_ATTENTION_MS)
 *   (absent → 0.5 neutral) and
 *   fatiguePressure = clamp01(max(repetitionLevel ?? 0,
 *   (recentInterruptions ?? 0) / RECENT_INTERRUPTIONS_LIMIT)).
 *   Urgency measures the FAVORABILITY of the moment (not calendar
 *   urgency) ∈ [0,1].
 * - expectedImprovement = fit(bestQueued) − fit(current), where fit(E) =
 *   0 when E declares a different objective than the plan objective;
 *   fitScore (clamped [0,1]) when declared; 0.5 NEUTRAL when undeclared
 *   (documented neutral prior for differences: no evidence of advantage
 *   ⇒ 0 improvement between equally-unknown experiences). 0 when the
 *   plan has no queued experiences. bestQueued = highest fit, then
 *   experienceId ascending (deterministic).
 * - interruptionCost = 0.2 base + 0.3 when the current format is
 *   non-interruptible + 0.5 × clamp01(recentInterruptions /
 *   RECENT_INTERRUPTIONS_LIMIT) ∈ [0.2, 1.0].
 * - resumeLoss = 0.1 when a resume checkpoint exists for the current
 *   experience in the plan (cheap resume), else 0.6.
 * - uncertaintyPenalty = 0.2 × (missing evidence channels / 2), where a
 *   channel is missing when the current or best-queued fit evidence is
 *   undeclared (or objective-mismatched) ∈ [0, 0.2].
 *
 * Determinism: pure synchronous kernel; same inputs ⇒ byte-identical
 * output (digest-tested). NO-LLM LAW: zero LLM calls, zero network.
 */
import {
  ContextSnapshotSchema,
  ExperiencePlanSchema,
  ExperienceSchema,
  type ContextSnapshot,
  type Experience,
  type ExperiencePlan,
  type Id,
  type InterruptionPolicyRef,
} from "@reckon/contracts";
import type { Result } from "./errors.js";
import { invalidInput } from "./errors.js";

/** Attention budget floor (ms). Below this the subject cannot receive
 *  anything new — the moment is not an interruption opportunity. */
export const MIN_ATTENTION_BUDGET_MS = 30_000;

/** Reference attention budget (ms) for urgency normalization (10 min). */
export const REFERENCE_ATTENTION_MS = 600_000;

/** Repetition level at/above which fatigue blocks an opportunity. */
export const FATIGUE_REPETITION_THRESHOLD = 0.7;

/** Recent-interruption count at/above which fatigue blocks an
 *  opportunity. */
export const RECENT_INTERRUPTIONS_LIMIT = 3;

/** Current-experience format kinds that are NOT suitable interruption
 *  moments (documented set — immersive or interaction-locked). */
export const NONINTERRUPTIBLE_FORMATS: readonly string[] = ["full", "interactive"];

/** Neutral fit prior for undeclared fit evidence (differences only). */
export const NEUTRAL_FIT = 0.5;

const BASE_INTERRUPTION_COST = 0.2;
const FORMAT_COST_PENALTY = 0.3;
const INTERRUPTION_HISTORY_WEIGHT = 0.5;
export const RESUME_LOSS_WITH_CHECKPOINT = 0.1;
export const RESUME_LOSS_WITHOUT_CHECKPOINT = 0.6;
const MAX_UNCERTAINTY_PENALTY = 0.2;

/** The interruption-opportunity input (all declared inputs). */
export interface InterruptionOpportunityInput {
  /** Attention signals (frozen ContextSnapshot contract fields only). */
  context: ContextSnapshot;
  /** The experience currently being presented. */
  currentExperience: Experience;
  /** The current plan (queued experiences, resume checkpoints, objective). */
  plan: ExperiencePlan;
  /** Which interruption policy (id/version echo). */
  policyRef: InterruptionPolicyRef;
}

/** Estimated switch terms (documented formulas; caller-supplied to the
 *  switch evaluator — never auto-fed by the scheduler). */
export interface EstimatedSwitchTerms {
  /** The best queued candidate the estimates refer to (absent when the
   *  plan queues nothing). */
  candidateExperienceId?: Id;
  expectedImprovement: number;
  interruptionCost: number;
  uncertaintyPenalty: number;
  resumeLoss: number;
}

/** The evaluated interruption opportunity (SEPARATION LAW: this is NOT
 *  a switch decision). */
export interface InterruptionOpportunityResult {
  /** Does an interruption opportunity exist right now? */
  opportunity: boolean;
  /** Gate outcomes (every gate, pass or fail — deterministic order). */
  reasons: { code: string; message: string }[];
  /** Moment favorability ∈ [0,1] (0 when no opportunity). */
  urgency: number;
  /** Documented-formula estimates for the switch evaluator. */
  estimatedTerms: EstimatedSwitchTerms;
}

export type InterruptionOpportunityEvaluation = Result<InterruptionOpportunityResult>;

/**
 * The interruption-opportunity policy port (W2-005). Implementations
 * are pure, deterministic and LLM-free.
 */
export interface InterruptionOpportunityPolicy {
  evaluate(input: InterruptionOpportunityInput): InterruptionOpportunityEvaluation;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Fit evidence for the switch-term formulas: declared fitScore when
 *  the experience serves the plan objective; 0 on declared mismatch;
 *  NEUTRAL_FIT when undeclared; `present` false when undeclared (for
 *  the uncertainty-penalty channel count). */
function fitEvidence(
  experience: Experience,
  planObjectiveId: string,
): { value: number; present: boolean } {
  const declared = experience.objectiveFit;
  if (declared === undefined) return { value: NEUTRAL_FIT, present: false };
  const declaredObjective = declared.objective;
  if (declaredObjective !== undefined && declaredObjective.objectiveId !== planObjectiveId) {
    return { value: 0, present: true };
  }
  const fitScore = declared.fitScore;
  if (typeof fitScore !== "number" || !Number.isFinite(fitScore)) {
    return { value: NEUTRAL_FIT, present: false };
  }
  return { value: clamp01(fitScore), present: true };
}

/** Best queued candidate: fit DESC, then experienceId ASC — deterministic. */
function bestQueued(plan: ExperiencePlan): Experience | undefined {
  if (plan.queuedExperiences.length === 0) return undefined;
  const ranked = [...plan.queuedExperiences].sort((a, b) => {
    const fitA = fitEvidence(a, plan.objective.objectiveId).value;
    const fitB = fitEvidence(b, plan.objective.objectiveId).value;
    if (fitA !== fitB) return fitB - fitA;
    return a.experienceId < b.experienceId ? -1 : a.experienceId > b.experienceId ? 1 : 0;
  });
  return ranked[0];
}

// ---------------------------------------------------------------------------
// Kernel
// ---------------------------------------------------------------------------

/** Pure, total, deterministic interruption-opportunity evaluation. */
export function evaluateInterruptionOpportunity(
  input: InterruptionOpportunityInput,
): InterruptionOpportunityEvaluation {
  if (!isObject(input)) {
    return invalidInput("evaluateInterruptionOpportunity: input must be an object");
  }
  const issues: { path: string; message: string }[] = [];
  const parsedContext = ContextSnapshotSchema.safeParse(input.context);
  if (!parsedContext.success) {
    issues.push(
      ...parsedContext.error.issues.map((i) => ({
        path: `context.${i.path.join(".")}`,
        message: i.message,
      })),
    );
  }
  const parsedCurrent = ExperienceSchema.safeParse(input.currentExperience);
  if (!parsedCurrent.success) {
    issues.push(
      ...parsedCurrent.error.issues.map((i) => ({
        path: `currentExperience.${i.path.join(".")}`,
        message: i.message,
      })),
    );
  }
  const parsedPlan = ExperiencePlanSchema.safeParse(input.plan);
  if (!parsedPlan.success) {
    issues.push(
      ...parsedPlan.error.issues.map((i) => ({
        path: `plan.${i.path.join(".")}`,
        message: i.message,
      })),
    );
  }
  const ref = input.policyRef;
  if (
    !isObject(ref) ||
    typeof ref.policyId !== "string" ||
    ref.policyId.length < 1 ||
    ref.policyId.length > 128 ||
    (ref.version !== undefined &&
      (typeof ref.version !== "string" || ref.version.length < 1 || ref.version.length > 64))
  ) {
    issues.push({ path: "policyRef", message: "must be { policyId: string(1..128), version?: string(1..64) }" });
  }
  if (issues.length > 0) {
    return invalidInput("evaluateInterruptionOpportunity: invalid input", issues);
  }

  // Issues empty ⇒ every parse succeeded; the never casts are unreachable.
  const context = parsedContext.success ? parsedContext.data : (undefined as never);
  const current = parsedCurrent.success ? parsedCurrent.data : (undefined as never);
  const plan = parsedPlan.success ? parsedPlan.data : (undefined as never);

  // --- Gates (documented order: attention, fatigue, format). ---
  const reasons: { code: string; message: string }[] = [];
  let attentionExhausted = false;

  const attention = context.attention;
  if (attention?.availableMs !== undefined && attention.availableMs < MIN_ATTENTION_BUDGET_MS) {
    attentionExhausted = true;
    reasons.push({
      code: "attention-exhausted",
      message: `available attention ${attention.availableMs}ms < ${MIN_ATTENTION_BUDGET_MS}ms minimum budget`,
    });
  } else if (attention?.quality === "interrupted") {
    attentionExhausted = true;
    reasons.push({
      code: "attention-already-interrupted",
      message: "attention quality is interrupted; another interruption is not an opportunity",
    });
  } else {
    reasons.push({
      code: "attention-ok",
      message:
        attention?.availableMs !== undefined
          ? `available attention ${attention.availableMs}ms ≥ ${MIN_ATTENTION_BUDGET_MS}ms minimum budget`
          : "no attention-exhaustion evidence declared (absent fields do not block)",
    });
  }

  const fatigue = context.fatigue;
  let fatigued = false;
  if (fatigue?.repetitionLevel !== undefined && fatigue.repetitionLevel >= FATIGUE_REPETITION_THRESHOLD) {
    fatigued = true;
    reasons.push({
      code: "fatigue-high",
      message: `repetition level ${fatigue.repetitionLevel} ≥ ${FATIGUE_REPETITION_THRESHOLD} fatigue threshold`,
    });
  } else if (fatigue?.recentInterruptions !== undefined && fatigue.recentInterruptions >= RECENT_INTERRUPTIONS_LIMIT) {
    fatigued = true;
    reasons.push({
      code: "interruption-fatigue",
      message: `${fatigue.recentInterruptions} recent interruptions ≥ limit ${RECENT_INTERRUPTIONS_LIMIT}`,
    });
  } else {
    reasons.push({
      code: "fatigue-ok",
      message:
        fatigue?.repetitionLevel !== undefined || fatigue?.recentInterruptions !== undefined
          ? "fatigue signals below blocking thresholds"
          : "no fatigue evidence declared (absent fields do not block)",
    });
  }

  const formatSuitable = !NONINTERRUPTIBLE_FORMATS.includes(current.format.kind);
  if (!formatSuitable) {
    reasons.push({
      code: "format-unsuitable",
      message: `current format ${current.format.kind} is a non-interruptible moment (${NONINTERRUPTIBLE_FORMATS.join(", ")})`,
    });
  } else {
    reasons.push({
      code: "format-suitable",
      message: `current format ${current.format.kind} is a naturally breakable moment`,
    });
  }

  const opportunity = !attentionExhausted && !fatigued && formatSuitable;

  // --- Urgency (documented formula; 0 when no opportunity). ---
  let urgency = 0;
  if (opportunity) {
    const attentionHeadroom =
      attention?.availableMs !== undefined ? clamp01(attention.availableMs / REFERENCE_ATTENTION_MS) : NEUTRAL_FIT;
    const interruptionPressure =
      fatigue?.recentInterruptions !== undefined
        ? fatigue.recentInterruptions / RECENT_INTERRUPTIONS_LIMIT
        : 0;
    const fatiguePressure = clamp01(Math.max(fatigue?.repetitionLevel ?? 0, interruptionPressure));
    urgency = clamp01(0.5 * attentionHeadroom + 0.5 * (1 - fatiguePressure));
  }

  // --- Estimated switch terms (documented formulas). ---
  const candidate = bestQueued(plan);
  const currentFit = fitEvidence(current, plan.objective.objectiveId);
  const candidateFit = candidate !== undefined ? fitEvidence(candidate, plan.objective.objectiveId) : undefined;

  const expectedImprovement = candidateFit !== undefined ? candidateFit.value - currentFit.value : 0;

  const formatPenalty = formatSuitable ? 0 : FORMAT_COST_PENALTY;
  const historyPenalty =
    INTERRUPTION_HISTORY_WEIGHT *
    clamp01((fatigue?.recentInterruptions ?? 0) / RECENT_INTERRUPTIONS_LIMIT);
  const interruptionCost = BASE_INTERRUPTION_COST + formatPenalty + historyPenalty;

  const hasCheckpoint = plan.resumeCheckpoints.some(
    (checkpoint) => checkpoint.experienceId === current.experienceId,
  );
  const resumeLoss = hasCheckpoint ? RESUME_LOSS_WITH_CHECKPOINT : RESUME_LOSS_WITHOUT_CHECKPOINT;

  const missingChannels =
    (currentFit.present ? 0 : 1) + (candidateFit !== undefined && !candidateFit.present ? 1 : 0);
  const uncertaintyPenalty = MAX_UNCERTAINTY_PENALTY * (missingChannels / 2);

  return {
    ok: true,
    value: {
      opportunity,
      reasons,
      urgency,
      estimatedTerms: {
        ...(candidate !== undefined ? { candidateExperienceId: candidate.experienceId } : {}),
        expectedImprovement,
        interruptionCost,
        uncertaintyPenalty,
        resumeLoss,
      },
    },
  };
}

/** Factory for the stateless interruption-opportunity policy port. */
export function createInterruptionOpportunityPolicy(): InterruptionOpportunityPolicy {
  return { evaluate: evaluateInterruptionOpportunity };
}
