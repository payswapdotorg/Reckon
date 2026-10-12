# Personal Ad Memory — Architecture and Ad Query Contracts

Status: FROZEN WITH AD-001 (ADR-005)

Owner: TL3

This note is the Ad Memory architecture/design note and the Ad Query
contract documentation required by the TL6 final handoff. Contracts
live in `packages/contracts/src/ads.ts` (see ADR-005 for the decision
record). Everything here composes with the frozen platform path —
`Item → Realization → Experience → Decision → Schedule → Outcome` —
and with the W3-008 advertising reference adapter; nothing here
replaces them.

## Product behavior

The user's Personal Agent may retain advertising experiences the user
is permitted to retain. Later the agent can:

- recall an ad it previously encountered ("Show me the hotel ad I saw last week");
- answer explicit queries about ads ("What laptop ads have I seen?");
- retrieve relevant retained ads ("Find me relevant ads for hotels in Accra");
- retrieve eligible current ads supplied by host/ad providers;
- present a remembered ad in a contextually appropriate format, or
  defer/suppress it when context, attention or constraints say so;
- compare and re-rank retrieved ad candidates through the EXISTING
  Reckon decision kernel.

The user must always be able to distinguish remembered ads from newly
retrieved/provider-supplied ads (law 9), and advertising from ordinary
recommendations (law 8).

## Pipeline

```
                       ┌────────────────────────────────────────────────┐
                       │ host ad system (identity/rights/delivery stay │
                       │  host-authoritative — W3-008 host-authority)  │
                       └───────┬───────────────────────────┬────────────┘
                               │ observed encounter         │ availability
                               │ (OutcomeEvent, observed    │ declaration
                               │  evidence class only)      │ (AdAvailability)
                               ▼                           ▼
   ┌───────────────┐   ┌───────────────┐         ┌────────────────────┐
   │ AdEncounter   │   │ AdProvenance  │         │  provider-supplied │
   │ Evidence      ├──▶│ discriminated │         │  supply (never an  │
   │ (observed)    │   │ union (law 9) │         │  observation)      │
   └───────────────┘   └───────┬───────┘         └─────────┬──────────┘
                               │                           │
              explicit retention basis (law 1)              │
                               │                           │
                               ▼                           │
   ┌───────────────────────────────────────┐                │
   │ Personal Ad Memory (AdMemoryRecord)   │◀───────────────┘
   │  ad snapshot + lineage + retention    │  (host may seed memory
   │  + permissions + provenance + rights  │   from supply with a
   │  + digest/id (deterministic, AD-002)  │   provider-supplied
   └───────────────┬───────────────────────┘   provenance)
                   │ Ad Query (AD-003)
                   ▼
   ┌───────────────────────────────────────┐
   │ AdQueryRequest / AdQueryResult        │
   │  mode: remembered | available | both  │
   │  separate lanes, per-candidate        │
   │  whyRetrieved, disclosed query        │
   │  understanding (model seam, ADR-002)  │
   └───────────────┬───────────────────────┘
                   │ adCandidatesToCandidateSet (no parallel ranking)
                   ▼
   ┌───────────────────────────────────────┐
   │ EXISTING decision path (AD-004)       │
   │ CandidateSet → DecisionRequest →      │
   │ Experience → Scheduler → presentation │
   │ → OutcomeEvent (observed)             │
   └───────────────────────────────────────┘
```

The kernel decides whether an ad shows at all, which format, when,
whether to continue/queue/suggest/interrupt/resume — using the
existing interruption cost, attention state, uncertainty, constraints
and host objectives. An ad is not shown merely because it has high
commercial value (law 7; AD-004).

## Object model

### AdMemoryRecord (`reckon.ad-memory-record`)

One record = one retained ad for one subject in one tenant:

- `ad` — `AdCatalogItem`: the existing `CatalogItem` narrowed to
  `kind: "advertising"` (law 8), snapshotted at retention time.
- `realizations` — existing `Realization` list (formats/surfaces).
- `lineage` — `AdLineage`: host-owned source/advertiser/campaign/
  creative references. The host ad system is the identity authority;
  Reckon stores opaque refs and never resolves or enriches them.
- `retention` — see below.
- `permissions` — `retain`/`present` grants with append-only
  transition history.
- `provenance` — `observed-encounter` (with `AdEncounterEvidence`) or
  `provider-supplied` (with `AdAvailability`); law 9 union.
- `rights` — `AdRightsConstraints`; `redistributionPermitted`
  defaults false (law 4).
- `contentDigest` / `recordId` — deterministic sha256 over the
  canonical content; `recordId = "admem-" + digest[0..24)`.
  `finalizeAdMemoryRecord()` is the single construction path; same
  content ⇒ same id ⇒ idempotent writes (AD-002). Digest scope
  includes tenant + subject + ad + evidence; hosts wanting
  one-record-per-ad dedup can upsert by (subject, itemId) under their
  own write policy — the contract does not force a cardinality.
- `recordedAt`, optional `idempotencyKey` — caller-supplied for
  deterministic replay (contract rule #4).

Law 6: the record carries NO audience-inference field. Raw ad content
stays separate from derived learning state — learning belongs to
`PreferenceDelta` (existing primitive, own provenance/confidence), and
impressions carry no affinity evidence (W3-008 rule).

### Retention (laws 1–3)

Discriminated union on `state`; **every member requires an explicit
`basis`** — `explicit-user-consent`, `host-retention-policy`,
`host-contractual-term` or `legal-obligation`. Public observability of
an ad is never a basis.

- `active` — retained and retrievable; optional `expiresAt`.
- `expired` — the basis lapsed (`expiresAt` required). Not retrievable;
  may be held transiently for audit until purged.
- `forgotten` — terminal (law 2). `forgottenAt` required. No
  transition out of `forgotten` exists in the contracts; retrieval can
  never return it again.

Runtime gates (pure, deterministic against the caller-supplied clock):

- `isAdMemoryRetrievable(record, at)` — state `active`, unexpired at
  `at`, `permissions.retain === "granted"`.
- `isAdAvailableAt(ad, at)` — the ad's own catalog window.
- `isAdCandidateCurrentlyAvailable(candidate, at)` — candidate
  availability window AND ad window (law 3).

### Encounter evidence (laws 5, 10)

`AdEncounterEvidence` requires the observed `OutcomeEvent` id
(encounters flow through the same evidence pipeline as everything
else), an observed evidence class (`production-observed`, `staging`,
`controlled-local` — the `OBSERVED_EVIDENCE_CLASSES` family),
`encounteredAt`, and context **by reference only**. There is no
location/attention/sensor field; unknown keys are stripped on parse.
Simulated/counterfactual/fixture encounters are parse errors
(architecture-lock #20).

### Provenance and availability (law 9)

`AdProvenance` is a discriminated union with disjoint members:

- `observed-encounter` — requires evidence (above).
- `provider-supplied` — requires `AdAvailability` (`suppliedBy`,
  optional window, channel provenance). A declaration by a host
  channel that it is willing to serve the ad — never an observation,
  and never a rights grant (architecture-lock #23).

## Ad Query contract

### Request (`reckon.ad-query-request`)

- `mode` — `remembered` | `available` | `both` (default `both`).
- `text` — raw query text.
- `filters` — `AdQueryFilters`: lexical `terms`, `labels`, lineage refs
  (advertiser/campaign), `surfaces`, `encounteredFrom/Until`, `limit`.
- `context` — context by reference for contextual relevance (law 5).
- `at` — REQUIRED caller-supplied evaluation clock: expiry,
  availability and temporal relevance are all evaluated against it,
  deterministically, for replay.

Model-assisted query understanding (semantic expansion) happens behind
the model adapter seam (ADR-002) and MUST be disclosed on the result —
never a hidden ranker (model/provider boundary).

### Result (`reckon.ad-query-result`)

- `remembered` — `RememberedAdCandidate[]`: `advertising: true`, an
  embedded `RetrievableAdMemoryRecord` (structurally active retention —
  forgotten/expired records cannot appear), optional eligibility,
  separated `userValue`/`commercialValue`, per-candidate
  `whyRetrieved`.
- `available` — `AvailableAdCandidate[]`: `advertising: true`, the
  declared ad + realizations, `AdAvailability`, rights constraints, an
  optional `memoryRecordId` link, same value/reason fields.
- `queryUnderstanding` — disclosed terms plus model provenance, if a
  model assisted.
- `notes` — honest statements about what was NOT searched or could not
  be evaluated.

The two arrays are NEVER merged (law 9), and mode consistency is
enforced on parse: `remembered` mode cannot return available
candidates and vice versa. `whyRetrieved` kinds form a closed neutral
vocabulary (`query-match`, `semantic-match`, `label-match`,
`lineage-match`, `temporal-match`, `contextual-match`, `recency`,
`user-requested`, `provider-supplied`, `other`); their `score`
components are retrieval hints, never decisions.

### Forget (`reckon.ad-forget-request` / `-result`)

Targets: a single `record`, all records for an `item`, an
`advertiser`, or `all`. The result reports the affected record ids.
After commit, `isAdMemoryRetrievable` is false forever (law 2);
`forgotten` is terminal. Forgetting a record removes it from Personal
Ad Memory retrieval — it does not rewrite history in host ad systems
or outcome streams (append-oriented evidence, contract rule #8).

## Candidate resolution (no parallel ranking)

`adCandidatesToCandidateSet(setId, { remembered, available })` maps
both lanes into the existing `CandidateSet`:

- remembered → `CandidateReference` with source
  `reckon.ad-memory.remembered`;
- available → source `reckon.ad-availability.current`;
- `rankHint` is positional; `scoreHint` is the best `whyRetrieved`
  score. Hints only — ranking authority stays with the decision
  kernel (AD-004).
- an empty mapping throws, mirroring `DecisionRequest`'s rejection of
  empty candidate sets.

Ad eligibility projects onto the EXISTING `HardConstraint` vocabulary
via `adEligibilityToConstraints`: flight window → `time-window`,
gates → `policy-rights`. Surfaces and host frequency/pacing policy
stay host-evaluated (W3-008 host-authority law: Reckon never enforces
frequency caps, pacing or brand safety).

## Evidence classes and production truth

Encounter evidence is observed-class only (law 10). Fixture/simulated
ad-lane evidence remains explicitly labeled per AGENTS.md. Nothing in
this note is production acceptance: AD-002–AD-006 must re-prove the
lane on real serving surfaces with real capability, authorization,
output, latency and failure behavior before any production claim
(production truth rules).

## Out of scope (host/other-owner authorities)

Reckon remains the decisioning/scheduling authority inside the host
product. It is NOT:

- an identity provider (subject refs are opaque; host resolves identity);
- an ad network or media buyer;
- a rights authority (host rights gates verify; rights never inferred);
- a creative delivery authority;
- a payment/billing authority;
- a second recommendation engine (no parallel ad ranking contract).

## Frozen artifacts

- Contracts: `packages/contracts/src/ads.ts` (ADR-005).
- Generated JSON Schemas: `packages/contracts/schemas/ad-memory-record.schema.json`,
  `ad-query-request.schema.json`, `ad-query-result.schema.json`,
  `ad-forget-request.schema.json`, `ad-forget-result.schema.json`.
- Tests: `packages/contracts/test/ads.test.ts` (63 tests, including
  machine-checks of laws 1, 4, 8 and 10 inside the generated
  artifacts).
