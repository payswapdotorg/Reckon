# Contextual Ad Selection + Format/Timing Integration — AD-004 Design Note

Status: DELIVERED WITH AD-004 (this note)

Owner: W2 (AD-004)

Contracts: FROZEN with AD-001 (`packages/contracts/src/ads.ts`, ADR-005 —
ZERO contract edits in AD-004; `git diff --stat <rail>..HEAD --
packages/contracts` is 0 lines). Retrieval: AD-003
(`docs/architecture/ad-retrieval.md`). Persistence: AD-002
(`docs/architecture/ad-memory-store.md`). This note documents the
INTEGRATION: how ad candidates flow through the EXISTING decision,
experience, scheduler and outcome kernels — no second ranking, no second
policy, no second scheduler (architecture lock; "do not create a second
ranking, policy or scheduler").

## The integration surface (one pipeline, one law)

```
 reckon.ads.query (AD-003)  ──►  AdQueryResult (remembered | available)
        │
        ▼  buildAdBearingCandidates (SDK, AD-004)  ── or any host mapping
        │  using the frozen AD_CANDIDATE_SOURCES vocabulary
        ▼
 DecisionRequest.candidates  ──►  ONE CandidateSet (organic + ad
        │                          candidates; ads are ordinary
        │                          candidates carrying provenance)
        ▼
 THE kernel chain (unchanged): normalize → expand → policy → decide
        │        ▲ ad-lane catalog truth (items / realizations /
        │        │ projected per-item constraints) resolved by the
        │        │ composition's AdSelectionSource at the REQUEST clock
        ▼
 DecisionResult (ad experience selected/queued/suggested with format,
        │  timing, alternatives, reasons, provenance)
        ▼
 host presents → OutcomeEvent (impression) → POST /v1/outcomes
        │
        ▼  AdEncounterCapture (AD-004 composition; observed classes only)
        ▼
 Personal Ad Memory (AD-002 store port) → later queryAds (AD-003) → …
```

## 1. Ad-candidate selection through the EXISTING decision kernel

**Declaration.** Hosts declare ad candidacy by including ad candidates
in the `DecisionRequest` candidate set, using the frozen ad-lane source
vocabulary (`reckon.ad-memory.remembered` /
`reckon.ad-availability.current` — the same sources the contracts'
`adCandidatesToCandidateSet` emits). The SDK's `buildAdBearingCandidates`
(`packages/sdk/src/ad-selection.ts`) builds the merged set from an
AD-003 `AdQueryResult` + the organic set: it gates both lanes at the
caller-supplied selection clock (law 3 — remembered ads must pass
`isAdAvailableAt`, provider-supplied ads `isAdCandidateCurrentlyAvailable`),
maps gated-in ads with EXACTLY the frozen mapping's semantics (positional
`rankHint`, best-reason `scoreHint` — hints, never decisions), collects
the ad items/realizations, and projects declared eligibility onto
per-item hard constraints (`adEligibilityToConstraints`). Building a set
from nothing throws the frozen contract's own typed error
(CandidateSet `min(1)`).

**Truth resolution.** The production decision handler
(`createRuntimeDecisionHandler`, apps/api/src/composition.ts) resolves
ad-lane catalog truth for DECLARED ad candidates only — through the
`AdSelectionSource` port (`apps/api/src/ad-selection.ts`), which reads
the SAME two seams the /v1/ads routes read (the AD-02 memory store port
+ the composed availability channels) at the request's caller-supplied
clock. Catalog truth wins; ad-lane truth fills gaps (deterministic).
Requests with no ad candidates are byte-identical to the pre-AD-004
path. An ad candidate with no resolvable truth anywhere falls to the
normalizer's honest-absence law (`no-catalog-item`) — never invented.

**One pipeline proof points** (tests: `apps/api/test/ad-selection.test.ts`,
`apps/api/test/ad-decisions.test.ts`):

- POLICY PARITY: an ad experience and an organic experience carrying
  IDENTICAL declared evidence score IDENTICALLY in `evaluatePolicy`
  (same reward-term value ⇒ same score); with no declared evidence both
  are 0 with uncertainty disclosure. There is no ad-specific scoring
  anywhere in the chain.
- Determinism: identical inputs → identical policy order and scheduler
  decisions; `decisionId` is a pure digest of the request.
- Availability gating at the SELECTION clock complements the query
  clock (a host that queried at t1 and decides at t2 gets t2 gating —
  `selectAdCandidacy` notes the closed windows honestly).

**User value vs commercial value (law 7).** Declared ad USER value
bridges into the policy engine's EXISTING per-experience declared-value
channel: the SDK's `adUserValueRewardTerm` builds a `RewardTerm` whose
`params.values` keys the RESOLVED ad experience ids (from
`reckon.experiences.resolve`) to the declared user-value scores. The
host merges the term into their request's reward spec; the composition
passes the request's reward through VERBATIM (see Design Notes — the
one-line composition fix). Commercial value has NO ranking path by
design.

## 2. Ad format/timing through the EXISTING experience + scheduler kernels

**Format/placement.** Ad formats are experience attributes on the ONE
expansion surface: a realization declaring
`constraints: { formats: ["banner", "in-feed", "interstitial"] }`
expands to one experience variant per format (W2-003 unchanged).
`formatParams`, `durationSeconds`, `deviceClasses`, `requiresScreen`,
`minBandwidth` all ride the documented realization vocabulary.

**Per-ad constraints.** The ONE kernel edit AD-004 makes (disclosed
below): `ExpandInput.itemConstraints` — per-ITEM hard constraints,
keyed by itemId, stamped onto every expanded experience of the item
(the frozen per-experience constraint surface, which the policy engine
re-applies in its defense-in-depth pass) and gated at expansion with
the same kernel-evaluable kinds and fail-closed semantics as request
constraints. Ad eligibility projects onto it: flight window →
`time-window`, gates → `policy-rights` (opaque/host-evaluated kinds
ride verbatim for host-side enforcement); bumper policies
(`max-duration: 6s`) are KERNEL-ENFORCED (tested: a 30s interstitial is
excluded with a typed reason while the 5s banner survives). Lanes union
their projections — two `time-window` constraints AND together (the
honest intersection of both lanes' windows).

**Timing windows.** Ad availability windows ride the item's
`availableFrom`/`availableUntil` → the experience's frozen
`timing.earliestMs/latestMs` (existing expander behavior, unchanged),
PLUS the `time-window` constraints above. SCHEDULER_GAP-1 (recorded):
the scheduler kernel does not evaluate `Experience.timing` windows when
choosing QUEUE/SUGGEST/SWITCH/CONTINUE targets — enforcement stays
host-side for ALL experience kinds (pre-existing behavior; ads inherit
it honestly rather than getting an ad-specific timing gate).

**Defer/queue.** The scheduler's existing actions carry ad timing:
balanced policy → the best ad candidate is QUEUEd from idle (defer,
never auto-play); mindful policy → SUGGEST (an ad never implicitly
consumes attention); CONTINUE from `queued` dequeues the ad as plan
head.

**Interruption.** Switching TO an ad flows through the existing switch
evaluator + interruption policy (numbers caller-supplied — SEPARATION
LAW): a net-positive switch is emitted when the interruption
opportunity is present; the SAME switch is GATED to CONTINUE when the
moment is wrong (attention exhausted / fatigue / non-interruptible
format); host-requested INTERRUPT checkpoints the organic experience
(RESUME LAW). Fatigue/attention gates evaluate ad-bearing moments
exactly like organic ones — one policy (`ad-format-timing.test.ts`).

**Pacing/frequency.** Frequency capping and pacing stay HOST-side
(`AdEligibility.hostFrequencyPolicy` is opaque by law — W3-008
host-authority; Reckon never enforces frequency caps or brand safety).
The kernel's fatigue/attention signals are the only kernel-side pacing
input (SCHEDULER_GAP-2, disclosed).

## 3. Provenance + memory round-trip

Observed outcome events for ad experiences flow back through the
EXISTING outcomes surface; the composition's `AdEncounterCapture`
(`apps/api/src/ad-memory-capture.ts`) writes Personal Ad Memory through
the AD-002 store port:

- The capture policy is DEPLOYMENT-DECLARED and never defaulted (law 1:
  an explicit retention basis is required — `adMemoryCapture.policy`).
- The evidence is the observed outcome event itself (law 9: provenance
  `observed-encounter`, `outcomeEventId` + `evidenceClass` +
  `encounteredAt` from the event); context rides the event's own
  `ContextReference` VERBATIM (law 5 — no raw context exists to
  persist).
- LAW 10: only observed evidence classes are captured — simulated /
  counterfactual / fixture events are typed skips (tested against PG).
- The memory write's idempotency key is the event's own — replays
  replay the same write (store-level duplicate).
- The default resolver maps the event's `experienceId` to the ad by
  computing the SAME deterministic id the expander emits
  (`experienceIdFor` over realization × format-kind — never a second id
  scheme) against current memory + channel supply, UNGATED by
  availability (an impression of a window-closed ad is still a
  legitimate encounter — memory ≠ availability). Channel-supplied
  encounters carry the channel identity as lineage source.
- Capture is best-effort AFTER the outcome is durable (a capture
  failure is logged, never fails the outcome); consent/retention laws
  stay at the AD-002 boundary (present/retain gates, terminal forget,
  re-encounter-after-forget = new record — all tested).

## 4. API/SDK integration surface (additive)

- **decisions route**: UNCHANGED (the frozen `DecisionRequest` already
  accepts ad candidates + a context reference; ad truth resolution is
  composition-level). Responses carry ad experiences with the frozen
  result's provenance/explainability.
- **experiences/resolve**: the API-level envelope gains ONE optional
  field, `itemConstraints` (composed only from frozen schema objects —
  `z.record(IdSchema, HardConstraintSchema.array())`), mirroring the
  decision path's per-item constraint surface. The SDK's
  `ResolveRequestSchema` mirror gains the same field.
- **SDK**: `buildAdBearingCandidates` + `selectAdCandidacy` +
  `adUserValueRewardTerm` + `isAdCandidateSource` (pure, over frozen
  contracts; `packages/sdk/src/ad-selection.ts`). Naming follows the
  existing helper conventions (`generateWebhookSigningSecret`,
  `createInjectFetch`).
- **Composition** (`buildProductionServer`): the ad-selection source is
  always wired (activates only for ad-bearing requests);
  `adMemoryCapture` is opt-in (policy-declared).

## Kernel-edit disclosure (the one)

`packages/experience/src/expand.ts` (W2-003) — TWO additive changes,
zero behavior change when unused (the full pre-existing suite passes
byte-identically):

1. `ExpandInput.itemConstraints?: Readonly<Record<itemId, readonly
   HardConstraint[]>>` — per-item constraints, validated through
   `HardConstraintSchema`, stamped onto the experience's own frozen
   `constraints` field and gated at expansion (request constraints
   first, then the item's — documented order).
   JUSTIFICATION: the frozen contract HAS a per-experience constraint
   surface (`Experience.constraints`, evaluated by the policy engine's
   defense-in-depth pass), and ADR-005 explicitly projects ad
   eligibility onto it — but the expander had NO input path to populate
   per-item constraints, so per-ad constraints (flight windows, rights
   gates, bumper durations) could not ride the decision path at all.
   The alternative (post-expansion stamping in composition) would
   violate the expander's own law that emitted experiences are complete
   `Experience` records by construction.
2. `experienceIdFor` exported — so compositions compute the SAME
   deterministic experience id the expander emits (the capture
   resolver's experienceId→ad inversion and any reward-term builder
   need it; a private copy would be a second id scheme).

No change to `packages/decision` or `packages/scheduler`.
`packages/contracts` is untouched (0-line diff, cited in the report).

## Honest limitations

- The scheduler does not enforce `Experience.timing` windows
  (SCHEDULER_GAP-1) — host-side enforcement for all kinds, ads
  included; the windows ride both `timing` and `time-window`
  constraints for hosts that enforce.
- Frequency capping / pacing / brand safety stay host-evaluated
  (SCHEDULER_GAP-2 by design — W3-008 host-authority law).
- The default encounter resolver sees CURRENT memory + channel supply;
  a forgotten-and-unsupplied ad cannot be auto-captured (hosts with
  their own registries substitute a resolver).
- Remembered-lane records carry no eligibility declaration (the frozen
  `AdMemoryRecord` has no eligibility field) — remembered ads project
  no per-item constraints; available-lane supply carries them.
- Ad `userValue` reaches scoring only through the host-declared reward
  channel (the documented bridge); there is no automatic userValue →
  score injection.

## Gap findings (recorded, not worked around)

- **SCHEDULER_GAP-1**: no kernel-side `Experience.timing` window
  enforcement when selecting/queueing targets (all experience kinds;
  pre-existing). An additive scheduler timing gate is a kernel policy
  change — TL3 decision.
- **SCHEDULER_GAP-2**: no kernel-side ad frequency/pacing capability
  (host-authority by law; intentionally not a gap to close in Reckon).
- **CONTRACT_GAP-2**: `DecisionRequest` cannot carry per-candidate ad
  metadata (userValue/commercialValue live on the `AdQueryResult`, not
  the decision path) — the SDK reward-term bridge is the documented
  composition; commercial value has no ranking path by design (law 7).
- **API_GAP-3**: no server-side compound "decide-with-ads" route (a
  route accepting an `AdQueryResult` would need a new frozen contract —
  TL3 decision); hosts merge candidate sets client-side via
  `buildAdBearingCandidates`.
- **UX_DX_GAP-2**: `itemConstraints` on the resolve envelope is an
  API-level field (`reckon.api.resolve-request` — same TL3-flagged
  label family as the other api.* envelopes), not a frozen contract id.
- **CONTRACT_GAP-1 / API_GAP-1 / API_GAP-2 / SDK_GAP-1 / UX_DX_GAP-1**
  from AD-003 remain open unchanged.

## Test evidence (controlled-local)

- `apps/api/test/ad-selection.test.ts` — 12 tests: selection gating
  (law 3, both windows), mapping parity with the frozen
  `adCandidatesToCandidateSet`, eligibility projection, merged-set
  building, ONE-pipeline expansion (format variants + provenance),
  POLICY PARITY, the userValue reward bridge, determinism, mindful
  suggestion.
- `apps/api/test/ad-format-timing.test.ts` — 12 tests: format variants
  + placement attributes, timing fields, per-item max-duration
  exclusion (kernel-enforced), request format-forbidden, time-window
  passthrough, QUEUE/SUGGEST/CONTINUE defer semantics, SWITCH with/without
  opportunity, INTERRUPT + checkpoints, interruption-policy fatigue
  gates over ad-bearing plans.
- `apps/api/test/ad-decisions.test.ts` — 6 route tests: ad-bearing
  decisions through the real pipeline (both lanes), context-by-reference
  (law 5), idempotency (replay + 422), clock semantics (window close +
  rewind), honest absence for unresolvable ads, resolve with
  itemConstraints.
- `apps/api/test/ad-memory-roundtrip.test.ts` — 8 tests: the full
  capture→query loop with provenance, law-10 skips, event-type policy,
  unresolvable skips, idempotent replay, present/retain consent gates,
  terminal forget + re-encounter, policy-declared revoked permissions.
- `packages/sdk/test/sdk-ad-selection.test.ts` — 5 tests: SDK
  queryAds→buildAdBearingCandidates→decisions.request round-trip, the
  resolve→reward-term bridge, typed empty-set error, null reward term,
  typed scope errors.
- `apps/api/test/ad-selection-composition.test.ts` — 5 tests over a
  REAL PostgreSQL server (production composition + SDK): full
  selection round-trip, impression→PG-memory capture, law-10 cleanliness
  against PG, terminal forget with the PG tombstone, cross-clock
  selection gating. ICU60 environmental note: this sandbox exposes
  libicuuc.so.76 (not .60); the embedded PG 18 binaries booted and ran
  cleanly — no ICU60 failure observed in this environment.

## Production truth

Everything above is controlled-local evidence. The lane is not
production-accepted until it runs against a real deployed PostgreSQL
endpoint (Gate L, real DATABASE_URL), real availability channels, real
serving surfaces and real retention-basis/consent flows — per AGENTS.md
production-truth rules (AD-006 owns that proof).
