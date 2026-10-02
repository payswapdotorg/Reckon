/**
 * @reckon/persistence — production PostgreSQL persistence per ADR-001
 * (P1-001 / P1-003).
 *
 * - PgPoolExecutor: the production SQL executor (pg driver, wire protocol,
 *   Neon-compatible via DATABASE_URL).
 * - applyMigrations: forward-only, checksummed, idempotent schema setup.
 * - PgEventSink: the async OutcomeSink over durable outcome_events.
 * - PgOutboxTransport: the durable OutcomeTransport (outbox pattern —
 *   at-least-once across process crashes, idempotency dedup at the sink).
 * - PgIdempotencyStore: durable route idempotency (apps/api port).
 * - Authoritative state stores: decisions, experience plans (versioned),
 *   catalog + realizations, preference deltas (append-only), context
 *   snapshots, research jobs with durable leases.
 *
 * The in-memory/JSONL adapters in sibling packages remain TEST
 * INFRASTRUCTURE. Test evidence for THIS package is produced against a
 * REAL PostgreSQL server (embedded-postgres PG 18 binaries) through the
 * same pg wire driver used in production — evidence class
 * controlled-local; the deployed-infrastructure wire path (Gate L) runs
 * against the real DATABASE_URL.
 */
export { PgPoolExecutor } from "./executor.js";
export type { SqlExecutor, SqlRow } from "./executor.js";
export { MIGRATIONS, applyMigrations, migrationStatus } from "./migrations.js";
export type { Migration, MigrationStatusEntry } from "./migrations.js";
export { runMigrateCli } from "./migrate-cli.js";
export type { MigrateCliIo } from "./migrate-cli.js";
export {
  PersistenceError,
  MigrationError,
  StateIdConflictError,
  StoredRecordParseError,
  ResearchJobError,
} from "./errors.js";
export { PgEventSink, PgEventQueries, rowToStoredOutcomeEvent, tenantColumns } from "./event-sink.js";
export type { PgEventSinkOptions, EventQueryOptions } from "./event-sink.js";
export { PgOutboxTransport } from "./outbox-transport.js";
export type { PgOutboxTransportOptions } from "./outbox-transport.js";
export { PgIdempotencyStore } from "./idempotency-store.js";
export type { StoredIdempotent, StoredIdempotentResponse } from "./idempotency-store.js";
export { PgAgentStore } from "./agent-store.js";
export type { StoredAgentBody, StoredAgentOrganization } from "./agent-store.js";
export {
  PgDecisionStore,
  PgPlanStore,
  PgCatalogStore,
  PgPreferenceStore,
  PgContextStore,
  PgResearchJobStore,
} from "./state-stores.js";
export type { StoredPlanVersion, ResearchJob, EnqueueResearchJob } from "./state-stores.js";
