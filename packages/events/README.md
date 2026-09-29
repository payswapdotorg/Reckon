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

## Outcome transport (W3-003)

The durable at-least-once delivery seam declared in wave 1:

- `OutcomeTransport` (port): `publish`, `pump`, `flush`, `failures`,
  `pending`, `status`.
- `BufferedTransport` (implementation): validates against the frozen
  `OutcomeEventSchema`, batches appends (`maxBatchSize`), retries transient
  sink failures with **deterministic backoff via an injected clock**
  (`TransportClock` — `ManualClock` for tests, `SystemClock` otherwise; no
  hidden timers), and enforces **at-least-once** semantics: a partial write
  followed by a thrown response is retried whole-batch and the sink's
  `idempotencyKey` dedup collapses the re-delivery to the ORIGINAL record.
- `OutcomeSink` (port) + `eventStoreSink(store)` adapter: the wave-1
  `EventStore` satisfies the sink structurally. Thrown errors are transient
  (retry); returned `rejected` results are permanent typed rejections
  (fail terminally without retry).
- Journals (`TransportJournal` port): append-only `enqueue` / `attempt` /
  `terminal` records with content digests. `InMemoryJournal` (default) and
  `JsonlFileJournal` are **TEST INFRASTRUCTURE** (controlled-local); the
  production PostgreSQL transport is a later wave per the ADR-001 plan.
  Constructing a `BufferedTransport` on an existing journal **replays**
  pending entries (with their attempt history) and re-surfaces terminal
  failures; a tampered line fails recovery with a typed
  `TransportJournalError`.
- Terminal failures are **never dropped**: retained in `failures()`,
  surfaced live through `onTerminalFailure`, journaled as `terminal
  failed`, and re-surfaced after restart.

Wiring in `apps/api` (frozen route contract, internal plumbing only):

```ts
import { wireOutcomeTransport } from "@reckon/api";
import { InMemoryEventStoreAdapter, ManualClock } from "@reckon/events";

const wiring = wireOutcomeTransport({
  store: new InMemoryEventStoreAdapter(), // sink (test infra)
  clock: new ManualClock(0),              // inject SystemClock in production
  onTerminalFailure: (failure) => { /* surface to observability */ },
});
const app = buildServer({ keys, handlers: { outcomeIngest: wiring.handler } });
```
