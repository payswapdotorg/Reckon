# @reckon/preferences

Preference state and deltas (W1-003). Stable and situational stores with
confidence, scope, provenance, decay, expiry and model lineage.

## Laws implemented

- **One-topic law**: `scope.contextKind` and/or `scope.contextId` present ⇒
  the delta routes to the SITUATIONAL store; absent ⇒ STABLE. A
  situational delta NEVER writes into the stable store — one topic/view
  must not permanently redefine long-term taste.
- **Decay/expiry (pure, deterministic)**: `snapshot(subject, tenant, at)`
  folds ONLY deltas with `timestamp <= at` (no-future-leakage /
  deterministic replay), then applies half-life decay
  (`2^(−elapsedSeconds/halfLifeSeconds)`, elapsed clamped at 0) and expiry
  filtering (`expiresAt`, `scope.validFrom`/`validUntil`, inclusive bounds).
  `snapshot()` without `at` returns the accumulated state as-is.
- **Confidence**: `confidenceDelta` accumulates (each distinct delta applies
  exactly once — apply is idempotent per (tenant, deltaId)); clamped to
  [0, 1]. `resultingConfidence`, when provided, WINS over accumulation.
- **Model lineage**: last-writer-wins per dimension; the FULL delta log is
  retained and readable via `log()`.
- **Tenant isolation**: apply/snapshot/dimensions/log are tenant-scoped.

## Op semantics (deterministic, total)

`set` replaces; `add` adds (missing prior = 0); `multiply`/`decay` multiply
(missing prior = 1); `remove` tombstones (re-set revives); `merge` adds
numbers / concatenates strings / ORs booleans / null absorbs. Type
mismatches are typed errors — never silent coercions.

## Port / adapter

- `PreferenceStore` (port): `apply(delta)`, `snapshot(subject, tenant, at?)`,
  `dimensions(subject, tenant, scope?)`, `log(subject, tenant, scope?)`.
- `InMemoryPreferenceStoreAdapter` — **test infrastructure, evidence class:
  controlled-local.** NOT production persistence. The retained delta log is
  the single source of truth; reads are deterministic folds.

## Errors

Typed only: `PreferenceValidationError`, `PreferenceDeltaConflictError`,
`PreferenceOpError` (discriminated by `code` on `PreferencesError`).
