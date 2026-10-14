# Level 20 — Adversarial / Uncertain Environment (SIM-006 integration case)

Ladder: "stale/noisy data, provider failure, delayed outcomes, capability churn and recovery"
Host: **StormWatch** (`host-l20-stormwatch`, tenant `tenant-l20-stormwatch`, subject `user-l20-watcher-1`)
Profile: `profile-l20-adversarial` (12 required capabilities, evidence floor `fixture`)
Fixture: `packages/simulation/src/levels/level-20-adversarial.ts` (canonical run config fixed in `packages/simulation/src/levels/wave-c.ts`: seed `2120`, 8 steps, **faultRate 0.25, maxRetries 3**, virtual clock 0/+1000ms)

## Domain mapping onto the frozen contracts

| Domain concept | Contract surface |
|---|---|
| Provider failure (transport) | the harness's OWN seeded fault injection (faultRate 0.25 / maxRetries 3 — measured in the record's failures/retries, never simulated away) |
| Provider failure (content) | `HardConstraint` kind `custom`, `constraintId: l20-provider-health` (params: alphaUp, failoverTo alpha/beta) + provider-specific `Realization`s (failover-aware `providerForStep`) |
| Stale data | `HardConstraint` kind `custom`, `constraintId: l20-freshness-gate` (params: staleCache, indexAgeHours) — the 4h freshness bound is host authority |
| Noisy preference signals | preference deltas with adversarial dimension mixing during the stale window (severe-weather / situation-report intrusions) |
| Delayed outcomes | the step-2 completion event reported at step 5 — outcome metrics carry `{ delayedOutcome, presentedAtStep, reportedAtStep }` (append-oriented, never rewritten) |
| Stay-ahead-of-storm objective | `Objective` kind `stay-informed` (params: environment `adversarial`, staleServing) |
| Alert-ready posture | `AttentionPolicy` style `balanced` (params: criticalAlertsOnlyInterruptions true) |
| Capability churn | manifest v1 (degraded: preference-feedback MISSING, honestly declared) → manifest v2 (recovered: restored + evidenced) — the same host factory, `capabilityPhase` option |
| Storm-day plan coupling | `DecisionRequest.planId` ↔ `ScheduleDelta.planId` (`plan-l20-storm-day`) |

## Measured runs (virtual clock)

<!-- sim-006:level20:canonical:begin (machine-generated — regenerate via @reckon/simulation runCanonicalLadderWaveD) -->
| Level | Host adapter | Glue (fn/LOC/adapter LOC) | API ops | SDK methods | First decision (step/ms) | Full loop (step/ms) | p50/p95 (ms) | Samples | Failures (cnt/retry/exh) | Capability coverage | Evidence | Reckon-Complete |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 20 | adapter-l20-stormwatch-1 | 12/443/110 | 6 | 6 | 1/512 | 1/551 | 27/61 | 44 | 9/12/0 | 12/12 (1.000) | fixture | YES |
<!-- sim-006:level20:canonical:end -->

The canonical run (`rec-f0b876162869318b`, content checksum `6ba66583b22b7495…`) is Reckon-Complete **with the transport fault storm injected into the canonical fixture itself** (the adversarial level: provider failure and recovery are MEASURED, not asserted): 9 failed call attempts, 12 classified bounded retries, 0 exhausted — the full loop still completed at step 1 with p95 latency rising to 61 virtual ms. Glue declared 12 functions / 443 LOC (110 custom-adapter LOC inside the `glue:adapter` markers).

### The law-mandated auxiliary run (capability churn)

<!-- sim-006:level20:aux:begin (machine-generated) -->
| Level | Kind | Case | Host adapter | Steps | Seed | Verdict (satisfied/partial/missing) | Reckon-Complete | Record gaps |
|---|---|---|---|---|---|---|---|---|
| 20 | capability-churn | level20-churn-degraded | adapter-l20-stormwatch-1 | 8 | 2124 | 11/0/1 | NO | preference-feedback|ADAPTER_GAP |
<!-- sim-006:level20:aux:end -->

## Scenario semantics (asserted by the acceptance suite)

- **Provider outage + failover (content)** — the provider `l20-provider-alpha` is down at steps 3–4 (world fact: providerAlphaUpLog); the host fails over to `l20-provider-beta` for those steps (failoverSteps [3, 4]), the `l20-provider-health` constraint on every request carrying `alphaUp` + `failoverTo`; after recovery the alpha realizations serve again.
- **Staleness** — the alpha index refresh corrupts during the outage: index age runs 1h → 2h → **6h → 7h** (the 4h freshness bound breached at steps 3–4, staleSteps [3, 4]) then refreshes to 1h → 2h → 3h → 4h after recovery; the `l20-freshness-gate` constraint carries staleCache + indexAgeHours on every request, and the objective params declare `staleServing` while stale.
- **Noisy signals** — during the stale window the preference stream mixes adversarial dimensions (severe-weather at step 3, situation-report at step 7 intruding on the energy-brief affinity stream; noisyDeltaSteps [3, 4]).
- **Interruption + resume under adversity** — the severe-storm alert at step 4 INTERRUPTs the live energy brief (critical-alerts-only interruptions posture); the checkpointed brief RESUMES at step 5.
- **Delayed outcome** — the step-2 presentation's completion event is reported at step 5 (DELAYED_OUTCOME_FOR_STEP 2 → REPORTED_AT 5): the outcome stream carries it append-oriented with `{ delayedOutcome, presentedAtStep, reportedAtStep }` metrics — never rewritten, never dropped (delayedOutcomeReported true).
- **Capability churn + recovery (with evidence)** — the churn phase (manifest v1, `capabilityPhase: "degraded"`): the preference provider outage takes `preference-feedback` down entirely — honestly declared MISSING in the manifest (no deltas flow, nothing wired: the record's SDK methods drop `preferences.appendDelta`, deltaDimensions stays empty), verdict honestly incomplete 11/12. **Recovery is the canonical v2 run itself**: the capability restored, the deltas flowing again, 12/12 Reckon-Complete — the recovery evidence is the canonical record, not an assertion.

## Capability coverage and findings

Baseline coverage: 12/12 required capabilities satisfied (the standard set) — under the injected fault storm.

### Friction findings (named gaps)

<!-- sim-006:level20:gaps:begin (machine-generated) -->
| Level | Run | Capability | Friction | Detail |
|---|---|---|---|---|
| 20 | capability-churn | preference-feedback | ADAPTER_GAP | preference provider outage during the churn phase — the feedback channel is down; manifest v1 declares the gap honestly (no deltas flow, nothing is wired); recovery is the v2 manifest with the capability restored and evidenced |
<!-- sim-006:level20:gaps:end -->

| Category | Capability | Finding |
|---|---|---|
| `ADAPTER_GAP` | `preference-feedback` | Churn-phase finding (above): during the provider outage the feedback channel is host-side down — an ADAPTER (host) gap, not a platform gap: the standard-loop preference route works (the canonical v2 run proves it). Recorded with recovery evidence. |
| `HOST_RESPONSIBILITY` | — (constraint-declaration, exercised) | Provider health, the freshness bound, and the failover map are host-owned authority expressed as custom hard constraints; Reckon never owns provider topology. Not a record gap — the boundary worked as designed. |
| `HOST_RESPONSIBILITY` | — (outcome-return, exercised) | Delayed-outcome reporting is host-side reality carried through the frozen Outcome contract's metrics — no outcome-versioning feature was needed. |

## Limitations

Fixture-class evidence: the scripted responder proves host-side integration and contract parity, not real provider outages or storm behavior. The outage window, index ages, and noisy dimensions are scripted fixture parameters; the transport faults are seeded harness draws (deterministic for the fixed seed — the replay gate proves it). Latencies are virtual-clock measurements of the loop shape under the fault model. See the scorecard doc for the full honesty statement.
