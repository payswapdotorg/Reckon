# Personal Ad Memory Store — AD-002 Design Note

Status: DELIVERED WITH AD-002 (this note)

Owner: W1 (AD-002)

Contracts: FROZEN with AD-001 (`packages/contracts/src/ads.ts`, ADR-005 —
see `docs/decisions/ADR-005-ad-memory.md` and
`docs/architecture/ad-memory.md`). This note documents the PERSISTENCE
design: the upsert-policy decision ADR-005 explicitly left to AD-002,
forget mechanics, retention/expiry evaluation, permission-history
storage, and failure typing.

Production = PostgreSQL per ADR-001 / P1-001: `PgAdMemoryStore`
(`packages/persistence/src/ad-memory-store.ts`) runs on the same
`SqlExecutor` port as every other production store, with the same
discipline TL6-002 established (`webhook-stores.ts`): parameterized SQL
only, tenant-scoped by construction, canonical-JSON payload + sha256
digest, parse back through the frozen schemas on read, honest typed
failures, restart-durability proofs. The `InMemoryAdMemoryStore` in the
same file is TEST INFRASTRUCTURE ONLY (behavioral twin; the shared
law-mapped suite runs against BOTH implementations so equivalence is
asserted, not assumed).

## Upsert policy — (subject, itemId) current-upsert (the documented freedom)

ADR-005 left record cardinality open: "the digest covers the full
content payload, so a re-encounter with new evidence yields a new record
id unless AD-002 adopts a (subject, itemId) upsert policy. This is
documented freedom for AD-002, not an oversight."

**Decision: AD-002 adopts the (subject, itemId) upsert.** At most ONE
CURRENT record (unsuperseded, non-forgotten) exists per
`(tenant, workspace, subject, ad.itemId)`, enforced STRUCTURALLY by the
`ad_memory_records_current_item` partial unique index (migration
`m007_ad_memory`), not by convention.

Rationale (OBSERVED from the frozen contract surface and architecture):

1. The architecture doc defines the object model as "One record = one
   retained ad for one subject in one tenant" — one record PER AD, not
   per encounter. Digest-level append would accumulate a near-duplicate
   row per re-encounter and push dedup into every consumer (AD-003, the
   UX) — the lane contract has no dedup primitive.
2. Record identity stays pure: `recordId = admem-<digest prefix>` and
   the digest covers the full content INCLUDING evidence (AD-001 law).
   The store NEVER fabricates a stable id for mutating content — a
   re-encounter with new evidence produces a NEW record (new digest,
   new id) via `finalizeAdMemoryRecord`, and the PREVIOUS current record
   is marked `superseded_by_record_id` (audit-preserving, not deleted).
3. The remembered lane is therefore "the ad as the user most recently
   encountered it" — one current record per ad — while the full
   encounter history remains readable by recordId for audit/export.

Write algorithm (`put`):

1. Boundary validation (below). A record already stored with the SAME
   `recordId` → `duplicate` no-op that returns the stored state and
   NEVER touches supersession (re-writing identical content cannot
   change which record is current — even out-of-order replays are safe).
2. Supersede step: mark the previous current record for the same
   `(tenant, workspace, subject, itemId)` as superseded. Forgotten rows
   are never superseded (they are already terminal).
3. Insert the new row. `ON CONFLICT (tenant, workspace, record_id) DO
   NOTHING` absorbs a concurrent identical write (graceful duplicate);
   a concurrent DIFFERENT-content write crosses the partial unique index
   and surfaces as a typed `AdMemoryWriteConflictError` — honest and
   retryable, never silently absorbed.

Edge semantics (tested):

- Re-encounter AFTER forget: a NEW encounter (new evidence ⇒ new id) is
  a legitimate new memory and becomes current; the FORGOTTEN row is
  untouched and stays unretrievable forever. The exact previous content
  can NEVER return (`put` of it reports the tombstone duplicate).
- Superseded rows stay verbatim and readable by id; they never re-enter
  the remembered lane.

## Forget mechanics (law 2)

`forget(AdForgetRequest)` executes record / item / advertiser / all
targets within the request's tenant+subject scope. Matched,
not-yet-forgotten rows transition IN PLACE to the terminal `forgotten`
retention: the basis is CARRIED (law 1 — even a forgotten record keeps
its explicit basis for the audit trail), `retainedAt`/`expiresAt` are
preserved when present, `forgottenAt` = the request's caller-supplied
`at`, `forgetReason` mirrors the request reason. No other field changes
(laws 4/9: rights and provenance stay verbatim).

- The row is NOT deleted: the tombstone (record id, forgottenAt, the
  forgotten retention) persists — this is the audit trail the contract
  requires (`forgottenAt` REQUIRED "for the audit trail").
- Forgotten is terminal: `get` returns null on every read path;
  `listRemembered` excludes forgotten rows at every caller clock;
  permission transitions on a forgotten record are typed rejections; a
  re-write of identical content returns the tombstone (`duplicate`,
  `record: null`) — there is NO un-forget path, and none is added.
- Already-forgotten rows matched by a target are untouched and NOT
  re-counted (forget is idempotent at the row level; a replayed
  advertiser/all forget reports 0).
- Forgetting removes the record from Personal Ad Memory retrieval only —
  it does not rewrite host outcome streams (append-oriented evidence,
  contract rule #8; AD-001's architecture note).

## Retention & expiry — the caller-supplied clock (law 3)

The store holds NO hidden clock authority: there is not a single
wall-clock read (`Date.now()` etc.) in `ad-memory-store.ts`. Every
temporal input is caller-supplied (contract rule #4): `recordedAt` on
writes, `at` on forget requests and permission transitions, and the
REQUIRED `at` on every `listRemembered` call.

- The full `AdRetention` union is persisted VERBATIM (canonical JSON) —
  active (with or without `expiresAt`), expired, forgotten — plus the
  `basis_kind`/`expires_at`/`forgotten_at`/`retention_state` audit
  columns mirroring the parsed record (columns are index/audit
  projections, never a second schema).
- Basis-less writes are rejected at the boundary (law 1): every input is
  parsed through the frozen `AdMemoryRecordSchema`; a retention without
  `basis` cannot parse, cannot be stored.
- Expiry is evaluated against the CALLER's `at` on every retrieval:
  SQL pushdown (`expires_at IS NULL OR expires_at > at`) plus the frozen
  `isAdMemoryRetrievable(record, at)` as the authoritative post-parse
  gate (the TL6-002 `listMatching` pushdown precedent — push down for
  efficiency, the frozen logic stays the source of truth). Expired
  records (structurally `expired`, or `active` with `expiresAt <= at`)
  are never returned as remembered candidates — at ANY caller clock
  after expiry, and return if the caller rewinds the clock (replay is
  deterministic; the store keeps no hidden now).

## Permission state — append-only history, store-level gates

`AdPermissionState` is persisted inside the verbatim record; the
`permission_retain`/`permission_present` columns mirror it for lane
pushdown. `applyPermissionTransition(tenant, recordId, transition)`:

- validates the transition input through the frozen
  `AdPermissionTransitionSchema` at the boundary;
- applies the FROZEN pure helper `applyAdPermissionTransition` — a
  `from`-mismatch is a typed `AdMemoryTransitionRejectedError` (history
  cannot be rewritten);
- appends the transition verbatim to the history (append-only, persisted
  in full — corrections never overwrite earlier transitions);
- enforces the contract comment (ads.ts §6 / ADR-003): revoking `retain`
  REQUIRES the store to forget the record — the transition is appended
  first, then the retention becomes terminal `forgotten`
  (`forgottenAt` = transition.at). No re-grant can follow (terminal).
  Revoking `present` keeps the memory but removes the record from
  presentation candidates (the lane's present gate) — and is reversible
  by a later grant while the record is not forgotten.
- Asymmetry note (documented): a record WRITTEN with `retain: "revoked"`
  is accepted verbatim (the frozen schema allows it; the store adds no
  write-time permission policy) and is simply never retrievable until a
  grant transition. The auto-forget law binds the revoke TRANSITION, as
  the contract comment states.

Both gates — `retain` AND `present` — are enforced on EVERY retrieval:
the remembered-lane query filters `permission_retain = 'granted' AND
permission_present = 'granted'` (pushdown) and re-verifies with
`isAdMemoryRetrievable` + the present grant (authority).

## Store-level retrieval query (for AD-003)

`listRemembered(tenant, subject, at, { limit? })` — a STORE method, not
an HTTP route (AD-003 owns the API). It returns the structurally-active,
permission-passing, unexpired (against `at`), current (unsuperseded)
records for one tenant+subject, in deterministic chronological order
(`recordedAt ASC, record_id ASC`) — a replay-stable ordering that is
explicitly NOT a ranking (law 7: the store persists commercial value
nowhere — records carry no value/rank state at all; value separation
lives on the candidate contracts AD-003 builds from these records).

## Failure typing (honest — no silent fallbacks)

Defined in `ad-memory-store.ts` (extending the shared `PersistenceError`
base; `errors.ts` was outside AD-002's granted surface):

- `AdMemoryRecordInvalidError` (`PERSISTENCE_AD_MEMORY_RECORD_INVALID`)
  — boundary rejections: frozen-schema parse failures (laws 1, 5, 6, 8,
  10) and forged identity (digest/recordId inconsistent with content —
  "finalizeAdMemoryRecord before write" is enforced, not assumed).
- `AdMemoryWriteConflictError` (`PERSISTENCE_AD_MEMORY_WRITE_CONFLICT`)
  — a concurrent write crossed the transaction and hit a uniqueness
  guard (record PK or the current-item partial index). Retryable; the
  store never silently absorbs cross-statement races.
- `AdMemoryTransitionRejectedError`
  (`PERSISTENCE_AD_MEMORY_TRANSITION_REJECTED`) — unknown record in the
  tenant scope, forgotten record (terminal), or `from`-mismatch.
- `StoredRecordParseError` (existing) — a stored row failed to parse
  back through the frozen schema on read (integrity).

## Migration registration (m007_ad_memory)

`migrations.ts` gains the `m007_ad_memory` entry (forward-only, IF NOT
EXISTS, no DROP — same laws as m001–m006). The CLI itself
(`migrate-cli.ts`) is generic over `MIGRATIONS` and needed no code
change; the CLI's count-assertion suite (`migrate-cli.test.ts`) was
updated 6→7 in the same shape the Lead-certified station rail applied
for m006 (OBSERVED: `git show 4f2048b -- packages/persistence/test/migrate-cli.test.ts`
shows the 5→6 bump shipping with the m006 registration). This keeps the
`reckon-migrate` output-contract tests in sync with the registry; it is
flagged transparently in the AD-002 completion report as the one file
outside the literal granted list, justified by that certified precedent.

## Test coverage (law-mapped; `test/ad-memory-store.test.ts`)

The SAME behavioral suite runs against `PgAdMemoryStore` (real
PostgreSQL via the pg-harness, evidence class controlled-local) and
`InMemoryAdMemoryStore` (test infrastructure):

- Law 1: basis-less retention → typed rejection; PG `basis_kind` audit
  column proof.
- Law 2: forget unretrievable on every read path; no resurrection via
  identical re-write; retain-revoke ⇒ terminal forget; PG tombstone-row
  proof (row retained, carried basis + forgottenAt).
- Law 3: caller-clock expiry (before/at/after the boundary, rewind
  works); structurally-expired records never in the lane at any clock.
- Law 4: rights round-trip verbatim; never mutated by any operation.
- Law 5: injected location/attention/sensor fields stripped at the
  boundary; PG raw `record_json` proof (physically absent).
- Law 6: injected audience fields stripped; stored key set is exactly
  the frozen schema's.
- Law 7: deterministic chronological lane order regardless of
  value-ish attributes; recordId tie-break.
- Law 8: non-advertising `kind` → typed rejection; advertising literal
  persists verbatim.
- Law 9: both provenance kinds round-trip unchanged; never rewritten.
- Law 10: simulated/counterfactual/fixture evidence classes → typed
  rejections.
- Upsert policy: idempotent duplicates; supersession chain; re-encounter
  after forget; PG `superseded_by_record_id` + current-item index
  rejection proofs.
- Forget targets: record/item/advertiser/all scoping; subject/tenant
  isolation; idempotent re-forget.
- Permissions: append-only history; present gate; re-grant; retain-revoke
  terminal; mismatch rejection.
- Scoping: tenant, workspace, subject (digest scoping).
- Restart durability: `restart-durability.test.ts` extended — current
  record + permission history + superseded shadow + forgotten tombstone
  survive a full server stop/restart on the same data dir.

## Production truth

Everything above is adapter-level, controlled-local evidence. The lane
is not production-accepted until it runs against a real deployed
PostgreSQL endpoint (Gate L, real DATABASE_URL) and a real serving
surface — per AGENTS.md production-truth rules.
