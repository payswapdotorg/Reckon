# Reckon Frozen Architecture

**Version:** 0.1  
**Status:** FROZEN FOR TL3 IMPLEMENTATION  
**Product:** Reckon — Recommendation, Experience Planning & Scheduling Infrastructure

## 1. Mission

Reckon is infrastructure that makes context-aware decisions about what to recommend, what representation to use, when to present it, whether to continue, whether to switch, and what should happen next.

The reusable unit is a **Decision**, not a feed card.

## 2. North star

For a declared objective and current context:

> maximize expected user/audience value across eligible experiences while respecting constraints, minimizing unnecessary interruption and cost, and preserving uncertainty.

Reckon MUST NOT claim to know the objectively best future choice. Production APIs expose ranked/selected decisions together with confidence/uncertainty metadata appropriate to the implementation.

## 3. Domain model

### Subject

The user, audience member, account, or anonymous session whose behavior is being optimized.

### Catalog Item

A host-owned item: media, product, ad, article, notification, offer, etc.

### Realization

A way the item can actually be delivered: source, provider, player, locale, format, channel, device, or other host capability.

### Experience

A concrete presentation of an item/realization:

- item;
- realization;
- format;
- duration;
- timing;
- context;
- objective;
- constraints.

### Context Snapshot

A typed point-in-time description of relevant state, such as:

- time;
- device;
- screen availability;
- audio route;
- network;
- activity signals supplied by the host;
- available attention;
- location only when explicitly permitted and necessary;
- session state;
- interruptions/fatigue;
- current task/objective.

Sensitive/raw sensor data is not a Reckon requirement.

### Preference State

Long-lived and situational preference representations with:

- confidence;
- provenance;
- scope;
- decay;
- temporal validity;
- context conditions;
- uncertainty.

### Intent

A user/audience objective such as learn, relax, discover, catch up, shop, find a gift, compare, complete a task, etc.

### Attention Policy

Explicit policy governing how aggressively Reckon may consume attention. Examples: mindful, balanced, immersive, custom.

### Candidate Set

The eligible set available to Reckon from host-provided retrieval systems and/or approved exploration providers.

### Decision Policy

A versioned policy selecting an action/experience from eligible candidates.

### Experience Plan

A sequence/horizon of planned decisions that can be changed after new observations.

### Scheduler

Evaluates HOLD / CONTINUE / QUEUE / SUGGEST / SWITCH / INTERRUPT / RESUME / END decisions.

### Outcome Event

Host-reported result after a decision or schedule action.

### Learning Artifact

Versioned model/policy/feature/evaluation artifact derived from evidence.

### Agent Body

Executable capability envelope with tools, permissions, memory interface, budgets, latency and evaluation hooks.

### Agent Organization

A directed graph of Agent Bodies, communication/delegation edges, termination conditions, and resource allocations.

## 4. Public architecture

```
Host Product
    │
    ├── Catalog / Item Service
    ├── Identity / Consent
    ├── Provider / Delivery Adapters
    ├── Policy / Rights / Commerce
    │
    ▼
Reckon SDK / API
    │
    ├── Context + Preference State
    ├── Candidate Resolution
    ├── Decision Engine
    ├── Experience Resolver
    ├── Scheduler
    ├── Agent Runtime
    └── Learning / Experiment APIs
            │
            ▼
      Reckon Decision Kernel
            │
      ┌─────┴────────┐
      ▼              ▼
Fast Runtime     Research Runtime
      │              │
      │          World Model
      │          Simulation
      │          Policy Search
      │          Org Search
      │          Calibration
      ▼              ▼
 Decision         Compiled Policy/
 Result           Organization
```

## 5. Two-speed architecture

### Fast Runtime

The production request path should normally be deterministic/low-latency and may include:

- cached candidate retrieval;
- feature assembly;
- policy scoring;
- constraints;
- exploration;
- scheduling;
- switch/interruption decision;
- precomputed model execution.

LLM calls are optional and MUST NOT be a hidden latency dependency.

### Research Runtime

Long-running work may include:

- dataset construction;
- response modeling;
- bandits;
- offline policy evaluation;
- sequential simulation;
- RL;
- counterfactual analysis;
- agent-organization search;
- robustness ensembles;
- calibration.

Research work uses durable workers, explicit seeds/configuration, budget caps, resumability, and artifact lineage.

## 6. Candidate and experience separation

Reckon must not assume the host's candidate retrieval and its decision policy are the same thing.

Candidate source examples:

- native host retrieval;
- provider APIs;
- provider ranking feeds;
- search;
- vector/semantic retrieval;
- exploration service;
- catalog rules;
- host-supplied candidates.

Then:

`candidate items → experience expansion → policy → schedule`

This allows an item to have multiple eligible experiences.

## 7. Personal Agent model

One user may have one logical Personal Agent identity across devices.

Each device can provide a local Agent Body with local observations and actuators.

```
Logical Personal Agent
 ├── Personal Model
 ├── Device Body: phone
 ├── Device Body: desktop
 ├── Device Body: TV
 └── Device Body: vehicle/audio client
```

Cross-device learning is opt-in.

Default sync primitive:

`derived learning state / deltas`

not unrestricted raw telemetry.

A host may decline cross-device synchronization entirely.

## 8. Continuous experience planning

A plan is a rolling horizon rather than a static playlist.

```
NOW → CURRENT
NEXT → best continuation
HORIZON → likely future sequence
OPPORTUNITIES → newly valuable candidates
```

New events can trigger re-planning.

Examples:

- newly relevant news;
- user context changed;
- candidate became unavailable;
- user feedback;
- fatigue/boredom signal;
- objective changed.

## 9. Interruption architecture

Ranking and interruption are separate.

```
Current Experience
       │
       ▼
Observation / Outcome State
       │
       ▼
Opportunity Detector
       │
       ▼
Candidate New Experience
       │
       ▼
Switch/Interruption Policy
       │
       ├── HOLD
       ├── SUGGEST
       └── SWITCH
```

The policy must account for:

- expected improvement;
- confidence;
- context fit;
- objective fit;
- format fit;
- switching cost;
- interruption cost;
- resume quality;
- user attention policy.

A higher-ranked candidate does not automatically justify an interruption.

## 10. Learning environment

The environment must model sequential interaction rather than only static item scores.

Minimum state:

- user/audience preference state;
- session state;
- context;
- objective;
- attention;
- current experience;
- recent exposure;
- candidate inventory;
- availability;
- fatigue/repetition;
- uncertainty.

Minimum actions:

- select item;
- select realization;
- select format;
- continue;
- queue;
- switch;
- suggest switch;
- interrupt;
- resume;
- explore;
- ask.

Minimum outcome events:

- impression;
- start;
- completion;
- abandonment;
- seek/skip;
- save;
- purchase/conversion;
- explicit feedback;
- interruption accept/reject;
- return/resume;
- context transition.

## 11. Learning ladder

The implementation MUST support replaceable algorithms:

1. supervised response models;
2. contextual bandits / off-policy evaluation;
3. offline policy learning;
4. sequential RL;
5. model-based/counterfactual planning;
6. bounded real-world experiments;
7. calibration.

Static recommendation logs alone are insufficient to validate long-horizon policy changes; simulation exists to probe sequential behavior and counterfactual policies. This follows the motivation behind Google Research RecSim and RecSim NG. citeturn284345search0turn284345search3

## 12. Agent organization search

Organization search is an optional advanced capability.

Search dimensions:

- number of agents;
- role specialization;
- graph topology;
- communication edges;
- memory sharing;
- tool allocation;
- model assignment;
- budget allocation;
- latency limits;
- termination;
- evaluator/critic presence.

A generalist single-agent baseline is mandatory.

The system should be able to discover that no multi-agent decomposition is superior for a given task.

## 13. Reward and objective

Reward MUST be versioned and host-declared.

Possible components:

- user satisfaction proxy;
- task/objective success;
- qualified engagement;
- conversion;
- revenue;
- retention;
- discovery value;
- serendipity;
- continuity;
- interruption regret;
- inference cost;
- latency;
- bandwidth;
- policy/rights risk.

The host can define hard constraints separately from soft reward terms.

## 14. Uncertainty and robustness

Every research candidate should retain, when available:

- expected value;
- uncertainty;
- model disagreement;
- out-of-distribution score;
- seed robustness;
- cost;
- latency;
- policy feasibility;
- capability dependencies.

A policy that wins only because of one simulator artifact is not promotion-ready.

## 15. Multi-domain extension

Reckon is domain-neutral.

The core vocabulary intentionally distinguishes:

`Item → Realization → Experience → Decision → Schedule → Outcome`

This supports:

### Media

video/audio/article/clip → playback/source/format → play/switch/queue.

### Commerce

product → offer/channel/fulfillment representation → recommend/present/bundle/wait.

### Advertising

creative → placement/format/channel → show/defer/change/interrupt.

### Notifications

message → channel/format → send/defer/escalate.

The domain-specific policy/evaluator is supplied by the host integration.

## 16. Provider and rights boundaries

Reckon must never infer that a URL, API response, subscription, or connected account grants rights beyond the host's explicit authorization.

Media acquisition and playback remain host responsibilities.

## 17. Technology direction

Initial implementation:

- TypeScript for contracts/API/SDK/kernel surfaces;
- PostgreSQL-compatible persistence;
- durable worker execution for research jobs;
- provider-neutral model adapter interface;
- event ingestion and append-oriented learning records;
- deterministic serialization and hashes for research artifacts;
- object storage for large model/simulation artifacts.

Language/runtime changes require TL3 architecture review.

## 18. OpenMuse evaluation

OpenMuse is a candidate **Agent Computer / browser-body implementation substrate**. It is not a dependency of the Reckon architecture.

A bounded fork or adapter may be evaluated for:

- browser body;
- persistent browser sessions;
- desktop/computer control;
- multi-platform client scaffolding.

Reckon remains authoritative for:

- decisioning;
- scheduling;
- preference/intent semantics;
- agent-body contracts;
- agent-organization search;
- learning/simulation;
- evaluation and calibration.

This preserves the utility of OpenMuse without inheriting its product-specific architecture or CopilotKit Intelligence dependency.

## 19. Hard non-goals

- bypassing provider security;
- hidden tracking without consent;
- silent sensitive profiling;
- direct provider publication authority;
- hardcoded provider-specific recommendation logic in the kernel;
- a second model-routing authority;
- assuming online RL is necessary for launch;
- optimizing maximum engagement as a universal objective;
- claiming simulated superiority as real-world superiority.
