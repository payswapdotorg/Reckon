# @reckon/decision

Decision kernel (Worker 2 lane). First wave (W2-001) implements
**candidate normalization** and declares the **policy-engine port**
(W2-002 — later wave, port only).

## What is here

- `CandidateNormalizer` port + pure kernel (`normalizeCandidates`):
  provider-neutral normalization of host candidate references into
  `NormalizedCandidate` records for the experience expander (W2-003)
  and the policy engine (W2-002).
- `PolicyEngine` port (declared seam, NOT implemented in this wave).

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

## The policy-engine port (W2-002 seam)

`PolicyEngine.score(input)` is frozen here so downstream composition
depends on the seam, not an implementation. `ScoredExperience` is the
canonical scored-experience type consumed by the scheduler (W2-004).
