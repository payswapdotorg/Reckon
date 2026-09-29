/**
 * @reckon/scheduler — the scheduler + switch/interruption evaluator
 * (Worker 2 lane).
 *
 * W2-004: the plan-state machine over the eight scheduler actions
 * (LEGAL-TRANSITION MATRIX, lock #11), the switch evaluator (SEPARATION
 * LAW, lock #9), and resume checkpoint slots (RESUME LAW, lock #12).
 * Pure, total, deterministic; zero LLM calls.
 */
export * from "./errors.js";
export * from "./state.js";
export * from "./switch-evaluator.js";
export * from "./scheduler.js";
