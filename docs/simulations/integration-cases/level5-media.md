# Level 5 — Media Streaming (SIM-003 integration case)

Ladder: "current/next experience, switching, resume, rolling plans"
Host: **StreamLine Media** (`host-streamline`, tenant `tenant-streamline`, subject `user-stream-7`)
Profile: `profile-level-5-media-streaming` (12 required capabilities, evidence floor `fixture`)
Fixture: `tests/conformance/fixtures/integration-cases/level5-media.ts`

## Domain mapping onto the frozen contracts

| Domain concept | Contract surface |
|---|---|
| Episode / documentary / live event | `CatalogItem` kind `media` (labels: series/drama, documentary, live/sports) |
| Stream delivery | `Realization` kinds `stream-hls` / `live-stream` (resolution / latency constraints) |
| Evening session objective | `Objective` kind `be-entertained` (params: session) |
| Binge vs mindful posture | `AttentionPolicy` styles `immersive` / `balanced` / `mindful` |
| Current playback | `DecisionRequest.currentExperience` (drives CONTINUE/SWITCH/INTERRUPT/RESUME) |
| Evening rolling plan | `DecisionRequest.planId` ↔ `ScheduleDelta.planId` (`plan-streamline-evening`) |
| Resume point | `ScheduleDelta.resumeCheckpoint` (deterministic `resume-<digest>` tokens) |

## Scenarios and measured runs (virtual clock)

| Scenario (archetypes) | Steps | Seed | Glue (fn/loc/adapter) | First decision | Full loop | p50/p95 (ms) | Samples | Coverage | Complete |
|---|---|---|---|---|---|---|---|---|---|
| switching (switching) | 5 | 16608543330478309374 | 7/108/105 | step 1 @ 458ms | step 1 @ 502ms | 29/48 | 32 | 12/12 | ✅ |
| interruption (interruption, resume) | 4 | 873470984856287549 | 7/87/84 | step 1 @ 369ms | step 1 @ 409ms | 25/42 | 28 | 12/12 | ✅ |
| resume (interruption, resume) | 4 | 15409928593447850188 | 7/86/83 | step 1 @ 386ms | step 1 @ 452ms | 25/47 | 27 | 12/12 | ✅ |
| rolling-plans (replan, switching) | 6 | 11302255356259018618 | 7/130/127 | step 1 @ 367ms | step 1 @ 396ms | 21/45 | 36 | 12/12 | ✅ |
| probe-plan-management (replan) | 6 | 12369994512153932021 | 7/130/127 | step 1 @ 406ms | step 1 @ 464ms | 29/45 | 36 | 12/13 (partial) | ❌ by design |
| resilience (replan, switching; faultRate 0.2, 3 retries) | 6 | 15513935328657430110 | 7/130/127 | step 1 @ 412ms | step 1 @ 505ms | 30/74 | 36 | 12/12 | ✅ |

Evidence class of every run: `fixture`. Internal imports: 0. API operations: the six standard-loop operations; SDK methods: the six standard-loop methods (identical for all runs — measured from the call log).

## Scenario semantics (asserted by the acceptance suite)

- **switching** — `QUEUE → SWITCH → CONTINUE → SUGGEST → SWITCH`. The mid-session switch keeps a resume checkpoint of the switched-away episode; the mindful step (documentary suggestion while an episode plays) never displaces playback (`SUGGEST` = enqueue only).
- **interruption** — `QUEUE → INTERRUPT → RESUME → SWITCH`. A live marathon (candidate source `host-time-critical`) interrupts the episode; the episode resumes from its checkpoint; the next episode switches in after completion.
- **resume** — `QUEUE → INTERRUPT → RESUME → CONTINUE`. The checkpoint round trip for a documentary: the retained token (`resume-…`) survives the interruption and the resume refreshes it.
- **rolling-plans** — `QUEUE → SWITCH → SWITCH → SWITCH → SWITCH → CONTINUE` with `planId` echoed on every schedule delta; the host-side queue never holds more than the rolling frontier (each SWITCH dequeues the just-consumed episode).

## Capability coverage and findings

Baseline coverage: 12/12 required capabilities satisfied (`tenant-identity`, `catalog-registration`, `realization-declaration`, `candidate-retrieval`, `objective-declaration`, `constraint-declaration`, `attention-policy`, `decision-request`, `schedule-execution`, `outcome-return`, `preference-feedback`, `conformance-verification`).

### Friction findings (named gaps)

| Category | Capability | Finding |
|---|---|---|
| `COMPOSITION_GAP` | `plan-management` | Rolling plans are host-owned; decisions couple via `planId` and the SDK/API expose `plans.create/replan/get/history`, but the SIM-001 harness port composes only the standard decision loop — plan CRUD is not reachable through the composed harness path. Probed (profile requires it): verdict honestly incomplete, gap recorded in the run record (`rec-7f2a1e322671a5db`). |
| `HOST_RESPONSIBILITY` | — (schedule-execution, exercised) | The rolling plan's queue/checkpoint state is host-owned by architecture; the host executes schedule deltas and owns presentation. Not a record gap — the boundary worked as designed. |
| `ADAPTER_GAP` | — (experience-resolution) | "Next experience" prefetch beyond decision responses would need `POST /v1/experiences/resolve` (SDK-exposed, not composed in the harness port); today the host builds next-up candidates from its own catalog state. |

### Resilience (seeded fault storm)

faultRate 0.2, maxRetries 3: 12 failed attempts across the run, all recovered by classified bounded retries (12 retry attempts spent, 0 exhausted); the full loop still completed at step 1 with p95 latency rising to 74 virtual ms — honest failure/retry behavior measured, not simulated away.

## Limitations

Fixture-class evidence: the scripted responder proves host-side integration and contract parity, not the real decision kernel's ranking/switching quality. Latencies are virtual-clock measurements of the loop shape. See the wave README for the full honesty statement.
