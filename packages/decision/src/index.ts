/**
 * @reckon/decision — the decision kernel (Worker 2 lane).
 *
 * W2 first wave implements candidate normalization (W2-001) and declares
 * the policy-engine port (W2-002 — later wave, port only).
 *
 * All exports are pure, total, deterministic TypeScript. No LLM calls
 * (NO-LLM LAW, architecture-lock #6). Errors are typed results, never
 * raw throws.
 */
export * from "./errors.js";
export * from "./normalize.js";
export * from "./policy-port.js";
