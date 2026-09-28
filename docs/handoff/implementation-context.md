# Reckon Implementation Context

**Status:** APPROVED PRODUCT CONTEXT / REPOSITORY SOURCE OF TRUTH

## Product

Reckon is a standalone infrastructure product for context-aware decisioning, experience planning and scheduling.

Intended consumers include:

- WebFlix and other media platforms;
- video/feed products;
- commerce platforms and shops;
- marketplaces;
- advertising systems;
- notification/messaging systems.

Reference repositories:

- WebFlix: https://github.com/payswapdotorg/WebFlix
- MOS: https://github.com/payswapdotorg/MOS
- OpenMuse reference: https://github.com/CopilotKit/openmuse

## Product promise

Reckon determines:

> What should happen next, in what form, and when, for a declared user/audience objective under the current context and constraints?

It is not merely a top-N recommender.

## North star

Maximize expected user/audience value across eligible experiences while respecting hard constraints, minimizing unnecessary interruption, accounting for switching/resume cost, controlling system cost, and preserving uncertainty.

Reckon must not claim an objectively best future choice.

## Core abstraction

`Item → Realization → Experience → Decision → Schedule → Outcome → Learning`

An Experience combines the item with an executable realization, format, timing, duration, context and objective.

An Experience Plan is a rolling, continuously revisable sequence. A media auto-playlist is one domain-specific representation of this abstraction.

## Personal Agent

A logical Personal Agent can span devices.

Each device may expose a local Agent Body with explicit observations and actuators.

Examples include phone activity, desktop/browser state, TV playback, vehicle/audio state and future device surfaces.

Cross-device learning is opt-in.

The default synchronization object is derived learning state or deltas, not unrestricted raw telemetry.

## Context

Possible context includes time, activity, device, screen/audio availability, network, available attention, session, fatigue/repetition, current objective, current experience and interruption state.

Sensitive raw sensor data is not required by the core.

## Continuous planning and media switching

Reckon should be able to:

- keep a rolling auto-plan;
- discover new opportunities while an experience is active;
- detect low-value continuation/boredom signals supplied by the host;
- compare the current experience with new candidates;
- hold when improvement is insufficient;
- suggest when the user should choose;
- switch when automatic switching is allowed;
- preserve a high-quality resume point.

Ranking and switching are separate decisions.

A higher-ranked candidate does not automatically justify interruption.

## Experience representation

One item may have multiple experiences:

- full video;
- shorter segment;
- audio-only;
- translated;
- dubbed;
- summarized;
- alternate source;
- alternate format.

The host remains responsible for rights and actual delivery.

## Exploration

Reckon must discover useful content/products with sparse evidence.

Exploration should model uncertainty, novelty, diversity and serendipity. Low popularity alone is not evidence of quality.

## Research / RL

Learning ladder:

1. supervised response modeling;
2. contextual bandits and off-policy evaluation;
3. offline policy learning;
4. sequential simulation/RL;
5. counterfactual/model-based planning;
6. bounded live evaluation;
7. calibration.

The environment must model sequential behavior, not just static ranking.

## Agent organization search

An Agent Body contains role, observations, tools, permissions, memory, actions, budgets, latency limits, evaluators and implementation references.

`Agent Body + selected LLM/model + permitted capabilities = Agent Instance`

An Agent Organization is a directed graph of Agent Bodies and communication/delegation edges.

The search may vary roles, topology, communication, memory, model assignment, tools, budgets, termination and critic/evaluator roles.

A single generalist agent is always a mandatory baseline.

## Domain expansion

Media:
`media item → realization → experience → play/queue/switch`

Commerce:
`product → offer/realization → experience → recommend/present/bundle/wait`

Advertising:
`creative → placement/format → experience → show/defer/interrupt`

Notifications:
`message → channel/format → experience → send/defer/escalate`

The kernel remains domain-neutral.

## OpenMuse decision

Observed current upstream at takeover:

- main commit: `34b15bc80340e582fb8c25573646cfb0bbc5184d`;
- MIT license;
- persistent Chromium/browser worker;
- optional Linux computer;
- durable task/work execution;
- iOS/Android/web surfaces.

Decision:

OpenMuse is an optional Agent Computer/browser-body substrate evaluation. It is not a Reckon architectural dependency.

Do not block the first Reckon vertical slice on the OpenMuse evaluation.

## MOS relationship

MOS v1.7's repository architecture provides a useful reference for:

`reference corpus → world model → strategy search → Agent Body/Organization search → bounded experiment → calibration`

Reckon adopts this pattern at a domain-neutral recommendation/decision layer without importing MOS authorities.

## Hard boundaries

Reckon must never:

- bypass provider security, DRM, authentication or rate limits;
- infer reuse/redistribution rights from availability;
- silently track across devices without permission;
- fabricate engagement;
- optimize deceptive/inchoate behavior;
- turn an attention policy into a universal maximum-engagement objective;
- represent counterfactual output as observed evidence.

The host remains authoritative for identity, consent, catalog, rights, delivery, payment and policy.

## Product positioning analogy

`Stripe of recommendation and media/content/purchase-item scheduling` is an internal positioning analogy.

It means an embedding product sends normalized state, candidates, objectives, constraints and outcomes to Reckon and receives decisions/plans/schedule actions.

It does not claim market parity with Stripe.