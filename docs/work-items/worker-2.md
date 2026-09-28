# Worker 2 Handoff — Decision / Scheduling / Agent Runtime

## Owned paths

- §packages/decision/**§
- §packages/experience/**§
- §packages/scheduler/**§
- §packages/agents/**§
- §packages/organization/**§

## First wave

After CONTRACT-001:

- W2-001 candidate normalization
- W2-003 experience expansion
- W2-004 scheduler
- W2-007 Agent Body runtime

W2-002 follows candidate normalization.

## Required

Decision must consume objective, context, attention policy, candidates, experience options, constraints, uncertainty and current plan/experience.

Fast decisioning must not depend on an LLM.

Experience resolution must treat source/provider/format capability as declared host capability.

Scheduler actions:

- HOLD
- CONTINUE
- QUEUE
- SUGGEST
- SWITCH
- INTERRUPT
- RESUME
- END

Ranking and switching are separate.

Switch logic must account for expected improvement, objective/context/format fit, confidence, interruption cost, uncertainty and resume loss.

Personal Agent: one logical user agent across permitted device bodies; cross-device learning requires explicit grant.

Agent Body: model-neutral executable structure with tools, permissions, memory, actions, budgets, latency and evaluators.

Agent Organization: graph of bodies + communication/delegation; always compare against a single-agent baseline.

## Forbidden

- second model router;
- direct secrets access;
- provider-specific kernel branches;
- organization complexity assumed to be better;
- architecture authority delegated to an LLM.

## Completion evidence

Prove deterministic decisions, constraint/reward separation, scheduler state transitions, switch/resume behavior, budget/latency enforcement and organization baseline comparison.