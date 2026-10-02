/**
 * Authoritative state stores over PostgreSQL (P1-001).
 *
 * Every store: tenant-scoped by construction (tenant_id + workspace_id in
 * every WHERE), canonical-JSON payload + sha256 content digest, parses
 * back through the frozen @reckon/contracts schemas on read (the contract
 * schema stays the single authority — PG columns are indexes, not a
 * second schema), append-only where the append law demands it
 * (preference_deltas, experience_plans versions).
 *
 * The ADR-001 "durable jobs and worker leases" law is carried by
 * PgResearchJobStore (enqueue → claim with lease → reclaim expired →
 * complete/fail).
 */
import {
  CatalogItemSchema,
  ContextSnapshotSchema,
  DecisionResultSchema,
  ExperiencePlanSchema,
  PreferenceDeltaSchema,
  RealizationSchema,
  canonicalJson,
  contentDigest,
  type CatalogItem,
  type ContextSnapshot,
  type DecisionResult,
  type ExperiencePlan,
  type Id,
  type PreferenceDelta,
  type Realization,
  type SubjectReference,
  type TenantScope,
} from "@reckon/contracts";
import type { SqlExecutor } from "./executor.js";
import { tenantColumns } from "./event-sink.js";
import { ResearchJobError, StateIdConflictError, StoredRecordParseError } from "./errors.js";

function parseOr<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: { message: string } } }, kind: string, id: string | undefined, raw: unknown): T {
  const parsed = schema.safeParse(typeof raw === "string" ? JSON.parse(raw) : raw);
  if (!parsed.success || parsed.data === undefined) {
    throw new StoredRecordParseError(kind, id, `stored ${kind} failed schema validation: ${parsed.error?.message ?? "unknown"}`);
  }
  return parsed.data;
}

/* ------------------------------------------------------------------ *
 * Decisions                                                           *
 * ------------------------------------------------------------------ */

export class PgDecisionStore {
  readonly #executor: SqlExecutor;

  constructor(executor: SqlExecutor) {
    this.#executor = executor;
  }

  /**
   * Store a decision result. Same (tenant, workspace, decisionId) with the
   * SAME request digest is idempotent (returns the stored original); a
   * DIFFERENT digest is a typed StateIdConflictError (ids are immutable).
   */
  async put(decision: DecisionResult, requestDigest: string): Promise<{ readonly duplicate: boolean; readonly stored: DecisionResult }> {
    const { tenantId, workspaceId } = tenantColumns(decision.tenant);
    const digest = contentDigest(decision);
    const existing = await this.#executor.query(
      `SELECT request_digest, decision_json FROM decisions
       WHERE tenant_id = $1 AND workspace_id = $2 AND decision_id = $3`,
      [tenantId, workspaceId, decision.decisionId],
    );
    if (existing.length > 0) {
      const existingDigest = String(existing[0]!.request_digest);
      if (existingDigest !== requestDigest) {
        throw new StateIdConflictError(
          "decision",
          tenantId,
          decision.decisionId,
          `decision ${decision.decisionId} already stored with a different request digest`,
        );
      }
      const stored = parseOr(DecisionResultSchema, "decision", decision.decisionId, existing[0]!.decision_json);
      return { duplicate: true, stored };
    }
    await this.#executor.query(
      `INSERT INTO decisions (
         tenant_id, workspace_id, decision_id, created_at,
         request_digest, decision_json, content_digest
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [tenantId, workspaceId, decision.decisionId, decision.at, requestDigest, canonicalJson(decision), digest],
    );
    return { duplicate: false, stored: decision };
  }

  async get(tenantId: string, decisionId: string): Promise<DecisionResult | null> {
    const rows = await this.#executor.query(
      `SELECT decision_json FROM decisions WHERE tenant_id = $1 AND decision_id = $2`,
      [tenantId, decisionId],
    );
    if (rows.length === 0) return null;
    return parseOr(DecisionResultSchema, "decision", decisionId, rows[0]!.decision_json);
  }

  async list(tenant: TenantScope): Promise<readonly DecisionResult[]> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const rows = await this.#executor.query(
      `SELECT decision_json, decision_id FROM decisions
       WHERE tenant_id = $1 AND workspace_id = $2 ORDER BY created_at ASC, decision_id ASC`,
      [tenantId, workspaceId],
    );
    return rows.map((row) => parseOr(DecisionResultSchema, "decision", String(row.decision_id), row.decision_json));
  }
}

/* ------------------------------------------------------------------ *
 * Experience plans (versioned, append-only replan history)             *
 * ------------------------------------------------------------------ */

export interface StoredPlanVersion {
  readonly plan: ExperiencePlan;
  readonly version: number;
  readonly reason: string | null;
  readonly createdAt: number;
}

export class PgPlanStore {
  readonly #executor: SqlExecutor;

  constructor(executor: SqlExecutor) {
    this.#executor = executor;
  }

  /** Create a plan (version 1). A re-create with the same planId is a typed conflict. */
  async create(plan: ExperiencePlan): Promise<StoredPlanVersion> {
    const { tenantId, workspaceId } = tenantColumns(plan.tenant);
    const existing = await this.#executor.query(
      `SELECT plan_id FROM experience_plans WHERE tenant_id = $1 AND workspace_id = $2 AND plan_id = $3`,
      [tenantId, workspaceId, plan.planId],
    );
    if (existing.length > 0) {
      throw new StateIdConflictError(
        "plan",
        tenantId,
        plan.planId,
        `plan ${plan.planId} already exists (use replan to version it)`,
      );
    }
    await this.#executor.query(
      `INSERT INTO experience_plans (
         tenant_id, workspace_id, plan_id, version, created_at, reason, plan_json, content_digest
       ) VALUES ($1,$2,$3,1,$4,NULL,$5::jsonb,$6)`,
      [tenantId, workspaceId, plan.planId, planCreatedAt(plan), canonicalJson(plan), contentDigest(plan)],
    );
    return { plan, version: 1, reason: null, createdAt: planCreatedAt(plan) };
  }

  /** Append a new version (never overwrites history). */
  async replan(plan: ExperiencePlan, reason: string): Promise<StoredPlanVersion> {
    const { tenantId, workspaceId } = tenantColumns(plan.tenant);
    const nextVersion = await this.#executor.transaction(async (tx) => {
      const maxRow = await tx.query(
        `SELECT coalesce(max(version), 0)::int AS v FROM experience_plans
         WHERE tenant_id = $1 AND workspace_id = $2 AND plan_id = $3`,
        [tenantId, workspaceId, plan.planId],
      );
      return Number(maxRow[0]!.v) + 1;
    });
    if (nextVersion === 1) {
      // No history at all — same contract as create().
      return this.create(plan);
    }
    const createdAt = planCreatedAt(plan);
    await this.#executor.query(
      `INSERT INTO experience_plans (
         tenant_id, workspace_id, plan_id, version, created_at, reason, plan_json, content_digest
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
      [tenantId, workspaceId, plan.planId, nextVersion, createdAt, reason, canonicalJson(plan), contentDigest(plan)],
    );
    return { plan, version: nextVersion, reason, createdAt };
  }

  async get(tenant: TenantScope, planId: Id): Promise<StoredPlanVersion | null> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const rows = await this.#executor.query(
      `SELECT version, reason, created_at, plan_json FROM experience_plans
       WHERE tenant_id = $1 AND workspace_id = $2 AND plan_id = $3
       ORDER BY version DESC LIMIT 1`,
      [tenantId, workspaceId, planId],
    );
    if (rows.length === 0) return null;
    return this.#rowToVersion(rows[0]!, planId);
  }

  /**
   * Latest version of each plan for a tenant, newest first (P1/UI-005
   * read surface: GET /v1/plans). DISTINCT ON keeps one row per plan_id
   * (highest version); the created_at DESC re-sort + slice happens in JS
   * because DISTINCT ON's required ORDER BY conflicts with it.
   */
  async listRecent(tenant: TenantScope, limit = 20): Promise<readonly StoredPlanVersion[]> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const rows = await this.#executor.query(
      `SELECT DISTINCT ON (plan_id) plan_id, version, reason, created_at, plan_json
       FROM experience_plans
       WHERE tenant_id = $1 AND workspace_id = $2
       ORDER BY plan_id, version DESC`,
      [tenantId, workspaceId],
    );
    const versions = rows.map((row) =>
      this.#rowToVersion(row, String((row as Record<string, unknown>).plan_id)),
    );
    versions.sort((a, b) => b.createdAt - a.createdAt);
    return versions.slice(0, Math.max(1, Math.min(limit, 100)));
  }

  async history(tenant: TenantScope, planId: Id): Promise<readonly StoredPlanVersion[]> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const rows = await this.#executor.query(
      `SELECT version, reason, created_at, plan_json FROM experience_plans
       WHERE tenant_id = $1 AND workspace_id = $2 AND plan_id = $3
       ORDER BY version ASC`,
      [tenantId, workspaceId, planId],
    );
    return rows.map((row) => this.#rowToVersion(row, planId));
  }

  #rowToVersion(row: Record<string, unknown>, planId: Id): StoredPlanVersion {
    return {
      plan: parseOr(ExperiencePlanSchema, "plan", planId, row.plan_json),
      version: Number(row.version),
      reason: row.reason === null ? null : String(row.reason),
      createdAt: Number(row.created_at),
    };
  }
}

/** Caller-supplied plan timestamp (plans carry `createdAt`; 0 fallback honest). */
function planCreatedAt(plan: ExperiencePlan): number {
  const withAt = plan as ExperiencePlan & { createdAt?: number };
  return typeof withAt.createdAt === "number" ? withAt.createdAt : 0;
}

/* ------------------------------------------------------------------ *
 * Catalog + realizations                                              *
 * ------------------------------------------------------------------ */

export class PgCatalogStore {
  readonly #executor: SqlExecutor;

  constructor(executor: SqlExecutor) {
    this.#executor = executor;
  }

  /** Catalog items carry no tenant field — the scope comes from the caller (AuthContext law). */
  async putItem(tenant: TenantScope, item: CatalogItem): Promise<{ readonly duplicate: boolean }> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const result = await this.#executor.query(
      `INSERT INTO catalog_items (tenant_id, workspace_id, item_id, item_json, content_digest)
       VALUES ($1,$2,$3,$4::jsonb,$5)
       ON CONFLICT (tenant_id, workspace_id, item_id) DO NOTHING
       RETURNING item_id`,
      [tenantId, workspaceId, item.itemId, canonicalJson(item), contentDigest(item)],
    );
    return { duplicate: result.length === 0 };
  }

  async getItem(tenant: TenantScope, itemId: Id): Promise<CatalogItem | null> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const rows = await this.#executor.query(
      `SELECT item_json FROM catalog_items WHERE tenant_id = $1 AND workspace_id = $2 AND item_id = $3`,
      [tenantId, workspaceId, itemId],
    );
    if (rows.length === 0) return null;
    return parseOr(CatalogItemSchema, "catalog_item", itemId, rows[0]!.item_json);
  }

  async listItems(tenant: TenantScope): Promise<readonly CatalogItem[]> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const rows = await this.#executor.query(
      `SELECT item_json, item_id FROM catalog_items
       WHERE tenant_id = $1 AND workspace_id = $2 ORDER BY item_id ASC`,
      [tenantId, workspaceId],
    );
    return rows.map((row) => parseOr(CatalogItemSchema, "catalog_item", String(row.item_id), row.item_json));
  }

  async putRealization(tenant: TenantScope, realization: Realization): Promise<{ readonly duplicate: boolean }> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const result = await this.#executor.query(
      `INSERT INTO realizations (tenant_id, workspace_id, realization_id, item_id, realization_json, content_digest)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6)
       ON CONFLICT (tenant_id, workspace_id, realization_id) DO NOTHING
       RETURNING realization_id`,
      [tenantId, workspaceId, realization.realizationId, realization.itemId, canonicalJson(realization), contentDigest(realization)],
    );
    return { duplicate: result.length === 0 };
  }

  async getRealization(tenant: TenantScope, realizationId: Id): Promise<Realization | null> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const rows = await this.#executor.query(
      `SELECT realization_json FROM realizations
       WHERE tenant_id = $1 AND workspace_id = $2 AND realization_id = $3`,
      [tenantId, workspaceId, realizationId],
    );
    if (rows.length === 0) return null;
    return parseOr(RealizationSchema, "realization", realizationId, rows[0]!.realization_json);
  }

  async listRealizations(tenant: TenantScope, itemId?: Id): Promise<readonly Realization[]> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const itemClause = itemId === undefined ? "" : " AND item_id = $3";
    const rows = await this.#executor.query(
      `SELECT realization_json, realization_id FROM realizations
       WHERE tenant_id = $1 AND workspace_id = $2${itemClause} ORDER BY realization_id ASC`,
      itemId === undefined ? [tenantId, workspaceId] : [tenantId, workspaceId, itemId],
    );
    return rows.map((row) => parseOr(RealizationSchema, "realization", String(row.realization_id), row.realization_json));
  }
}

/* ------------------------------------------------------------------ *
 * Preference deltas (append-only)                                     *
 * ------------------------------------------------------------------ */

export class PgPreferenceStore {
  readonly #executor: SqlExecutor;

  constructor(executor: SqlExecutor) {
    this.#executor = executor;
  }

  /** Append one delta (append law — never overwritten, never deleted). */
  async append(delta: PreferenceDelta): Promise<{ readonly sequence: number }> {
    const { tenantId, workspaceId } = tenantColumns(delta.tenant);
    const rows = await this.#executor.query(
      `INSERT INTO preference_deltas (
         tenant_id, workspace_id, subject_kind, subject_ref,
         delta_json, content_digest, recorded_at
       ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
       RETURNING sequence`,
      [
        tenantId,
        workspaceId,
        delta.subject.kind,
        delta.subject.ref,
        canonicalJson(delta),
        contentDigest(delta),
        delta.timestamp,
      ],
    );
    return { sequence: Number(rows[0]!.sequence) };
  }

  async bySubject(tenant: TenantScope, subject: SubjectReference): Promise<readonly PreferenceDelta[]> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const rows = await this.#executor.query(
      `SELECT delta_json FROM preference_deltas
       WHERE tenant_id = $1 AND workspace_id = $2 AND subject_kind = $3 AND subject_ref = $4
       ORDER BY sequence ASC`,
      [tenantId, workspaceId, subject.kind, subject.ref],
    );
    return rows.map((row) => parseOr(PreferenceDeltaSchema, "preference_delta", undefined, row.delta_json));
  }
}

/* ------------------------------------------------------------------ *
 * Context snapshots                                                   *
 * ------------------------------------------------------------------ */

export class PgContextStore {
  readonly #executor: SqlExecutor;

  constructor(executor: SqlExecutor) {
    this.#executor = executor;
  }

  /** Context snapshots carry no tenant field — the scope comes from the caller (AuthContext law). */
  async put(tenant: TenantScope, snapshot: ContextSnapshot): Promise<{ readonly duplicate: boolean }> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const result = await this.#executor.query(
      `INSERT INTO context_snapshots (tenant_id, workspace_id, context_id, context_json, content_digest)
       VALUES ($1,$2,$3,$4::jsonb,$5)
       ON CONFLICT (tenant_id, workspace_id, context_id) DO NOTHING
       RETURNING context_id`,
      [tenantId, workspaceId, snapshot.contextId, canonicalJson(snapshot), contentDigest(snapshot)],
    );
    return { duplicate: result.length === 0 };
  }

  async get(tenant: TenantScope, contextId: Id): Promise<ContextSnapshot | null> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const rows = await this.#executor.query(
      `SELECT context_json FROM context_snapshots
       WHERE tenant_id = $1 AND workspace_id = $2 AND context_id = $3`,
      [tenantId, workspaceId, contextId],
    );
    if (rows.length === 0) return null;
    return parseOr(ContextSnapshotSchema, "context_snapshot", contextId, rows[0]!.context_json);
  }

  async list(tenant: TenantScope): Promise<readonly ContextSnapshot[]> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const rows = await this.#executor.query(
      `SELECT context_json, context_id FROM context_snapshots
       WHERE tenant_id = $1 AND workspace_id = $2 ORDER BY context_id ASC`,
      [tenantId, workspaceId],
    );
    return rows.map((row) => parseOr(ContextSnapshotSchema, "context_snapshot", String(row.context_id), row.context_json));
  }
}

/* ------------------------------------------------------------------ *
 * Research jobs (durable jobs + worker leases — ADR-001)              *
 * ------------------------------------------------------------------ */

export interface ResearchJob {
  readonly jobId: string;
  readonly tenant: TenantScope;
  readonly kind: string;
  readonly state: "queued" | "leased" | "done" | "failed";
  readonly payload: unknown;
  readonly resultRef: string | null;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface EnqueueResearchJob {
  readonly jobId: string;
  readonly tenant: TenantScope;
  readonly kind: string;
  readonly payload: unknown;
}

export class PgResearchJobStore {
  readonly #executor: SqlExecutor;
  readonly #clock: { now(): number };

  constructor(executor: SqlExecutor, clock: { now(): number }) {
    this.#executor = executor;
    this.#clock = clock;
  }

  async enqueue(job: EnqueueResearchJob): Promise<ResearchJob> {
    const { tenantId, workspaceId } = tenantColumns(job.tenant);
    const existing = await this.#executor.query(
      `SELECT job_id FROM research_jobs WHERE job_id = $1`,
      [job.jobId],
    );
    if (existing.length > 0) {
      throw new ResearchJobError(job.jobId, `research job ${job.jobId} already exists`);
    }
    const now = this.#clock.now();
    await this.#executor.query(
      `INSERT INTO research_jobs (
         job_id, tenant_id, workspace_id, kind, state,
         payload_json, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,'queued',$5::jsonb,$6,$6)`,
      [job.jobId, tenantId, workspaceId, job.kind, JSON.stringify(job.payload ?? null), now],
    );
    return {
      jobId: job.jobId,
      tenant: job.tenant,
      kind: job.kind,
      state: "queued",
      payload: job.payload,
      resultRef: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Claim the oldest queued job (FIFO) with a lease that expires after
   * `leaseMs` (injected-clock time). Returns undefined when the queue is
   * empty or every job is actively leased.
   */
  /** Latest jobs for a tenant, newest first (bounded; state filter optional). */
  async listRecent(
    tenant: { tenantId: string; workspaceId?: string },
    limit = 20,
    state?: "queued" | "leased" | "done" | "failed",
  ): Promise<readonly ResearchJob[]> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const rows = await this.#executor.query(
      `SELECT job_id, kind, state, payload_json, result_ref,
              lease_owner, lease_expires_at, created_at, updated_at
       FROM research_jobs
       WHERE tenant_id = $1 AND workspace_id = $2 AND ($3::text IS NULL OR state = $3)
       ORDER BY updated_at DESC, job_id ASC
       LIMIT $4`,
      [tenantId, workspaceId, state ?? null, Math.max(1, Math.min(limit, 100))],
    );
    return rows.map((row) => this.#rowToJob(row));
  }

  async claim(owner: string, leaseMs: number): Promise<ResearchJob | undefined> {
    const now = this.#clock.now();
    const claimed = await this.#executor.transaction(async (tx) => {
      // Reclaim expired leases first (durable-worker crash recovery).
      await tx.query(
        `UPDATE research_jobs
         SET state = 'queued', lease_owner = NULL, lease_expires_at = NULL, updated_at = $1
         WHERE state = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at <= $1`,
        [now],
      );
      const rows = await tx.query(
        `UPDATE research_jobs
         SET state = 'leased', lease_owner = $1, lease_expires_at = $2, updated_at = $2
         WHERE job_id = (
           SELECT job_id FROM research_jobs WHERE state = 'queued'
           ORDER BY created_at ASC, job_id ASC LIMIT 1 FOR UPDATE SKIP LOCKED
         )
         RETURNING *`,
        [owner, now + leaseMs],
      );
      return rows.length > 0 ? rows[0] : undefined;
    });
    return claimed === undefined ? undefined : this.#rowToJob(claimed);
  }

  async complete(jobId: string, resultRef: string): Promise<void> {
    const now = this.#clock.now();
    const rows = await this.#executor.query(
      `UPDATE research_jobs
       SET state = 'done', result_ref = $1, lease_owner = NULL, lease_expires_at = NULL, updated_at = $2
       WHERE job_id = $3 AND state = 'leased'
       RETURNING job_id`,
      [resultRef, now, jobId],
    );
    if (rows.length === 0) {
      throw new ResearchJobError(jobId, `research job ${jobId} is not leased (cannot complete)`);
    }
  }

  async fail(jobId: string, error: string): Promise<void> {
    const now = this.#clock.now();
    const rows = await this.#executor.query(
      `UPDATE research_jobs
       SET state = 'failed', result_ref = $2, lease_owner = NULL, lease_expires_at = NULL, updated_at = $3
       WHERE job_id = $1 AND state = 'leased'
       RETURNING job_id`,
      [jobId, `error: ${error}`, now],
    );
    if (rows.length === 0) {
      throw new ResearchJobError(jobId, `research job ${jobId} is not leased (cannot fail)`);
    }
  }

  /** Requeue every job whose lease expired (independent sweep — ADR-001). */
  async reclaimExpired(): Promise<readonly string[]> {
    const now = this.#clock.now();
    const rows = await this.#executor.query(
      `UPDATE research_jobs
       SET state = 'queued', lease_owner = NULL, lease_expires_at = NULL, updated_at = $1
       WHERE state = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at <= $1
       RETURNING job_id`,
      [now],
    );
    return rows.map((row) => String(row.job_id));
  }

  async get(jobId: string): Promise<ResearchJob | undefined> {
    const rows = await this.#executor.query(`SELECT * FROM research_jobs WHERE job_id = $1`, [jobId]);
    return rows.length > 0 ? this.#rowToJob(rows[0]!) : undefined;
  }

  async listQueued(): Promise<readonly ResearchJob[]> {
    const rows = await this.#executor.query(
      `SELECT * FROM research_jobs WHERE state = 'queued' ORDER BY created_at ASC, job_id ASC`,
    );
    return rows.map((row) => this.#rowToJob(row));
  }

  #rowToJob(row: Record<string, unknown>): ResearchJob {
    return {
      jobId: String(row.job_id),
      tenant: {
        tenantId: String(row.tenant_id),
        ...(String(row.workspace_id) !== "" ? { workspaceId: String(row.workspace_id) } : {}),
      },
      kind: String(row.kind),
      state: row.state as ResearchJob["state"],
      payload: row.payload_json,
      resultRef: row.result_ref === null ? null : String(row.result_ref),
      leaseOwner: row.lease_owner === null ? null : String(row.lease_owner),
      leaseExpiresAt: row.lease_expires_at === null ? null : Number(row.lease_expires_at),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }
}
