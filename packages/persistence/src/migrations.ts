/**
 * Forward-only schema migrations for the Reckon production schema
 * (ADR-001; FINAL TL HANDOFF §24/§25 migration discipline).
 *
 * Laws:
 * - every statement is idempotent (IF NOT EXISTS) so a partially-applied
 *   state converges on re-run;
 * - each migration applies inside its own transaction and is recorded in
 *   reckon_schema_migrations with a sha256 checksum of its SQL;
 * - applied_at uses infra wall-clock time (new Date().toISOString()) —
 *   this is infrastructure bookkeeping, NOT a contract-visible timestamp,
 *   so the caller-supplied-timestamps law is not violated;
 * - no destructive statements anywhere (no DROP) — breaking changes
 *   require a new forward migration with explicit safety notes.
 */
import { createHash } from "node:crypto";
import type { SqlExecutor } from "./executor.js";
import { MigrationError } from "./errors.js";

export interface Migration {
  readonly id: string;
  readonly name: string;
  readonly sql: readonly string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: "m001_events",
    name: "outcome events (append-only, tenant-scoped, idempotent)",
    sql: [
      `CREATE TABLE IF NOT EXISTS outcome_events (
  sequence        BIGSERIAL PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  workspace_id    TEXT NOT NULL DEFAULT '',
  event_id        TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  subject_kind    TEXT NOT NULL,
  subject_ref     TEXT NOT NULL,
  decision_id     TEXT,
  experience_id   TEXT,
  event_type      TEXT NOT NULL,
  evidence_class  TEXT NOT NULL,
  occurred_at     BIGINT NOT NULL,
  event_json      JSONB NOT NULL,
  content_digest  TEXT NOT NULL
)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS outcome_events_tenant_key
         ON outcome_events (tenant_id, workspace_id, idempotency_key)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS outcome_events_tenant_event
         ON outcome_events (tenant_id, workspace_id, event_id)`,
      `CREATE INDEX IF NOT EXISTS outcome_events_tenant_decision
         ON outcome_events (tenant_id, workspace_id, decision_id)
         WHERE decision_id IS NOT NULL`,
      `CREATE INDEX IF NOT EXISTS outcome_events_tenant_subject
         ON outcome_events (tenant_id, workspace_id, subject_kind, subject_ref, occurred_at)`,
      `CREATE INDEX IF NOT EXISTS outcome_events_tenant_experience
         ON outcome_events (tenant_id, workspace_id, experience_id)
         WHERE experience_id IS NOT NULL`,
    ],
  },
  {
    id: "m002_outbox",
    name: "durable outcome outbox (at-least-once transport state)",
    sql: [
      `CREATE TABLE IF NOT EXISTS outcome_outbox (
  id                 BIGSERIAL PRIMARY KEY,
  tenant_id          TEXT NOT NULL,
  workspace_id       TEXT NOT NULL DEFAULT '',
  event_id           TEXT NOT NULL,
  idempotency_key    TEXT NOT NULL,
  event_json         JSONB NOT NULL,
  content_digest     TEXT NOT NULL,
  state              TEXT NOT NULL CHECK (state IN ('pending','delivered','failed')),
  attempts           INTEGER NOT NULL DEFAULT 0,
  next_attempt_at    BIGINT NOT NULL,
  created_at         BIGINT NOT NULL,
  last_error         TEXT,
  delivered_sequence BIGINT,
  delivered_digest   TEXT,
  UNIQUE (tenant_id, workspace_id, idempotency_key)
)`,
      `CREATE INDEX IF NOT EXISTS outcome_outbox_due
         ON outcome_outbox (state, next_attempt_at, id)`,
    ],
  },
  {
    id: "m003_api_state",
    name: "authoritative API + research state (idempotency, decisions, plans, catalog, preferences, context, jobs, observability)",
    sql: [
      `CREATE TABLE IF NOT EXISTS idempotent_responses (
  tenant_id       TEXT NOT NULL,
  route_key       TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_digest  TEXT NOT NULL,
  status_code     INTEGER NOT NULL,
  response_body   JSONB NOT NULL,
  response_headers JSONB,
  stored_at       TEXT NOT NULL,
  PRIMARY KEY (tenant_id, route_key, idempotency_key)
)`,
      `CREATE TABLE IF NOT EXISTS decisions (
  tenant_id      TEXT NOT NULL,
  workspace_id   TEXT NOT NULL DEFAULT '',
  decision_id    TEXT NOT NULL,
  created_at     BIGINT NOT NULL,
  request_digest TEXT NOT NULL,
  decision_json  JSONB NOT NULL,
  content_digest TEXT NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id, decision_id)
)`,
      `CREATE TABLE IF NOT EXISTS experience_plans (
  tenant_id     TEXT NOT NULL,
  workspace_id  TEXT NOT NULL DEFAULT '',
  plan_id       TEXT NOT NULL,
  version       INTEGER NOT NULL,
  created_at    BIGINT NOT NULL,
  reason        TEXT,
  plan_json     JSONB NOT NULL,
  content_digest TEXT NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id, plan_id, version)
)`,
      `CREATE TABLE IF NOT EXISTS catalog_items (
  tenant_id     TEXT NOT NULL,
  workspace_id  TEXT NOT NULL DEFAULT '',
  item_id       TEXT NOT NULL,
  item_json     JSONB NOT NULL,
  content_digest TEXT NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id, item_id)
)`,
      `CREATE TABLE IF NOT EXISTS realizations (
  tenant_id      TEXT NOT NULL,
  workspace_id   TEXT NOT NULL DEFAULT '',
  realization_id TEXT NOT NULL,
  item_id        TEXT NOT NULL,
  realization_json JSONB NOT NULL,
  content_digest TEXT NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id, realization_id)
)`,
      `CREATE TABLE IF NOT EXISTS preference_deltas (
  sequence      BIGSERIAL PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  workspace_id  TEXT NOT NULL DEFAULT '',
  subject_kind  TEXT NOT NULL,
  subject_ref   TEXT NOT NULL,
  delta_json    JSONB NOT NULL,
  content_digest TEXT NOT NULL,
  recorded_at   BIGINT NOT NULL
)`,
      `CREATE INDEX IF NOT EXISTS preference_deltas_tenant_subject
         ON preference_deltas (tenant_id, workspace_id, subject_kind, subject_ref, sequence)`,
      `CREATE TABLE IF NOT EXISTS context_snapshots (
  tenant_id     TEXT NOT NULL,
  workspace_id  TEXT NOT NULL DEFAULT '',
  context_id    TEXT NOT NULL,
  context_json  JSONB NOT NULL,
  content_digest TEXT NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id, context_id)
)`,
      `CREATE TABLE IF NOT EXISTS research_jobs (
  job_id        TEXT NOT NULL PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  workspace_id  TEXT NOT NULL DEFAULT '',
  kind          TEXT NOT NULL,
  state         TEXT NOT NULL CHECK (state IN ('queued','leased','done','failed')),
  payload_json  JSONB NOT NULL,
  result_ref    TEXT,
  lease_owner   TEXT,
  lease_expires_at BIGINT,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL
)`,
      `CREATE INDEX IF NOT EXISTS research_jobs_queue
         ON research_jobs (state, created_at)`,
      `CREATE TABLE IF NOT EXISTS observability_records (
  sequence    BIGSERIAL PRIMARY KEY,
  record_id   TEXT NOT NULL,
  tenant_id   TEXT,
  scope       TEXT NOT NULL,
  record_json JSONB NOT NULL,
  recorded_at BIGINT NOT NULL
)`,
      `CREATE INDEX IF NOT EXISTS observability_records_tenant
         ON observability_records (tenant_id, sequence)`,
    ],
  },
];

function migrationChecksum(migration: Migration): string {
  return createHash("sha256").update(migration.sql.join("\n;\n")).digest("hex");
}

/** Idempotently create the bookkeeping table (shared by apply + status). */
async function ensureBookkeeping(executor: SqlExecutor): Promise<void> {
  await executor.transaction(async (tx) => {
    await tx.query(
      `CREATE TABLE IF NOT EXISTS reckon_schema_migrations (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  checksum   TEXT NOT NULL
)`,
    );
  });
}

/**
 * Per-migration status for `reckon-migrate status` (P1-004).
 *
 * `checksumOk` is `null` for pending migrations and a hard boolean for
 * applied ones: a `false` means the recorded checksum no longer matches
 * the migration SQL in the running code (edited-after-apply tampering, or
 * a partial upgrade) — the CLI exits 2 on any tamper, honestly.
 */
export interface MigrationStatusEntry {
  readonly id: string;
  readonly name: string;
  readonly applied: boolean;
  /** null ⇔ pending; false ⇔ recorded checksum mismatch (tamper). */
  readonly checksumOk: boolean | null;
  readonly appliedAt: string | null;
}

/**
 * Report the applied/pending state of every known migration, verifying
 * recorded checksums against the current migration SQL. Safe on a fresh
 * database (everything reports pending; the bookkeeping table is created
 * idempotently first). Read-only beyond that creation.
 */
export async function migrationStatus(executor: SqlExecutor): Promise<readonly MigrationStatusEntry[]> {
  await ensureBookkeeping(executor);
  const rows = await executor.query(`SELECT id, name, applied_at, checksum FROM reckon_schema_migrations`);
  const recorded = new Map<string, { appliedAt: string; checksum: string }>();
  for (const row of rows) {
    recorded.set(String(row.id), { appliedAt: String(row.applied_at), checksum: String(row.checksum) });
  }
  return MIGRATIONS.map((migration) => {
    const row = recorded.get(migration.id);
    if (row === undefined) {
      return { id: migration.id, name: migration.name, applied: false, checksumOk: null, appliedAt: null };
    }
    return {
      id: migration.id,
      name: migration.name,
      applied: true,
      checksumOk: row.checksum === migrationChecksum(migration),
      appliedAt: row.appliedAt,
    };
  });
}

/**
 * Apply all not-yet-applied migrations (idempotent). Returns the ids
 * applied by THIS call (empty when the schema is current).
 */
export async function applyMigrations(executor: SqlExecutor): Promise<readonly string[]> {
  await ensureBookkeeping(executor);

  const applied: string[] = [];
  for (const migration of MIGRATIONS) {
    const existing = await executor.query(
      `SELECT checksum FROM reckon_schema_migrations WHERE id = $1`,
      [migration.id],
    );
    if (existing.length > 0) continue;
    try {
      await executor.transaction(async (tx) => {
        for (const statement of migration.sql) {
          await tx.query(statement);
        }
        await tx.query(
          `INSERT INTO reckon_schema_migrations (id, name, applied_at, checksum)
           VALUES ($1, $2, $3, $4)`,
          [
            migration.id,
            migration.name,
            new Date().toISOString(),
            migrationChecksum(migration),
          ],
        );
      });
    } catch (error) {
      throw new MigrationError(migration.id, error);
    }
    applied.push(migration.id);
  }
  return applied;
}
