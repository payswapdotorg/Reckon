# @reckon/scheduler

The scheduler + switch/interruption evaluator (Worker 2 lane).
Implements **W2-004** (scheduler + switch evaluator) and **W2-005**
(interruption-opportunity policy).

## What is here

- `Scheduler` port + pure kernel (`decide`) over the plan-state machine.
- `LEGAL_TRANSITIONS` — the legal-transition matrix (lock #11).
- `SwitchEvaluator` — the switch/interruption evaluator, SEPARATE from
  ranking (lock #9).
- `InterruptionOpportunityPolicy` — the W2-005 timing gate on the
  MOMENT (attention budget, fatigue, format suitability from the frozen
  `ContextSnapshot`), consumed by the scheduler via the optional
  `SchedulerInput.opportunity` composition field.

## The legal-transition matrix

States: `idle` (nothing playing, nothing primed), `queued` (queue
primed, nothing playing), `playing` (current experience active),
`interrupted` (current experience interrupted; carries a resume
checkpoint), `ended` (TERMINAL — no legal actions).

| from \ action | HOLD | CONTINUE | QUEUE | SUGGEST | SWITCH | INTERRUPT | RESUME | END |
|---|---|---|---|---|---|---|---|---|
| idle | idle | — | queued | idle | — | — | playing* | ended |
| queued | queued | playing | queued | queued | — | — | playing* | ended |
| playing | playing | playing | playing | playing | playing | interrupted | — | ended |
| interrupted | interrupted | — | interrupted | interrupted | playing | — | playing | ended |
| ended | — | — | — | — | — | — | — | — |

`—` = ILLEGAL (typed `ILLEGAL_TRANSITION` error). `*` RESUME from
idle/queued requires ≥1 resume checkpoint. CONTINUE from queued
proceeds with the queue head (implied non-empty by state
well-formedness). SWITCH requires an active or interrupted experience.

Every `decide()` emission is validated against this matrix before it is
returned and is logged as a `TransitionRecord` (deterministic
digest-derived id, caller-supplied `at` passthrough).

## SEPARATION LAW (lock #9)

Ranking never interrupts. The scheduler emits SWITCH (or
switch-driven SUGGEST) ONLY when the caller supplied an explicit
`SwitchEvaluationInput` — every number caller-supplied, never guessed —
whose net value clears the thresholds:

```
netValue = expectedImprovement − interruptionCost − uncertaintyPenalty − resumeLoss

netValue >  switchThreshold   ⇒ SWITCH
netValue >= suggestThreshold  ⇒ SUGGEST   ([suggestThreshold, switchThreshold])
otherwise                     ⇒ HOLD
```

SWITCH requires net STRICTLY greater than `switchThreshold`. Objective/
context/format fit and confidence are inputs to the caller-supplied
`expectedImprovement` number — never derived here from rank or score.
Without switch input, a playing plan always CONTINUEs.

## Interruption-opportunity policy (W2-005)

`evaluateInterruptionOpportunity` decides whether an interruption
OPPORTUNITY exists RIGHT NOW — a timing gate on the moment, never a
switch decision (ranking and switching stay separate; the switch
numbers stay caller-supplied). Gates use only frozen
`ContextSnapshot` fields:

- **attention budget** — no opportunity when `attention.availableMs <
  MIN_ATTENTION_BUDGET_MS` (30s) or `attention.quality ===
  "interrupted"`; absent fields do NOT block (absence is not evidence
  of exhaustion);
- **fatigue** — no opportunity when `fatigue.repetitionLevel ≥ 0.7` or
  `fatigue.recentInterruptions ≥ 3`; absent fields do not block;
- **format suitability** — no opportunity when the current format kind
  ∈ NONINTERRUPTIBLE_FORMATS (`full`, `interactive`).

The result carries `{ opportunity, reasons, urgency }` plus documented
-formula ESTIMATED switch terms (`expectedImprovement =
fit(bestQueued) − fit(current)` with a 0.5 neutral prior for undeclared
fit; `interruptionCost = 0.2 + 0.3·non-interruptible +
0.5·clamp01(recentInterruptions/3)`; `resumeLoss` 0.1 with a plan
checkpoint for the current experience else 0.6; `uncertaintyPenalty =
0.2 × missing-fit-channels/2`). The caller MAY feed the estimates into
the switch evaluator — the scheduler never auto-feeds them.

**Scheduler composition**: `SchedulerInput.opportunity` (optional,
composition — no frozen contract schema changed):
- `opportunity: false` + SWITCH verdict ⇒ gated to CONTINUE (from
  `playing`) or the resume/hold path (from `interrupted`), with
  `switch-gated-no-opportunity` + opportunity reasons recorded;
- SUGGEST is never gated (non-binding; suggestions never interrupt);
- host-requested INTERRUPT/END are never gated;
- absent ⇒ the W2-004 behavior is unchanged; malformed ⇒ typed
  `INVALID_INPUT` (never silently ignored).

## RESUME LAW (lock #12)

Every SWITCH/INTERRUPT records a `ResumeCheckpointSlot`
`{ experienceId, resumeToken, source }` — the token is caller-supplied
(`resumeTokens` map or an existing checkpoint) or `null`; NEVER
invented. A full contract `ResumeCheckpoint` is appended to the next
plan state and the schedule delta only when BOTH a token and a
caller-supplied timestamp (`request.at`) exist (timestamps are never
invented either); reasons record which. Duplicate checkpoints for the
same experience are not appended.

## Deterministic core policy (wave 1)

- `ended` → typed `ILLEGAL_TRANSITION` (terminal).
- `endRequested` → END (host-driven); `interruptRequested` + playing →
  INTERRUPT (host-driven).
- `playing`: switch evaluation verdict (SWITCH → SWITCH to the
  evaluated candidate; SUGGEST → SUGGEST it; HOLD → CONTINUE);
  no switch input → CONTINUE.
- `interrupted`: SWITCH verdict → SWITCH; else resumable checkpoint →
  RESUME (most recent checkpoint for the interrupted experience, else
  most recent overall); else HOLD.
- `idle`/`queued`: resume checkpoints exist → RESUME (continuity:
  returning the subject to their own prior state is not a new
  attention-consuming action); else mindful attention policy → SUGGEST
  the best scored candidate (never auto-start); else queue the best
  not-already-queued candidate; else proceed with the queue head
  (non-mindful); else HOLD.

Wave-1 policy notes (documented limitations): HOLD/QUEUE are
matrix-legal from `playing` but not emitted by this deterministic
policy (playing without switch input keeps the current experience;
queue priming happens from idle/queued); SUGGEST/QUEUE from
`interrupted` are likewise not emitted (SWITCH/RESUME/HOLD cover the
interrupted semantics). The matrix remains the legality authority for
hosts and future policies.

## Determinism

All outputs derive from the input; `scored` is re-sorted canonically
(score desc, then experienceId asc). Identical inputs (and permuted
scored lists) produce byte-identical decisions (digest-tested).

## Cross-package types

`ScoredExperience` is re-exported from `@reckon/decision` (type-only
import; W2-004 depends on W2-001 per the dependency graph; no runtime
dependency, no lockfile change).
