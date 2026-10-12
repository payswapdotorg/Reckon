# SIM-002 — Reckon-Complete Ladder Levels 1–4 (Wave A, W1)

Status: ACTIVE (SIM-002) — W1 work order deliverable
Base: `53b4c9e` · Branch: `work/sim-002-levels-1-4`
Program spec: `docs/simulations/reckon-complete-ladder.md` · Profile spec: `docs/simulations/reckon-complete-profile.md`
Harness: `packages/simulation/src/harness/**` (SIM-001) · Levels: `packages/simulation/src/levels/**`

## Mission and scope

Deliver ladder Levels 1–4 as synthetic-host simulation cases on the SIM-001 common
harness, one level profile + one synthetic host adapter + deterministic fixtures +
harness runs producing `IntegrationEffortRecord`s per level, plus the honest Wave A
scorecard:

- Level 1 — Static catalog picker (query a small catalog and return the best item)
- Level 2 — Simple content feed (preferences, context, outcomes, queue/replace)
- Level 3 — E-commerce storefront (variants, price, availability, constraints, conversion)
- Level 4 — Notification system (attention, fatigue, time windows, defer/queue, interruption)

W1 surface only: `packages/simulation/**`, `tests/conformance/fixtures/**`,
`docs/simulations/**`. No frozen-contract, apps, SDK, persistence, experience or
decision package was touched (the required `pnpm run generate:schemas` twice check
is byte-stable — SIM-002 adds zero contract churn).

## The platform finding (read this first)

Across all four levels the Reckon-side surface the host touches is IDENTICAL — the
six public operations of the standard decision loop:

```
POST /v1/catalog/items · POST /v1/catalog/realizations · POST /v1/candidates
POST /v1/decisions · POST /v1/outcomes · POST /v1/preferences/events
```

All ladder complexity from Level 1 to Level 4 lands HOST-side (world state,
transitions, ranking, defer/queue logic, glue: 248 → 455 LOC). That is the ladder's
success criterion working as designed: increasing domain complexity changes the
host-declared profile and host glue, not Reckon-specific integration code.

The wave's named gap — **`context-snapshots` is only PARTIAL on the public surface**
(decision requests carry an opaque `contextId` reference; the frozen
`ContextSnapshot` payload has no public ingestion route) — appeared in exactly the
two levels whose ladder definitions demand context/attention dynamics (Levels 2 and
4). Domain count 2: recurring, NOT yet a 3-domain platform-upgrade candidate. If
Wave B (W2 Levels 5–8, e.g. media switching with attention state) hits the same
gap, the ladder law triggers a platform upgrade decision for TL3.

## Level definitions

Each level module (`packages/simulation/src/levels/level-N-*.ts`) is a
self-contained synthetic host: profile input + capability manifest + world state +
adapter callbacks. Fresh factories make replay byte-identical by construction.

### Level 1 — Static catalog picker (`level-1-static-catalog.ts`)

- Profile `profile-l1-static-catalog` (10 required capabilities, evidence floor
  `fixture`): tenant-identity, catalog-registration, realization-declaration,
  candidate-retrieval, objective-declaration, attention-policy, decision-request,
  outcome-return, preference-feedback, conformance-verification.
- World: a six-article static catalog, fixed editorial ranking, one web realization
  per article. No transitions beyond the presentation ledger (the baseline
  archetype). Outcome: completion with step-scaled dwell. Delta: topic add.
- Verdict: **Reckon-Complete** (10/10 satisfied, fixture evidence).

### Level 2 — Simple content feed (`level-2-content-feed.ts`)

- Profile `profile-l2-content-feed` (12 required): the Level 1 set +
  `context-snapshots` + `schedule-execution` (queue/replace).
- World transitions (all host-side, all deterministic):
  - preferences: per-topic weights move with every outcome (completion +0.3,
    abandonment −0.2, floor 0.1) and RE-RANK retrieval each step; consumed articles
    never re-show (8 distinct articles presented in the canonical run);
  - context: day-part rotation morning → afternoon → evening referenced through
    per-step context ids;
  - outcomes: completion/abandonment (the synthetic user abandons every 4th item —
    scripted fixture-class behavior);
  - queue/replace: depth-2 prefetch queue; overflow dropped; the whole queue is
    replaced after an abandonment (7 replacements in the canonical run).
- Verdict: **partial** — `context-snapshots` declared `partial`/`API_GAP` honestly:
  the contextId reference rides the decision request, but the snapshot payload
  cannot cross the public surface.

### Level 3 — E-commerce storefront (`level-3-storefront.ts`)

- Profile `profile-l3-storefront` (11 required): the Level 1 set +
  `constraint-declaration`.
- Mapping (nothing domain-specific enters the kernel):
  - variants: multiple realizations per product (sizes/capacity);
  - price + stock: host-owned realization delivery characteristics
    (`Realization.constraints`), availability windows on `availableFrom`/`Until`
    gating retrieval host-side;
  - constraints: five hard-constraint kinds per request — time-window (promo
    window), max-cost (cart budget), catalog-rule (stock gate), policy-rights
    (host-owned payment eligibility gate), custom (cart capacity);
  - conversion: impression/conversion outcomes with order-value metrics; stock
    decrements on conversion; sold-out variants leave retrieval (the canonical run
    sells out `l3-real-tee-s`); session browsing never re-surfaces a seen product;
    category affinity feeds back into retrieval.
- Rights/price authority stays host-owned by design — recorded below as
  HOST_RESPONSIBILITY / RIGHTS_POLICY_BOUNDARY notes (the architecture working as
  intended, not a Reckon gap).
- Verdict: **Reckon-Complete** (11/11 satisfied, fixture evidence).

### Level 4 — Notification system (`level-4-notifications.ts`)

- Profile `profile-l4-notifications` (13 required): the Level 1 set +
  `context-snapshots` + `constraint-declaration` + `schedule-execution`.
- World transitions:
  - attention: quality rotates background → partial → full; background steps
    DEFER presentation — the decision still lands (first decision step 1) but the
    full loop completes one step later (step 2): the defer cost is a MEASURED
    number in the effort record (705 ms → 1840 ms in the canonical run);
  - fatigue: per-category presentation history; ≥2 presentations within 3 steps
    suppresses the category for 3 steps and removes it from retrieval (the
    canonical run suppresses `calendar` at step 4);
  - time windows: time-window/max-latency/format-required/quiet-hours constraints
    on every request; quiet-hour steps (every 5th) defer regardless of attention;
  - defer/queue: deferred notifications queue with retrieval priority and DRAIN on
    presentation (the canonical run's queue ends empty);
  - interruption: high-urgency notifications presented at partial attention are
    interruption-accept/reject outcomes bounded by the mindful policy's
    interruption budget (3); category deltas follow.
- Verdict: **partial** — `context-snapshots` `partial`/`API_GAP` (attention quality
  and fatigue signals live in the frozen `ContextSnapshot` payload, which has no
  public ingestion route).

## Canonical Wave A evidence (machine-generated — the doc-drift gate)

The tables below are regenerated by `runCanonicalLadderWaveA()` and compared
byte-for-byte against this document by `tests/conformance/fixtures/ladder-wave-a.test.ts`
(the doc-drift gate). If the harness, levels, or fixtures change, the gate fails
until this section is regenerated — documented numbers can never silently drift
from the measured ones.

Canonical fixtures (`LADDER_WAVE_A_FIXTURES`): seeds 1101/1102/1103/1104, steps
5/8/6/9, faultRate 0, maxRetries 2, clock {startMs 0, stepMs 1000}, fresh host
factories, scripted fixture responder (`createFixtureReckonPort`).

<!-- sim-002:wave-a:evidence:begin (machine-generated — regenerate via @reckon/simulation runCanonicalLadderWaveA) -->
| Level | Host adapter | Glue (fn/LOC/adapter LOC) | API ops | SDK methods | First decision (step/ms) | Full loop (step/ms) | p50/p95 (ms) | Samples | Failures (cnt/retry/exh) | Capability coverage | Evidence | Reckon-Complete |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | adapter-l1-static-catalog-1 | 9/248/42 | 6 | 6 | 1/340 | 1/409 | 33/47 | 32 | 0/0/0 | 10/10 (1.000) | fixture | YES |
| 2 | adapter-l2-content-feed-1 | 12/362/102 | 6 | 6 | 1/619 | 1/683 | 32/49 | 52 | 0/0/0 | 11/12 (0.917) | fixture | NO |
| 3 | adapter-l3-storefront-1 | 14/432/174 | 6 | 6 | 1/501 | 1/553 | 27/46 | 39 | 0/0/0 | 11/11 (1.000) | fixture | YES |
| 4 | adapter-l4-notifications-1 | 17/455/159 | 6 | 6 | 1/705 | 2/1840 | 32/46 | 52 | 0/0/0 | 12/13 (0.923) | fixture | NO |
<!-- sim-002:wave-a:evidence:end -->

<!-- sim-002:wave-a:gaps:begin (machine-generated) -->
| Level | Capability | Friction | Detail |
|---|---|---|---|
| 2 | context-snapshots | API_GAP | decision requests carry an opaque contextId reference only; the frozen ContextSnapshot payload (time.dayPart, device, attention, fatigue) has no public ingestion route — the feed's context transitions cannot cross the public surface as data, only as an id |
| 4 | context-snapshots | API_GAP | attention quality and fatigue signals live in the frozen ContextSnapshot payload (attention.quality, fatigue.repetitionLevel, fatigue.recentInterruptions) but the public surface carries an opaque contextId only — no ingestion route exists, so the notification host's attention/fatigue state cannot cross the public surface as data |
<!-- sim-002:wave-a:gaps:end -->

<!-- sim-002:wave-a:scorecard:begin (machine-generated) -->
- scorecardId: `scorecard-sim-002-wave-a`
- runCount: 4; distinctHosts: 4; distinctLevels: 4
- medianGlueLoc: 362; p95GlueLoc: 455
- medianFirstDecisionMs: 501; medianFullLoopMs: 553
- medianLatencyP50Ms: 32; p95LatencyP95Ms: 49
- meanCapabilityCoverageRatio: 0.960
- totalFailures: 0; totalRetries: 0
- recurringGaps: context-snapshots|API_GAP (domains 2+4, runs 2, platformUpgradeCandidate false)
<!-- sim-002:wave-a:scorecard:end -->

## Friction ledger (per level, named)

Categories are the frozen 11-member vocabulary. Profile-mechanical gaps (the
verdict's `gaps`) are marked MEASURED; observational findings from building the
levels are marked FINDING (they inform TL3 but are not verdict gaps).

| Level | Category | Kind | Named gap / note |
|---|---|---|---|
| 1 | — | — | none — the static picker needs nothing beyond the standard loop |
| 2 | API_GAP | MEASURED | `context-snapshots` partial — no public ContextSnapshot ingestion route; only an opaque contextId crosses the wire |
| 2 | UX_DX_GAP | FINDING | queue/replace semantics live entirely host-side; the platform offers no shared queue/replace primitive, so every feed re-implements the replace policy (candidate platform upgrade if it recurs) |
| 3 | HOST_RESPONSIBILITY | FINDING | price and stock authority is host-owned by architecture (Realization.constraints are opaque to the core) — working as designed, not a gap |
| 3 | RIGHTS_POLICY_BOUNDARY | FINDING | the policy-rights constraint references a HOST gate id (payment eligibility); Reckon must never own payment/rights gates — working as designed |
| 4 | API_GAP | MEASURED | `context-snapshots` partial — attention quality + fatigue signals cannot cross the public surface (same finding as Level 2, second domain) |
| 4 | OBSERVABILITY_GAP | FINDING | the scripted fixture responder always returns action QUEUE — INTERRUPT/HOLD/SUGGEST decision semantics are not exercised at fixture evidence class; a controlled-local or staging port is required to measure them |
| all | OBSERVABILITY_GAP | FINDING | every canonical run is `fixture`-class evidence (scripted responder); no level claims controlled-local/staging/production proof |

## Determinism, replay, and laws

- Determinism proof: same seed + fresh host factory ⇒ byte-identical records —
  asserted per level in `packages/simulation/test/levels.test.ts` (canonical JSON
  equality of record + call log + verdict) and for the whole wave in
  `tests/conformance/fixtures/ladder-wave-a.test.ts`.
- Replay gate: `replaySimulationRun` with a fresh host reproduces the identical
  record per level (harness gate, exercised for all four levels).
- Zero-internal-access proof: the levels and fixtures import only
  `@reckon/contracts` + the `@reckon/simulation` harness surface — mechanically
  enforced by `tests/conformance/zero-internal-access.test.ts` (SIM-001 scanner,
  which scans `packages/simulation/src/**` including `src/levels/**` for imports).
- Determinism tokens: the SIM-001 token scan covers `harness/**` + conformance
  fixtures; the levels module additionally enforces the same token laws
  package-locally (`packages/simulation/test/levels-determinism-scan.test.ts`).
- No wall-clock, no `Math.random`, no LLM/network anywhere in simulation logic;
  time is the injected `SimClock`, randomness is the seeded RNG.
- Evidence honesty: every synthetic outcome is `evidenceClass: "fixture"` and can
  never become observed evidence; the scorecard aggregates fixture-class evidence
  only; profiles with a `production-observed` floor are honestly incomplete
  (OBSERVABILITY_GAP) — asserted for all four levels.
- Glue honesty: each level's declared `glue.loc` equals a mechanical recount
  (comment-stripped, non-blank lines) of its module source, and
  `customAdapterLoc` equals the recount inside the `glue:adapter` markers —
  mechanically re-verified by `packages/simulation/test/levels.test.ts`.

## Honest limitations

1. Fixture evidence only — the scripted responder proves host-side wiring and
   contract parity, not a live deployment. Higher evidence classes need a real
   port (in-process API via `createInjectFetch` is controlled-local).
2. The fixture responder's decision policy is fixed (first candidate, action
   QUEUE): Levels 3/4 declare rich constraints, but the fixture does not evaluate
   them — constraint *declaration* is measured, constraint *enforcement* is not
   (that belongs to the real decision kernel against a controlled-local port).
3. The synthetic users follow scripted deterministic patterns (abandon every 4th
   item, convert every 3rd step, quiet hours every 5th). These are fixture-class
   behaviors chosen to exercise world-state transitions — not behavioral claims.
4. `glue.functions` is host-declared (a listed inventory in each module header);
   `loc`/`customAdapterLoc` are machine-recounted. A future harness could
   mechanize the function count too.
5. Level runs measure the virtual clock; wall-clock timings would be strictly
   larger and are deliberately out of scope (determinism law).

## Reproducing

```
pnpm --filter @reckon/simulation test          # levels + determinism scan + harness
npx vitest run tests/conformance               # Wave A conformance + doc-drift gate
```

The canonical tables above regenerate from
`runCanonicalLadderWaveA()` (`packages/simulation/src/levels/wave-a.ts`).
