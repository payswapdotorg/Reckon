/**
 * @reckon/evaluation — offline evaluation harnesses (W1 lane).
 *
 * - Offline policy evaluation (W1-007): deterministic, pure IPS /
 *   SNIPS / doubly-robust estimators over logged DecisionResult-derived
 *   records, with documented skip semantics and clipping diagnostics.
 * - Contextual-bandit evaluation (W1-008): seeded evaluation harness
 *   over feature-family contexts with regret, per-arm statistics and
 *   append-only calibration records.
 * - Calibration ledger (W1-010): append-only prediction-vs-observation
 *   records with Brier score, reliability curves and ECE, evidence-class
 *   segregated (research evidence never mixes with observed evidence).
 * - Robustness harness (W1-010): propensity clip/shrink, feature-family
 *   dropout and seed-ensemble perturbations with drift flags and a
 *   deterministic robustness digest.
 *
 * Laws: no Math.random, no Date.now, no LLM/network dependency;
 * tenant-scoped everything; fixture evidence stays labeled fixture.
 */
export * from "./errors.js";
export * from "./rng.js";
export * from "./offline.js";
export * from "./bandit.js";
export * from "./calibration.js";
export * from "./robustness.js";
