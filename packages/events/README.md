# @reckon/events

Event/outcome ingestion backbone (W1-001). Append-oriented, tenant-scoped,
idempotent, provenance-aware, caller-timed for deterministic replay.

## Laws implemented

- **Append law** (ADR-001, contracts.md #8): records append, never overwrite;
  corrections reference earlier records via `correctsEventId`; a duplicate
  `idempotencyKey` (per tenant) returns the ORIGINAL record, never a second
  one. An `eventId` reused with a different idempotency key is a typed
  conflict (IDs are immutable, contracts #2).
- **Evidence-typing law** (contracts.md #9): `observed()` and `research()`
  iterators are disjoint by construction — `simulated`/`counterfactual`/
  `fixture` records can never flow into the observed API and vice versa.
  Corrections cannot link the two partitions.
- **Tenant isolation** (contracts.md #5): every query takes the tenant scope
  explicitly; cross-tenant reads are structurally impossible.
- **Determinism**: caller-supplied `occurredAt` is never overwritten, stored
  records are frozen defensive copies, and every record carries a
  `contentDigest` (canonical JSON → sha256, from `@reckon/contracts`).

## Port / adapter

- `EventStore` (port): `append`, `getByDecision`, `getBySubject`,
  `getByExperience`, `stream`, `observed`, `research` — all tenant-scoped.
- `InMemoryEventStoreAdapter` — **test infrastructure, evidence class:
  controlled-local.** NOT production persistence; the PostgreSQL adapter is
  a later wave (W3-003 transport). No hidden global state: construct and
  inject explicitly.

## Errors

Typed only (never raw strings): `EventValidationError`,
`EventIdConflictError`, `CorrectionTargetNotFoundError`,
`CorrectionCrossTenantError`, `CorrectionEvidenceClassMismatchError` — all
discriminated by `code` on `EventsError`.
