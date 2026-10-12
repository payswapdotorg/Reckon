# SIM-003 — Integration Cases: Ladder Levels 5–8 (W2)

Status: ACTIVE (SIM-003, Wave A W2)
Owner: W2
Base: `53b4c9e` · Branch: `work/sim-003-levels-5-8`
Ladder: `docs/simulations/reckon-complete-ladder.md` (levels 5–8) · Harness: `docs/simulations/harness-guide.md`
Machinery: `packages/simulation/src/integration-cases/**` (additive)
Fixtures: `tests/conformance/fixtures/integration-cases/**` (additive)
Acceptance: `packages/simulation/test/integration-cases.test.ts`

## What an "integration case" is

A ladder level rendered as **decision/experience/scheduler integration scenarios** on the SIM-001 common harness. Each scenario is a deterministic, scripted synthetic host (`ScenarioScript`) whose steps exercise the public standard loop with the switching/interruption/resume/replan semantics the level demands:

```
register capability manifest
  → connect sources (catalog items + realizations via POST /v1/catalog/*)
  → per step: submit candidates (POST /v1/candidates)
      → decision request (POST /v1/decisions — objective, attention policy,
        constraints, reward, currentExperience, planId declared in-request)
      → schedule answer (QUEUE / CONTINUE / SUGGEST / SWITCH / INTERRUPT /
        RESUME + enqueue/dequeue + resume checkpoints + planId coupling)
      → host PRESENTS — or honestly declines host-side (rights / consent /
        pacing gates; unpresented decisions emit no outcome, execute no delta)
      → outcome returned (POST /v1/outcomes) + preference delta
        (POST /v1/preferences/events)
  → IntegrationEffortRecord + conformance verdict (replay-gated)
```

Every run goes through the REAL `@reckon/sdk` client over the scripted fixture responder — each request and response is validated against the frozen zod contracts in both directions. Evidence class of every run: **`fixture`** (never observed evidence).

## The SIM-003 additive surface

| Piece | Module | Notes |
|---|---|---|
| `ScenarioScript` + `createScenarioHost` | `integration-cases/scenario.ts` | Script → host adapter + deterministic per-run observation log (actions, formats, checkpoints, queue evolution, outcomes). Schedule deltas are executed host-side only when the host presents (host-owned presentation authority). |
| `runIntegrationCase` / `runIntegrationCaseSuite` | `integration-cases/runner.ts` | Runs scenarios on the common harness; suite aggregation into a sealed scorecard (`generatedAt` = max record `completedAt`, deterministic). Seeds derive from `deriveSeed("sim-003", level, scenarioId)`. |
| `standardLoopManifestContent` / `standardLoopProfile` / `capabilityProbeProfile` | `integration-cases/standard-loop.ts` | The COMMON host wiring (12-capability standard loop + beyond-surface declarations) moved platform-side — the ladder's goal: marginal host effort falls as common wiring moves to the platform. |
| Driver/port extensions | `harness/driver.ts`, `harness/host-adapter.ts`, `harness/port.ts`, `harness/responder.ts` | Additive: `HostDecisionInputs.currentExperience/planId/reward` flow onto the decision request (byte-identical requests for SIM-001 hosts that omit them); the responder's schedule policy answers current-experience requests deterministically (see below). |

### The scripted schedule policy (frozen, pure function of the request)

Evaluated in this exact order for requests carrying a `currentExperience`
(requests without one keep the exact SIM-001 QUEUE behavior — byte-compat law):

1. same item AND same realization as the current experience → **CONTINUE** (echo the current experience; no queue change);
2. selected candidate source `host-resume` → **RESUME** (enqueue the resumed experience, dequeue the current one, checkpoint the resumed experience);
3. attention policy `mindful` → **SUGGEST** (enqueue only — a mindful host is never switched or interrupted; time-critical candidates degrade to suggestions);
4. selected candidate source `host-time-critical` → **INTERRUPT** (enqueue the new experience, dequeue the current one, checkpoint the current);
5. otherwise → **SWITCH** (enqueue the new experience, dequeue the current one, checkpoint the current — includes same-item offer/creative swaps across different realizations).

A `format-required` hard constraint is honored on every newly-built experience (the contract-idiomatic way a host demands a placement format); `request.planId` is echoed into `scheduleDelta.planId` for rolling-plan coupling.

## The honest two-tier design (baselines + capability probes)

- **Baseline scenario runs** target the level's standard-loop profile (12 required capabilities) and complete Reckon-Complete: they prove the PUBLIC standard surface suffices for the level's core decision/experience/scheduler loop.
- **Capability probe runs** target a profile that ALSO requires a capability the level genuinely wants but the composed harness path cannot express. The host's manifest declares it `partial` with a named friction category, so the verdict is honestly INCOMPLETE and the record's `gaps` carry the finding into the scorecard's recurring-gap register. An incomplete verdict is a measurement, never a failure to hide.

## Glue measurement basis (host-declared, mechanical)

Each scenario section in `tests/conformance/fixtures/integration-cases/level*.ts` is marker-delimited (`// ===== scenario: <id> =====` … `// ===== end scenario: <id> =====`):

- `glue.loc` — non-blank, non-comment-only lines of the scenario section (the host-side code the scenario represents: script data + host factory);
- `glue.customAdapterLoc` — the subset inside the `ScenarioScript` construction (the lines that exist to map host domain state onto Reckon contract vocabulary: candidate references, constraints, rewards, current-experience refs, plan coupling, outcome/delta specs, manifest wiring);
- `glue.functions` — 7 per scenario: the four adapter callbacks (`provideDecisionInputs`, `consumeDecision`, `provideOutcome`, `providePreferenceDelta`), the shared host-side schedule executor and experience resolver (factory-provided), and the scenario host factory.

The shared level constants (domain catalogs, objectives, attention policies) and the platform-provided `standard-loop` builders are NOT counted per scenario (they are level-shared / platform-side by design — the ladder's direction of travel).

## Wave A (W2) aggregate — 24 runs, 16 hosts, 4 levels

| Metric | Value |
|---|---|
| Run count / distinct hosts / distinct levels | 24 / 16 / 4 |
| Median / p95 scenario glue LOC | 111 / 141 |
| Median / p95 time to first decision | 369 ms / 544 ms (virtual clock; step 1 in every run) |
| Median / p95 full-loop completion | 409 ms / 619 ms (virtual clock; step 1 in every run) |
| Median per-run p50 latency / p95 of per-run p95 | 25 ms / 91 ms (virtual ms, nearest-rank) |
| Mean capability coverage ratio | 0.9872 (20 baseline+resilience runs at 1.0; 4 probe runs at 12/13) |
| Total failures / retries (resilience runs) | 30 / 48 (all recovered except 1 exhausted call in L8-resilience, honestly recorded; every run still completed its loop) |
| Evidence class | `fixture` (every run) |
| Internal imports | 0 (mechanically enforced by `tests/conformance/zero-internal-access.test.ts`) |

### Recurring-gap register (the 3-domain law)

| Capability | Friction | Domains | Platform-upgrade candidate |
|---|---|---|---|
| `plan-management` | `COMPOSITION_GAP` | [5, 8] (2) | **no** — below the 3-domain threshold |
| `ad-memory` | `COMPOSITION_GAP` | [6] (1) | no |
| `decision-retrieval` | `COMPOSITION_GAP` | [7] (1) | no |

No (capability, friction) pair reaches three domains in this wave, so no platform upgrade is claimed. The finding to carry into SIM-007/SIM-008: **the SDK/API already expose plans CRUD, the ads family and decision lookup — the SIM-001 harness port composes only the six standard-loop operations.** If W1 (levels 1–4) and W3 (levels 9–12) probes surface the same composition gap in one more domain each, the 3-domain law triggers a port-composition upgrade (extend `ReckonPublicPort` + the scripted responder with the existing public routes), not a new platform.

### Friction categories observed across the wave (named, honest)

| Category | Where | Finding |
|---|---|---|
| `COMPOSITION_GAP` | L5/L8 `plan-management`, L6 `ad-memory`, L7 `decision-retrieval` | Public API+SDK surface exists; the composed harness port does not include it (probed, recorded in record gaps). |
| `HOST_RESPONSIBILITY` | L5 rolling plans, L6 pacing, L7 offer/inventory state, L8 itinerary state | Rolling-plan/pacing/inventory state is host-owned by architecture; the standard loop carries the coupling (planId, constraints, candidates, outcomes) but the host remains the authority. Not a record gap — an architectural boundary exercised as designed. |
| `RIGHTS_POLICY_BOUNDARY` | L6 rights-consent | Ad rights and consent gates are host-owned; `policy-rights` gate ids and custom consent constraints CARRY the gates, Reckon never grants rights (rights are never inferred from availability). Declined ads are requested-but-not-presented (measured, no outcome). |
| `ADAPTER_GAP` | L6 ad formats | Placement formats are expressed via `format-required` constraints and honored on resolved experiences; a richer placement/format negotiation surface (per-slot format inventories) would be host-side adapter work today. |
| `OBSERVABILITY_GAP` | all levels (evidence honesty test) | Fixture runs never satisfy a production-observed profile floor — surfaced as OBSERVABILITY_GAP, never a silent pass. |

## Per-level scorecard entries

- [Level 5 — Media streaming](./level5-media.md)
- [Level 6 — Ad-supported media](./level6-ads.md)
- [Level 7 — Marketplace](./level7-marketplace.md)
- [Level 8 — Travel / booking](./level8-travel.md)

## Reproducing every number

```bash
pnpm --filter @reckon/simulation test        # includes integration-cases.test.ts (34 tests)
npx vitest run tests/conformance             # zero-internal-access + determinism token scans over the fixtures
pnpm run test                                # the full root battery
```

Every run is deterministic: same seed + same host adapter + same profile ⇒ byte-identical `IntegrationEffortRecord` (canonical-JSON digest equality, asserted by the acceptance suite, including the full-suite scorecard aggregation and the replay gate for all 24 runs).

## Limitations (fixture honesty)

- The scripted responder is NOT the real decision kernel: it proves the HOST side and CONTRACT parity (every request/response validates against the frozen contracts through the real SDK), not live ranking quality. Higher evidence classes require a real port (`controlled-local` via `createInjectFetch`, staging, production-observed).
- The responder's schedule policy is a documented deterministic fixture policy (see above), not a learned interruption/switching policy.
- All latencies are virtual-clock measurements from the frozen harness latency model — they measure the integration loop shape, not real network time.
