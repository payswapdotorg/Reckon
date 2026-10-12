# ADR-005 — Personal Ad Memory and Ad Query Contracts

**Status:** ACCEPTED / FROZEN

**Work item:** AD-001 (owner TL3; base SHA `da13f05`)

## Context

The Personal Ad Memory / Ad Query product lane (TL6-FINAL-HANDOFF.md)
adds a user-controlled advertising memory to Reckon:

`Ad → Ad Memory → Retrieval Query → Candidate Resolution → Decision → Experience → Schedule → Outcome`

`packages/contracts` is frozen (CONTRACT-001): every change requires an
Architecture Change Record. The ad lane needs new public contracts for
the canonical memory object, retention, provenance, permission state,
forget/expiry semantics and query request/results — while the existing
advertising vertical already runs through the frozen normalized
contracts via the W3-008 reference adapter (`packages/integrations/src/advertising.ts`),
which maps creatives → `CatalogItem`/`Realization`, campaign rows →
`CandidateSet`, serving reports → observed `OutcomeEvent`s, and
show/defer/interrupt decisions through the EXISTING scheduler actions.

## Decision

Add `packages/contracts/src/ads.ts` as a **purely additive** extension
of the frozen contracts (exported via one new line in `src/index.ts`;
five new generated JSON Schema targets in `src/export-json-schemas.ts`).
No existing exported shape changes; the eleven pre-existing generated
schema files are byte-identical after regeneration. New contracts live
in the `reckon.ad-*` family at version `0.1.0`.

The frozen contract set:

- **`AdMemoryRecord`** (`reckon.ad-memory-record`) — the canonical
  Personal Ad Memory object: tenant + opaque subject scope, the ad as
  an `AdCatalogItem` (CatalogItem narrowed to `kind: "advertising"`),
  realizations, host-owned `AdLineage` (source/advertiser/campaign/
  creative), retention, permission state, provenance, rights
  constraints, deterministic `contentDigest` and derived `recordId`
  (`admem-` + digest prefix; helpers `adMemoryRecordDigest`,
  `adMemoryRecordId`, `finalizeAdMemoryRecord` make writes
  deterministic and idempotent for AD-002).
- **Retention** — discriminated union on `state`:
  `active` / `expired` / `forgotten`. **Every member requires an
  explicit `basis`** (`AdRetentionBasis`:
  `explicit-user-consent` | `host-retention-policy` |
  `host-contractual-term` | `legal-obligation`). `forgotten` is
  terminal and requires `forgottenAt`; `expired` requires `expiresAt`.
- **Provenance** — unconfusable discriminated union (law 9):
  `observed-encounter` (requires `AdEncounterEvidence`, observed
  evidence classes only) vs `provider-supplied` (requires
  `AdAvailability` — a channel declaration, never an observation).
- **Permission state** — per-record `retain`/`present` grants with
  append-only transition history (`AdPermissionState`,
  `AdPermissionTransition`, pure `applyAdPermissionTransition`).
- **Rights constraints** — `AdRightsConstraints` with
  `redistributionPermitted` **defaulting to false** and host rights
  gates; rights are never inferred from availability
  (architecture-lock #23).
- **Value separation** — `AdUserValueAssessment` and
  `AdCommercialValueAssessment` as separate optional candidate fields;
  commercial value is a declared input, never a ranking authority.
- **Eligibility** — `AdEligibility` (flight window, surfaces, gates,
  opaque host frequency policy) with `adEligibilityToConstraints`
  projecting the portable parts onto the EXISTING `HardConstraint`
  vocabulary (`time-window`, `policy-rights`).
- **Query contracts** — `AdQueryRequest` (modes
  `remembered`/`available`/`both`, structured filters, REQUIRED
  caller-supplied clock `at`) and `AdQueryResult` (remembered and
  available candidates in **separate arrays**, mode consistency
  enforced on parse, disclosed `queryUnderstanding` including model
  provenance). `RememberedAdCandidate` embeds only structurally-active
  records (`RetrievableAdMemoryRecordSchema`); `AvailableAdCandidate`
  carries provider availability, rights and an optional memory link.
  Every ad candidate carries `advertising: true` as a literal.
- **Forget contracts** — `AdForgetRequest` (record/item/advertiser/all
  targets) and `AdForgetResult`.
- **Candidate resolution** — `adCandidatesToCandidateSet` maps both
  lanes into the EXISTING `CandidateSet` consumed by
  `DecisionRequest`. Retrieval hints (`rankHint` positional,
  `scoreHint` from `whyRetrieved`) are hints, never decisions.

### No parallel ad-ranking contract

AD-001 deliberately does NOT define an ad ranking/reward contract. Ad
candidates resolve into the existing `CandidateSet → DecisionRequest →
Experience → Scheduler` path; the Reckon decision kernel remains the
single ranking authority (AD-004; "no second recommendation
authority"). Ad-specific gates project onto the existing
`HardConstraint` vocabulary instead of a parallel constraint system.

### Model/provider boundary

Semantic query understanding, semantic retrieval and ad-content
understanding may use models BEHIND the existing model adapter seam
(ADR-002) and must be disclosed per result (`queryUnderstanding.modelProvenance`,
per-candidate `whyRetrieved` kinds such as `semantic-match`). Models
must not become a hidden identity authority, policy engine, scheduler,
or ranking authority. The fast path remains deterministic where
practical; no LLM is required for correctness of these contracts.

## Ad-memory privacy law mapping (all ten, explicit)

| # | Law | Enforcement |
|---|-----|-------------|
| 1 | Retention requires an explicit basis | Structural: `basis` required in every `AdRetention` union member (parse error without it); machine-checked in the generated JSON Schema artifact (test suite asserts every `anyOf` member requires `basis`). |
| 2 | Forget means unretrievable | Structural: `forgotten` terminal + requires `forgottenAt`; `RememberedAdCandidate` embeds only active records; runtime gate `isAdMemoryRetrievable` false for forgotten. No un-forget transition exists in the contracts. |
| 3 | Expired ≠ currently available | Structural: expired records cannot be remembered candidates; runtime gates `isAdMemoryRetrievable` (retention expiry vs query clock `at`), `isAdAvailableAt`, `isAdCandidateCurrentlyAvailable` (ad + candidate windows). |
| 4 | Encounter is not a redistribution license | Structural: `redistributionPermitted` defaults to false (asserted in the generated artifact); rights never inferred from availability (architecture-lock #23); verification stays with host rights gates. |
| 5 | No silent raw location/attention persistence | Structural: `AdEncounterEvidence` references context by id only (`ContextReferenceSchema`); no location/attention/sensor field exists; unknown keys are stripped on parse (test-verified). |
| 6 | No inferred sensitive attributes for advertising | Structural: no inference/audience-attribute field on `AdMemoryRecord`; derived learning state belongs to `PreferenceDelta` (existing primitive with its own provenance/confidence discipline). Process rule (ADR-003) still binds hosts/adapters. |
| 7 | User value separate from advertiser commercial value | Structural: `userValue` and `commercialValue` are separate fields with distinct schemas; no blended ad value exists; commercial value is never a ranking authority. |
| 8 | Advertising stays explicitly identifiable | Structural: `advertising: true` literal on every ad candidate; `AdCatalogItemSchema` narrows `kind` to `"advertising"` (const in the generated artifact). |
| 9 | Remembered vs provider-supplied provenance | Structural: `AdProvenance` discriminated union with disjoint members; query results keep the two lanes in separate arrays; mode consistency enforced on parse; distinct candidate sources in the CandidateSet mapping. |
| 10 | Same evidence classes as the rest of Reckon | Structural: encounter evidence accepts only `OBSERVED_EVIDENCE_CLASSES` (from outcomes.ts); simulated/counterfactual/fixture encounters are parse errors (architecture-lock #20). |

## Consequences

**Positive**

- AD-002 (persistence), AD-003 (retrieval), AD-004 (contextual
  selection) and AD-005 (UX) can proceed in parallel against a frozen
  contract surface, per the parallelization rule.
- The ten ad-memory privacy laws are machine-checkable (63 new tests
  in `packages/contracts/test/ads.test.ts`, including assertions over
  the generated JSON Schema artifacts).
- Deterministic digests/ids make AD-002 writes idempotent and
  replayable without a central id authority.
- The ad lane composes with W3-008 instead of competing with it: both
  feed the same `CandidateSet`/decision path.

**Negative / accepted costs**

- `AdMemoryRecord` is a wide object (full ad snapshot + realizations +
  governance state). This is deliberate: memory records must remain
  self-describing for audit, forget and export even if the host catalog
  changes.
- The zod parse is authoritative; the generated JSON Schema is a lossy
  projection (cross-field refinements such as query-mode consistency
  and the `prefault` filter default do not fully survive projection).
  Consumers validating with JSON Schema alone get a weaker check than
  consumers parsing with zod.
- Record cardinality is not forced by the contract: the digest covers
  the full content payload, so a re-encounter with new evidence yields
  a new record id unless AD-002 adopts a (subject, itemId) upsert
  policy. This is documented freedom for AD-002, not an oversight.
- Retention-basis vocabulary is closed; host products needing a novel
  basis require a contract change (a new ADR). This is the intended
  friction for a privacy-critical enum.

## Evidence

- OBSERVED: `pnpm --filter @reckon/contracts build` / `test` /
  `pnpm run generate:schemas` green on `work/ad-001-contracts`;
  156/156 contracts tests (63 ad-specific) pass; the 11 pre-existing
  generated schema files are byte-identical after regeneration
  (git status shows only 5 new schema files).
