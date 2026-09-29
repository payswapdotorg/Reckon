/**
 * W2-004 — the switch evaluator (SEPARATE from ranking).
 *
 * SEPARATION LAW (architecture-lock #9, frozen architecture §9): ranking
 * and interruption are SEPARATE policies. A higher-ranked candidate
 * NEVER justifies interruption by itself. This evaluator computes
 *
 *   netValue = expectedImprovement − interruptionCost
 *              − uncertaintyPenalty − resumeLoss
 *
 * from EXPLICIT caller-supplied numbers (never guessed, never derived
 * from rank or score) and acts only past explicit thresholds:
 *
 *   netValue >  switchThreshold   ⇒ SWITCH
 *   netValue >= suggestThreshold  ⇒ SUGGEST   (i.e. [suggest, switch))
 *   otherwise                     ⇒ HOLD
 *
 * Note the boundary semantics: SWITCH requires netValue STRICTLY greater
 * than switchThreshold; netValue == switchThreshold falls into the
 * SUGGEST band; netValue == suggestThreshold is SUGGEST (inclusive).
 */
import type { Id } from "@reckon/contracts";
import type { Result } from "./errors.js";
import { invalidInput } from "./errors.js";

export interface SwitchEvaluationInput {
  /** The experience we would switch AWAY from (active or interrupted). */
  currentExperienceId: Id;
  /** The candidate experience we would switch TO. */
  candidateExperienceId: Id;
  /** Caller-supplied: expected improvement of switching (objective/
   *  context/format fit and confidence are inputs to this number —
   *  computed by the host/policy layer, never guessed here). */
  expectedImprovement: number;
  /** Caller-supplied: modeled interruption cost (RESUME LAW, lock #12). */
  interruptionCost: number;
  /** Caller-supplied: uncertainty penalty. */
  uncertaintyPenalty: number;
  /** Caller-supplied: modeled resume loss (RESUME LAW, lock #12). */
  resumeLoss: number;
  /** netValue must EXCEED this to emit SWITCH. */
  switchThreshold: number;
  /** netValue >= this (and <= switchThreshold) emits SUGGEST. */
  suggestThreshold: number;
}

export type SwitchVerdict = "HOLD" | "SUGGEST" | "SWITCH";

export interface SwitchEvaluationResult {
  verdict: SwitchVerdict;
  /** expectedImprovement − interruptionCost − uncertaintyPenalty − resumeLoss. */
  netValue: number;
  terms: {
    expectedImprovement: number;
    interruptionCost: number;
    uncertaintyPenalty: number;
    resumeLoss: number;
  };
  thresholds: {
    switchThreshold: number;
    suggestThreshold: number;
  };
}

export interface SwitchEvaluator {
  evaluate(input: SwitchEvaluationInput): Result<SwitchEvaluationResult>;
}

const NUMERIC_FIELDS = [
  "expectedImprovement",
  "interruptionCost",
  "uncertaintyPenalty",
  "resumeLoss",
  "switchThreshold",
  "suggestThreshold",
] as const;

/** Pure, total, deterministic switch evaluation. */
export function evaluateSwitch(input: SwitchEvaluationInput): Result<SwitchEvaluationResult> {
  if (input === null || typeof input !== "object") {
    return invalidInput("evaluateSwitch: input must be an object");
  }
  const issues: { path: string; message: string }[] = [];
  for (const field of NUMERIC_FIELDS) {
    const value = input[field];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      issues.push({ path: field, message: "must be a finite number" });
    }
  }
  if (typeof input.currentExperienceId !== "string" || input.currentExperienceId.length < 1) {
    issues.push({ path: "currentExperienceId", message: "must be a non-empty id" });
  }
  if (typeof input.candidateExperienceId !== "string" || input.candidateExperienceId.length < 1) {
    issues.push({ path: "candidateExperienceId", message: "must be a non-empty id" });
  }
  if (issues.length > 0) {
    return invalidInput("evaluateSwitch: invalid input", issues);
  }
  if (input.suggestThreshold > input.switchThreshold) {
    return invalidInput(
      "evaluateSwitch: suggestThreshold must be <= switchThreshold",
      [{ path: "suggestThreshold", message: `got ${input.suggestThreshold} > switchThreshold ${input.switchThreshold}` }],
    );
  }

  const netValue =
    input.expectedImprovement -
    input.interruptionCost -
    input.uncertaintyPenalty -
    input.resumeLoss;

  let verdict: SwitchVerdict;
  if (netValue > input.switchThreshold) {
    verdict = "SWITCH";
  } else if (netValue >= input.suggestThreshold) {
    verdict = "SUGGEST";
  } else {
    verdict = "HOLD";
  }

  return {
    ok: true,
    value: {
      verdict,
      netValue,
      terms: {
        expectedImprovement: input.expectedImprovement,
        interruptionCost: input.interruptionCost,
        uncertaintyPenalty: input.uncertaintyPenalty,
        resumeLoss: input.resumeLoss,
      },
      thresholds: {
        switchThreshold: input.switchThreshold,
        suggestThreshold: input.suggestThreshold,
      },
    },
  };
}

/** Factory for the stateless switch-evaluator port. */
export function createSwitchEvaluator(): SwitchEvaluator {
  return { evaluate: evaluateSwitch };
}
