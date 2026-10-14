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

## Wave C (SIM-006, W2) — Levels 17–20 + the law-mandated auxiliary runs

One `IntegrationEffortRecord` per run: four canonical level runs (all Reckon-Complete through the six standard-loop public operations; Level 20's canonical run injects the transport fault storm — faultRate 0.25, maxRetries 3 — so provider failure/recovery is measured) plus the auxiliary runs the ladder laws mandate (the Level 17 single-agent baseline, the agent-delegation and webhook-delivery capability probes, the Level 20 capability-churn phase). Case docs: `docs/simulations/integration-cases/level17-multi-agent.md` … `level20-adversarial.md`.

<!-- sim-006:wave-c:evidence:begin (machine-generated — regenerate via @reckon/simulation runCanonicalLadderWaveD) -->
| Level | Host adapter | Glue (fn/LOC/adapter LOC) | API ops | SDK methods | First decision (step/ms) | Full loop (step/ms) | p50/p95 (ms) | Samples | Failures (cnt/retry/exh) | Capability coverage | Evidence | Reckon-Complete |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 17 | adapter-l17-hiveops-org-1 | 10/591/233 | 6 | 6 | 1/336 | 1/430 | 28/47 | 44 | 0/0/0 | 12/12 (1.000) | fixture | YES |
| 18 | adapter-l18-auraplay-1 | 10/405/83 | 6 | 6 | 1/358 | 1/405 | 23/46 | 48 | 0/0/0 | 12/12 (1.000) | fixture | YES |
| 19 | adapter-l19-edgecast-1 | 12/399/135 | 6 | 6 | 1/359 | 1/438 | 20/47 | 46 | 0/0/0 | 12/12 (1.000) | fixture | YES |
| 20 | adapter-l20-stormwatch-1 | 12/443/110 | 6 | 6 | 1/512 | 1/551 | 27/61 | 44 | 9/12/0 | 12/12 (1.000) | fixture | YES |
<!-- sim-006:wave-c:evidence:end -->

<!-- sim-006:wave-c:aux:begin (machine-generated) -->
| Level | Kind | Case | Host adapter | Steps | Seed | Verdict (satisfied/partial/missing) | Reckon-Complete | Record gaps |
|---|---|---|---|---|---|---|---|---|
| 17 | single-agent-baseline | level17-single-agent-baseline | adapter-l17-hiveops-solo-1 | 8 | 2121 | 12/0/0 | YES | — |
| 17 | capability-probe | level17-probe-agent-delegation | adapter-l17-hiveops-org-1 | 8 | 2122 | 12/1/0 | NO | agent-delegation|COMPOSITION_GAP |
| 18 | capability-probe | level18-probe-webhook-delivery | adapter-l18-auraplay-1 | 8 | 2123 | 12/1/0 | NO | webhook-delivery|COMPOSITION_GAP |
| 20 | capability-churn | level20-churn-degraded | adapter-l20-stormwatch-1 | 8 | 2124 | 11/0/1 | NO | preference-feedback|ADAPTER_GAP |
<!-- sim-006:wave-c:aux:end -->

<!-- sim-006:wave-c:gaps:begin (machine-generated) -->
| Level | Run | Capability | Friction | Detail |
|---|---|---|---|---|
| 17 | capability-probe | agent-delegation | COMPOSITION_GAP | the frozen AgentBody/AgentOrganization contracts validate the host's org declaration (bodies as capability envelopes, delegation edges, budgets, termination rules) and the SDK/API expose agents.createBody/createOrganization, but the SIM-001 harness port composes only the six standard-loop operations — the organization graph cannot cross the composed public path, so org state stays host-owned and couples through candidates/objectives/outcomes only |
| 18 | capability-probe | webhook-delivery | COMPOSITION_GAP | a multi-surface realtime system wants thin-event push to its surfaces (decision/schedule/outcome notifications), and the SDK/API expose webhook endpoint create/list/get + event/delivery surfaces, but the SIM-001 harness port composes only the six standard-loop operations — realtime push cannot cross the composed public path, so surfaces poll through the standard loop instead |
| 20 | capability-churn | preference-feedback | ADAPTER_GAP | preference provider outage during the churn phase — the feedback channel is down; manifest v1 declares the gap honestly (no deltas flow, nothing is wired); recovery is the v2 manifest with the capability restored and evidenced |
<!-- sim-006:wave-c:gaps:end -->

<!-- sim-006:wave-c:scorecard:begin (machine-generated) -->
- scorecardId: `scorecard-sim-006-wave-c`
- runCount: 8; distinctHosts: 5; distinctLevels: 4
- medianGlueLoc: 405; p95GlueLoc: 591
- medianFirstDecisionMs: 373; medianFullLoopMs: 438
- medianLatencyP50Ms: 27; p95LatencyP95Ms: 61
- meanCapabilityCoverageRatio: 0.970
- totalFailures: 9; totalRetries: 12
- recurringGaps (this wave only): agent-delegation|COMPOSITION_GAP (domains 17, runs 1, platformUpgradeCandidate false); preference-feedback|ADAPTER_GAP (domains 20, runs 1, platformUpgradeCandidate false); webhook-delivery|COMPOSITION_GAP (domains 18, runs 1, platformUpgradeCandidate false)
<!-- sim-006:wave-c:scorecard:end -->

Within Wave C each named gap appears in exactly ONE domain — no new platform-upgrade candidate fires inside this wave alone. The cross-wave composition (Wave A 1–4 + SIM-003 5–8 + Wave B 9–12 + W1's levels 13–16 + Wave C 17–20) is TL3/SIM-007's reconciliation; the merged-wave candidates already on record (`context-snapshots`|API_GAP, `plan-management`|COMPOSITION_GAP) are unchanged by this wave.
