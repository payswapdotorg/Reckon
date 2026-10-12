# Ad Retrieval API/SDK — AD-003 Design Note

Status: DELIVERED WITH AD-003 (this note)

Owner: W3 (AD-003)

Contracts: FROZEN with AD-001 (`packages/contracts/src/ads.ts`, ADR-005 —
see `docs/decisions/ADR-005-ad-memory.md` and
`docs/architecture/ad-memory.md`). Persistence: DELIVERED with AD-002
(`packages/persistence/src/ad-memory-store.ts` — see
`docs/architecture/ad-memory-store.md`). This note documents the
RETRIEVAL surface: the `/v1/ads` route family, the SDK client methods,
the retrieval semantics per lane, and the honest limitations.

Production = the `buildProductionServer` composition: the remembered
lane reads through the real `PgAdMemoryStore` (the AD-002 store port on
the shared `SqlExecutor`); the available lane evaluates the
host/provider availability channels composed at deployment time.
Evidence class for everything here: controlled-local (real PG engine +
production composition in `apps/api/test/ads-composition.test.ts`;
production acceptance still requires Gate L + a real serving surface
per AGENTS.md production-truth rules).

## Route surface

| Route | Contract | Scope | Handler port |
|---|---|---|---|
| `POST /v1/ads/query` | `reckon.ad-query-request` → `reckon.ad-query-result` | `ads` | `adRetrievalHandler.query` |
| `POST /v1/ads/forget` | `reckon.ad-forget-request` → `reckon.ad-forget-result` | `ads` | `adRetrievalHandler.forget` |

Both routes run the shared contract pipeline (auth → scope → tenant law
→ frozen-schema validation → idempotency replay/conflict → handler →
frozen-schema response validation → tenant invariant). The `ads` scope
is a new entry in `ROUTE_SCOPES` (apps/api — key provisioning expresses
it exactly like every other family).

The `ads` route family owns NO persistence of its own: the remembered
lane is a read through the AD-002 store port; the available lane is a
per-query evaluation of composed channels (no storage, no discovery).

## SDK surface (`@reckon/sdk`)

```ts
const reckon = createReckonClient({ baseUrl, apiKey });

// Retrieval query (mode remembered | available | both; `at` REQUIRED).
const result = await reckon.ads.query({
  queryId: "q-1",
  tenant: { tenantId: "my-tenant" },
  subject: { kind: "user", ref: "user-9" },
  mode: "both",
  text: "the hotel ad I saw last week",
  at: 1_770_000_000_000,
});

// Terminal forget (record / item / advertiser / all targets).
await reckon.ads.forget({
  requestId: "fr-1",
  tenant: { tenantId: "my-tenant" },
  subject: { kind: "user", ref: "user-9" },
  target: { kind: "advertiser", advertiserRef: "adv-42" },
  at: 1_770_000_000_000,
  idempotencyKey: "forget-1",
});

// Order-named aliases (the AD-003 work-order's literal names) — same surfaces.
await reckon.queryAds({ ... });
await reckon.forgetAds({ ... });
```

The primary surface follows the SDK's family convention
(`reckon.ads.query` / `reckon.ads.forget`, like `reckon.plans.create`);
`queryAds`/`forgetAds` are top-level thin aliases kept so both the
convention and the order's literal names resolve. Every request is
validated against the frozen `AdQueryRequestSchema` /
`AdForgetRequestSchema` before it is sent; every response against
`AdQueryResultSchema` / `AdForgetResultSchema` before it is returned;
every failure is a typed `ReckonSdkError`. No internal shapes are
imported (zero-internal-import law).

Idempotency convention: `AdForgetRequest` REQUIRES the body-level
`idempotencyKey` (the decisions/outcomes convention — no header
fallback needed). `AdQueryRequest` carries an OPTIONAL body-level
`idempotencyKey`; when the request omits it the client sends a
generated `Idempotency-Key` header so callers never trip the route's
typed 400 (see UX_DX_GAP-1).

## Retrieval semantics

### Remembered lane (Personal Ad Memory)

- Source: the AD-002 store port — `listRemembered(tenant, subject, at)`
  at the CALLER-supplied clock. The store is the authority for every
  ad-memory privacy law at its boundary (basis-required retention, terminal
  forget, expiry-vs-clock, retain+present permission gates, supersession);
  the route does not re-implement, weaken or bypass any of them. The
  final response parse through `AdQueryResultSchema` (embedding
  `RetrievableAdMemoryRecordSchema`) re-asserts laws 2/3/8/9
  structurally on the way out.
- Order: the store's deterministic chronological order (recordedAt ASC,
  recordId ASC) is preserved VERBATIM. The retrieval stage has NO
  ranking authority (law 7): lexical scores appear only as
  `whyRetrieved[].score` HINTS for the decision kernel, never as a sort
  key here. Any scoring/ranking belongs to the host/decision layers
  (AD-004).
- Mode discipline: `mode: "remembered"` never queries availability
  channels; `mode: "available"` never reads memory; `both` fills both
  lanes. The frozen result schema enforces lane/mode consistency on
  parse.

### Available lane (host/provider supply)

- Source: `AdAvailabilityChannel` implementations composed at
  deployment time (`buildProductionServer({ adAvailabilityChannels })`
  or a custom handler wiring). A channel supplies `AdAvailabilitySupply`
  declarations — the ad as the channel declares it, the channel's
  `AdAvailability` (a DECLARATION, never an observation, never a rights
  grant — laws 4/9), and channel-declared rights/eligibility/value
  inputs. The engine validates every declaration through the frozen
  `AvailableAdCandidateSchema` surface (composed via `.omit` of the
  fields the engine owns) at the boundary; a channel supplying garbage
  is a typed 500 (deployment integrity failure — never a silent pass).
- Window gate: every declaration is gated through the frozen
  `isAdCandidateCurrentlyAvailable(supply, at)` — BOTH the channel's
  declared window AND the ad's own catalog window must be open at the
  caller clock (law 3). Closed-window supply is excluded and counted in
  an honest note.
- No persistence: the lane is evaluated fresh per query. Nothing a
  channel supplies is stored by the route.
- Order: channel configuration order, then channel declaration order —
  preserved verbatim (the engine never re-sorts supply; a host channel
  that wants an order declares it).
- Memory link: in `mode: "both"`, an available candidate whose
  `ad.itemId` matches a CURRENT remembered record of the same subject
  carries that record's id in `memoryRecordId` (the AD-002
  (subject, itemId) upsert policy guarantees one current record per
  ad); a channel-supplied link is kept verbatim otherwise. `mode:
  "available"` never reads memory, so no link is synthesized there.
- Provenance: every available candidate's `whyRetrieved` starts with
  `provider-supplied` naming `availability.suppliedBy`; rights arrive
  verbatim from the channel (law 4 — never inferred).

### Semantic matching (honest, deterministic, disclosed)

Text matching is DETERMINISTIC LEXICAL matching — no model, no
embeddings:

- Terms = `filters.terms` (host/adapter-expanded, lowercased) ∪ terms
  extracted from `text` (lowercase tokenization on non-alphanumeric
  boundaries, length ≥ 2, ad-lane stopword removal — "ad", "ads",
  "show", "the", …). The effective term set is DISCLOSED verbatim in
  `queryUnderstanding.terms`.
- A term matches a candidate when it appears (case-insensitively) as a
  SUBSTRING of any searchable metadata string: the ad's itemId, labels,
  string attribute values (recursively), realization kinds, lineage
  refs (remembered only), the encounter surface (remembered only), and
  the channel id (available only).
- `query-match` reasons carry `score = matchedTerms / totalTerms` — a
  retrieval HINT, never a decision, never a sort key.
- `semantic-match` is NEVER emitted by this deployment; the honest
  limitation is disclosed per result in `notes` ("no embedding model
  was consulted"). True semantic retrieval would ride the ADR-002 model
  seam and must be disclosed via `queryUnderstanding.modelProvenance`
  — that surface is intentionally unused (see SDK_GAP/API_GAP findings).
- `contextual-match` is never emitted: context is accepted BY REFERENCE
  only (law 5) and this deployment applies no contextual matching —
  disclosed in `notes` when a context reference is present.

### Structured filter semantics (disclosed)

The `AdQueryFilters` combine conjunctively ACROSS dimensions; within a
list dimension a candidate matches when it matches AT LEAST ONE entry
(any-of). A dimension that cannot be evaluated for a candidate EXCLUDES
the candidate — never a silent pass, never an invented match:

| Dimension | Remembered lane matches on | Available lane matches on |
|---|---|---|
| `terms` (+ extracted text terms) | substring over metadata | substring over metadata |
| `labels` | ad labels (case-insensitive exact) | ad labels (case-insensitive exact) |
| `advertiserRefs` / `campaignRefs` | record lineage (exact) | **no lineage on declarations — excluded, honest note** |
| `surfaces` | encounter surface ∪ realization kinds (case-insensitive) | `eligibility.surfaces` (case-insensitive) |
| `encounteredFrom`/`Until` | `evidence.encounteredAt` (inclusive bounds; provider-supplied memory has no encounter — excluded) | **no encounter on declarations — excluded, honest note** |
| `limit` | caps the lane (store pushdown when no other filter is active, else engine-side) | caps the lane in channel declaration order |

When a query has NO text and NO filters, every lane candidate passes
and carries a `user-requested` reason (the honest explanation: "you
asked for your remembered ads / current supply").

### Clock semantics (law 3, contract rule #4)

`at` is REQUIRED and caller-supplied. Every temporal evaluation —
retention expiry (in the store), availability windows (the frozen
`isAdCandidateCurrentlyAvailable`), encounter windows — runs against
it. There is no wall-clock read (`Date.now()` etc.) anywhere in the
route logic (`apps/api/src/ad-retrieval.ts`, `apps/api/src/routes/ads.ts`).
Replay is deterministic: the same memory + the same `at` yields the
same result; rewinding the clock un-expires records (proven against PG
in `ads-composition.test.ts`).

### Forget (law 2)

`POST /v1/ads/forget` delegates ENTIRELY to the AD-002 store's
`forget`: matched, not-yet-forgotten records of the request's
tenant+subject transition in place to the terminal `forgotten`
retention (basis carried — law 1; `forgottenAt` = the request's `at`;
audit-preserving tombstones; no un-forget path). The route adds the
platform idempotency semantics (same key + same body → verbatim
replay; same key + different body → typed 422). Forgetting removes the
records from Personal Ad Memory retrieval only — it does not rewrite
host outcome streams (append-oriented evidence, contract rule #8).

## Honest limitations (also surfaced per result in `notes`)

- No semantic/embedding retrieval (lexical only; disclosed per result).
- No contextual matching (context by reference only; disclosed).
- No availability channels configured → the available lane is honestly
  empty with a disclosed note. Availability is NEVER derived from
  catalog presence (rights are never inferred — architecture-lock #23).
- Lineage/encounter filters exclude provider-supplied availability
  (declarations carry neither) — disclosed when active.
- Channel ordering is host-declared; the engine never re-sorts.
- The remembered lane fetches the subject's full current memory when
  filters are active (the store port has no filter pushdown — AD-003
  owns query semantics; per-subject current memory is bounded by the
  one-current-record-per-ad upsert policy).

## Gap findings (recorded, not worked around)

- **CONTRACT_GAP-1**: `CONTRACT_IDS` (packages/contracts, FROZEN) has no
  entries for the `reckon.ad-*` family; the routes use the contracts'
  own `schema` literals as labels (same convention as the API-level
  envelope labels flagged for TL3 review).
- **API_GAP-1**: there is no per-tenant runtime availability-channel
  registration route (channels are composed at deployment time). A
  runtime registration surface would be a new contract — TL3 decision.
- **API_GAP-2**: the AD-002 `RememberedAdMemoryQuery` port exposes only
  `limit` (no filter pushdown). Composed per the documented freedom;
  see the scaling note above. The store was NOT modified (prefer
  composition).
- **SDK_GAP-1**: no embedding/semantic client surface exists (and none
  is faked). Semantic retrieval would ride the ADR-002 model seam and
  the disclosed `queryUnderstanding.modelProvenance` — future work.
- **UX_DX_GAP-1**: `AdQueryRequest.idempotencyKey` is OPTIONAL in the
  frozen body while the platform's POST convention requires a body key
  OR the `Idempotency-Key` header — a raw HTTP caller omitting both
  gets a 400. The SDK hides this (it always sends a header); the
  header/body inconsistency is a frozen-contract shape TL3 may want to
  reconcile in a future ADR.

## Test evidence (controlled-local)

- `apps/api/test/ads.test.ts` — 33 route-level tests: both lanes, mode
  variants, lexical matching honesty, every filter dimension, clock
  semantics (expiry boundaries, rewind, availability windows),
  permission gates, forget targets/terminality/scoping, idempotency
  (replay without re-execution, 422 conflict, body/header rules), and
  the auth/validation/501 matrix.
- `packages/sdk/test/sdk-ads.test.ts` — 9 SDK tests: contract
  round-trips on both sides, the memory link, idempotency, and the
  typed error matrix (scope/tenant/validation/not-wired) through the
  real in-process API.
- `apps/api/test/ads-composition.test.ts` — 4 composition tests over a
  REAL PostgreSQL server (embedded-postgres PG 18 binaries through the
  production executor): PG-backed retrieval, caller-clock expiry with
  rewind determinism, terminal forget with the PG tombstone, subject
  scoping.

## Production truth

Everything above is adapter-level, controlled-local evidence. The lane
is not production-accepted until it runs against a real deployed
PostgreSQL endpoint (Gate L, real DATABASE_URL), real availability
channels and a real serving surface — per AGENTS.md production-truth
rules (AD-006 owns that proof).
