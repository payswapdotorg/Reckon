/**
 * Policy-engine seam — DECLARED PORT ONLY (W2-002 owns the
 * implementation; it is a LATER wave and is NOT implemented here).
 *
 * The port is frozen now so the scheduler (W2-004) and future
 * composition roots depend on the seam, never on an implementation.
 * The fast decisioning path must be correct with ZERO LLM calls
 * (NO-LLM LAW): any future implementation of this port is deterministic
 * TypeScript; model adapters are a separate seam and are never called
 * by this kernel.
 */
import type {
  Experience,
  HardConstraint,
  Objective,
  RewardSpec,
  Uncertainty,
} from "@reckon/contracts";
import type { Result } from "./errors.js";

/** A scored experience produced by the policy engine (W2-002). */
export interface ScoredExperience {
  experience: Experience;
  /** Policy score for the declared objective/reward. */
  score: number;
  uncertainty?: Uncertainty;
}

export interface PolicyScoreInput {
  /** Eligible (constraint-passing) experiences to score. */
  experiences: Experience[];
  objective: Objective;
  /** Hard constraints already applied upstream may be re-declared for
   *  defense in depth; constraints are separate from reward
   *  (architecture-lock #21). */
  constraints: HardConstraint[];
  /** Host-declared, versioned reward spec (never engagement-by-default). */
  reward?: RewardSpec;
  policyId: string;
  policyVersion: string;
}

export type PolicyScoreResult = Result<ScoredExperience[]>;

/**
 * The policy-engine port (W2-002). Implementations must be pure,
 * deterministic, and LLM-free on the fast path.
 */
export interface PolicyEngine {
  score(input: PolicyScoreInput): PolicyScoreResult;
}
