# Level 18 — Multi-Surface Realtime System (SIM-006 integration case)

Ladder: "web/mobile/device bodies, cross-surface plans, explicit cross-device consent"
Host: **AuraPlay** (`host-l18-auraplay`, tenant `tenant-l18-auraplay`, subject `user-l18-listener-1`)
Profile: `profile-l18-multi-surface` (12 required capabilities, evidence floor `fixture`)
Fixture: `packages/simulation/src/levels/level-18-multi-surface.ts` (canonical run config fixed in `packages/simulation/src/levels/wave-c.ts`: seed `2118`, 8 steps, virtual clock 0/+1000ms)

## Domain mapping onto the frozen contracts

| Domain concept | Contract surface |
|---|---|
| Web / mobile / device surfaces | surface-specific `Realization`s per item (`realizationForSurface`) — one item, three realizations |
| Cross-surface day plan | the frozen **Experience Plan** contract reused as the cross-device plan: `DecisionRequest.planId` ↔ `ScheduleDelta.planId` (`plan-l18-day-1`, echoed by every delta — 8/8 steps coupled) |
| Explicit cross-device consent | `HardConstraint` kind `custom`, `constraintId: l18-cross-device-consent` (params: granted, grantedAtStep) on EVERY request — host authority, never implicit |
| Single logical identity (Personal Agent) | one `SubjectReference` across all surfaces (world fact: distinctSubjectCount 1) |
| Surface attention posture | `AttentionPolicy` style `balanced` (params: crossSurfaceHandoff `consent-gated`) |
| Day-listening objective | `Objective` kind `be-entertained` (params: dayPlan `single-identity`, surface) |
| Cross-surface resume | `ScheduleDelta.resumeCheckpoint` (deterministic tokens; a device checkpoint resumes on web) |
| Surface affinity learning | preference deltas `surface.<web/mobile/device>` |

## Measured runs (virtual clock)

<!-- sim-006:level18:canonical:begin (machine-generated — regenerate via @reckon/simulation runCanonicalLadderWaveC) -->
| Level | Host adapter | Glue (fn/LOC/adapter LOC) | API ops | SDK methods | First decision (step/ms) | Full loop (step/ms) | p50/p95 (ms) | Samples | Failures (cnt/retry/exh) | Capability coverage | Evidence | Reckon-Complete |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 18 | adapter-l18-auraplay-1 | 10/405/83 | 6 | 6 | 1/358 | 1/405 | 23/46 | 48 | 0/0/0 | 12/12 (1.000) | fixture | YES |
<!-- sim-006:level18:canonical:end -->

The canonical run (`rec-9dad5128a0b32e73`, content checksum `caff373500925cf2…`) is Reckon-Complete: 12/12 through exactly the six standard-loop public operations; zero internal imports; glue declared 10 functions / 405 LOC (83 custom-adapter LOC inside the `glue:adapter` markers).

### The law-mandated auxiliary run

<!-- sim-006:level18:aux:begin (machine-generated) -->
| Level | Kind | Case | Host adapter | Steps | Seed | Verdict (satisfied/partial/missing) | Reckon-Complete | Record gaps |
|---|---|---|---|---|---|---|---|---|
| 18 | capability-probe | level18-probe-webhook-delivery | adapter-l18-auraplay-1 | 8 | 2123 | 12/1/0 | NO | webhook-delivery|COMPOSITION_GAP |
<!-- sim-006:level18:aux:end -->

## Scenario semantics (asserted by the acceptance suite)

- **Canonical run** — `QUEUE → CONTINUE → QUEUE → SWITCH → SWITCH → CONTINUE → RESUME → SWITCH` over the surface rotation web → web → mobile → mobile → device → device → web → mobile. The user **withholds** cross-device consent at step 3 (the first mobile→device handoff attempt is blocked — no implicit cross-surface data flow: the device surface never receives the mobile local state while consent is off) and **explicitly grants** it at step 4, after which handoffs flow (steps 4–5: mobile→mobile-state handoff, mobile→device). A checkpoint taken on the device **resumes on web** at step 7 (cross-surface resume); cross-surface current-experience flow happens at steps 5, 7, 8 (consent-gated). The Personal Agent keeps ONE logical identity throughout (distinctSubjectCount 1) while the surface-specific realizations carry the per-body presentation.
- **Consent gate mechanics** — the consent state is HOST authority expressed as the `l18-cross-device-consent` custom hard constraint on every decision request: `granted: false, grantedAtStep: 4` before the grant, `granted: true` after. The decision request also carries `currentExperience` only when the owning surface's state may flow (the consent law) — never silently.
- **Plan coupling** — every decision request carries `planId: "plan-l18-day-1"` (8/8 steps) and every schedule delta echoes it: the frozen Experience Plan contract IS the cross-device plan; no new plan surface was needed.
- **Webhook-delivery probe** — the same host measured against a stricter 13-capability profile that requires `webhook-delivery`: honestly incomplete (12 satisfied, 1 partial — the COMPOSITION_GAP below).

## Capability coverage and findings

Baseline coverage: 12/12 required capabilities satisfied (the standard set).

### Friction findings (named gaps)

<!-- sim-006:level18:gaps:begin (machine-generated) -->
| Level | Run | Capability | Friction | Detail |
|---|---|---|---|---|
| 18 | capability-probe | webhook-delivery | COMPOSITION_GAP | a multi-surface realtime system wants thin-event push to its surfaces (decision/schedule/outcome notifications), and the SDK/API expose webhook endpoint create/list/get + event/delivery surfaces, but the SIM-001 harness port composes only the six standard-loop operations — realtime push cannot cross the composed public path, so surfaces poll through the standard loop instead |
<!-- sim-006:level18:gaps:end -->

| Category | Capability | Finding |
|---|---|---|
| `COMPOSITION_GAP` | `webhook-delivery` | Probed (above): the public surface EXPOSES webhook endpoints + event/delivery, but the composed harness path has no push route — surfaces poll through the standard loop. Recorded; NOT upgraded here (single domain). |
| `HOST_RESPONSIBILITY` | — (schedule-execution, exercised) | Per-surface presentation state and the consent ledger are host-owned by architecture (identity/authority law); the host executes schedule deltas per body. Not a record gap — the boundary worked as designed. |
| `HOST_RESPONSIBILITY` | — (single logical identity) | The Personal Agent's single logical identity is a host-side discipline expressed through one SubjectReference; Reckon needs no multi-surface identity feature for this level — the measurement says so. |

## Limitations

Fixture-class evidence: the scripted responder proves host-side integration and contract parity, not real cross-device latency or consent UX. The surface rotation and the consent grant step are scripted fixture parameters. Latencies are virtual-clock measurements of the loop shape (the realtime PUSH demand is exactly what the webhook probe measures as missing). See the scorecard doc for the full honesty statement.
