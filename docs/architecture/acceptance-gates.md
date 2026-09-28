# Acceptance Gates

TL3 uses these gates in order.

## A — Repository and contracts

Architecture, schemas, serialization, versioning and tenant boundaries are frozen and verified.

## B — Runtime vertical slice

`context → candidates → experience → decision → schedule → outcome` executes without an LLM dependency.

## C — Learning

Outcomes update preference/learning state and materially affect a later decision.

## D — Scheduling

Plans can be created, replanned, held, switched, interrupted and resumed with preserved checkpoints.

## E — Research

Sequential simulation replays deterministically and distinguishes observed, simulated and counterfactual outcomes.

## F — Agentic runtime

Agent Bodies execute within permissions/budget/latency constraints. Agent Organizations execute and are evaluated against a generalist baseline.

## G — Consumer integrations

WebFlix/media, generic media, commerce and advertising adapters use the same public contracts.

## H — Performance

Fast-path p50/p95 latency and resource envelopes are measured on a declared environment.

## I — Robustness/calibration

Policies are evaluated across seeds/world-model ensembles and calibrated against observed outcomes where live data exists.

## J — Production readiness

Auth/tenant security, operational runbooks, observability, SDK compatibility, failure semantics, deployment procedures and real integration evidence are complete.

No gate is satisfied solely by local fixtures unless the gate explicitly says fixture.
