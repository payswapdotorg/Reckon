/**
 * @reckon/events — append-oriented event/outcome ingestion backbone
 * (W1-001).
 *
 * Laws implemented here:
 * - Append law (ADR-001, contracts.md #8): records append, never
 *   overwrite; corrections reference earlier records via
 *   `correctsEventId`; idempotent re-observations return the original.
 * - Evidence-typing law (contracts.md #9): observed-class and
 *   research-class records are stored and iterated through disjoint
 *   APIs (`observed()` / `research()`).
 * - Tenant isolation (contracts.md #5): every query is explicitly
 *   tenant-scoped.
 * - Provenance and caller-supplied `occurredAt` are preserved verbatim
 *   (deterministic replay); every stored record carries a
 *   `contentDigest` (reproducible artifact lineage).
 */
export * from "./errors.js";
export * from "./port.js";
export { InMemoryEventStoreAdapter } from "./adapter.js";
