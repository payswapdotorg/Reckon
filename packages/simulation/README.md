Worker 1 owns the deterministic sequential world model and stochastic ensemble/replay infrastructure.

## Contents

- `src/world-model.ts` + `src/simulator.ts` — W1-005/W1-006: versioned, digestable world state anchored at an information cutoff, and the seeded sequential simulator.
- `src/harness/**` — SIM-001: the common Reckon-Complete simulation harness (driver, port, scripted responder, recording port, host-adapter seam, scorecard). See `docs/simulations/harness-guide.md`.
- `src/levels/**` — SIM-002: the ladder Levels 1–4 synthetic-host cases (Wave A):
  - `level-1-static-catalog.ts` — static catalog picker;
  - `level-2-content-feed.ts` — simple content feed (preferences/context/outcomes/queue-replace);
  - `level-3-storefront.ts` — e-commerce storefront (variants/price/availability/constraints/conversion);
  - `level-4-notifications.ts` — notification system (attention/fatigue/time windows/defer-queue/interruption);
  - `wave-a.ts` — canonical Wave A fixtures, runner, sealed scorecard, and the machine-generated report tables;
  - `index.ts` — public re-exports.

Laws for every module in this package: imports only `@reckon/contracts` + `@reckon/sdk` (zero internal kernel packages — enforced by `tests/conformance/zero-internal-access.test.ts`); no wall-clock reads or unseeded randomness; synthetic output is always `evidenceClass: "fixture"|"simulated"` and never becomes observed evidence. See `docs/simulations/sim-002-levels-1-4.md` for the Wave A evidence report.
