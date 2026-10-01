/**
 * @reckon/organization — the Agent Organization runtime + search (Worker 2 lane).
 *
 * W2-008: a directed graph of Agent Bodies (the frozen
 * `AgentOrganization` contract) with communication/delegation edges,
 * message passing over the W2-007 body runtime (the envelope machinery
 * enforces every operation), delegation records with traceable
 * lineage, deterministic orchestration (REQUIRED injected clock, seeded
 * tie-breaks), bounded failure isolation, and the mandatory
 * single-agent baseline comparison (lock #15).
 *
 * W2-009: organization search — a deterministic, model-neutral search
 * layer over the same graph (capability matching over declared body
 * capabilities, min-cost delegation/communication paths, decision-
 * support ranking, and the mandatory single-agent baseline comparison
 * with honest deltas).
 *
 * Cross-package composition note: the W2-007 agents runtime is imported
 * via a RELATIVE module path (typecheck + runtime). The frozen lockfile
 * forbids adding workspace dependencies, so — like the scheduler's
 * type-only import of @reckon/decision — the organization package
 * composes the agents package without a package.json/lockfile change.
 */
export * from "./errors.js";
export * from "./runtime.js";
export * from "./search.js";
