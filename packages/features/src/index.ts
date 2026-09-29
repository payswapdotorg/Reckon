/**
 * @reckon/features — feature assembly (W1-004).
 *
 * Seven deterministic feature families (item, realization, experience,
 * preference, context, temporal, uncertainty) assembled into a
 * digested FeatureVector:
 * - every input record is validated against its frozen contract schema
 *   (typed errors — never raw strings);
 * - temporal features respect the no-future-leakage law
 *   (`occurredAt <= at`, strictly);
 * - host vocabulary enters only through stable hashed buckets
 *   (provider-neutral core);
 * - location contributes only an explicit permitted flag (ADR-003);
 * - identical inputs ⇒ identical digest; any semantic change ⇒ a
 *   different digest.
 */
export * from "./errors.js";
export * from "./port.js";
export * from "./hashing.js";
export * from "./families.js";
export { createFeatureAssembler } from "./assembler.js";
