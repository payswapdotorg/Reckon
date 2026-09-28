# Reckon Positioning & Research Notes

## Existing market category

Current services already cover substantial parts of recommender-as-a-service.

- Amazon Personalize supports real-time item recommendations and updates personalization from recent interaction events. citeturn284345search2turn284345search8
- Recombee provides user/item/interactions APIs and recommendation endpoints as a recommender-as-a-service product. citeturn284345search4turn284345search7

Therefore Reckon should not position itself as “an API that returns recommended items” alone.

## Reckon differentiation

The intended product surface is:

```
Top-N recommender
        ⊂
Decision engine
        ⊂
Experience planner
        ⊂
Experience scheduler
        ⊂
Adaptive decision infrastructure
```

The additional dimensions are:

- context;
- explicit objective;
- attention policy;
- representation/format;
- timing;
- interruption cost;
- continuity/resumption;
- exploration/serendipity;
- uncertainty;
- agentic analysis;
- sequential simulation;
- policy and organization search.

## Research basis

Google Research introduced RecSim as a configurable simulator for sequential recommender interactions and later RecSim NG as a multi-actor probabilistic simulation platform intended to address long-horizon and ecosystem-level recommendation evaluation. See `docs/research/sources.md`.

Contextual bandit recommendation research provides a principled sequential decision framing and supports offline evaluation before deploying a different policy live. One influential Yahoo Front Page study reported a 12.5% click lift over a context-free bandit on a dataset of more than 33 million events; this is a historical study result, not a Reckon performance claim. citeturn284345search14

## Benchmark dimensions

Reckon research should benchmark at least:

- top-N relevance;
- objective success;
- long-horizon utility;
- discovery/serendipity;
- diversity;
- interruption regret;
- context fit;
- format fit;
- continuity;
- latency;
- compute cost;
- uncertainty calibration;
- robustness across seeds/models/world models;
- policy/rights feasibility.

## Critical experimental principle

Do not optimize a single engagement metric and call that user value.

The host declares the objective and hard constraints. Reckon reports both objective value and engineering/system costs.

## Product expansion hypothesis

The same primitives can support:

```
media item → media experience → playback schedule

product → offer experience → shopping journey

ad creative → ad experience → ad interruption schedule

notification → message experience → delivery schedule
```

This is a product hypothesis to validate with consumers, not a claim that one universal policy is appropriate for all domains.
