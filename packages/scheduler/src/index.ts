/**
 * @reckon/scheduler — the scheduler + switch/interruption evaluator
 * (Worker 2 lane).
 *
 * W2-004: the plan-state machine over the eight scheduler actions
 * (LEGAL-TRANSITION MATRIX, lock #11), the switch evaluator (SEPARATION
 * LAW, lock #9), and resume checkpoint slots (RESUME LAW, lock #12).
 *
 * W2-005: the interruption-opportunity policy — a timing gate on the
 * MOMENT (attention budget, fatigue, format suitability from the frozen
 * ContextSnapshot) feeding the scheduler via the optional
 * `SchedulerInput.opportunity` composition field. Opportunities are
 * separate from switch decisions; SWITCH verdicts are gated when no
 * opportunity exists, SUGGEST is never gated.
 *
 * Pure, total, deterministic; zero LLM calls.
 */
export * from "./errors.js";
export * from "./state.js";
export * from "./switch-evaluator.js";
export * from "./interruption-policy.js";
export * from "./scheduler.js";
