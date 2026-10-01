# tests/perf — the no-LLM fast-path performance envelope (W3-010)

Worker 3 owns the performance envelope for the no-LLM decision→schedule
fast path. `envelope-bench.ts` is the deterministic benchmark harness;
`envelope.test.ts` is the regression guard (the envelope FAILS when any
stage regresses beyond its documented budget).

## What is measured

The REAL repository kernels, adapter-fronted, at the payload scales the
reference adapters produce (WebFlix adapter limits: 256 items/import,
8 realizations/item, 256 candidates/set — the envelope runs at ~78% of
every limit):

| Stage | Kernel path |
|---|---|
| normalization | W2-001 `normalizeCandidates` over the mapped payload |
| decision | W2-003 `expandExperiences` + W2-002 `evaluatePolicy` |
| scheduling | W2-004 `decide` — the full SWITCH path (request + scored-experience validation, switch evaluation, checkpoint materialization) |
| outcome recording | adapter report → `OutcomeEvent` (schema-validated) + W3-004 `recordOutcome` + `EventStore` append (in-memory sink; disk journals are I/O and excluded from the kernel envelope) |
| end-to-end | per-iteration SUM of the four stages |

Payload (deterministic, index-based generation through the REAL WebFlix
adapter): 200 catalog items / 400 realizations / 132 candidate rows
(4 ghost rows for honest absence) / 512 expanded experiences / 512
scored experiences. 30 warmup iterations (never measured) + 200 measured
iterations; nearest-rank percentiles on sorted samples; Node's monotonic
`performance.now()` timer.

## Measured baseline (this repository's reference host)

```
stage                              p50(ms)   p95(ms)   p99(ms)
normalization                          1.5       1.9       5.1
decision                               9.5      13.2      18.5
scheduling                             2.7       5.4       6.1
outcome-recording                     0.18      0.25      0.26
end-to-end (decision→schedule+record) 14.2      17.8      27.6
```

The envelope test logs the freshly measured table on every run — those
numbers are the baseline evidence carried into W3-011
(production-readiness). EVIDENCE CLASS: controlled-local — measured on
the benchmark host, NOT a production latency claim (AGENTS.md
"Production truth").

## Documented budgets (the regression guard)

Any stage exceeding its budget fails the suite. Every budget holds ≈5×
headroom at p50/p95 (≈6× at p99) over the measured baseline — generous
enough for shared CI hardware (parallel test workers, JIT/GC jitter,
~2× slower cores), tight enough that an order-of-magnitude (10×)
regression in ANY stage breaches its p50 budget:

| Stage | p50 budget | p95 budget | p99 budget |
|---|---|---|---|
| normalization | 8 ms | 12 ms | 30 ms |
| decision | 50 ms | 75 ms | 120 ms |
| scheduling | 15 ms | 30 ms | 40 ms |
| outcome recording | 1.5 ms | 3 ms | 8 ms |
| end-to-end | 75 ms | 100 ms | 180 ms |

## Observability surfacing

The envelope surfaces through the REAL W3-004 observability records:
every iteration emits a decision record (latency advanced onto the
injected clock from the measured kernel time, policy/model version,
action, status), a scheduler-action record (the emitted action with
enqueue/dequeue counts and the interrupted experience), and an
outcome-linkage record (eventId ↔ decisionId, evidence class) — the
worker-3 handoff list. `envelope.test.ts` asserts this trail on every
run.
