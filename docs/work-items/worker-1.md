# Worker 1 Handoff — Data / Context / Simulation

## Owned paths

- §packages/context/**§
- §packages/preferences/**§
- §packages/events/**§
- §packages/features/**§
- §packages/simulation/**§
- §packages/evaluation/**§
- §packages/learning/**§

## First wave

After CONTRACT-001:

- W1-001 events/outcomes
- W1-002 context
- W1-003 preferences
- W1-004 features

These can proceed concurrently.

## Required

Events: append-oriented, tenant-scoped, idempotent, provenance-aware, caller-timed where deterministic replay matters.

Context: time, device, screen/audio availability, host activity signals, attention, session, objective, fatigue and current experience.

Preferences: stable + situational, with confidence, scope, provenance, decay and expiry. One topic/view must not permanently redefine long-term taste.

Features: item, realization, experience, user, context, objective, session, temporal and uncertainty features.

Simulation: deterministic replay plus stochastic ensembles. Record world-model version, seed, simulation clock, information cutoff, configuration and reward version.

Evaluation: relevance, objective success, exploration/serendipity, diversity, context/format fit, interruption regret, cost, latency and uncertainty calibration.

RL: do not require online RL first. Follow the locked learning ladder.

Calibration: append prediction-vs-observation records; never rewrite historical evidence.

## Forbidden

- provider-specific ranking logic;
- direct provider acquisition;
- default raw cross-device telemetry;
- future-information leakage;
- simulated data presented as observed;
- hardcoded engagement reward;
- direct runtime composition.

## Completion evidence

Prove serialization, tenant isolation, idempotency, reproducibility, counterfactual labeling, negative cases and exact SHA/diff/test evidence.