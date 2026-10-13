# SIM-004 — Reckon-Complete Ladder Levels 9–12 (Wave B, W3)

Status: ACTIVE (SIM-004) — W3 work order deliverable
Base: `f060f1f8365faf9b7549232295b0e7905ba5bc1b` · Branch: `work/sim-004-levels-9-12`
Program spec: `docs/simulations/reckon-complete-ladder.md` · Profile spec: `docs/simulations/reckon-complete-profile.md`
Harness: `packages/simulation/src/harness/**` (SIM-001) · Levels: `packages/simulation/src/levels/**` · API-only driver: `packages/simulation/src/api-only/driver.ts`

## Mission and scope

Deliver ladder Levels 9–12 as synthetic-host simulation cases on the SIM-001 common
harness — one level profile + one synthetic host adapter + deterministic fixtures +
harness runs producing honest `IntegrationEffortRecord`s per level — plus the W3
Wave-B mandate: **API-only measurement** (drive a representative level of each domain
through the public API/SDK operations only, with zero host-adapter abstraction and
zero internal-package imports):

- Level 9 — Food delivery (changing ETA, substitutions, urgent replanning, hard deadlines)
- Level 10 — Mobility / ride-hailing (real-time matching, spatial context, scarce resources, tight latency)
- Level 11 — Social feed (large candidate sets, freshness, exploration, strong policy boundaries)
- Level 12 — Finance / offers (strict eligibility, auditability, host suitability/policy constraints)

W3 surface only: `packages/simulation/**` (levels/cases + the NEW `api-only/` driver;
harness core untouched), `tests/conformance/fixtures/**`,
`tests/conformance/**` (new tests), `docs/simulations/**`. No frozen-contract, apps,
or SDK package was touched (the required `pnpm run generate:schemas` twice check is
byte-stable — SIM-004 adds zero contract churn).

## The platform finding (read this first)

Across all four levels the Reckon-side surface the host touches is IDENTICAL — the
six public operations of the standard decision loop:

```
POST /v1/catalog/items · POST /v1/catalog/realizations · POST /v1/candidates
POST /v1/decisions · POST /v1/outcomes · POST /v1/preferences/events
```

All ladder complexity from Level 9 to Level 12 lands HOST-side (world state,
transitions, ranking, suitability gates, glue: 400 → 507 LOC). The API-only driver
measures the same six operations driving the SAME levels without any adapter
abstraction — host glue drops to 114–233 LOC of flat request-body scripts, the
direct evidence that the public surface carries the standard loop and nothing more.

**THE 3-DOMAIN LAW TRIGGERED (the headline finding).** Wave B is the first wave that
can compose the full ladder so far — Wave A levels 1–4 (SIM-002) + SIM-003
integration-case records (levels 5–8) + Wave B levels 9–12 — and the composed
register contains exactly two three-domain recurring gaps:

1. **`context-snapshots` | API_GAP in domains {2, 4, 10}** — the Wave A finding
   (decision requests carry an opaque `contextId`; the frozen `ContextSnapshot`
   payload has no public ingestion route) hit its third domain at Level 10, where
   spatial context (pickup zone as `location.coarse`, in-vehicle device class) is
   the ladder definition's core demand.
2. **`plan-management` | COMPOSITION_GAP in domains {5, 8, 9}** — the SIM-003
   finding (the public SDK exposes `plans.create/replan/get`, but the composed
   harness path has no plan route) hit its third domain at Level 9, whose rolling
   delivery plan is the ladder definition's core demand.

Both are recorded with `platformUpgradeCandidate: true` by the frozen scorecard
machinery (`crossWaveRecurringGaps`). SIM-004 **records the candidates; it does NOT
upgrade the platform** — the ladder law assigns the upgrade decision to TL3 via the
Architecture Change Record process (no contract churn in this work item, by law).

## Level definitions

Each level module (`packages/simulation/src/levels/level-N-*.ts`) is a
self-contained synthetic host: profile input + capability manifest + world state +
adapter callbacks. Fresh factories make replay byte-identical by construction.

### Level 9 — Food delivery (`level-9-food-delivery.ts`)

- Profile `profile-l9-food-delivery` (13 required): the standard set +
  `constraint-declaration` + `plan-management`.
- World transitions (all host-side, all deterministic):
  - changing ETA: the traffic model adds +2 min/step to the live order; when the ETA
    first exceeds promise + slack, the host appends a CORRECTION outcome referencing
    the step-1 "start" promise (canonical run: one correction, step 4);
  - substitutions: the pasta dish sells out at step 3 (scripted kitchen world
    event); retrieval offers the substitution-group sibling (risotto) with source
    `host-substitution` ⇒ the decision SWITCHes the live order (step 3);
  - urgent replanning: at step 6 the priority-prep candidate (source
    `host-time-critical`, the responder's well-known interrupt source) INTERRUPTs
    the live order — promise re-planned 21 → 15 min, retained resume checkpoint;
  - hard deadlines: every request carries a time-window order cutoff and a
    max-latency budget; delivery lands at step 8.
- Verdict: **partial** — `plan-management` declared `partial`/`COMPOSITION_GAP`
  honestly: the rolling plan couples via `DecisionRequest.planId` and
  `ScheduleDelta.planId`, but plan CRUD is not reachable through the composed
  harness path (the SDK surface exists — see the probes below).

### Level 10 — Mobility / ride-hailing (`level-10-mobility.ts`)

- Profile `profile-l10-mobility` (13 required): the standard set +
  `context-snapshots` + `constraint-declaration`.
- World transitions:
  - real-time matching: a 5-vehicle pool with busy/return bookkeeping; matched
    vehicles leave the pool, completed rides return (scarce-resource tracking);
  - spatial context: zone rotation central → north → east → south → …; the
    in-vehicle device class and pickup zone ride the frozen `ContextSnapshot`
    payload — referenced through zone-bearing `contextId`s only (the gap below);
  - scarce resources + surge: the south-zone scarcity forces a nearest-zone match
    (source `host-nearest-zone`); the surge re-dispatch at step 5 rides the
    time-critical source as an INTERRUPT with a retained checkpoint;
  - tight latency: every request carries a max-latency budget.
- Verdict: **partial** — `context-snapshots` `partial`/`API_GAP`: the THIRD domain
  of the Wave A finding (levels 2 and 4) — this is the trigger entry.

### Level 11 — Social feed (`level-11-social-feed.ts`)

- Profile `profile-l11-social-feed` (12 required): the standard set +
  `constraint-declaration`.
- World transitions:
  - large candidate sets: 24 posts, candidate sets of 12, decaying as staleness
    removes items (8 → 4 by the final steps);
  - freshness: posts older than 5h depart retrieval (twelve departures in the
    canonical run);
  - exploration: exploration candidates inject every 3rd step (sets of 14,
    exploration steps 3 and 6);
  - strong policy boundaries: steps 4 and 8 are policy deferrals — the requested
    post fails the host's policy gate and is NEVER presented (no outcome, no
    delta); two posts land in the suppressed ledger.
- Verdict: **Reckon-Complete** (12/12 satisfied, fixture evidence) — the wave's
  complete level: the strong policy boundary is exercised as HOST authority
  (requested-but-not-presented), needing nothing beyond the standard loop.

### Level 12 — Finance / offers (`level-12-finance.ts`)

- Profile `profile-l12-finance` (12 required): the standard set +
  `constraint-declaration`.
- World transitions:
  - strict eligibility: hard-constraint battery on every request (KYC, income
    floor, jurisdiction, risk-band — all HOST-owned gates);
  - suitability: the subject's suitability band fails two requested offers
    (steps 3 and 5 — requested-but-not-presented, no outcome, no delta);
  - auditability: an append-only audit ledger links every decision (decisionId +
    experienceId) to its presentation and outcome; the APY correction at step 6 is
    an append-oriented CORRECTION outcome referencing the step-2 acceptance;
  - acceptance: the conversion lands at step 2 with product-line feedback.
- Verdict: **partial** — `evidence-retrieval` `partial`/`COMPOSITION_GAP` honestly:
  the audit trail needs decision/outcome linkage retrieval; the public SDK exposes
  decision lookup (`decisions.get`) but the composed harness path composes only
  the six standard-loop operations, so the audit ledger stays host-side.

## Canonical Wave B evidence (machine-generated — the doc-drift gate)

The tables below are regenerated by `runCanonicalLadderWaveB()` and compared
byte-for-byte against this document by `tests/conformance/fixtures/ladder-wave-b.test.ts`
(the doc-drift gate). If the harness, levels, or fixtures change, the gate fails
until this section is regenerated — documented numbers can never silently drift
from the measured ones.

Canonical fixtures (`LADDER_WAVE_B_FIXTURES`): seeds 2109/2110/2111/2112, steps
8/7/9/6, faultRate 0, maxRetries 2, clock {startMs 0, stepMs 1000}, fresh host
factories, scripted fixture responder (`createFixtureReckonPort`).

<!-- sim-004:wave-b:evidence:begin (machine-generated — regenerate via @reckon/simulation runCanonicalLadderWaveB) -->
| Level | Host adapter | Glue (fn/LOC/adapter LOC) | API ops | SDK methods | First decision (step/ms) | Full loop (step/ms) | p50/p95 (ms) | Samples | Failures (cnt/retry/exh) | Capability coverage | Evidence | Reckon-Complete |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 9 | adapter-l9-food-delivery-1 | 10/497/140 | 6 | 6 | 1/467 | 1/532 | 27/46 | 46 | 0/0/0 | 12/13 (0.923) | fixture | NO |
| 10 | adapter-l10-mobility-1 | 10/507/142 | 6 | 6 | 1/300 | 1/345 | 25/45 | 36 | 0/0/0 | 12/13 (0.923) | fixture | NO |
| 11 | adapter-l11-social-feed-1 | 10/423/91 | 6 | 6 | 1/1382 | 1/1431 | 25/45 | 80 | 0/0/0 | 12/12 (1.000) | fixture | YES |
| 12 | adapter-l12-finance-1 | 9/400/71 | 6 | 6 | 1/331 | 1/352 | 17/48 | 30 | 0/0/0 | 12/13 (0.923) | fixture | NO |
<!-- sim-004:wave-b:evidence:end -->

<!-- sim-004:wave-b:gaps:begin (machine-generated) -->
| Level | Capability | Friction | Detail |
|---|---|---|---|
| 9 | plan-management | COMPOSITION_GAP | the rolling delivery plan (order → substitution → priority prep → deadline) is host-owned; decisions couple to the plan via DecisionRequest.planId and ScheduleDelta.planId and the SDK/API exposes plans.create/replan/get, but the SIM-001 harness port composes only the standard decision loop — plan CRUD is not reachable through the composed harness path |
| 10 | context-snapshots | API_GAP | spatial context (the rider's pickup zone as location.coarse, the in-vehicle device class) lives in the frozen ContextSnapshot payload but the public surface carries an opaque contextId only — no ingestion route exists, so the mobility host's spatial context cannot cross the public surface as data, third domain after Wave A levels 2 and 4 |
| 12 | evidence-retrieval | COMPOSITION_GAP | the audit trail needs decision/outcome linkage retrieval; the public SDK exposes decision lookup (GET /v1/decisions/{id} via decisions.get) and webhook delivery evidence, but the SIM-001 harness port composes only the six standard-loop operations — evidence retrieval is not reachable through the composed harness path, so the audit ledger stays host-side |
<!-- sim-004:wave-b:gaps:end -->

<!-- sim-004:wave-b:scorecard:begin (machine-generated) -->
- scorecardId: `scorecard-sim-004-wave-b`
- runCount: 4; distinctHosts: 4; distinctLevels: 4
- medianGlueLoc: 423; p95GlueLoc: 507
- medianFirstDecisionMs: 331; medianFullLoopMs: 352
- medianLatencyP50Ms: 25; p95LatencyP95Ms: 48
- meanCapabilityCoverageRatio: 0.942
- totalFailures: 0; totalRetries: 0
- recurringGaps (this wave only): context-snapshots|API_GAP (domains 10, runs 1, platformUpgradeCandidate false); evidence-retrieval|COMPOSITION_GAP (domains 12, runs 1, platformUpgradeCandidate false); plan-management|COMPOSITION_GAP (domains 9, runs 1, platformUpgradeCandidate false)
<!-- sim-004:wave-b:scorecard:end -->

## The API-only measurement (the Wave-B W3 mandate)

The ladder's worker table assigns W3 "API-only drivers … request/response
measurement, conformance checks, failure/retry harnesses." The driver
(`packages/simulation/src/api-only/driver.ts`) measures a synthetic host as a flat
script of PUBLIC operations — no `SimulationHostAdapter` callbacks: the host IS the
script. Every call crosses the REAL `@reckon/sdk` client
(`createReckonClient` → `createSdkPort`), which validates every request against the
frozen zod contracts before sending and every response after receiving — a
contract-parity round-trip on both directions of every operation. Zero internal
Reckon packages are imported (mechanically enforced by the SIM-001 conformance
scanner, which scans the fixture).

Scenario battery (`tests/conformance/fixtures/api-only/level9-12.ts`), one
representative level per domain, driven ONLY through the six standard-loop public
operations:

- `l9-food-dispatch` (seed 3109) — fresh order → substitution SWITCH →
  priority-prep INTERRUPT → delivery, with hard-deadline constraints, planId
  coupling and a competing reward (speed vs cost) on every request;
- `l10-spatial-dispatch` (seed 3110) — central match → ride tracking → completion
  → south-zone scarcity → surge re-dispatch INTERRUPT, with a tight max-latency
  budget and zone-bearing context ids;
- `l11-feed-page` (seed 3111) — 18-candidate sets, exploration every 3rd step, a
  policy-boundary DECLINE at step 4 (requested-but-not-presented), an abandonment;
- `l12-offer-audit` (seed 3112) — strict-eligibility constraints, a suitability
  DECLINE at step 3, an acceptance and the append-oriented APY correction;
- `l9-malformed-dispatch` — the terminal-classification probe (step 3 carries a
  contract-invalid empty candidate set);
- resilience variants of l10 and l12 under a seeded transport-fault storm
  (faultRate 0.25, maxRetries 3).

<!-- sim-004:api-only:evidence:begin (machine-generated — regenerate via @reckon/simulation runApiOnlySuite over API_ONLY_LEVEL_ENTRIES) -->
| Level | Scenario | Host adapter | Glue (fn/LOC/adapter LOC) | API ops | SDK methods | First decision (step/ms) | Full loop (step/ms) | p50/p95 (ms) | Samples | Round-trips | Failures (cnt/retry/exh) | Capability coverage | Evidence | Reckon-Complete |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 9 | l9-food-dispatch | adapter-api-l9-food-1 | 2/233/56 | 6 | 6 | 1/251 | 1/276 | 25/46 | 26 | 26 | 0/0/0 | 11/12 (0.917) | fixture | NO |
| 10 | l10-spatial-dispatch | adapter-api-l10-mobility-1 | 3/206/47 | 6 | 6 | 1/216 | 1/273 | 36/49 | 24 | 24 | 0/0/0 | 11/12 (0.917) | fixture | NO |
| 11 | l11-feed-page | adapter-api-l11-social-1 | 2/114/61 | 6 | 6 | 1/1032 | 1/1100 | 26/45 | 54 | 54 | 0/0/0 | 11/11 (1.000) | fixture | YES |
| 12 | l12-offer-audit | adapter-api-l12-finance-1 | 2/132/60 | 6 | 6 | 1/253 | 1/323 | 27/49 | 24 | 24 | 0/0/0 | 11/12 (0.917) | fixture | NO |
<!-- sim-004:api-only:evidence:end -->

Measured behavior (asserted in `packages/simulation/test/api-only.test.ts`):

- **Request/response**: every successful call is a contract round-trip (26/24/54/24
  samples = successful calls); p50/p95 come from successful calls only.
- **Failure/retry classification**: contract-invalid requests fail TERMINALLY
  (`SDK_REQUEST_INVALID`, attempts 1 — the frozen retryable set excludes it) while
  the run continues honestly; seeded transport faults are transient (bounded
  classified retries, zero exhaustion, byte-identical under the same seed).
- **Capability coverage**: the same honest partials the adapter-side wave measured
  (the manifest declares them; the fixture port proves the reachability boundary).
- **The replay gate**: `replayApiOnlyScenario` reproduces byte-identical records;
  harness-version drift is a typed `ApiOnlyReplayMismatchError`.
- **Evidence honesty**: a `production-observed` floor is honestly unmet
  (OBSERVABILITY_GAP) — fixture runs never masquerade as observed evidence.

The beyond-surface SDK probes (the composed-path boundary, measured from the
API-only side):

<!-- sim-004:api-only:probes:begin (machine-generated) -->
| SDK method | Route | Capability | Request built | Outcome | Classification | Note |
|---|---|---|---|---|---|---|
| decisions.get | GET /v1/decisions/{decisionId} | decision-retrieval | YES | NOT_FOUND | terminal | the public SDK method exists and drove a typed round-trip, but the composed fixture port has no route — decision retrieval is not reachable through the composed harness path (COMPOSITION_GAP) |
| plans.create | POST /v1/plans | plan-management | YES | NOT_FOUND | terminal | the public SDK method exists and the plan body passed client-side contract validation, but the composed fixture port has no route — plan CRUD is not reachable through the composed harness path (COMPOSITION_GAP) |
| ads.query | POST /v1/ads/query | ad-memory | YES | NOT_FOUND | terminal | the public SDK method exists and drove a typed round-trip, but the composed fixture port has no route — ad memory retrieval is not reachable through the composed harness path (COMPOSITION_GAP) |
<!-- sim-004:api-only:probes:end -->

The probes prove the SEAM (the public SDK methods exist and validate requests both
ways); they do not prove a live deployment (fixture evidence class). The boundary
is a composed-path property — the SDK surface exists, the harness path does not
mount it: the honest COMPOSITION_GAP reading that feeds the plan-management
trigger below.

## The cross-wave 3-domain analysis (the ladder law, machine-checked)

`crossWaveRecurringGaps` composes the canonical Wave A records (levels 1–4), the
SIM-003 integration-case records (levels 5–8), and the Wave B canonical records
(levels 9–12) — 32 records, 12 distinct domains, all fixture-class — and groups
every record gap by (capability, friction) across DISTINCT ladder levels using the
SAME frozen scorecard machinery. The register below is the honest trigger list
(asserted in `packages/simulation/test/cross-wave-3-domain.test.ts` and doc-drift
gated):

<!-- sim-004:cross-wave:begin (machine-generated — regenerate via @reckon/simulation crossWaveRecurringGaps over the canonical Wave A + SIM-003 + Wave B records) -->
| Capability | Friction | Domains (ladder levels) | Domain count | Run count | Platform-upgrade candidate |
|---|---|---|---|---|---|
| ad-memory | COMPOSITION_GAP | [6] | 1 | 1 | false |
| context-snapshots | API_GAP | [2, 4, 10] | 3 | 3 | TRUE |
| decision-retrieval | COMPOSITION_GAP | [7] | 1 | 1 | false |
| evidence-retrieval | COMPOSITION_GAP | [12] | 1 | 1 | false |
| plan-management | COMPOSITION_GAP | [5, 8, 9] | 3 | 3 | TRUE |
<!-- sim-004:cross-wave:end -->

The two candidates are recorded, NOT actioned: upgrading the platform primitive
(a public ContextSnapshot ingestion route; mounting the plan routes on the composed
path) requires an Architecture Change Record and contract evolution — TL3's call,
per the frozen-contract law. SIM-004 ships zero contract churn by design.

## Friction ledger (per level, named)

Categories are the frozen 11-member vocabulary. Profile-mechanical gaps (the
verdict's `gaps`) are marked MEASURED; observational findings from building the
levels are marked FINDING (they inform TL3 but are not verdict gaps).

| Level | Category | Kind | Named gap / note |
|---|---|---|---|
| 9 | COMPOSITION_GAP | MEASURED | `plan-management` partial — plan CRUD not reachable on the composed harness path (third domain of the SIM-003 finding; trigger entry) |
| 9 | HOST_RESPONSIBILITY | FINDING | kitchen stock, the ETA model and substitution groups are host-owned by architecture — working as designed, not a gap |
| 10 | API_GAP | MEASURED | `context-snapshots` partial — spatial context cannot cross the public surface as data (third domain of the Wave A finding; trigger entry) |
| 10 | HOST_RESPONSIBILITY | FINDING | the vehicle pool, matching and surge pricing are host-owned — the platform offers no second scheduler, by law |
| 11 | — | — | none — the strong policy boundary is exercised as host authority within the standard loop (the wave's complete level) |
| 11 | UX_DX_GAP | FINDING | candidate-set trimming for large feeds is entirely host-side; a shared retrieval primitive could reduce per-host ranking glue if the pattern recurs (watch item, domain count 1) |
| 12 | COMPOSITION_GAP | MEASURED | `evidence-retrieval` partial — decision/outcome linkage retrieval not reachable on the composed harness path (the audit ledger stays host-side) |
| 12 | RIGHTS_POLICY_BOUNDARY | FINDING | eligibility/suitability gates (KYC, income, jurisdiction, risk-band) are HOST authority — Reckon must never own them; working as designed |
| all | OBSERVABILITY_GAP | FINDING | every canonical run is `fixture`-class evidence (scripted responder); no level claims controlled-local/staging/production proof |

## Determinism, replay, and laws

- Determinism proof: same seed + fresh host factory ⇒ byte-identical records —
  asserted per level in `packages/simulation/test/levels-wave-b.test.ts` (canonical
  JSON equality of record + call log + verdict), for the whole wave in
  `tests/conformance/fixtures/ladder-wave-b.test.ts`, and for every API-only
  scenario in `packages/simulation/test/api-only.test.ts`.
- Replay gates: `replaySimulationRun` (adapter side) and `replayApiOnlyScenario`
  (API-only side) reproduce byte-identical records from `replayInputs`; harness
  version drift on the API-only side is a typed mismatch error.
- Zero-internal-access proof: the levels, the API-only driver, and the fixtures
  import only `@reckon/contracts`, `@reckon/sdk` and the `@reckon/simulation`
  harness surface — mechanically enforced by
  `tests/conformance/zero-internal-access.test.ts` (the SIM-001 scanner scans
  `packages/simulation/src/**` — including `src/api-only/**` — and
  `tests/conformance/fixtures/**`, including the new `api-only/` fixtures).
- Determinism tokens: the SIM-001 token scan covers `harness/**` + conformance
  fixtures; no wall-clock, no `Math.random`, no LLM/network anywhere in simulation
  logic — time is the injected `SimClock`, randomness is the seeded RNG, SDK ids
  come from `createDeterministicIdGenerator`.
- Evidence honesty: every synthetic outcome is `evidenceClass: "fixture"` and can
  never become observed evidence; the wave scorecard and the API-only suite
  aggregate fixture-class evidence only; profiles with a `production-observed`
  floor are honestly incomplete (OBSERVABILITY_GAP) — asserted for all four levels
  AND on the API-only driver.
- Glue honesty: each level's declared `glue.loc` equals a mechanical recount
  (comment-stripped, non-blank lines) of its module source, `customAdapterLoc`
  equals the recount inside the `glue:adapter` markers (re-verified by
  `packages/simulation/test/levels-wave-b.test.ts`); each API-only scenario's glue
  equals the mechanical recount of its marker-delimited section in the fixture
  (re-verified by `packages/simulation/test/api-only.test.ts`).
- Architecture laws: no second ranking/policy/scheduler was created — all ladder
  complexity (ETA model, matching pool, feed ranking, eligibility gates) is
  host-owned; identity/catalog/rights/delivery authority stays with the hosts;
  synthetic outcomes never masquerade as observed.

## Honest limitations

1. Fixture evidence only — the scripted responder proves host-side wiring and
   contract parity, not a live deployment. Higher evidence classes need a real
   port (controlled-local via an in-process API, staging, production-observed).
2. The fixture responder's decision policy is scripted (candidate-source-driven
   actions: QUEUE/SWITCH/INTERRUPT/CONTINUE); it does not evaluate the declared
   constraints — constraint *declaration* and host-side *gating* are measured,
   constraint *enforcement* belongs to the real decision kernel.
3. The synthetic users follow scripted deterministic patterns (sell-out at step 3,
   surge at step 5, policy deferrals at steps 4/8, suitability failures at steps
   3/5). These are fixture-class behaviors chosen to exercise world-state
   transitions — not behavioral claims.
4. The API-only driver measures the six standard-loop operations only; the
   beyond-surface SDK probes (decisions.get, plans.create, ads.query) prove the
   seam exists and classifies the composed-path gap — they do not measure a live
   deployment of those routes.
5. The cross-wave register composes CANONICAL records (Wave A 4 + SIM-003 24 +
   Wave B 4 = 32); ensemble seeds would multiply run counts but not domain counts —
   the law counts DISTINCT domains.
6. `glue.functions` on the level side is host-declared (a listed inventory in each
   module header); `loc`/`customAdapterLoc` are machine-recounted. On the API-only
   side all three are machine-recounted (function declarations + const-arrow
   builders within the scenario section).

## Reproducing

```
pnpm --filter @reckon/simulation test          # levels-wave-b + api-only + cross-wave + prior batteries
npx vitest run tests/conformance               # Wave B conformance + doc-drift gate + SIM-001 scanner
```

The canonical tables above regenerate from `runCanonicalLadderWaveB()`
(`packages/simulation/src/levels/wave-b.ts`), the API-only tables from
`runApiOnlySuite(API_ONLY_LEVEL_ENTRIES)` + `probePublicSdkSurface()`
(`packages/simulation/src/api-only/driver.ts`), and the cross-wave register from
`crossWaveRecurringGaps({waveALevels, sim003IntegrationCases, waveB})`.
