/**
 * @reckon/simulation — deterministic sequential simulation + the
 * Reckon-Complete common simulation harness.
 *
 * - WorldModel (W1-005): versioned, digestable world state anchored at
 *   an information cutoff (no future leakage, tenant/subject scoped,
 *   evidence-class separation between input history and simulated
 *   output).
 * - SequentialSimulator (W1-006): steps a world state forward with a
 *   seeded virtual clock; deterministic replay + stochastic ensembles.
 * - SIM-001 harness: the driver API a synthetic host uses to become
 *   Reckon-Complete through Reckon's PUBLIC surface only — register
 *   manifest → connect sources → declare objectives → run the decision
 *   loop → return outcomes → collect an IntegrationEffortRecord.
 *
 * Laws: no Math.random, no Date.now / wall-clock reads, no LLM/network
 * dependency, simulated output always `evidenceClass: "simulated"`, and
 * the harness imports ONLY @reckon/contracts + @reckon/sdk (never an
 * internal kernel package — enforced by tests/conformance/
 * zero-internal-access.test.ts).
 */
export * from "./errors.js";
export * from "./rng.js";
export * from "./world-model.js";
export * from "./simulator.js";
// SIM-001: the common Reckon-Complete simulation harness — additive
// extension; no existing exported shape above changes.
export * from "./harness/clock.js";
export * from "./harness/percentile.js";
export * from "./harness/port.js";
export * from "./harness/sdk-port.js";
export * from "./harness/responder.js";
export * from "./harness/recording.js";
export * from "./harness/host-adapter.js";
export * from "./harness/driver.js";
export * from "./harness/scorecard.js";

