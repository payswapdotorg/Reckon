# @reckon/decision

Decision kernel (Worker 2 lane). Wave 1 (W2-001) implemented
**candidate normalization** and declared the **policy-engine port**.
Wave 2 (W2-002) implements the **policy engine**.

## What is here

- `CandidateNormalizer` port + pure kernel (`normalizeCandidates`):
  provider-neutral normalization of host candidate references into
  `NormalizedCandidate` records for the experience expander (W2-003)
  and the policy engine (W2-002).
- `PolicyEngine` port + implementation (`createPolicyEngine`, and the
  richer `evaluatePolicy` detail API) — pure, deterministic, LLM-free
  scoring of eligible experiences against the declared objective and
  (optionally) a versioned reward spec.

## Laws enforced

- **NO-LLM LAW** (architecture-lock #6): pure deterministic TypeScript;
  zero LLM calls; model adapters are never invoked.
- **HONEST-ABSENCE LAW**: an item without a matching realization in the
  input is normalized with `available: false` (reason
  `no-realization`); a candidate without a catalog item is normalized
  with `available: false` (reason `no-catalog-item`). Availability is
  never invented.
- **Purity and totality**: no environment reads, no async, no
  exceptions on valid input; invalid input (e.g. empty candidates)
  returns a typed `INVALID_INPUT` error result — never a raw throw.
- **CONSTRAINT/REWARD SEPARATION** (lock #21): hard constraints gate
  eligibility (constraint-failing experiences are never scored); reward
  terms only shape preference among eligible experiences.
- **NO DEFAULT ENGAGEMENT REWARD** (lock #22): with no declared
  `RewardSpec`, scores use declared objective-fit evidence only
  (`rewardApplied: false` on the evaluation detail). Engagement is
  never implicitly rewarded.
- **HONEST UNCERTAINTY**: `Uncertainty.confidence` is the real
  evidence-sparsity ratio (present/total evidence channels), never a
  fabricated number; `spread`/`disagreement`/`oodScore` are omitted
  because a single deterministic scorer cannot quantify them.

## Documented deterministic semantics

- **Dedup key**: canonical JSON of the `(itemId, source)` pair.
- **Duplicate merge**: `realizationIds` = union of each duplicate's
  matched realizations; `rankHint`/`scoreHint` take the MAXIMUM of the
  supplied values (strongest host hint; hints are retrieval metadata,
  never decisions).
- **Realization matching**: a candidate with explicit
  `realizationIds` intersects them with the input realizations for the
  item; a candidate with no preference expands to ALL input
  realizations for the item. Matched ids are deduped and sorted.
- **Availability**: `available = item exists in the input catalog AND
  ≥1 matched realization`. Unavailability reasons are typed
  (`no-catalog-item` checked first, then `no-realization`).
- **Input duplicates**: first occurrence wins for duplicate
  `itemId`s / `realizationId`s.
- **Ordering**: `rankHint` descending (absent hints sort last), then
  `itemId` ascending, then `source` ascending — UTF-16 code-unit
  comparisons (locale-independent). The output is permutation-invariant
  (digest-verified in tests).
- **Labels**: from the catalog item, deduped and sorted; `[]` when the
  item is absent.

## The policy engine (W2-002)

`PolicyEngine.score(input)` is the frozen seam (scheduler/composition
roots depend on it). `createPolicyEngine()` implements it;
`evaluatePolicy(input)` additionally returns the evaluation detail:
excluded experiences with typed reasons, `rewardApplied`, policy
selector echo (composition — the seam is unchanged).

Documented scoring semantics:

- **objectiveFit(E)** = `0` when the experience declares a different
  `objectiveFit.objective.objectiveId` than the request objective;
  `fitScore` (clamped to [0,1]) when declared; `0` otherwise (absent
  evidence is never fabricated and lowers uncertainty confidence).
- **rewardScore(E)** = `Σᵢ wᵢ·vᵢ(E) / Σᵢ |wᵢ|` over the terms EVALUATED
  for the experience. Term values come ONLY from declared reward
  params: `params.values` (per-experience map) or `params.value`
  (constant), clamped to [0,1]; unevaluated terms are ignored (never
  guessed) and disclosed via uncertainty. Zero when no term is
  evaluated or the evaluated weight magnitude sum is zero.
- **score(E)** = `objectiveFit(E)` with no reward spec; `½·objectiveFit
  + ½·rewardScore` with a declared reward spec (equal-footing mix).
- **Ordering**: score descending, then `experienceId` ascending
  (UTF-16) — deterministic stable tie-breaking; the output is
  permutation-invariant (digest-verified in tests). Duplicate
  experience ids are a typed `INVALID_INPUT` (tie-breaks require
  unique ids).
- **Defense in depth**: request-level `constraints` AND each
  experience's own `constraints` are re-applied (the same
  kernel-evaluable kinds as W2-003, same fail-closed semantics:
  `min-duration`, `max-duration`, `format-required`,
  `format-forbidden`, `locale-required`, `device-class-required`;
  request-scoped/opaque kinds pass through). Constraint-failing
  experiences are excluded with typed reason codes and messages.
- **Uncertainty**: `confidence` = present evidence channels / total
  channels (1 fit channel + 1 per reward term), `method
  = "policy-engine.evidence-sparsity.v1"`.
