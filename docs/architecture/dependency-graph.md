# Reckon Dependency Graph

Status: FROZEN FOR TL3 + 3 WORKERS

## Phase 0 — TL3 foundations

```
ARCH-001 architecture lock
   │
   ├── CONTRACT-001 public schemas
   ├── ADR-001 persistence/event model
   ├── ADR-002 model adapter boundary
   ├── ADR-003 consent/privacy boundary
   └── ADR-004 research/runtime separation
```

These are TL-owned and must land before workers modify shared public surfaces.

## Worker 1 — Data, Context, Simulation

```
W1-001 event ingestion primitives
       ├── W1-002 subject/context state
       ├── W1-003 preference learning state
       └── W1-004 feature assembly
                │
          W1-005 candidate/world model
                │
          W1-006 simulator kernel
                │
          W1-007 offline evaluation
                │
          W1-008 bandit/off-policy lane
                │
          W1-009 sequential RL environment
                │
          W1-010 calibration + robustness
```

W1-002, W1-003, and W1-004 can proceed in parallel after CONTRACT-001.

W1-005 depends on feature contracts.

W1-006 and W1-007 can proceed concurrently once W1-005 is frozen.

W1-008 depends on W1-007.

W1-009 depends on W1-006 and W1-008.

W1-010 depends on W1-009 and real outcome ingestion.

## Worker 2 — Decision, Scheduling, Agent Runtime

```
W2-001 candidate contract implementation
       ├── W2-002 policy engine
       ├── W2-003 experience resolver
       └── W2-004 scheduler
                │
          W2-005 interruption/opportunity policy
                │
          W2-006 Personal Agent runtime
                │
          W2-007 Agent Body runtime
                │
          W2-008 Agent Organization runtime
                │
          W2-009 organization search
```

W2-002, W2-003, W2-004 can proceed concurrently.

W2-005 depends on W2-004.

W2-006 depends on context/preference contracts, not Worker 1 implementation internals.

W2-007 can begin after contract freeze.

W2-008 depends on W2-007.

W2-009 consumes the research runtime but must not own simulator internals.

## Worker 3 — SDK, Integrations, Observability, Proof

```
W3-001 API skeleton + auth/tenant boundary
       ├── W3-002 SDK
       ├── W3-003 event/outcome transport
       └── W3-004 observability
                │
          W3-005 WebFlix adapter
          W3-006 generic media adapter
          W3-007 commerce adapter
          W3-008 advertising adapter
                │
          W3-009 E2E conformance
          W3-010 load/perf harness
          W3-011 production-readiness proof
```

W3-005..008 can be developed concurrently after normalized contracts.

W3-009 depends on representative adapters and runtime APIs.

## Cross-worker milestones

### M0

TL3 architecture + public contracts frozen.

### M1

Worker 1: state/event backbone  
Worker 2: decision/scheduler kernel  
Worker 3: API/SDK skeleton

### M2

First complete runtime decision path:

`context + candidates → experience → decision → schedule → outcome`

### M3

Personal Agent + cross-device learning.

### M4

Simulation + offline evaluation.

### M5

Agent Body + Organization runtime/search.

### M6

WebFlix/media/commerce/ads adapters.

### M7

End-to-end proof and production hardening.

## Forbidden dependency directions

- decision kernel → provider SDK;
- simulator → direct provider API;
- Agent Body → direct secret store;
- Agent Organization → host workflow replacement;
- LLM/model provider → domain authority;
- SDK → internal storage schema;
- UI/host integration → direct kernel table mutation;
- domain-specific adapter → core ranking logic.
