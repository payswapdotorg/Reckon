/**
 * @reckon/events — append-oriented event/outcome ingestion backbone
 * (W1-001) + durable outcome transport seam (W3-003).
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
 * - At-least-once transport (W3-003): idempotencyKey dedup at the sink,
 *   deterministic injected-clock backoff, append-only journals, terminal
 *   failures surfaced — never dropped.
 */
export * from "./errors.js";
export * from "./port.js";
export { InMemoryEventStoreAdapter } from "./adapter.js";
export * from "./transport.js";
export { BufferedTransport } from "./buffered-transport.js";
export type { BufferedTransportOptions } from "./buffered-transport.js";
export * from "./journal.js";
