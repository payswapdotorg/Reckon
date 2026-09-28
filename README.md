# Reckon

**The decision engine for what to show, say, play, recommend, buy, or interrupt — and when.**

Reckon is a provider-neutral Recommendation, Experience Planning, and Scheduling platform.

Its core job is not merely to return a ranked list. Reckon evaluates a user's or audience's current context, objective, attention state, available choices, constraints, uncertainty, and switching/interruption cost to select or schedule the next best **experience**.

Reckon is designed to be consumed by products such as WebFlix, YouTube-like media platforms, TikTok-like feeds, e-commerce stores, marketplaces, advertising systems, content platforms, and other applications that need to decide:

- what to recommend;
- which representation or format to use;
- when to present it;
- whether to continue the current experience;
- whether to switch;
- whether to interrupt;
- what to queue next;
- how much to explore;
- and, eventually, which agent organization should make the decision.

## Product thesis

> **Reckon is the Stripe of recommendation and experience scheduling:** a provider-neutral infrastructure layer that lets another product supply its users, catalog, events, constraints, objectives, and delivery surfaces while Reckon supplies decisioning, learning, experimentation, scheduling, and optimization.

The comparison is a product-positioning analogy, not a claim that Reckon has the same market position as Stripe.

## Core abstractions

### Decision

A decision is a typed request for the next best action or experience.

### Experience

An experience is not just an item:

`content/item + realization/source + format + timing + duration + context + objective`

The same item may produce several valid experiences.

### Personal Agent

A logical Personal Agent may own a private user's preference and context state. It can have device-local bodies and may synchronize derived learning state across devices when the user grants permission.

### Agent Body

An Agent Body is an executable capability envelope: observations, tools, memory interfaces, permissions, budgets, latency limits, and action contracts.

`Agent Body + LLM/model + permitted capabilities = Agent Instance`

### Agent Organization

An Agent Organization is a graph of agent bodies and communication/delegation edges. Reckon may search or compile organizations suited to particular decision classes and contexts.

### Experience Plan

A continuously revisable sequence of future experiences. A playlist, product recommendation sequence, ad sequence, notification plan, or content queue can all be representations of an Experience Plan.

### Scheduler

The runtime that decides whether to HOLD, PLAY, QUEUE, SWITCH, SUGGEST, INTERRUPT, or RESUME.

### World Model

A versioned model/simulator of user or audience response used for offline evaluation, counterfactual analysis, sequential policy learning, and organization search.

### Reward

A versioned objective that captures value and costs. Engagement is never assumed to be the objective.

## Canonical loop

`catalog + user/audience state + context + objective + constraints + events`
→ `candidate universe`
→ `candidate/experience resolution`
→ `decision`
→ `schedule/act`
→ `observe outcome`
→ `update learning state`
→ `evaluate/calibrate`

For research:

`evidence`
→ `environment`
→ `policy/organization candidates`
→ `offline evaluation`
→ `simulation`
→ `bounded live experiment`
→ `calibration`

## Initial domain-neutral use cases

- Media recommendation and auto-playlist scheduling.
- Continuous media planning and context-aware playback.
- Proactive content switching with explicit interruption policies.
- Commerce next-best-item and next-best-action.
- Advertising selection, format selection, and interruption timing.
- Content/news recommendation.
- Notifications and messaging timing.
- Marketplace ranking and merchandising.
- Cross-surface recommendation for products with web/mobile/device clients.

## Architecture boundaries

Reckon is the decisioning authority inside an embedding product, but it does **not** become that product's:

- identity authority;
- source-of-truth content/catalog authority;
- payment authority;
- entitlement/rights authority;
- provider API authority;
- delivery/playback authority;
- policy/compliance authority.

Those stay with the host product and its integrations.

Reckon consumes explicit capability and policy contracts from those systems.

## Provider neutrality

Provider-specific SDKs and behavior belong behind adapters. The Reckon core must not hardcode YouTube, TikTok, Amazon, Shopify, WebFlix, or other provider vocabulary into its decisioning kernel.

Public availability does not imply permission to acquire, cache, transform, or redistribute content.

## Research direction

Reckon explicitly supports a learning ladder rather than assuming online RL from day one:

1. supervised response modeling;
2. contextual bandits / off-policy evaluation;
3. offline policy learning;
4. sequential RL in simulation;
5. counterfactual/model-based planning;
6. bounded real-world experimentation;
7. calibration against observed outcomes;
8. repeated policy and agent-organization search.

The simulation architecture is informed by Google Research's RecSim/RecSim NG work on sequential and multi-actor recommender environments. citeturn284345search0turn284345search3

## Existing RaaS landscape

Amazon Personalize provides real-time item recommendations that update with recent interactions, and Recombee provides a Recommendation-as-a-Service API over users, items, interactions and recommendation calls. Reckon's intended differentiation is the larger control surface: **decision + experience representation + scheduling + interruption + agentic decisioning + simulation/calibration**, rather than only top-N ranking. citeturn284345search2turn284345search8turn284345search7

## Repository rule

The repository is the source of truth. Architecture, contracts, work orders, acceptance criteria, and implementation status MUST be captured here rather than in chat.

No mocks, fixtures, benchmark results, or simulated provider outputs may be presented as production evidence.

## Status

Architecture setup for **TL3 + 3 workers**.

See:

- `docs/architecture/reckon-frozen-architecture.md`
- `docs/architecture/contracts.md`
- `docs/architecture/dependency-graph.md`
- `docs/handoff/TL3-HANDOFF.md`
- `docs/work-items/index.md`
