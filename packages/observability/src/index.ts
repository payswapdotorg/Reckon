/**
 * @reckon/observability — append-only, digest-stamped telemetry records
 * for the decision → schedule → outcome flow (W3-004).
 *
 * Laws:
 * - APPEND-ONLY (calibration law): records are immutable, carry content
 *   digests, and are never rewritten.
 * - Contract-typed inputs: every recorded contract object is validated
 *   against the REAL frozen zod schemas (typed errors, never raw throws).
 * - Deterministic: record timestamps and ids come from injected
 *   clock/generator; latency is computed from the injected clock by the
 *   composition wrapper.
 * - Honest evidence: records carry an explicit evidence-class label.
 *
 * EVIDENCE LABEL: the in-memory and JSONL sinks are TEST INFRASTRUCTURE
 * (controlled-local); production telemetry backends are later waves.
 */
export * from "./errors.js";
export * from "./records.js";
export * from "./sink.js";
export * from "./recorder.js";
