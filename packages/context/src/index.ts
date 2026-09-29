/**
 * @reckon/context — subject/audience context state (W1-002).
 *
 * - Ingestion validates against the frozen `ContextSnapshotSchema`
 *   (unknown shapes rejected with typed errors).
 * - Stored snapshots are frozen defensive copies — a snapshot saved at
 *   T is never mutated by events appended later (no-future-leakage).
 * - `latest()` orders by the caller-supplied `at` with a deterministic
 *   `contextId` tie-break.
 * - Location is accepted ONLY under the schema's explicit `permitted:
 *   true` marker (ADR-003) and is never enriched or inferred.
 * - `deriveAttentionView` is a pure derived view (attention + fatigue).
 */
export * from "./errors.js";
export * from "./port.js";
export * from "./attention.js";
export { InMemoryContextStoreAdapter } from "./adapter.js";
