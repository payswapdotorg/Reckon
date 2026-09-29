/**
 * @reckon/integrations — reference adapters (W3 lane).
 *
 * W3-005: the WebFlix reference adapter — WebFlix-shaped host data →
 * frozen normalized contracts (CatalogItem/Realization, CandidateSet,
 * ContextSnapshot, Objective, AttentionPolicy, scheduler action
 * inputs, observed-class OutcomeEvents, PreferenceDeltas).
 *
 * W3-006: the generic media reference adapter — the same contract
 * proof with completely different host vocabulary, demonstrating that
 * the frozen contracts are media-domain-neutral (no WebFlix naming).
 *
 * Every adapter is a pure deterministic mapper with a typed declaration
 * (capabilities, authorization requirements, limits, fixture-only live
 * verification, provenance, failure semantics). Host systems remain
 * authoritative for identity, consent, catalog, rights, delivery and
 * payment. Fixture evidence never proves a live provider integration.
 */
export * from "./errors.js";
export * from "./declaration.js";
export * from "./webflix.js";
export * from "./media.js";

export const LANE = "@reckon/integrations";
