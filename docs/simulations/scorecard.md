# Integration Effort Scorecard

Status: ACTIVE (SIM-001)  
Contract: `IntegrationEffortScorecardSchema` (`packages/contracts/src/reckon-complete.ts`)  
Schema: `packages/contracts/schemas/integration-effort-scorecard.schema.json`  
Aggregation: `aggregateIntegrationEffortScorecard` (`packages/simulation/src/harness/scorecard.ts`)

The machine-readable aggregate the ladder waves produce (SIM-007) and TL3 reconciles (SIM-008). One `IntegrationEffortRecord` per run; one scorecard per wave.

## IntegrationEffortRecord — the measurement unit

Every field the ladder's measurement section lists:

| Field | Source |
|---|---|
| `apiOperations` / `sdkMethods` | sorted unique operations/methods from the run's call log |
| `glue: { functions, loc, customAdapterLoc }` | honest host declaration |
| `internalImports` | 0 — enforced by `tests/conformance/zero-internal-access.test.ts` |
| `timing: { firstDecisionMs, firstDecisionSteps, fullLoopMs, fullLoopSteps }` | virtual clock; `0` = not achieved within the run (honest sentinel) |
| `latency: { p50Ms, p95Ms, samples }` | nearest-rank percentiles over SUCCESSFUL call latencies |
| `failures: { count, retriedCount, retryCount, exhaustedCount }` | call log (classified retries; `exhaustedCount` = calls that never succeeded) |
| `capabilityCoverage` | declared vs supported (the conformance coverage summary) |
| `gaps: [{ capability, friction, detail? }]` | per-gap friction category |
| `evidenceClass` | the run's honest class (`fixture` for the scripted responder) |
| `replayInputs` | the replay gate block (seed + manifest checksum + host adapter id + run config) |
| `checksum` | sha256 over canonical content (excludes `recordId` + `checksum`) |

## Aggregation semantics (deterministic)

- Medians/p95s: nearest-rank percentiles over the contributing records; summation in argument order.
- `medianFirstDecisionMs` / `medianFullLoopMs` aggregate over ACHIEVED values only (records where the corresponding step count is non-zero); `0` when no record achieved it.
- `medianLatencyP50Ms`: median of per-record `latency.p50Ms` (records with samples > 0). `p95LatencyP95Ms`: p95 of per-record `latency.p95Ms`.
- `meanCapabilityCoverageRatio`: arithmetic mean of `capabilityCoverage.coverageRatio`.
- `totalFailures` / `totalRetries`: sums over records.
- `distinctHosts`: unique `hostAdapterId`s; `distinctLevels`: unique ladder levels.

## The 3-domain law (recurring gaps → platform upgrades)

`recurringGaps` groups every record's gaps by `(capability, friction)` across runs:

```
{ capability, friction, ladderLevels[], domainCount, runCount, platformUpgradeCandidate }
```

- `domainCount` = number of DISTINCT ladder levels (domains) where the exact gap appeared.
- `platformUpgradeCandidate` = `domainCount ≥ 3` — the ladder law verbatim: "When the same gap appears in at least three domains, upgrade the common platform primitive and replay earlier levels."
- Group ordering is deterministic (capability, then friction).

The goal (ladder success criterion): measurable reduction in host integration effort — marginal glue LOC / first-decision time falling across waves as recurring gaps are eliminated at the platform layer.

## Producing a scorecard

```ts
import { aggregateIntegrationEffortScorecard } from "@reckon/simulation";

const scorecard = aggregateIntegrationEffortScorecard(
  [runA.record, runB.record, runC.record],
  { scorecardId: "scorecard-wave-a", generatedAt: 50_000 }, // virtual clock time
);
```

Requires ≥ 1 record; the result is sealed with a content checksum (`finalizeIntegrationEffortScorecard`) and parses as a `reckon.complete.integration-effort-scorecard` family member.

## Evidence honesty

Aggregation never upgrades evidence: a wave of fixture-class runs yields a fixture-class view. `production-observed` completion requires per-run evidence that satisfies the profile's floor (see the profile spec's sufficiency semantics) — a scorecard built from fixture runs can never present itself as production evidence.
