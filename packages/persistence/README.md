# @reckon/persistence

Production PostgreSQL persistence adapters per **ADR-001** (work item
**P1-001**, durable transport from **P1-003**). This is the production
persistence layer; the in-memory / JSONL adapters in sibling packages are
TEST INFRASTRUCTURE and stay so (ADR-001: no hidden in-memory production
authority).

## Components

| Export | Role |
|---|---|
| `PgPoolExecutor` | Production SQL executor over the `pg` driver (wire protocol — Neon-compatible via `DATABASE_URL`) |
| `applyMigrations` | Forward-only, checksummed, idempotent schema migrations (`reckon_schema_migrations`) |
| `PgEventSink` | Async `OutcomeSink` over the append-only `outcome_events` table — replicates the frozen EventStore append semantics exactly |
| `PgEventQueries` | Async tenant-scoped read side (by decision / subject / experience / partition) |
| `PgOutboxTransport` | Durable `OutcomeTransport` (outbox pattern): at-least-once delivery across process crashes, idempotency dedup at the sink, typed terminal failures |
| `PgIdempotencyStore` | Durable route idempotency (structurally satisfies the `apps/api` IdempotencyStore port) |
| `PgDecisionStore` / `PgPlanStore` / `PgCatalogStore` / `PgPreferenceStore` / `PgContextStore` / `PgResearchJobStore` | Authoritative state: decisions, versioned plans (append-only replan history), catalog + realizations, append-only preference deltas, context snapshots, research jobs with durable worker leases |

## Laws honored

- **Tenant isolation by construction** — every table carries
  `(tenant_id, workspace_id)`; every query filters on both; no unscoped
  identifier is ever accepted.
- **Append law** — `outcome_events`, `preference_deltas`, plan versions
  and the outbox history are never rewritten or deleted.
- **Caller-supplied timestamps** — contract-visible times
  (`occurredAt`, `timestamp`, plan `createdAt`) are stored as supplied;
  SQL-side time functions are never used for them. Transport scheduling
  uses the injected clock.
- **Canonical serialization** — every stored payload is `canonicalJson`
  plus its sha256 `contentDigest` (`@reckon/contracts`); reads parse back
  through the frozen zod schemas (typed `StoredRecordParseError` on
  divergence — never silently accepted).
- **Deterministic replay** — the outbox and job-lease clocks are
  injectable; tests drive them manually.

## Testing (real PostgreSQL, not mocks)

Tests boot a REAL PostgreSQL server (PostgreSQL 18 binaries via
`embedded-postgres`) on `127.0.0.1:55433` and run the production
`PgPoolExecutor` — the same driver and wire protocol used against Neon in
deployment. Evidence class for these runs: **controlled-local**. The
deployed-infrastructure wire path (Gate L) is exercised with a real
`DATABASE_URL`.

```bash
pnpm --filter @reckon/persistence test
```

`restart-durability.test.ts` proves Gate-L semantics at the adapter level:
data written before a server stop still reads identically after a restart
on the same data directory.
