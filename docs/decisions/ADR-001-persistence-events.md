# ADR-001 — Persistence and Event Model

**Status:** ACCEPTED / FROZEN

## Decision

Use PostgreSQL-compatible durable persistence for authoritative Reckon state.

Use append-oriented events/outcomes for learning evidence.

Use deterministic canonical serialization and content digests for reproducible research artifacts where applicable.

Large research artifacts use approved object storage; durable metadata and lineage remain in PostgreSQL.

## Rules

- no SQLite authority;
- no hidden in-memory production state;
- durable jobs and worker leases;
- historical observations append rather than overwrite;
- deterministic replay uses caller-supplied timestamps.