/**
 * @reckon/decision — the decision kernel (Worker 2 lane).
 *
 * W2 wave 1 implemented candidate normalization (W2-001) and declared
 * the policy-engine port. W2 wave 2 (W2-002) implements the policy
 * engine: pure deterministic objective/reward scoring with defense-in-
 * depth constraint re-application and evidence-sparsity uncertainty.
 *
 * All exports are pure, total, deterministic TypeScript. No LLM calls
 * (NO-LLM LAW, architecture-lock #6). Errors are typed results, never
 * raw throws.
 */
export * from "./errors.js";
export * from "./normalize.js";
export * from "./policy-port.js";
export * from "./policy-engine.js";
