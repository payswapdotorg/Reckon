# Level 19 — Resource-Constrained Adaptive System (SIM-006 integration case)

Ladder: "CPU/API/money/time/attention budgets and graceful degradation"
Host: **EdgeCast** (`host-l19-edgecast`, tenant `tenant-l19-edgecast`, subject `user-l19-commuter-1`)
Profile: `profile-l19-resource-constrained` (12 required capabilities, evidence floor `fixture`)
Fixture: `packages/simulation/src/levels/level-19-resource-constrained.ts` (canonical run config fixed in `packages/simulation/src/levels/wave-c.ts`: seed `2119`, 8 steps, virtual clock 0/+1000ms)

## Domain mapping onto the frozen contracts

| Domain concept | Contract surface |
|---|---|
| Money / time / CPU budgets | `HardConstraint`s on every request (SEPARATE from reward — lock #21): `max-cost` (USD, tier-scaled 0.10 → 0.05 → 0.02), `max-latency` (250 → 150 → 80 ms), `catalog-rule` cpu-class gate, `time-window` |
| Reward (separate from constraints) | versioned `RewardSpec` `l19-edgecast-reward`: satisfaction-proxy (+1.0), inference-cost (−0.6, budget money), latency (−0.3, budget time) — constraints gate ELIGIBILITY; reward shapes ranking |
| CPU + cost-per-call + attention budgets | realization `constraints` (cpuUnits 8/5/3, costPerCallUsd 0.08/0.04/0.02, attentionUnits 1.5/1.0/0.5, qualityTier full/reduced/minimal) |
| Degradation tiers | realization kinds `edge-full` / `edge-lite` / `edge-minimal` (the SAME items, three realizations) |
| API-call quota | host-owned ledger (48 calls total; the connect phase spends 16; 4/step thereafter: 32 → 4 remaining) |
| Attention budget | host-owned ledger (9.0 units; per-presentation cost by tier 1.5/1.0/0.5) |
| Serve-the-commute objective | `Objective` kind `be-informed` (params: session `commute`) |
| Degradation observable in Outcome | outcome `metrics`: tierCode, apiCallsRemaining, attentionUnitsRemaining, costUsdTotal, cpuUnitsUsed (+ degradedSession, declinedStepCount on the final presented outcome of a degraded session) |

**No new scheduler feature** (work-order law): the host composes ONLY the six standard-loop public operations. Degradation is host-side budget policy expressed through EXISTING constraint/realization surfaces — the budget tier selects which realization ids enter the candidate set and which constraint ceilings ride the request.

## Measured runs (virtual clock)

<!-- sim-006:level19:canonical:begin (machine-generated — regenerate via @reckon/simulation runCanonicalLadderWaveC) -->
| Level | Host adapter | Glue (fn/LOC/adapter LOC) | API ops | SDK methods | First decision (step/ms) | Full loop (step/ms) | p50/p95 (ms) | Samples | Failures (cnt/retry/exh) | Capability coverage | Evidence | Reckon-Complete |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 19 | adapter-l19-edgecast-1 | 12/399/135 | 6 | 6 | 1/359 | 1/438 | 20/47 | 46 | 0/0/0 | 12/12 (1.000) | fixture | YES |
<!-- sim-006:level19:canonical:end -->

The canonical run (`rec-8be3166b70a10688`, content checksum `8849fc240372f950…`) is Reckon-Complete: 12/12 through exactly the six standard-loop public operations; zero internal imports; glue declared 12 functions / 399 LOC (135 custom-adapter LOC inside the `glue:adapter` markers).

No auxiliary runs are law-mandated for this level (the single-agent baseline law is Level 17's multi-agent requirement); the degradation ladder is exercised inside the canonical run itself.

## Scenario semantics (asserted by the acceptance suite)

- **Budget-tier degradation ladder** — the API-call ledger degrades `full` (steps 1–4, ≥20 calls remaining) → `reduced` (steps 5–7, ≥8) → `minimal` (step 8): candidate sets 4 → 2 → 1 items, realization tiers `edge-full` → `edge-lite` → `edge-minimal`, request ceilings max-latency 250 → 150 → 80 ms and max-cost 0.10 → 0.05 → 0.02 USD, attention spend 1.5 → 1.0 → 0.5 per presentation.
- **Degradation observable in the Outcome stream** — every presented outcome's metrics carry `tierCode` + the full budget ledger state (apiCallsRemaining, attentionUnitsRemaining, costUsdTotal, cpuUnitsUsed); the final presented outcome of the degraded session additionally carries `degradedSession: 1` + `declinedStepCount`. Never a silent quality drop.
- **Honest non-presentation (the ultimate degradation)** — at step 8 the attention budget is exhausted (7.5 → 6 → 4.5 → 3 → 2 → 1 → 0 → 0): the host still REQUESTS the decision (the loop runs; the API/CPU ledgers spend) but DECLINES to present it — 7 presentations, 7 outcomes, no step-8 outcome, no step-8 preference delta. The requested-but-not-presented boundary is host authority (the same boundary Level 12's suitability deferrals established).
- **Ledger arithmetic** — API calls remaining 32 → 4 (4/step); CPU units used 8/16/24/32 then +5/+5/+5 then +3 = 50 of the 100-unit budget; money spent 0.08×4 + 0.04×3 = USD 0.44 of 0.60; attention 9.0 − (1.5×4 + 1.0×3) = 0 at step 8.

## Capability coverage and findings

Baseline coverage: 12/12 required capabilities satisfied (the standard set).

### Friction findings (named gaps)

No record gaps at this level: the budgets mapped cleanly onto existing constraint/realization/reward surfaces, and the degradation stayed observable through the outcome metrics — the work-order's "NOT a new scheduler feature" law held without a single friction finding. (The `HOST_RESPONSIBILITY` rows below are boundary notes, not record gaps.)

| Category | Capability | Finding |
|---|---|---|
| `HOST_RESPONSIBILITY` | — (constraint-declaration, exercised) | Budget ledgers (API quota, attention, CPU accrual) are host-owned by architecture; Reckon sees only the tier-scaled constraint ceilings and the realization choice. Not a record gap — the boundary worked as designed. |
| `HOST_RESPONSIBILITY` | — (outcome-return, exercised) | The degradation tier rides outcome metrics (host-declared evidence), not a new outcome field — the frozen Outcome contract carried it without churn. |

## Limitations

Fixture-class evidence: the scripted responder proves host-side integration and contract parity, not real resource consumption. The cost/CPU/attention numbers are scripted fixture parameters of the tier model; the p50/p95 are virtual-clock measurements of the loop shape. See the scorecard doc for the full honesty statement.
