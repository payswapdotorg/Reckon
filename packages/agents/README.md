# @reckon/agents

The Agent Body runtime (Worker 2 lane). Implements **W2-007**.

## What is here

- `AgentBodyRuntime` port (`instantiate(body, assignment)`) + pure
  kernel (`createAgentBodyRuntime`).
- `AgentInstanceHandle.run(task)` — executes an injected `BodyExecutor`
  under the envelope's enforcement.
- `DeterministicTestExecutor` — **TEST INFRASTRUCTURE** (clearly
  labeled; real executors arrive in later waves: W2-006 Personal Agent
  runtime / W2-008 Agent Organization runtime).
- `createStepClock` — deterministic clock for reproducible runs.

## MODEL-NEUTRAL LAW (ADR-002, lock #16)

`ModelAssignment` is DATA carried verbatim on the instance and on every
run result — never a routing decision. Nothing imports a provider SDK
(a regression test asserts this). Model-inference operations must name
the ASSIGNED model; anything else is a typed `PERMISSION_DENIED`
(no second model router).

## THE ENVELOPE LAW

The body's declared `tools`/`observations`/`memoryInterfaces`/`actions`
are the ONLY surface an instance exposes:

- an operation referencing an UNDECLARED target is a typed
  `CAPABILITY_NOT_DECLARED` error (reflection beyond the envelope is
  denied);
- a DECLARED but un-permitted operation is a typed `PERMISSION_DENIED`
  error.

Permission mapping (documented): `tool` → capability `tool`;
`observe` → `observe`; `memory` → `memory` plus interface-access match
(read/write vs the declared `read|write|read-write`); `action` →
`write`; `model-inference` → `model-inference` plus assigned-model
match; `compute` → no permission (pure computation). Permission
`scope` semantics are host/adapter-owned (opaque to the core).

## THE BUDGET LAW

Per-execution enforcement with typed errors:

| budget kind | metered from | error |
|---|---|---|
| `cost` | summed `usage.cost` of accepted operations | `BUDGET_EXHAUSTED` |
| `tokens` | summed `usage.tokens` | `BUDGET_EXHAUSTED` |
| `calls` | count of accepted operations | `BUDGET_EXHAUSTED` |
| `wall-clock-ms` | injected clock elapsed since run start | `BUDGET_EXHAUSTED` |
| `custom` | summed `usage.custom[customKind]` | `BUDGET_EXHAUSTED` |

Budgets are checked BEFORE an operation is accepted: the operation that
would exceed a budget is NOT executed, and the run ABORTS with a
partial-state report (the audit log of accepted operations + usage
totals). Usage landing exactly ON a limit is allowed (exceeding aborts).

Latency limits: `softMs` passed ⇒ `degraded: true` is flagged (the
executor sees it in its run state and may degrade, e.g. fall back to a
cached answer); `hardMs` passed ⇒ the run YIELDS with a typed
`DEADLINE_EXCEEDED` error and its partial state.

A runtime `maxSteps` safety valve (default 10,000; distinct
`STEP_LIMIT_EXCEEDED` typed error) protects the host loop against
non-terminating executors — it is NOT a body budget.

## Run outcomes

`run(task)` returns `Result<BodyRunResult>`: malformed tasks are typed
`INVALID_INPUT` errors; execution outcomes are
`completed` / `blocked` (envelope violation or malformed operation) /
`aborted` (budget or step limit, with partial-state report) / `yielded`
(hard deadline). All carry the audit log, usage totals, the model
assignment (data) and a deterministic digest-derived `runId`.

## Determinism

With an injected deterministic clock (`createStepClock`) and a
deterministic executor, identical inputs produce byte-identical run
results (digest-tested). Task inputs must be canonical-serializable
(non-serializable inputs are typed `INVALID_INPUT` — the deterministic
run id requires it).
