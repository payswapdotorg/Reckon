# Level 6 — Ad-Supported Media (SIM-003 integration case)

Ladder: "placements, formats, pacing, interruption, rights and consent"
Host: **Broadcastly** (`host-broadcastly`, tenant `tenant-broadcastly`, subject `user-ad-supported-11`)
Profile: `profile-level-6-ad-supported-media` (12 required capabilities, evidence floor `fixture`)
Fixture: `tests/conformance/fixtures/integration-cases/level6-ads.ts`

## Domain mapping onto the frozen contracts

| Domain concept | Contract surface |
|---|---|
| Ad (never masquerading as content) | `CatalogItem` kind `advertising` (ad-004 law 8) with advertiser/campaign attributes |
| Creative / placement delivery | `Realization` kind `ad-creative` (creativeId + rightsGate constraints) |
| Slot formats (pre-roll video, rail banner, in-feed, full show) | `format-required` hard constraints → honored on resolved experiences (`interstitial` / `banner` / `in-feed` / `full`) |
| Pod pacing policy | `custom` hard constraint (`ad-pacing-max-pods`: maxPodsPerHour, minGapSeconds) + host-side pacing state |
| Rights gates | `policy-rights` hard constraints (`ad-rights-brand-a-spring`, `ad-rights-brand-x-revoked`) |
| Consent boundary | `custom` hard constraint (`ad-consent-personalization`) + host-owned consent authority |
| Personalized vs contextual retrieval | Candidate `source`: `host-ad-memory` (remembered) vs `host-ad-contextual` (contextual) — provenance carried, never merged |
| Mid-roll interruption + resume | `host-time-critical` / `host-resume` candidate sources → INTERRUPT / RESUME + checkpoints |
| Pacing plan coupling | `DecisionRequest.planId` ↔ `ScheduleDelta.planId` (`plan-broadcastly-pacing`) |

## Scenarios and measured runs (virtual clock)

| Scenario (archetypes) | Steps | Seed | Glue (fn/loc/adapter) | First decision | Full loop | p50/p95 (ms) | Samples | Coverage | Complete |
|---|---|---|---|---|---|---|---|---|---|
| placements-formats (switching) | 5 | 11042144020369263311 | 7/110/107 | step 1 @ 496ms | step 1 @ 552ms | 24/48 | 35 | 12/12 | ✅ |
| pacing (interruption, resume, replan) | 6 | 12832182718545430780 | 7/141/138 | step 1 @ 486ms | step 1 @ 564ms | 22/49 | 37 | 12/12 | ✅ |
| interruption-resume (interruption, resume, switching) | 5 | 7724071711485544832 | 7/108/105 | step 1 @ 413ms | step 1 @ 461ms | 23/47 | 35 | 12/12 | ✅ |
| rights-consent (switching) | 5 | 14406710264273982620 | 7/121/118 | step 1 @ 502ms | step 1 @ 544ms | 26/47 | 32 | 12/12 | ✅ |
| probe-ad-memory (switching) | 5 | 9708112948982697579 | 7/121/118 | step 1 @ 543ms | step 1 @ 587ms | 31/48 | 32 | 12/13 (partial) | ❌ by design |
| resilience (interruption, resume, replan; faultRate 0.2, 3 retries) | 6 | 6958829575080660664 | 7/141/138 | step 1 @ 489ms | step 1 @ 619ms | 26/60 | 37 | 12/12 | ✅ |

Evidence class of every run: `fixture`. Internal imports: 0. API operations / SDK methods: the six standard-loop operations (from the call log).

## Scenario semantics (asserted by the acceptance suite)

- **placements-formats** — `QUEUE → SWITCH → SWITCH → SUGGEST → SWITCH` with formats `[interstitial, interstitial, full, banner, interstitial]`: pre-roll pod, mid-pod creative swap, show start, mindful display-rail suggestion (never displaces the show), post-roll after completion. Every `format-required` constraint is honored on the resolved experience.
- **pacing** — `QUEUE → INTERRUPT → RESUME → CONTINUE → INTERRUPT(unpresented) → SWITCH`, planId-coupled throughout. The mid-roll pod interrupts the show at a natural break (checkpoint kept) and the show resumes; a later pod attempt inside the minimum gap is DECLINED host-side by the pacing gate — the decision is still requested (measured on the public surface) but never presented: no outcome event, no preference delta, and the INTERRUPT delta is NOT executed (the queue is observed unchanged).
- **interruption-resume** — `QUEUE → INTERRUPT → SWITCH → RESUME → CONTINUE`: the full mid-roll round trip including a second creative inside the pod.
- **rights-consent** — `QUEUE → SWITCH → SWITCH(unpresented) → SWITCH → SWITCH(unpresented)`: a remembered creative (`host-ad-memory` source) airs when its `policy-rights` gate passes; a personalized creative is declined when consent is absent (host-owned consent authority); the contextual fallback airs; a REVOKED-rights vendor is declined host-side. Declined steps emit no outcomes (latency sample counts reflect it — measured honesty).

## Capability coverage and findings

Baseline coverage: 12/12 (the standard loop with `constraint-declaration` and `schedule-execution` doing level-specific work: rights/consent/pacing gates and interrupt/resume execution).

### Friction findings (named gaps)

| Category | Capability | Finding |
|---|---|---|
| `COMPOSITION_GAP` | `ad-memory` | The SDK/API expose the AD-003 ads family (`POST /v1/ads/query`, `POST /v1/ads/forget` over Personal Ad Memory); the SIM-001 harness port composes only the standard decision loop. This host retains encountered creatives host-side and re-submits remembered ones as ordinary candidates with source `host-ad-memory` — measured host-side glue instead of the platform ad-memory lane. Probed: verdict honestly incomplete, gap recorded (`rec-7145ec7040e9c1e4`). |
| `RIGHTS_POLICY_BOUNDARY` | — (constraint-declaration, exercised) | Rights and consent are HOST-OWNED: `policy-rights` gate ids and custom consent constraints CARRY the gates; Reckon never grants rights and rights are never inferred from availability. Declined ads are requested-but-not-presented — the measured integration keeps the boundary explicit. |
| `HOST_RESPONSIBILITY` | — (schedule-execution, exercised) | Pacing state (pod count / minimum gap) is host-owned; the constraint vocabulary carries the policy parameters and the host enforces them at presentation time. |
| `ADAPTER_GAP` | — (experience-resolution) | Per-slot format inventories (what creatives CAN run in which slot) are host adapter state today; the public surface expresses demanded formats, not available format catalogs. |

### Resilience (seeded fault storm)

faultRate 0.2, maxRetries 3: 12 failed attempts, all recovered (0 exhausted), loop completed at step 1, p95 rising to 60 virtual ms — the pacing plan's interrupt/resume/replan sequence survived the storm.

## Limitations

Fixture-class evidence: the scripted responder's format/pacing behavior is a documented deterministic policy, not a live ad server or the real decision kernel. Impression/completion outcomes are scripted-world observations (`fixture` class). See the wave README.
