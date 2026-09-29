/**
 * @reckon/learning — bandit/RL/calibration learning ladder (W1 lane).
 *
 * W1-009: a deterministic, Gym-style SequentialRLEnvironment whose
 * observations are feature-family vectors, whose rewards are computed
 * from the host-declared RewardSpec with fully traceable terms, and
 * whose episodes are governed by explicit termination criteria.
 * Composes with the W1-006 simulator through a structural
 * SimulatedOutcomeModel adapter (interface, not inheritance).
 *
 * Laws: no Math.random, no Date.now / wall-clock reads, no LLM or
 * network dependency anywhere in this package; emitted outcome events
 * are always `evidenceClass: "simulated"` (research evidence).
 */
export * from "./errors.js";
export * from "./rng.js";
export * from "./environment.js";
