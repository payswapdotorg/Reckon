# Level 17 — Multi-Agent Operations (SIM-006 integration case)

Ladder: "Agent Organizations, delegation, budgets, termination, single-agent baseline"
Host: **HiveOps Dispatch** (`host-l17-hiveops`, tenant `tenant-l17-hiveops`, subject `user-l17-knowledge-1`)
Profile: `profile-l17-multi-agent` (12 required capabilities, evidence floor `fixture`)
Fixture: `packages/simulation/src/levels/level-17-multi-agent.ts` (canonical run config fixed in `packages/simulation/src/levels/wave-c.ts`: seed `2117`, 8 steps, virtual clock 0/+1000ms)

## Domain mapping onto the frozen contracts

| Domain concept | Contract surface |
|---|---|
| Agent Bodies (capability envelopes) | `AgentBody` (frozen contract; host-side `AgentBodySchema.parse` validation — tools/observations/permissions/memory-interfaces/actions/budgets/latency-limits) |
| Agent Organization (searchable graph) | `AgentOrganization` (frozen contract; bodies + delegation/escalation edges, org budgets, termination rules — all host-owned state) |
| Knowledge-ops task board | `CatalogItem` kind `article` (work products: research/drafting/review/delivery) + work-product `Realization`s |
| Deliver-the-report objective | `Objective` kind `complete-task` (params: domain, taskKind) |
| Org dispatch posture | `AttentionPolicy` style `balanced` (params: maxDelegationsPerTask 2) |
| Delegation routing provenance | candidate `source` `agent-delegate:<bodyId>` / `agent-solo-fallback` / `host-time-critical` / `host-resume` |
| Org budgets | host-owned ledger (5-delegation calls budget, USD 4.00 cost budget) + request `HardConstraint`s (time-window, max-latency 200ms, catalog-rule capability gate) |
| Task-board plan coupling | `DecisionRequest.planId` ↔ `ScheduleDelta.planId` (`plan-l17-task-board`) |

The organization graph itself is **host-owned runtime state** (architecture law: the host owns its agent runtime — Reckon is never a second router/scheduler). The org couples to Reckon only through the six standard-loop operations: candidates carry routing provenance, objectives declare the task, outcomes return work-product events, preference deltas carry task-kind affinity.

## Measured runs (virtual clock)

<!-- sim-006:level17:canonical:begin (machine-generated — regenerate via @reckon/simulation runCanonicalLadderWaveC) -->
| Level | Host adapter | Glue (fn/LOC/adapter LOC) | API ops | SDK methods | First decision (step/ms) | Full loop (step/ms) | p50/p95 (ms) | Samples | Failures (cnt/retry/exh) | Capability coverage | Evidence | Reckon-Complete |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 17 | adapter-l17-hiveops-org-1 | 10/591/233 | 6 | 6 | 1/336 | 1/430 | 28/47 | 44 | 0/0/0 | 12/12 (1.000) | fixture | YES |
<!-- sim-006:level17:canonical:end -->

The canonical org run (`rec-7f1d7e69f3823812`, content checksum `c49ae4d3801372d5…`) is Reckon-Complete: 12/12 required capabilities through exactly the six standard-loop public operations; zero internal imports; glue declared 10 functions / 591 LOC (233 custom-adapter LOC inside the `glue:adapter` markers — the module's recount MINUS the solo-baseline region, which the baseline run counts for itself).

### The law-mandated auxiliary runs

<!-- sim-006:level17:aux:begin (machine-generated) -->
| Level | Kind | Case | Host adapter | Steps | Seed | Verdict (satisfied/partial/missing) | Reckon-Complete | Record gaps |
|---|---|---|---|---|---|---|---|---|
| 17 | single-agent-baseline | level17-single-agent-baseline | adapter-l17-hiveops-solo-1 | 8 | 2121 | 12/0/0 | YES | — |
| 17 | capability-probe | level17-probe-agent-delegation | adapter-l17-hiveops-org-1 | 8 | 2122 | 12/1/0 | NO | agent-delegation|COMPOSITION_GAP |
<!-- sim-006:level17:aux:end -->

## Scenario semantics (asserted by the acceptance suite)

- **Canonical org run** — `QUEUE → SWITCH → SWITCH → INTERRUPT → RESUME → SWITCH → SWITCH → CONTINUE`. The board routes research (step 1, `agent-delegate:l17-body-research`), drafting (step 2, `agent-delegate:l17-body-writer`), review (step 3, the two-hop path `coordinator>writer>reviewer`); the reviewer **escalates** at step 4 (`reviewer>coordinator>research` re-dispatch as a time-critical candidate → INTERRUPT with checkpoint); the checkpointed draft **resumes** at step 5 (`host-resume`); the 5-delegation calls budget is now spent, so the step-6 review cannot delegate — the **budget-exhausted termination rule fires** and the coordinator finishes steps 6–8 **solo** (`agent-solo-fallback`); the board completes at step 8 (`task-complete`).
- **Single-agent baseline (mandatory)** — the same 8-task stream executed by ONE body (`l17-body-solo`, every capability in one envelope): no delegation, no escalation, no resume, flat USD 0.60/task cost, termination `task-complete` at step 8. 12/12 complete through the same six operations; marginal glue 6 functions / 165 LOC (the `glue:baseline` region only — it reuses the module's shared catalog/manifest/identity sources already counted for the org host).
- **The comparison (why the baseline is law)** — org vs solo on the same board: total execution cost **USD 2.85 vs 4.80** (specialists are cheaper per task than the generalist), scripted work-product quality **0.92 vs 0.74** — while the org's bounded delegation budget forces the honest budget-exhausted termination + solo fallback for the tail. Neither run changed the Reckon-side surface: identical API operations, identical SDK methods, identical capability coverage.
- **Agent-delegation probe** — the same org host measured against a stricter 13-capability profile that requires `agent-delegation`: honestly incomplete (12 satisfied, 1 partial — the COMPOSITION_GAP below).

## Capability coverage and findings

Baseline coverage: 12/12 required capabilities satisfied (`tenant-identity`, `catalog-registration`, `realization-declaration`, `candidate-retrieval`, `objective-declaration`, `constraint-declaration`, `attention-policy`, `decision-request`, `schedule-execution`, `outcome-return`, `preference-feedback`, `conformance-verification`).

### Friction findings (named gaps)

<!-- sim-006:level17:gaps:begin (machine-generated) -->
| Level | Run | Capability | Friction | Detail |
|---|---|---|---|---|
| 17 | capability-probe | agent-delegation | COMPOSITION_GAP | the frozen AgentBody/AgentOrganization contracts validate the host's org declaration (bodies as capability envelopes, delegation edges, budgets, termination rules) and the SDK/API expose agents.createBody/createOrganization, but the SIM-001 harness port composes only the six standard-loop operations — the organization graph cannot cross the composed public path, so org state stays host-owned and couples through candidates/objectives/outcomes only |
<!-- sim-006:level17:gaps:end -->

| Category | Capability | Finding |
|---|---|---|
| `COMPOSITION_GAP` | `agent-delegation` | Probed (above): the public surface VALIDATES the org declaration and EXPOSES the agents API, but the composed harness path has no agent-org route — the graph stays host-side. Recorded; NOT upgraded here (single domain; the ladder's 3-domain law assigns upgrades to TL3). |
| `HOST_RESPONSIBILITY` | — (schedule-execution, exercised) | Delegation routing, budget ledgers, and termination rules are host-owned by architecture; the host executes schedule deltas and owns the org runtime. Not a record gap — the boundary worked as designed. |
| `HOST_RESPONSIBILITY` | — (single-agent baseline) | The baseline is a measurement law, not a capability: every multi-agent case carries it. The comparison lives in this doc and the acceptance suite, not in the record schema. |

## Limitations

Fixture-class evidence: the scripted responder proves host-side integration and contract parity, not real delegation quality or cost. The quality scores (0.92/0.74) and cost model (USD/task by body) are scripted fixture parameters chosen to exercise the comparison mechanics — not behavioral claims. Latencies are virtual-clock measurements of the loop shape. See the scorecard doc for the full honesty statement.
