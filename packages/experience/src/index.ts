/**
 * @reckon/experience — experience expansion/resolution (Worker 2 lane).
 *
 * W2-003: normalized candidates (W2-001) → complete, schema-valid
 * `Experience` variants, gated by hard constraints (separate from
 * reward) with honest exclusion records. Pure, total, deterministic;
 * zero LLM calls.
 */
export * from "./errors.js";
export * from "./expand.js";
