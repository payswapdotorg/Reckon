# @reckon/context

Subject/audience context state (W1-002). Context snapshots are validated
against the frozen `ContextSnapshotSchema`, stored as frozen defensive
copies, and associated with an explicit subject + tenant at save time (the
snapshot contract itself carries no subject/tenant — the association is
host-declared and authoritative).

## Laws implemented

- **No-future-leakage / immutability**: a snapshot saved at T is never
  mutated by anything appended later; stored records are frozen and callers
  cannot reach the store through previously returned references.
- **Deterministic ordering**: `latest()` orders by the CALLER-SUPPLIED
  `snapshot.at`, tie-broken by `contextId` — never by save order. `history()`
  is ascending by (at, contextId).
- **Consent boundary** (ADR-003): location is accepted only under the
  schema's explicit `permitted: true` marker; the store never enriches or
  infers location.
- **Tenant isolation** (contracts.md #5): `latest` / `get` / `history` are
  all tenant-scoped.

## Port / adapter

- `ContextStore` (port): `save({ tenant, subject, snapshot })`,
  `latest(subject, tenant)`, `get(contextId, tenant)`,
  `history(subject, tenant, range?)`.
- `InMemoryContextStoreAdapter` — **test infrastructure, evidence class:
  controlled-local.** NOT production persistence.

## Derived view

`deriveAttentionView(snapshot)` — a PURE function combining the snapshot's
`attention` block with its `fatigue` signals into an available-attention
estimate (`fatiguePenalty = 0.6·repetition + 0.4·min(interruptions/10, 1)`,
capped at 0.9; the host's quality classification is reported verbatim,
never reclassified).

## Errors

Typed only: `ContextValidationError` (discriminated by `code` on
`ContextsError`).
