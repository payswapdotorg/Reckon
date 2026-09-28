# ADR-004 — Runtime vs Research Runtime

**Status:** ACCEPTED / FROZEN

## Decision

Reckon has two execution speeds.

### Fast runtime

Low-latency production decisioning, experience resolution and scheduling. It must remain correct without an LLM call.

### Research runtime

Durable, resumable work for world models, offline evaluation, bandits, RL, organization search, robustness and calibration.

## Rules

Research does not directly become production authority.

Simulation/counterfactual outcomes are typed separately from observed outcomes.

Research jobs require seed/configuration, budget, cancellation/resume and artifact lineage.

Promotion requires bounded real-world evidence.