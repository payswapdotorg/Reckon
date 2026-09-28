# ADR-002 — Model Adapter Boundary

**Status:** ACCEPTED / FROZEN

## Decision

Reckon has one provider-neutral model adapter boundary.

Models provide inference capability only. They do not become decision, identity, policy or domain authorities.

Fast runtime correctness must not require an LLM.

Agent Organizations do not create a second model router.

## Rules

- provider SDKs stay behind adapters;
- model/version/cost/latency are observable;
- Agent Bodies remain model-neutral;
- permissions are explicit and scoped.