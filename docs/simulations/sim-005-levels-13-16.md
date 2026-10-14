# SIM-005 — Reckon-Complete Ladder Levels 13–16 (Wave C-1, W1)

Status: ACTIVE (SIM-005) — W1 work order deliverable
Base: `7ee7ac5` · Branch: `work/sim-005-levels-13-16`
Program spec: `docs/simulations/reckon-complete-ladder.md` · Profile spec: `docs/simulations/reckon-complete-profile.md`
Harness: `packages/simulation/src/harness/**` (SIM-001) · Levels: `packages/simulation/src/levels/**`
Wave model: `docs/simulations/sim-004-levels-9-12.md` (Wave B — this wave doc follows its structure)

## Mission and scope

Deliver ladder Levels 13–16 as synthetic-host simulation cases on the SIM-001 common
harness — one level profile + one synthetic host adapter + deterministic fixtures +
harness runs producing honest `IntegrationEffortRecord`s per level — plus the W1
Wave-C-1 mandate: the **cross-wave 3-domain analysis extended through Wave C**
(compose the Wave A records (levels 1–8), the Wave B records (levels 9–12) and the
Wave C records (levels 13–16) through the SAME frozen scorecard machinery, group
every record gap by (capability, friction) across DISTINCT ladder levels, and record
— never action — the platform-upgrade candidates):

- Level 13 — Healthcare information (high-stakes uncertainty, provenance, consent, host safety gates)
- Level 14 — Education (long-horizon goals, curriculum state, delayed outcomes, sequential planning)
- Level 15 — B2B SaaS workspace (roles, teams, workflow context, multi-actor objectives)
- Level 16 — Enterprise workflow orchestration (approvals, long-lived plans, concurrency, audit, compensation)

W1 surface only: `packages/simulation/src/levels/level-13..16-*.ts` + `wave-c.ts`
(the canonical runner), the strictly ADDITIVE `levels/index.ts` block (SIM-005
section appended at the end; no existing export changes), `tests/conformance/
fixtures/ladder-wave-c.test.ts` (the doc-drift gate),
`packages/simulation/test/levels-wave-c.test.ts` +
`packages/simulation/test/cross-wave-through-wave-c.test.ts` (the package
batteries), and the level-module count in
`packages/simulation/test/levels-determinism-scan.test.ts` (8 → 12 — the scan's
own surface grew with the four new modules). No frozen-contract, apps, SDK, or
harness-core file was touched (the required `pnpm run generate:schemas` twice
check is byte-stable — SIM-005 adds zero contract churn).

## The platform finding (read this first)

Across all four levels the Reckon-side surface the host touches is IDENTICAL — the
six public operations of the standard decision loop (the same finding as Wave B,
now measured through healthcare, education, B2B SaaS and enterprise workflow):

```
POST /v1/catalog/items · POST /v1/catalog/realizations · POST /v1/candidates
POST /v1/decisions · POST /v1/outcomes · POST /v1/preferences/events
```

All ladder complexity from Level 13 to Level 16 lands HOST-side (consent ledgers,
curriculum DAGs and delayed assessments, role matrices and multi-actor rewards,
approval chains, concurrency guards and compensation engines: 503 → 588 LOC).
Level 15 (B2B SaaS) is the wave's Reckon-Complete level — roles, workflow context
and multi-actor objectives are exercised as HOST authority + standard-loop
declarations (the account-scoped subject, the declared team reward), needing
nothing beyond the six operations.

**THE 3-DOMAIN LAW TRIGGERED A THIRD TIME (the headline finding).** The composed
register through Wave C (Wave A levels 1–8 + Wave B levels 9–12 + Wave C levels
13–16 — 36 records, 16 distinct domains, all fixture-class) now carries exactly
three platform-upgrade candidates:

1. **`context-snapshots` | API_GAP in domains {2, 4, 10}** — the standing Wave-B
   candidate (unchanged: Wave C declares no context-snapshots gap — workflow
   context at Level 15 is host-owned gating riding opaque context ids).
2. **`plan-management` | COMPOSITION_GAP in domains {5, 8, 9, 14, 16}** — the
   standing candidate GAINS the education (14) and enterprise-workflow (16)
   domains: the long-horizon curriculum plan and the concurrent procurement/
   vendor plan lanes are the ladder definitions' core demands at both levels.
3. **`evidence-retrieval` | COMPOSITION_GAP in domains {12, 13, 16}** — the NEW
   trigger recorded by this wave: the finance audit ledger (12), the healthcare
   provenance/consent ledger (13) and the enterprise audit ledger (16) all need
   decision/outcome linkage retrieval; the public SDK exposes decision lookup
   but the composed harness path composes only the six standard-loop operations.
   Three distinct domains ⇒ `platformUpgradeCandidate: true`.

All three are recorded by the frozen scorecard machinery
(`crossWaveRecurringGapsThroughWaveC`). SIM-005 **records the candidates; it does
NOT upgrade the platform** — the ladder law assigns the upgrade decision to TL3
via the Architecture Change Record process (no contract churn in this work item,
by law). The composition is strictly additive: the Waves A+B entries keep their
domains and run counts (asserted in
`packages/simulation/test/cross-wave-through-wave-c.test.ts`); Wave C records
only join them.

## Level definitions

Each level module (`packages/simulation/src/levels/level-N-*.ts`) is a
self-contained synthetic host: profile input + capability manifest + world state +
adapter callbacks. Fresh factories make replay byte-identical by construction.

### Level 13 — Healthcare information (`level-13-healthcare.ts`)

- Profile `profile-l13-healthcare` (13 required): the standard set +
  `evidence-retrieval`.
- World transitions (all host-side, all deterministic):
  - provenance: every recommended item carries its provenance chain (source
    system, review board, evidence grade) in the host catalog; every presented
    item lands in the host's append-only provenance ledger with decision linkage
    (5 entries in the canonical run), and every outcome's metrics carry the
    item's uncertainty score and evidence grade — provenance is never dropped;
  - consent gates decision eligibility: the genetic-screening explainer (consent
    scope "genetic", ungranted) is requested at step 4 but the consent gate
    DENIES presentation (requested-but-not-presented: no outcome, no delta) —
    the consent ledger records all 7 gate verdicts;
  - host safety gate veto: the subject reports an anticoagulant at step 6
    (scripted world event); the generic anticoagulant-diet guide FAILS the
    clinical safety board's interaction gate and is vetoed
    (requested-but-not-presented) — the safety gate can always veto;
  - high-stakes uncertainty surfaced, never hidden: every outcome carries
    metrics.uncertaintyScore; the imaging prep guide's uncertainty (0.45,
    renal-function dependent) exceeds the 0.4 disclosure threshold at its
    presentation (step 3) and its guidance update (step 7);
  - the step-7 guidance update is an append-oriented CORRECTION outcome
    (correctsEventId → the step-3 presentation event); the urgent medication
    recall at step 5 INTERRUPTs the live reading (checkpoint retained) via the
    well-known `host-time-critical` source.
- Verdict: **partial** — `evidence-retrieval` declared `partial`/`COMPOSITION_GAP`
  honestly: the provenance/consent audit ledger needs decision/outcome linkage
  retrieval; the composed harness path composes only the six standard-loop
  operations (second domain after Wave B level 12).

### Level 14 — Education (`level-14-education.ts`)

- Profile `profile-l14-education` (13 required): the standard set +
  `plan-management`.
- World transitions:
  - long-horizon goal: every request declares the foundations-track objective
    and couples to the rolling curriculum plan via `DecisionRequest.planId`
    ("plan-l14-foundations");
  - curriculum state advances deterministically: units unlock only when their
    prerequisites are MASTERED (the prerequisite DAG is re-checked at every
    assignment — the coherence guard records zero violations in the canonical
    run); 6 assignments, 4 matured assessments, 3 mastered units, 1
    below-threshold remediation;
  - delayed outcomes: assessments mature 3 steps after assignment; the matured
    assessment emits a DELAYED completion outcome referencing the ASSIGNMENT
    decision (decisionId + experienceId of the earlier step) with the delay in
    metrics — outcomes arrive many steps late, never fabricated early; two
    assignments (the step-7 remediation practice, the step-9 statistics unit)
    mature after the canonical run ends and stay honestly pending;
  - sequential planning: assign → continue → interleave the parallel track →
    unlock-on-mastery → remediate below-threshold units with the practice
    realization (a same-item realization swap ⇒ SWITCH) → live-tutor INTERRUPT
    (step 8, `host-time-critical`) → next track.
- Verdict: **partial** — `plan-management` `partial`/`COMPOSITION_GAP`: the
  fourth domain of the SIM-003/Wave-B finding (after levels 5, 8 and 9).

### Level 15 — B2B SaaS workspace (`level-15-b2b-saas.ts`)

- Profile `profile-l15-b2b-saas` (12 required): the standard set.
- World transitions:
  - roles: a 3-actor team (member, admin, owner) rotates the requesting actor
    per step; the admin-scoped sprint report requested by a member at step 3 is
    requested-but-not-presented (no outcome, no delta) — role permission
    enforcement is HOST authority exercised at presentation, and the deferral
    completes at step 8 when an admin requests it (the
    deferred-then-completed arc);
  - workflow context: the active workflow rotates standup → sprint → approvals
    → retro → sprint; only workflow-appropriate actions are eligible (a
    mechanical matrix, re-checked per step — zero violations; emergency
    time-critical interrupts are cross-workflow by nature) and the workflow
    rides the opaque `contextId` (`ctx-l15-{step}-wf-{workflow}`);
  - multi-actor objectives: every request declares the account-scoped team
    subject, an explicit tenant `workspaceId`, and the declared versioned team
    reward (task-success 0.5 / interruption-regret 0.3 / custom
    admin-compliance 0.2) — competing actor objectives ride the standard
    decision request (the SIM-003 reward surface; 8/8 steps declared);
  - the production-outage alert at step 7 INTERRUPTs the retro board
    (checkpoint retained); the admin's approval-queue pass at step 5 is a
    conversion (3 approvals cleared).
- Verdict: **Reckon-Complete** (12/12 satisfied, fixture evidence) — the wave's
  complete level.

### Level 16 — Enterprise workflow orchestration (`level-16-enterprise-workflow.ts`)

- Profile `profile-l16-enterprise-workflow` (14 required): the standard set +
  `plan-management` + `evidence-retrieval`.
- World transitions:
  - approvals: the purchase-order chain gates actions — submit → manager
    approval → director approval (high value) → budget check → payment dispatch
    (7 chain states in the canonical run; the gates ride the request's
    policy-rights constraint);
  - long-lived plans: two CONCURRENT plans (`plan-l16-procurement-1` and
    `plan-l16-vendor-1`) interleave lanes (procurement: 7 steps, vendor: 3
    steps); every request couples to its lane's plan via `planId`;
  - concurrency without double-acting: the action-claim registry gives every
    executed action exactly one claiming plan; the step-7 budget check is a
    SHARED action claimed once by the procurement lane with the vendor lane's
    need merged; the step-9 re-plan proposes re-submission of claimed
    uncompensated actions (po-submit, the failed dispatch) and the double-act
    guard BLOCKS them (2 blocks recorded); the compensated dispatch re-executes
    exactly once at step 10;
  - audit: every step lands in the append-only audit ledger with decision
    linkage (decisionId + outcome event id + lane plan; 10 entries);
  - compensation: the scripted bank-verification failure at step 8 fails the
    dispatch; the step-9 compensation emits an append-oriented CORRECTION
    outcome (correctsEventId → the step-8 dispatch event) that compensates the
    failed dispatch — unlocking its re-execution — and the step-10 retry
    DISPATCHES successfully (conversion; the recovered workflow completes).
- Verdict: **partial (two honest partials)** — `plan-management`
  `partial`/`COMPOSITION_GAP` (fifth domain of the standing candidate) and
  `evidence-retrieval` `partial`/`COMPOSITION_GAP` (the THIRD domain after
  levels 12 and 13 — the trigger entry).

## Canonical Wave C evidence (machine-generated — the doc-drift gate)

The tables below are regenerated by `runCanonicalLadderWaveC()` and compared
byte-for-byte against this document by `tests/conformance/fixtures/ladder-wave-c.test.ts`
(the doc-drift gate). If the harness, levels, or fixtures change, the gate fails
until this section is regenerated — documented numbers can never silently drift
from the measured ones.

Canonical fixtures (`LADDER_WAVE_C_FIXTURES`): seeds 2113/2114/2115/2116, steps
7/9/8/10, faultRate 0, maxRetries 2, clock {startMs 0, stepMs 1000}, fresh host
factories, scripted fixture responder (`createFixtureReckonPort`).

<!-- sim-005:wave-c:evidence:begin (machine-generated — regenerate via @reckon/simulation runCanonicalLadderWaveC) -->
| Level | Host adapter | Glue (fn/LOC/adapter LOC) | API ops | SDK methods | First decision (step/ms) | Full loop (step/ms) | p50/p95 (ms) | Samples | Failures (cnt/retry/exh) | Capability coverage | Evidence | Reckon-Complete |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 13 | adapter-l13-healthcare-1 | 11/503/121 | 6 | 6 | 1/382 | 1/438 | 27/49 | 36 | 0/0/0 | 12/13 (0.923) | fixture | NO |
| 14 | adapter-l14-education-1 | 12/555/169 | 6 | 6 | 1/370 | 1/446 | 26/47 | 51 | 0/0/0 | 12/13 (0.923) | fixture | NO |
| 15 | adapter-l15-b2b-saas-1 | 12/509/145 | 6 | 6 | 1/348 | 1/398 | 22/45 | 42 | 0/0/0 | 12/12 (1.000) | fixture | YES |
| 16 | adapter-l16-enterprise-workflow-1 | 10/588/129 | 6 | 6 | 1/441 | 1/486 | 22/48 | 56 | 0/0/0 | 12/14 (0.857) | fixture | NO |
<!-- sim-005:wave-c:evidence:end -->

<!-- sim-005:wave-c:gaps:begin (machine-generated) -->
| Level | Capability | Friction | Detail |
|---|---|---|---|
| 13 | evidence-retrieval | COMPOSITION_GAP | the provenance/consent audit ledger needs decision/outcome linkage retrieval; the public SDK exposes decision lookup (GET /v1/decisions/{id} via decisions.get), but the SIM-001 harness port composes only the six standard-loop operations — evidence retrieval is not reachable through the composed harness path, so the provenance ledger stays host-side, second domain after Wave B level 12 |
| 14 | plan-management | COMPOSITION_GAP | the long-horizon curriculum plan (assign → assess → unlock → remediate) is host-owned; decisions couple to the plan via DecisionRequest.planId and ScheduleDelta.planId and the SDK/API exposes plans.create/replan/get, but the SIM-001 harness port composes only the standard decision loop — plan CRUD is not reachable through the composed harness path, fourth domain of the SIM-003/Wave-B finding after levels 5, 8 and 9 |
| 16 | plan-management | COMPOSITION_GAP | the long-lived concurrent plans (procurement + vendor lanes) are host-owned; decisions couple to each lane's plan via DecisionRequest.planId and ScheduleDelta.planId and the SDK/API exposes plans.create/replan/get, but the SIM-001 harness port composes only the standard decision loop — plan CRUD is not reachable through the composed harness path, fifth domain of the SIM-003/Wave-B finding after levels 5, 8, 9 and 14 |
| 16 | evidence-retrieval | COMPOSITION_GAP | the audit ledger needs decision/outcome linkage retrieval; the public SDK exposes decision lookup (GET /v1/decisions/{id} via decisions.get), but the SIM-001 harness port composes only the six standard-loop operations — evidence retrieval is not reachable through the composed harness path, so the audit ledger stays host-side, third domain after Wave B level 12 and Wave C level 13 (the 3-domain trigger entry — recorded as a platformUpgradeCandidate by the frozen scorecard machinery; the upgrade decision belongs to TL3) |
<!-- sim-005:wave-c:gaps:end -->

<!-- sim-005:wave-c:scorecard:begin (machine-generated) -->
- scorecardId: `scorecard-sim-005-wave-c`
- runCount: 4; distinctHosts: 4; distinctLevels: 4
- medianGlueLoc: 509; p95GlueLoc: 588
- medianFirstDecisionMs: 370; medianFullLoopMs: 438
- medianLatencyP50Ms: 22; p95LatencyP95Ms: 49
- meanCapabilityCoverageRatio: 0.926
- totalFailures: 0; totalRetries: 0
- recurringGaps (this wave only): evidence-retrieval|COMPOSITION_GAP (domains 13+16, runs 2, platformUpgradeCandidate false); plan-management|COMPOSITION_GAP (domains 14+16, runs 2, platformUpgradeCandidate false)
<!-- sim-005:wave-c:scorecard:end -->

## The cross-wave 3-domain analysis through Wave C (the ladder law, machine-checked)

`crossWaveRecurringGapsThroughWaveC` composes the canonical Wave A records
(levels 1–4, SIM-002), the SIM-003 integration-case records (levels 5–8), the
Wave B canonical records (levels 9–12, SIM-004) and the Wave C canonical records
(levels 13–16, SIM-005) — 36 records, 16 distinct domains, all fixture-class —
and groups every record gap by (capability, friction) across DISTINCT ladder
levels using the SAME frozen scorecard machinery (the union-compatible
aggregation: Wave C records join Waves A+B additively — the Waves A+B entries
keep their domains and run counts, asserted in
`packages/simulation/test/cross-wave-through-wave-c.test.ts`). The register below
is the honest trigger list (doc-drift gated on the same test):

<!-- sim-005:cross-wave:begin (machine-generated — regenerate via @reckon/simulation crossWaveRecurringGapsThroughWaveC over the canonical Wave A + SIM-003 + Wave B + Wave C records) -->
| Capability | Friction | Domains (ladder levels) | Domain count | Run count | Platform-upgrade candidate |
|---|---|---|---|---|---|
| ad-memory | COMPOSITION_GAP | [6] | 1 | 1 | false |
| context-snapshots | API_GAP | [2, 4, 10] | 3 | 3 | TRUE |
| decision-retrieval | COMPOSITION_GAP | [7] | 1 | 1 | false |
| evidence-retrieval | COMPOSITION_GAP | [12, 13, 16] | 3 | 3 | TRUE |
| plan-management | COMPOSITION_GAP | [5, 8, 9, 14, 16] | 5 | 5 | TRUE |
<!-- sim-005:cross-wave:end -->

The three candidates are recorded, NOT actioned: upgrading the platform
primitives (a public ContextSnapshot ingestion route; mounting the plan routes
and decision/evidence retrieval on the composed path) requires Architecture
Change Records and contract evolution — TL3's call, per the frozen-contract law.
SIM-005 ships zero contract churn by design.

## Friction ledger (per level, named)

Categories are the frozen 11-member vocabulary. Profile-mechanical gaps (the
verdict's `gaps`) are marked MEASURED; observational findings from building the
levels are marked FINDING (they inform TL3 but are not verdict gaps).

| Level | Category | Kind | Named gap / note |
|---|---|---|---|
| 13 | COMPOSITION_GAP | MEASURED | `evidence-retrieval` partial — the provenance/consent audit ledger needs decision/outcome linkage retrieval, not reachable on the composed harness path (second domain after level 12) |
| 13 | RIGHTS_POLICY_BOUNDARY | FINDING | consent scopes and the clinical safety board are HOST authority (ADR-003) — Reckon must never own consent or safety gates; working as designed |
| 14 | COMPOSITION_GAP | MEASURED | `plan-management` partial — the long-horizon curriculum plan is not manageable through the composed harness path (fourth domain of the standing candidate) |
| 14 | HOST_RESPONSIBILITY | FINDING | the curriculum DAG, mastery thresholds and assessment delays are host-owned by architecture — working as designed, not a gap |
| 15 | — | — | none — the level is Reckon-Complete: roles, workflow context and multi-actor objectives are exercised as host authority + standard-loop declarations (the wave's complete level) |
| 15 | HOST_RESPONSIBILITY | FINDING | role permissions and workflow eligibility are HOST gates exercised at presentation/retrieval — the platform offers no second policy engine, by law |
| 16 | COMPOSITION_GAP | MEASURED | `plan-management` partial — the concurrent long-lived plan lanes are not manageable through the composed harness path (fifth domain of the standing candidate) |
| 16 | COMPOSITION_GAP | MEASURED | `evidence-retrieval` partial — the audit ledger needs decision/outcome linkage retrieval (THIRD domain: the 12+13+16 trigger entry recorded by this wave) |
| 16 | HOST_RESPONSIBILITY | FINDING | the approval chain, the action-claim registry (no double-acting) and the compensation engine are host-owned orchestration authority — working as designed |
| all | OBSERVABILITY_GAP | FINDING | every canonical run is `fixture`-class evidence (scripted responder); no level claims controlled-local/staging/production proof |

## Determinism, replay, and laws

- Determinism proof: same seed + fresh host factory ⇒ byte-identical records —
  asserted per level in `packages/simulation/test/levels-wave-c.test.ts`
  (canonical JSON equality of record + call log + verdict), for the whole wave
  in `tests/conformance/fixtures/ladder-wave-c.test.ts`, and for the composed
  cross-wave register in
  `packages/simulation/test/cross-wave-through-wave-c.test.ts`.
- Replay gates: `replaySimulationRun` reproduces byte-identical records from
  `replayInputs` for all four levels (the adapter-side replay gate).
- Zero-internal-access proof: the levels and the conformance fixtures import
  only `@reckon/contracts`, `@reckon/sdk` and the `@reckon/simulation` harness
  surface — mechanically enforced by
  `tests/conformance/zero-internal-access.test.ts` (the SIM-001 scanner scans
  `packages/simulation/src/**` — including the new `level-13..16-*.ts` and
  `wave-c.ts` — and `tests/conformance/fixtures/**`, including the new
  ladder-wave-c gate), and re-asserted per level on the effort records
  (`internalImports === 0`) by the doc-drift gate.
- Determinism tokens: the SIM-001 token scan covers `harness/**` + conformance
  fixtures, and `packages/simulation/test/levels-determinism-scan.test.ts`
  covers `src/levels/**` (now 12 level modules — count updated 8 → 12); no
  wall-clock, no `Math.random`, no LLM/network anywhere in simulation logic —
  time is the injected `SimClock`, randomness is the seeded RNG, SDK ids come
  from `createDeterministicIdGenerator`.
- Evidence honesty: every synthetic outcome is `evidenceClass: "fixture"` and
  can never become observed evidence; the wave scorecard and the cross-wave
  register aggregate fixture-class evidence only; profiles with a
  `production-observed` floor are honestly incomplete (OBSERVABILITY_GAP) —
  asserted for all four levels.
- Glue honesty: each level's declared `glue.loc` equals a mechanical recount
  (comment-stripped, non-blank lines) of its module source,
  `customAdapterLoc` equals the recount inside the `glue:adapter` markers
  (re-verified by `packages/simulation/test/levels-wave-c.test.ts`).
- Architecture laws: no second ranking/policy/scheduler was created — all
  ladder complexity (consent/safety gates, curriculum DAG, role matrix,
  approval chain, concurrency guard, compensation engine) is host-owned;
  identity/catalog/rights/delivery authority stays with the hosts; synthetic
  outcomes never masquerade as observed.

## Honest limitations

1. Fixture evidence only — the scripted responder proves host-side wiring and
   contract parity, not a live deployment. Higher evidence classes need a real
   port (controlled-local via an in-process API, staging, production-observed).
2. The fixture responder's decision policy is scripted (candidate-source-driven
   actions: QUEUE/CONTINUE/SWITCH/INTERRUPT); it does not evaluate the declared
   constraints or rewards — constraint/reward *declaration* and host-side
   *gating* are measured, enforcement belongs to the real decision kernel.
3. The synthetic worlds follow scripted deterministic patterns (the consent
   denial at step 4, the safety veto at step 6, the below-threshold A2
   assessment at step 7, the role deferral at step 3, the bank failure at step
   8). These are fixture-class behaviors chosen to exercise world-state
   transitions — not behavioral claims.
4. The delayed-outcome mechanic at Level 14 emits the matured assessment's
   completion outcome at the maturation step referencing the earlier ASSIGNMENT
   decision; the harness surfaces exactly one outcome per step, so at most one
   assessment matures per step in the canonical script (two pending assessments
   honestly remain un-matured at run end).
5. The cross-wave register composes CANONICAL records (Wave A 4 + SIM-003 24 +
   Wave B 4 + Wave C 4 = 36); ensemble seeds would multiply run counts but not
   domain counts — the law counts DISTINCT domains.
6. `glue.functions` on the level side is host-declared (a listed inventory in
   each module header); `loc`/`customAdapterLoc` are machine-recounted.
7. The `evidence-retrieval` trigger at {12, 13, 16} is a COMPOSED-PATH finding
   (the SDK seam exists and validates); it does not measure a live deployment
   of a retrieval route — the upgrade decision belongs to TL3.

## Reproducing

```
pnpm --filter @reckon/simulation test   # levels-wave-c + cross-wave-through-wave-c + prior batteries
npx vitest run tests/conformance        # Wave C conformance + doc-drift gate + SIM-001 scanner
```

The canonical tables above regenerate from `runCanonicalLadderWaveC()`
(`packages/simulation/src/levels/wave-c.ts`) and the cross-wave register from
`crossWaveRecurringGapsThroughWaveC({waveALevels, sim003IntegrationCases,
waveB, waveC})` over the canonical Wave A + SIM-003 + Wave B + Wave C records.
