# TL3 Work Order

## Required outcome

Implement Reckon end to end with three workers while preserving the frozen architecture.

## Worker 1 — Data / Context / Simulation

Owned surfaces:

- `packages/context/**`
- `packages/preferences/**`
- `packages/events/**`
- `packages/features/**`
- `packages/simulation/**`
- `packages/evaluation/**`
- `packages/learning/**`

Worker 1 must implement the state and research substrate without owning production decision composition.

### Priority sequence

1. event/outcome ingestion
2. context snapshots
3. preference deltas
4. feature assembly
5. world-model primitives
6. deterministic sequential simulator
7. offline evaluation
8. contextual bandits/off-policy evaluation
9. sequential RL environment
10. calibration and robustness

## Worker 2 — Decision / Scheduling / Agent Runtime

Owned surfaces:

- `packages/decision/**`
- `packages/experience/**`
- `packages/scheduler/**`
- `packages/agents/**`
- `packages/organization/**`

Worker 2 owns runtime decision behavior.

### Priority sequence

1. candidate normalization
2. policy evaluation
3. experience expansion
4. scheduler
5. opportunity detector
6. switch/interruption policy
7. Personal Agent runtime
8. Agent Body runtime
9. Agent Organization runtime
10. organization search

The scheduler must remain separate from ranking. A new recommendation is not itself permission to interrupt.

## Worker 3 — API / SDK / Integrations / Proof

Owned surfaces:

- `apps/api/**`
- `packages/sdk/**`
- `packages/integrations/**`
- `packages/observability/**`
- `tests/e2e/**`
- `tests/conformance/**`

Worker 3 owns external integration composition but not the core decision model.

### Priority sequence

1. API/auth/tenant boundary
2. SDK
3. event/outcome transport
4. observability
5. WebFlix reference adapter
6. generic media adapter
7. commerce adapter
8. advertising adapter
9. cross-domain E2E
10. load/performance harness
11. production-readiness evidence

## TL3-only surfaces

- `docs/architecture/**`
- canonical schemas/shared generated contracts
- composition roots when multiple workers collide
- dependency graph/work-item status
- release manifests
- merge/reconciliation
- final acceptance evidence

## Parallel execution

After TL3 freezes shared schemas:

### Lane A
W1-001..004 in parallel.

### Lane B
W2-001, W2-003, W2-004 and W2-007 in parallel.

### Lane C
W3-001 first, then W3-002..004 in parallel.

The first complete vertical slice joins:

`context → candidates → experience → decision → schedule → outcome → preference delta`

Research and domain adapters can continue independently once their contracts stabilize.

## OpenMuse research track

Create a separate optional work item for evaluating `CopilotKit/openmuse` as a browser/computer body substrate.

Do not let that evaluation block the core vertical slice.

Required evidence:

- exact upstream commit;
- license;
- changed code surface;
- browser/session capabilities;
- auth/security implications;
- performance;
- whether CopilotKit Intelligence is optional;
- adapter-vs-fork maintenance burden.

## Acceptance evidence

Each worker reports:

- dispatch/base SHA;
- final SHA;
- exact owned-path diff;
- commands and exit status;
- test counts;
- known limitations;
- acceptance mapping;
- unresolved architecture questions.

No worker can declare another worker's work complete.

## Definition of done

Reckon is not complete when a ranking endpoint works.

It is complete when the repository proves:

`state + context → candidates → experience → decision → schedule → outcome → learning`

and the same contracts can be consumed by media, commerce and advertising adapters without provider-specific branching in the kernel.

Simulation must support sequential evaluation and counterfactual labeling. Agent organizations must be executable under explicit budget/latency constraints. Production integration evidence must be separate from fixture evidence.
