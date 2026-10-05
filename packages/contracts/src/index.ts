/**
 * @reckon/contracts — the canonical frozen public contracts of Reckon.
 *
 * CONTRACT-001 (FROZEN). Every change here requires an Architecture
 * Change Record approved by TL3. Workers implement against these
 * schemas; OpenAPI/JSON Schema/SDK representations are GENERATED from
 * this single source (src/export-json-schemas.ts).
 */
export * from "./version.js";
export * from "./primitives.js";
export * from "./domain.js";
export * from "./policy.js";
export * from "./experience.js";
export * from "./decision.js";
export * from "./outcomes.js";
export * from "./preferences.js";
export * from "./agents.js";
export * from "./organizations.js";
export * from "./plans.js";
export * from "./serialization.js";
// S2-001: developer-platform API contracts (Stripe-style hardening) —
// additive extension; no existing exported shape above changes.
export * from "./api-platform.js";
