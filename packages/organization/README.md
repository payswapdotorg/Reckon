# @reckon/organization

The Agent Organization runtime (Worker 2 lane). Implements **W2-008**
on top of the W2-007 Agent Body runtime.

## What is here

- `createOrganizationRuntime({ executor, clock, limits? })` — the
  organization runtime over a graph of Agent Bodies (the frozen
  `AgentOrganization` contract).
- `runOrganization(org, task, { entryBodyId?, seed? })` — deterministic
  orchestration with delegation records and traceable lineage.
- `compareTopologies(task, topologies, options?)` (runtime method) —
  per-topology metrics PLUS the mandatory single-agent baseline row
  (BASELINE COMPARISON LAW, lock #15).
- `metricsOf(run)` — documented run metrics.

## Graph + message passing

Bodies and communication/delegation edges come from the frozen
`AgentOrganization` contract. A message from S to T runs as a W2-007
`BodyTask` `{ taskId, input: { from, kind, payload } }` on T's instance
— the ENVELOPE machinery (permissions, budgets, latency limits) applies
to every operation the body performs while processing. A route S→T
requires a declared edge with the message's exact kind
(communicate | delegate | report | escalate | custom); undeclared
routes are recorded as `edge-not-declared` failures and skipped.

## Documented delegation protocol

A completed body's output is a delegation directive IFF it is an object
with a `delegate` array or a `result` property
(`BodyOutputDirective`):

```ts
{ result?: unknown, delegate?: DelegationDirective[] }
```

Every directive entry needs exactly one of `toBodyId` / `toRoleId` plus
a declared-edge-compatible `kind`. Role-targeted delegation selects
among eligible bodies (role match + compatible edge) with the SEEDED
tie-break: candidates sort by `digest(seed + ":" + bodyId)` then
`bodyId` — stable for a given seed, different seeds may order
differently. Non-directive outputs are leaf results. Malformed entries
are recorded (`malformed-directive`) and skipped.

## Delegation lineage

Every message produces a `DelegationRecord` — `recordId`
(digest-derived), `parentRecordId` (the record whose output delegated),
`rootRecordId`, from/to body ids, the edge used, depth, status, run id,
output and error. The chain from any record reaches the root record.
Failed attempts (edge-not-declared, unknown body/role, malformed,
depth-exceeded, deadline/budget-terminated pending messages) are
records too — the lineage documents what was attempted, what ran and
what failed.

## BASELINE COMPARISON LAW (lock #15)

Every topology evaluation is accompanied by a single-agent baseline run
of the SAME task. `compareTopologies` returns
`{ baseline, topologies }` — the baseline row is ALWAYS present (the
return type has no baseline-free shape; empty topologies without an
explicit baseline is a typed error). Each row (baseline included) runs
the same task through the SAME executor with a fresh identical step
clock and the same seed, so metrics are comparable and deterministic.
The default baseline body is the first topology's first body + its
model assignment (documented default generalist proxy); pass
`options.baseline` for an explicit generalist. Organization complexity
is never presented as better without the baseline row.

## Failure isolation (bounded timeouts)

- A dead/looping body is cut off by the W2-007 runtime step limit
  (`limits.maxStepsPerBody`, default 500) — its record is `aborted`
  (`STEP_LIMIT_EXCEEDED`) and the organization CONTINUES.
- The org `deadline` termination rule bounds the whole run
  (clock-based; remaining messages are recorded `deadline-exceeded`).
- Org `budgets` (cost/tokens/calls/wall-clock-ms/custom) bound
  accumulated usage (remaining messages are recorded
  `budget-exhausted`; landing exactly on a limit is allowed).
- The `max-depth` termination rule bounds delegation depth (deeper
  attempts are recorded `depth-exceeded`); an outer
  `limits.maxDepth` (default 8) safety valve applies when no rule
  declares one.
- `consensus` and `custom` termination rules are host-evaluated
  declarations — documented as NOT enforced by this kernel (evaluator
  bodies arrive with organization search, W2-009).

## Determinism

The clock is REQUIRED and injected (never a system clock — no
wall-clock in decisions). FIFO message queue, digest-derived record
ids, seeded tie-breaks: identical inputs (org, task, seed, fresh
identical clock) ⇒ digest-identical run results (digest-tested).

## Cross-package composition

The W2-007 agents runtime is imported via a RELATIVE module path
(runtime + types). The frozen lockfile forbids adding workspace
dependencies, so — like the scheduler's type-only import of
`@reckon/decision` — this package composes `@reckon/agents` without a
package.json/lockfile change.
