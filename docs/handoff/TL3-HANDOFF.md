# TL3 Handoff — Reckon

## Mission

Take over `payswapdotorg/Reckon` and implement the repository from the frozen architecture with three concurrent workers.

Reckon is a standalone infrastructure product consumed by WebFlix and, later, other recommendation/media/commerce/advertising platforms.

## Canonical product promise

Reckon decides:

> **what should happen next, in what form, and when — for a declared user/audience objective under current context and constraints.**

It is not limited to top-N recommendation.

## Locked architecture

Read `docs/architecture/architecture-lock.md` before dispatching workers. Any deviation requires a repository Architecture Change Record; workers must stop and surface it rather than silently redesigning a shared contract.

## Required TL3 behavior

1. Verify the repository before trusting any prior implementation claim.
2. Keep the public domain model provider-neutral.
3. Keep runtime decisioning separate from long-running research.
4. Keep host-owned authorities outside Reckon.
5. Use exactly three worker lanes unless a documented exception is required.
6. Allow maximal parallel work after contract freeze.
7. Resolve shared schema conflicts centrally.
8. Workers never merge.
9. Require exact SHA/diff/test evidence from every worker.
10. Never mark an external provider integration green from fixtures alone.

## Worker dispatch

### Worker 1 — Data / Context / Simulation

Primary outcomes:

- event/outcome backbone;
- personal/audience state;
- preference learning;
- feature assembly;
- sequential world model;
- simulation;
- offline evaluation;
- contextual bandits;
- RL environment;
- calibration.

Parallel first wave:

`W1-001, W1-002, W1-003, W1-004`

### Worker 2 — Decision / Scheduling / Agentic Runtime

Primary outcomes:

- decision kernel;
- experience resolver;
- scheduler;
- interruption/opportunity policy;
- Personal Agent runtime;
- Agent Body runtime;
- Agent Organization runtime;
- organization search.

Parallel first wave:

`W2-001, W2-002, W2-003, W2-004, W2-007`

### Worker 3 — API / SDK / Integrations / Proof

Primary outcomes:

- HTTP/API skeleton;
- SDK;
- event ingestion transport;
- observability;
- WebFlix reference integration;
- generic media reference integration;
- commerce integration;
- advertising integration;
- E2E/load/production proof.

Parallel first wave after contracts:

`W3-001`

Then parallelize SDK/event/observability and the adapter lanes as contracts stabilize.

## OpenMuse decision

Do not fork OpenMuse wholesale during the first vertical slice.

Treat `CopilotKit/openmuse` as an evaluated implementation substrate for Agent Computer / browser bodies.

A later Work Order may import selected MIT-licensed components or maintain a bounded fork/adapter, but the Reckon contracts must remain authoritative.

OpenMuse's current repository describes persistent Chromium/browser sessions, an optional Linux computer, durable tasks, and iOS/Android/web clients; these are useful substrate capabilities, but its application architecture and CopilotKit Intelligence dependency are not Reckon requirements.

## RL and organization-search rule

Do not begin by assuming pure RL.

Build the environment and evaluation contract first, then the learning ladder:

`supervised → contextual bandits/offline evaluation → offline policy learning → simulation/RL → organization search → bounded live evaluation → calibration`

A generalist single-agent baseline is mandatory.

## Multi-device PMA rule

Reckon supports one logical personal agent across multiple device bodies.

Only explicitly granted device capabilities may contribute observations or actions.

Cross-device synchronization defaults to derived learning state/deltas rather than unrestricted raw telemetry.

## Auto-plan rule

Treat “auto playlist” as a generic Experience Plan.

A host may use it as:

- media queue;
- commerce journey;
- ad schedule;
- notification schedule.

## Switch rule

Never couple ranking directly to switching.

The scheduler/interruption policy separately evaluates:

`benefit of switching - interruption cost - uncertainty - resume loss`

## Domain adapters

The first reference adapters are:

1. WebFlix/media;
2. generic media;
3. commerce;
4. advertising.

They must all consume the same normalized decision contracts.

## No-go shortcuts

- no provider-specific core branches;
- no hidden mocks;
- no hardcoded LLM provider;
- no second model router;
- no direct provider publication;
- no direct ad-serving authority;
- no unconsented cross-device tracking;
- no claim of “best” without explicit uncertainty semantics.

## Acceptance gates

### Gate A — Contract integrity
Schemas, versions, serialization and tenant boundaries pass.

### Gate B — Real runtime
A media-neutral decision can execute end-to-end with no LLM.

### Gate C — Personalization
State changes after outcomes and affects subsequent decisions.

### Gate D — Scheduling
A plan can be created, replanned, switched, held, and resumed.

### Gate E — Simulation
A deterministic sequential environment can replay and evaluate policies.

### Gate F — Agentic
Agent Body and organization candidates run under budgets and evaluation hooks.

### Gate G — Real integrations
At least one real consuming path is verified outside fixtures; adapters expose honest capability matrices.

### Gate H — Performance
Fast path has an explicit latency budget and measured p50/p95.

### Gate I — Research validity
Counterfactual/simulation outputs are clearly separated from observed outcomes; robustness and calibration are reported.

### Gate J — Product readiness
Docs, SDK examples, API compatibility, auth/tenant controls, observability and operational runbooks are complete.

## Final handoff condition

TL3 may declare Reckon implementation complete only after the repository contains:

- frozen architecture and contracts;
- dependency/work-item state;
- real runtime vertical slice;
- personal/context state;
- scheduler;
- research environment;
- agent runtime;
- domain-neutral SDK;
- representative integrations;
- production evidence;
- explicit limitations.
