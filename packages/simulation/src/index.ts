/**
 * @reckon/simulation — deterministic sequential simulation (W1 lane).
 *
 * - WorldModel (W1-005): versioned, digestable world state anchored at
 *   an information cutoff (no future leakage, tenant/subject scoped,
 *   evidence-class separation between input history and simulated
 *   output).
 * - SequentialSimulator (W1-006): steps a world state forward with a
 *   seeded virtual clock; deterministic replay + stochastic ensembles.
 *
 * Laws: no Math.random, no Date.now / wall-clock reads, no LLM/network
 * dependency, simulated output always `evidenceClass: "simulated"`.
 */
export * from "./errors.js";
export * from "./rng.js";
export * from "./world-model.js";
// W1-006 (simulator.ts) is exported once implemented below in this wave.

