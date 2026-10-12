/**
 * AD-002 — Personal Ad Memory persistence over the FROZEN AD-001
 * contracts (`packages/contracts/src/ads.ts`; ADR-005).
 *
 * Production = PostgreSQL per ADR-001 / P1-001 discipline: PgAdMemoryStore
 * runs on the SAME SqlExecutor port as every other production store (pg
 * wire driver, Neon-compatible via DATABASE_URL; the exact discipline
 * TL6-002 established with the webhook stores). The in-memory adapter at
 * the bottom of this file is TEST INFRASTRUCTURE ONLY — same port shape,
 * same laws, zero production authority (no hidden in-memory production
 * state — ADR-001).
 *
 * Store-level law mapping (the ten ad-memory privacy laws, ADR-005):
 *
 * - Law 1 (retention requires an explicit basis): every write is parsed
 *   through the frozen `AdMemoryRecordSchema` at the boundary — a
 *   retention without `basis` cannot be stored (typed
 *   AdMemoryRecordInvalidError). The `basis_kind` audit column mirrors
 *   the parsed basis.
 * - Law 2 (forget means unretrievable): `forget` transitions rows to the
 *   terminal `forgotten` retention (with `forgottenAt`); NO read path
 *   materializes forgotten content afterwards (`get` → null,
 *   `listRemembered` excludes it, a duplicate re-write of the identical
 *   content returns a tombstone — the row stays forgotten). No un-forget
 *   path exists or is added; permission transitions on a forgotten
 *   record are rejected.
 * - Law 3 (expired ≠ currently available): expiry is evaluated against
 *   the CALLER-supplied query clock `at` on every retrieval — the store
 *   keeps NO hidden clock authority (zero wall-clock reads in this
 *   file). Expired records are never returned as remembered candidates.
 * - Law 4 (encounter is not a redistribution license): `rights` is
 *   persisted and returned VERBATIM — the store never infers, upgrades
 *   or downgrades rights from availability or anything else.
 * - Law 5 (no silent raw location/attention/sensor persistence): the
 *   frozen schema has no such field and strips unknown keys on the
 *   boundary parse — a raw targeting payload injected into the evidence
 *   physically cannot persist through this store.
 * - Law 6 (no inferred audience attributes): same boundary mechanism —
 *   injected audience/attribute fields are stripped before persistence;
 *   the store adds none.
 * - Law 7 (user value separate from commercial value; the store is not
 *   a ranking authority): the store persists declared contract fields
 *   verbatim and adds NO ranking state; `listRemembered` ordering is
 *   deterministic (recordedAt, recordId) — chronological, never
 *   value-based. Ranking authority stays with the decision kernel.
 * - Law 8 (advertising stays identifiable): the boundary parse enforces
 *   `ad.kind === "advertising"` (AdCatalogItemSchema literal) — a
 *   non-ad catalog item cannot enter the ad-memory lane through this
 *   store.
 * - Law 9 (remembered vs provider-supplied provenance): `provenance` is
 *   stored and returned UNCHANGED (discriminated union verbatim); no
 *   store operation rewrites provenance.
 * - Law 10 (same evidence classes as the rest of Reckon): the boundary
 *   parse accepts only observed evidence classes — simulated/
 *   counterfactual/fixture encounters are typed rejections.
 *
 * Upsert policy (the documented AD-002 freedom, ADR-005 "record
 * cardinality"): this store maintains AT MOST ONE CURRENT (unsuperseded,
 * non-forgotten) record per (tenant, workspace, subject, ad.itemId).
 * A re-encounter with NEW evidence writes a new record (new digest ⇒
 * new recordId — `finalizeAdMemoryRecord` is the single construction
 * path) and SUPERSEDES the previous current record for the same
 * (subject, itemId). Superseded records remain verbatim in storage and
 * are still readable by recordId (audit), but never re-enter the
 * remembered lane. Re-writing IDENTICAL content is a no-op (duplicate)
 * and never changes supersession state. See docs/architecture/ad-memory-store.md.
 */
import {
  AdForgetRequestSchema,
  AdForgetResultSchema,
  AdMemoryRecordContentSchema,
  AdMemoryRecordSchema,
  AdPermissionTransitionSchema,
  adMemoryRecordDigest,
  adMemoryRecordId,
  applyAdPermissionTransition,
  canonicalJson,
  isAdMemoryRetrievable,
  type AdForgetRequest,
  type AdForgetResult,
  type AdMemoryRecord,
  type AdPermissionState,
  type AdPermissionTransition,
  type SubjectReference,
  type TenantScope,
  type TimestampMs,
} from "@reckon/contracts";
import type { SqlExecutor, SqlRow } from "./executor.js";
import { tenantColumns } from "./event-sink.js";
import { PersistenceError, StoredRecordParseError } from "./errors.js";

/* ------------------------------------------------------------------ *
 * Port shapes (AD-002 owns this port; AD-003 consumes the
 * remembered-lane lookup — a STORE method, never an HTTP route)
 * ------------------------------------------------------------------ */

/** Result of a `put`. See the upsert policy in the module header. */
export interface AdMemoryPutResult {
  /** "inserted" = a new row was written; "duplicate" = identical content already stored (no-op). */
  readonly outcome: "inserted" | "duplicate";
  /**
   * The stored record, materialized UNLESS the stored row is forgotten
   * (law 2: no read path — including this one — materializes forgotten
   * content). Null exactly when `forgottenAt` is non-null.
   */
  readonly record: AdMemoryRecord | null;
  /** Non-null when the stored row is forgotten: the honest tombstone (when it was forgotten). */
  readonly forgottenAt: number | null;
  /** Set when THIS write superseded the previous current record for the same (tenant, subject, itemId). */
  readonly supersededRecordId: string | null;
}

/** Result of `applyPermissionTransition`. */
export type AdMemoryTransitionResult =
  /** History appended (verbatim transition); the record stays materializable. */
  | { readonly effect: "updated"; readonly record: AdMemoryRecord }
  /**
   * Revoking `retain` REQUIRES the store to forget the record (contract
   * comment on AdPermissionStateSchema, ADR-003): terminal `forgotten`,
   * no content materialized (law 2).
   */
  | { readonly effect: "forgotten"; readonly recordId: string; readonly forgottenAt: number };

/** Optional knobs for the remembered-lane lookup (no filters — AD-003 owns query semantics). */
export interface RememberedAdMemoryQuery {
  readonly limit?: number;
}

/**
 * The Personal Ad Memory store port. The PRODUCTION implementation is
 * PgAdMemoryStore (PostgreSQL); InMemoryAdMemoryStore is test
 * infrastructure only.
 */
export interface AdMemoryStore {
  /**
   * Idempotent write: `finalizeAdMemoryRecord` before `put` is enforced
   * (digest/recordId consistency is re-derived at the boundary — a
   * hand-forged identity is a typed rejection). Re-writing identical
   * content is a no-op returning the existing stored state; a
   * re-encounter with new evidence inserts a new record and supersedes
   * the previous current record for the same (subject, itemId).
   */
  put(record: AdMemoryRecord): Promise<AdMemoryPutResult>;
  /**
   * By-recordId read, tenant-scoped by construction. Returns the stored
   * record VERBATIM, or null when unknown in this tenant scope — and
   * null for FORGOTTEN records (law 2: forgotten means unretrievable,
   * on every read path; the tombstone columns remain queryable by the
   * host's own audit tooling).
   */
  get(tenant: TenantScope, recordId: string): Promise<AdMemoryRecord | null>;
  /**
   * Store-level retrieval query for AD-003 (remembered lane): the
   * structurally-active, permission-passing (retain AND present
   * granted), non-expired (against the CALLER-supplied clock `at`),
   * current (unsuperseded) records of one tenant+subject. Deterministic
   * chronological order (recordedAt, recordId) — NOT a ranking (law 7).
   */
  listRemembered(
    tenant: TenantScope,
    subject: SubjectReference,
    at: TimestampMs,
    options?: RememberedAdMemoryQuery,
  ): Promise<readonly AdMemoryRecord[]>;
  /**
   * Execute an `AdForgetRequest` (record / item / advertiser / all
   * targets): matching, not-yet-forgotten records of the request's
   * tenant+subject transition to the terminal `forgotten` retention
   * (carrying their basis — law 1 — plus `forgottenAt` = request.at and
   * `forgetReason` = request.reason). Idempotent at the row level:
   * already-forgotten rows are untouched and not re-counted.
   */
  forget(request: AdForgetRequest): Promise<AdForgetResult>;
  /**
   * Append one validated permission transition (via the frozen
   * `applyAdPermissionTransition` — a `from`-mismatch is a typed
   * rejection, history is append-only and persisted in full). Revoking
   * `retain` triggers terminal forget (see AdMemoryTransitionResult).
   */
  applyPermissionTransition(
    tenant: TenantScope,
    recordId: string,
    transition: AdPermissionTransition,
  ): Promise<AdMemoryTransitionResult>;
}

/* ------------------------------------------------------------------ *
 * Typed failures (honest — no silent fallbacks; law: nothing is
 * faked green). Defined here (not errors.ts) to keep AD-002's granted
 * surface additive; they extend the shared PersistenceError base.
 * ------------------------------------------------------------------ */

/** A memory write/forget/transition input failed the frozen-contract boundary (laws 1, 5, 6, 8, 10 + identity forgery). */
export class AdMemoryRecordInvalidError extends PersistenceError {
  readonly recordId: string | undefined;

  constructor(recordId: string | undefined, message: string) {
    super("PERSISTENCE_AD_MEMORY_RECORD_INVALID", message);
    this.name = "AdMemoryRecordInvalidError";
    this.recordId = recordId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * A concurrent write crossed this transaction and hit a uniqueness
 * guard (the record PK or the one-current-per-(subject,itemId) partial
 * unique index). Honest and retryable: the store never silently
 * absorbs cross-statement races; a re-put resolves idempotently.
 */
export class AdMemoryWriteConflictError extends PersistenceError {
  constructor(message: string) {
    super("PERSISTENCE_AD_MEMORY_WRITE_CONFLICT", message);
    this.name = "AdMemoryWriteConflictError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A permission transition was rejected (unknown record in scope, forgotten record, or `from` mismatch). */
export class AdMemoryTransitionRejectedError extends PersistenceError {
  readonly recordId: string;

  constructor(recordId: string, message: string) {
    super("PERSISTENCE_AD_MEMORY_TRANSITION_REJECTED", message);
    this.name = "AdMemoryTransitionRejectedError";
    this.recordId = recordId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/* ------------------------------------------------------------------ *
 * Boundary validation + shared helpers
 * ------------------------------------------------------------------ */

/**
 * Enforce "finalizeAdMemoryRecord before write" at the store boundary:
 * re-parse through the frozen schema (strips unknown keys — laws 5/6;
 * enforces basis/observed-evidence/advertising-kind — laws 1/8/10) and
 * re-derive the canonical digest + recordId (a hand-forged identity is
 * a typed rejection, never a silent accept).
 */
function assertFinalizedAdMemoryRecord(record: AdMemoryRecord): AdMemoryRecord {
  const inputRecordId = (record as { recordId?: unknown }).recordId;
  const recordId = typeof inputRecordId === "string" ? inputRecordId : undefined;
  const parsed = AdMemoryRecordSchema.safeParse(record);
  if (!parsed.success) {
    throw new AdMemoryRecordInvalidError(
      recordId,
      `ad memory record failed the frozen contract boundary parse: ${parsed.error.message}`,
    );
  }
  const stored = parsed.data;
  const content = AdMemoryRecordContentSchema.parse(stored);
  const digest = adMemoryRecordDigest(content);
  if (digest !== stored.contentDigest) {
    throw new AdMemoryRecordInvalidError(
      stored.recordId,
      `contentDigest mismatch: record carries ${stored.contentDigest} but the canonical digest of its content is ${digest} — construct memory writes through finalizeAdMemoryRecord() (AD-002 idempotent-write law)`,
    );
  }
  const derivedId = adMemoryRecordId(content);
  if (derivedId !== stored.recordId) {
    throw new AdMemoryRecordInvalidError(
      stored.recordId,
      `recordId mismatch: record carries ${stored.recordId} but the content derives ${derivedId} — construct memory writes through finalizeAdMemoryRecord() (AD-002 idempotent-write law)`,
    );
  }
  return stored;
}

/** Parse a stored row's record_json back through the frozen schema (integrity on read). */
function parseStoredAdMemoryRecord(raw: unknown, recordId: string): AdMemoryRecord {
  const parsed = AdMemoryRecordSchema.safeParse(typeof raw === "string" ? JSON.parse(raw) : raw);
  if (!parsed.success) {
    throw new StoredRecordParseError(
      "ad_memory_record",
      recordId,
      `stored ad memory record failed schema validation: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

/**
 * Build the terminal `forgotten` version of a record: the retention
 * basis is CARRIED (law 1 — even a forgotten record keeps its explicit
 * basis for the audit trail), retainedAt/expiresAt are preserved when
 * present, `forgottenAt` is the caller-supplied instant, `forgetReason`
 * mirrors the request reason when given. No other field changes — the
 * record stays verbatim (laws 4/9), just terminally unretrievable.
 */
function toForgottenAdMemoryRecord(
  record: AdMemoryRecord,
  forgottenAt: number,
  reason: string | undefined,
): AdMemoryRecord {
  const retention = record.retention;
  const forgotten = AdMemoryRecordSchema.parse({
    ...record,
    retention: {
      state: "forgotten",
      basis: retention.basis,
      ...(retention.retainedAt !== undefined ? { retainedAt: retention.retainedAt } : {}),
      ...(retention.expiresAt !== undefined ? { expiresAt: retention.expiresAt } : {}),
      forgottenAt,
      ...(reason !== undefined ? { forgetReason: reason } : {}),
    },
  });
  return forgotten;
}

/** Wrap cross-statement unique violations as typed, retryable conflicts (never silently absorbed). */
function toAdMemoryWriteConflict(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("duplicate key value violates unique constraint")) {
    return new AdMemoryWriteConflictError(
      `concurrent ad-memory write crossed this transaction (${message}); the store does not silently absorb cross-statement races — re-put the record (idempotent by construction)`,
    );
  }
  return error;
}

/** Validate a transition input at the boundary (frozen schema). */
function assertValidTransition(transition: AdPermissionTransition): AdPermissionTransition {
  const parsed = AdPermissionTransitionSchema.safeParse(transition);
  if (!parsed.success) {
    throw new AdMemoryRecordInvalidError(undefined, `ad permission transition failed boundary parse: ${parsed.error.message}`);
  }
  return parsed.data;
}

/* ------------------------------------------------------------------ *
 * PgAdMemoryStore — the PRODUCTION store (AD-002)
 * ------------------------------------------------------------------ */

/** TL6-002-pattern production PostgreSQL Personal Ad Memory store. */
export class PgAdMemoryStore implements AdMemoryStore {
  readonly #executor: SqlExecutor;

  constructor(executor: SqlExecutor) {
    this.#executor = executor;
  }

  async put(record: AdMemoryRecord): Promise<AdMemoryPutResult> {
    const stored = assertFinalizedAdMemoryRecord(record);
    const { tenantId, workspaceId } = tenantColumns(stored.tenant);
    try {
      return await this.#executor.transaction(async (tx) => {
        // Duplicate check FIRST: an identical-content re-write must be a
        // pure no-op — it must NOT touch supersession state.
        const existing = await tx.query(
          `SELECT retention_state, forgotten_at, record_json FROM ad_memory_records
           WHERE tenant_id = $1 AND workspace_id = $2 AND record_id = $3`,
          [tenantId, workspaceId, stored.recordId],
        );
        if (existing.length > 0) {
          return duplicateResult(existing[0]!, stored.recordId);
        }
        // Supersede the previous current record for
        // (tenant, workspace, subject, itemId) BEFORE the insert: the
        // ad_memory_records_current_item partial unique index guarantees
        // at most ONE unsuperseded, non-forgotten record per
        // (subject, item). Forgotten rows are never superseded (they
        // are already terminal — and stay unretrievable forever).
        const superseded = await tx.query(
          `UPDATE ad_memory_records
           SET superseded_by_record_id = $5, superseded_at = $6
           WHERE tenant_id = $1 AND workspace_id = $2 AND subject_kind = $3 AND subject_ref = $4
             AND item_id = $7 AND record_id <> $5
             AND superseded_by_record_id IS NULL AND retention_state <> 'forgotten'
           RETURNING record_id`,
          [
            tenantId,
            workspaceId,
            stored.subject.kind,
            stored.subject.ref,
            stored.recordId,
            stored.recordedAt,
            stored.ad.itemId,
          ],
        );
        const inserted = await tx.query(
          `INSERT INTO ad_memory_records (
             record_id, tenant_id, workspace_id, subject_kind, subject_ref, item_id,
             lineage_advertiser_ref, retention_state, basis_kind, expires_at, forgotten_at,
             permission_retain, permission_present, provenance_kind, recorded_at,
             idempotency_key, record_json, content_digest
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18)
           ON CONFLICT (tenant_id, workspace_id, record_id) DO NOTHING
           RETURNING record_id`,
          [
            stored.recordId,
            tenantId,
            workspaceId,
            stored.subject.kind,
            stored.subject.ref,
            stored.ad.itemId,
            stored.lineage.advertiserRef ?? null,
            stored.retention.state,
            stored.retention.basis.kind,
            stored.retention.expiresAt ?? null,
            stored.retention.state === "forgotten" ? stored.retention.forgottenAt : null,
            stored.permissions.retain,
            stored.permissions.present,
            stored.provenance.kind,
            stored.recordedAt,
            stored.idempotencyKey ?? null,
            canonicalJson(stored),
            stored.contentDigest,
          ],
        );
        if (inserted.length > 0) {
          return {
            outcome: "inserted" as const,
            record: stored,
            forgottenAt: null,
            supersededRecordId: superseded.length > 0 ? String(superseded[0]!.record_id) : null,
          };
        }
        // A concurrent IDENTICAL write committed between the duplicate
        // check and the insert. Read the winner's row and report the
        // duplicate honestly (graceful — the content is identical).
        const winner = await tx.query(
          `SELECT retention_state, forgotten_at, record_json FROM ad_memory_records
           WHERE tenant_id = $1 AND workspace_id = $2 AND record_id = $3`,
          [tenantId, workspaceId, stored.recordId],
        );
        if (winner.length === 0) {
          // Cannot happen (ON CONFLICT DO NOTHING returned no rows while
          // the row does not exist) — fail loudly, never fake green.
          throw new Error(
            `PgAdMemoryStore.put: INSERT … ON CONFLICT DO NOTHING returned no rows for ${stored.recordId} and the row is absent`,
          );
        }
        return duplicateResult(winner[0]!, stored.recordId);
      });
    } catch (error) {
      throw toAdMemoryWriteConflict(error);
    }
  }

  async get(tenant: TenantScope, recordId: string): Promise<AdMemoryRecord | null> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const rows = await this.#executor.query(
      `SELECT retention_state, record_json FROM ad_memory_records
       WHERE tenant_id = $1 AND workspace_id = $2 AND record_id = $3`,
      [tenantId, workspaceId, recordId],
    );
    if (rows.length === 0) return null;
    const row = rows[0]!;
    if (String(row.retention_state) === "forgotten") {
      // Law 2: forgotten means unretrievable — on EVERY read path.
      return null;
    }
    return parseStoredAdMemoryRecord(row.record_json, recordId);
  }

  async listRemembered(
    tenant: TenantScope,
    subject: SubjectReference,
    at: TimestampMs,
    options?: RememberedAdMemoryQuery,
  ): Promise<readonly AdMemoryRecord[]> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const params: unknown[] = [tenantId, workspaceId, subject.kind, subject.ref, at];
    let sql = `SELECT record_json FROM ad_memory_records
       WHERE tenant_id = $1 AND workspace_id = $2 AND subject_kind = $3 AND subject_ref = $4
         AND superseded_by_record_id IS NULL
         AND retention_state = 'active'
         AND permission_retain = 'granted' AND permission_present = 'granted'
         AND (expires_at IS NULL OR expires_at > $5)
       ORDER BY recorded_at ASC, record_id ASC`;
    if (options?.limit !== undefined) {
      params.push(options.limit);
      sql += ` LIMIT $${params.length}`;
    }
    const rows = await this.#executor.query(sql, params);
    // The SQL predicates are PUSHDOWN (the listMatching precedent from
    // TL6-002); the FROZEN runtime gates stay the authority — every
    // candidate is re-verified with isAdMemoryRetrievable + the present
    // grant before it leaves the store (laws 2/3 + retain/present gates).
    return rows
      .map((row) => parseStoredAdMemoryRecord(row.record_json, String(row.record_id ?? "")))
      .filter((record) => isAdMemoryRetrievable(record, at) && record.permissions.present === "granted");
  }

  async forget(request: AdForgetRequest): Promise<AdForgetResult> {
    const parsedRequest = AdForgetRequestSchema.safeParse(request);
    if (!parsedRequest.success) {
      throw new AdMemoryRecordInvalidError(
        (request as { requestId?: unknown }).requestId !== undefined
          ? String((request as { requestId: unknown }).requestId)
          : undefined,
        `ad forget request failed the frozen contract boundary parse: ${parsedRequest.error.message}`,
      );
    }
    const req = parsedRequest.data;
    const { tenantId, workspaceId } = tenantColumns(req.tenant);
    return this.#executor.transaction(async (tx) => {
      const params: unknown[] = [tenantId, workspaceId, req.subject.kind, req.subject.ref];
      let where = `WHERE tenant_id = $1 AND workspace_id = $2 AND subject_kind = $3 AND subject_ref = $4
           AND retention_state <> 'forgotten'`;
      if (req.target.kind === "record") {
        params.push(req.target.recordId);
        where += ` AND record_id = $${params.length}`;
      } else if (req.target.kind === "item") {
        params.push(req.target.itemId);
        where += ` AND item_id = $${params.length}`;
      } else if (req.target.kind === "advertiser") {
        params.push(req.target.advertiserRef);
        where += ` AND lineage_advertiser_ref = $${params.length}`;
      }
      // 'all' — nothing further: every not-yet-forgotten record of this
      // tenant+subject. Row locks keep a concurrent put from interleaving
      // between the match and the transition.
      const matched = await tx.query(
        `SELECT record_id, record_json FROM ad_memory_records ${where}
         ORDER BY record_id ASC
         FOR UPDATE`,
        params,
      );
      const forgottenRecordIds: string[] = [];
      for (const row of matched) {
        const current = parseStoredAdMemoryRecord(row.record_json, String(row.record_id));
        const forgotten = toForgottenAdMemoryRecord(current, req.at, req.reason);
        await tx.query(
          `UPDATE ad_memory_records
           SET record_json = $4::jsonb, retention_state = 'forgotten', forgotten_at = $5
           WHERE tenant_id = $1 AND workspace_id = $2 AND record_id = $3`,
          [tenantId, workspaceId, forgotten.recordId, canonicalJson(forgotten), req.at],
        );
        forgottenRecordIds.push(forgotten.recordId);
      }
      const result: AdForgetResult = {
        schema: "reckon.ad-forget-result",
        schemaVersion: "0.1.0",
        requestId: req.requestId,
        tenant: req.tenant,
        forgottenCount: forgottenRecordIds.length,
        forgottenRecordIds,
        at: req.at,
      };
      return AdForgetResultSchema.parse(result);
    });
  }

  async applyPermissionTransition(
    tenant: TenantScope,
    recordId: string,
    transition: AdPermissionTransition,
  ): Promise<AdMemoryTransitionResult> {
    const validTransition = assertValidTransition(transition);
    const { tenantId, workspaceId } = tenantColumns(tenant);
    return this.#executor.transaction(async (tx) => {
      const rows = await tx.query(
        `SELECT record_json FROM ad_memory_records
         WHERE tenant_id = $1 AND workspace_id = $2 AND record_id = $3
         FOR UPDATE`,
        [tenantId, workspaceId, recordId],
      );
      if (rows.length === 0) {
        throw new AdMemoryTransitionRejectedError(
          recordId,
          `unknown ad memory record '${recordId}' in this tenant scope — permission transitions are tenant-scoped by construction`,
        );
      }
      const current = parseStoredAdMemoryRecord(rows[0]!.record_json, recordId);
      if (current.retention.state === "forgotten") {
        throw new AdMemoryTransitionRejectedError(
          recordId,
          `ad memory record '${recordId}' is forgotten — terminal (law 2); no permission transitions and no un-forget path exists`,
        );
      }
      let next: AdPermissionState;
      try {
        next = applyAdPermissionTransition(current.permissions, validTransition);
      } catch (cause) {
        throw new AdMemoryTransitionRejectedError(
          recordId,
          `applyAdPermissionTransition rejected the transition: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
      if (validTransition.capability === "retain" && validTransition.to === "revoked") {
        // Contract law (ads.ts §6): revoking `retain` REQUIRES the store
        // to forget the record (ADR-003 — revocation stops future use,
        // terminally). The transition is appended to the history first,
        // then the retention becomes terminal `forgotten`.
        const forgotten = AdMemoryRecordSchema.parse({
          ...toForgottenAdMemoryRecord(current, validTransition.at, validTransition.reason),
          permissions: next,
        });
        await tx.query(
          `UPDATE ad_memory_records
           SET record_json = $4::jsonb, retention_state = 'forgotten', forgotten_at = $5,
               permission_retain = $6, permission_present = $7
           WHERE tenant_id = $1 AND workspace_id = $2 AND record_id = $3`,
          [
            tenantId,
            workspaceId,
            forgotten.recordId,
            canonicalJson(forgotten),
            validTransition.at,
            next.retain,
            next.present,
          ],
        );
        return { effect: "forgotten" as const, recordId: forgotten.recordId, forgottenAt: validTransition.at };
      }
      const updated = AdMemoryRecordSchema.parse({ ...current, permissions: next });
      await tx.query(
        `UPDATE ad_memory_records
         SET record_json = $4::jsonb, permission_retain = $5, permission_present = $6
         WHERE tenant_id = $1 AND workspace_id = $2 AND record_id = $3`,
        [tenantId, workspaceId, updated.recordId, canonicalJson(updated), next.retain, next.present],
      );
      return { effect: "updated" as const, record: updated };
    });
  }
}

/** Shared duplicate-result derivation for put(). */
function duplicateResult(row: SqlRow, recordId: string): AdMemoryPutResult {
  if (String(row.retention_state) === "forgotten") {
    // Law 2: the identical content's row is forgotten — report the
    // honest tombstone, NEVER the content, and NEVER a resurrection.
    return {
      outcome: "duplicate" as const,
      record: null,
      forgottenAt: Number(row.forgotten_at),
      supersededRecordId: null,
    };
  }
  return {
    outcome: "duplicate" as const,
    record: parseStoredAdMemoryRecord(row.record_json, recordId),
    forgottenAt: null,
    supersededRecordId: null,
  };
}

/* ------------------------------------------------------------------ *
 * InMemoryAdMemoryStore — TEST INFRASTRUCTURE ONLY (ADR-001: no
 * hidden in-memory production state; production = PostgreSQL). Same
 * port shape, same laws, same observable semantics as PgAdMemoryStore
 * so contract-level suites can run against either implementation.
 * ------------------------------------------------------------------ */

interface InMemoryAdMemoryEntry {
  record: AdMemoryRecord;
  supersededByRecordId: string | null;
  supersededAt: number | null;
}

/**
 * TEST INFRASTRUCTURE — an in-memory AdMemoryStore. Behaviorally
 * identical to PgAdMemoryStore (same boundary validation, same upsert
 * policy, same terminal forget, same caller-clock discipline, same
 * deterministic ordering). Never a production authority.
 */
export class InMemoryAdMemoryStore implements AdMemoryStore {
  readonly #entries = new Map<string, InMemoryAdMemoryEntry>();

  static keyOf(tenant: TenantScope, recordId: string): string {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    return `${tenantId}|${workspaceId}|${recordId}`;
  }

  async put(record: AdMemoryRecord): Promise<AdMemoryPutResult> {
    const stored = assertFinalizedAdMemoryRecord(record);
    const key = InMemoryAdMemoryStore.keyOf(stored.tenant, stored.recordId);
    const existing = this.#entries.get(key);
    if (existing !== undefined) {
      if (existing.record.retention.state === "forgotten") {
        return {
          outcome: "duplicate",
          record: null,
          forgottenAt: existing.record.retention.forgottenAt,
          supersededRecordId: null,
        };
      }
      return { outcome: "duplicate", record: existing.record, forgottenAt: null, supersededRecordId: null };
    }
    // Supersede the previous current record for the same (subject, itemId).
    let supersededRecordId: string | null = null;
    for (const entry of this.#entries.values()) {
      const candidate = entry.record;
      if (
        candidate.tenant.tenantId === stored.tenant.tenantId &&
        (candidate.tenant.workspaceId ?? "") === (stored.tenant.workspaceId ?? "") &&
        candidate.subject.kind === stored.subject.kind &&
        candidate.subject.ref === stored.subject.ref &&
        candidate.ad.itemId === stored.ad.itemId &&
        candidate.recordId !== stored.recordId &&
        entry.supersededByRecordId === null &&
        candidate.retention.state !== "forgotten"
      ) {
        entry.supersededByRecordId = stored.recordId;
        entry.supersededAt = stored.recordedAt;
        if (supersededRecordId === null) supersededRecordId = candidate.recordId;
      }
    }
    this.#entries.set(key, { record: stored, supersededByRecordId: null, supersededAt: null });
    return { outcome: "inserted", record: stored, forgottenAt: null, supersededRecordId };
  }

  async get(tenant: TenantScope, recordId: string): Promise<AdMemoryRecord | null> {
    const entry = this.#entries.get(InMemoryAdMemoryStore.keyOf(tenant, recordId));
    if (entry === undefined) return null;
    if (entry.record.retention.state === "forgotten") return null; // law 2 — every read path
    return entry.record;
  }

  async listRemembered(
    tenant: TenantScope,
    subject: SubjectReference,
    at: TimestampMs,
    options?: RememberedAdMemoryQuery,
  ): Promise<readonly AdMemoryRecord[]> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const lane = [...this.#entries.values()]
      .map((entry) => entry.record)
      .filter(
        (record) =>
          record.tenant.tenantId === tenantId &&
          (record.tenant.workspaceId ?? "") === workspaceId &&
          record.subject.kind === subject.kind &&
          record.subject.ref === subject.ref,
      )
      // SQL-pushdown equivalents: current, active, both permission gates.
      .filter((record) => {
        const entry = this.#entries.get(InMemoryAdMemoryStore.keyOf(record.tenant, record.recordId));
        return (
          entry !== undefined &&
          entry.supersededByRecordId === null &&
          record.retention.state === "active" &&
          record.permissions.retain === "granted" &&
          record.permissions.present === "granted"
        );
      })
      // The FROZEN gates stay the authority (caller-supplied clock — law 3).
      .filter((record) => isAdMemoryRetrievable(record, at) && record.permissions.present === "granted")
      .sort((a, b) => (a.recordedAt !== b.recordedAt ? a.recordedAt - b.recordedAt : (a.recordId < b.recordId ? -1 : 1)));
    const limited = options?.limit !== undefined ? lane.slice(0, options.limit) : lane;
    return limited;
  }

  async forget(request: AdForgetRequest): Promise<AdForgetResult> {
    const parsedRequest = AdForgetRequestSchema.safeParse(request);
    if (!parsedRequest.success) {
      throw new AdMemoryRecordInvalidError(
        undefined,
        `ad forget request failed the frozen contract boundary parse: ${parsedRequest.error.message}`,
      );
    }
    const req = parsedRequest.data;
    const { tenantId, workspaceId } = tenantColumns(req.tenant);
    const forgottenRecordIds: string[] = [];
    for (const entry of this.#entries.values()) {
      const record = entry.record;
      if (
        record.tenant.tenantId !== tenantId ||
        (record.tenant.workspaceId ?? "") !== workspaceId ||
        record.subject.kind !== req.subject.kind ||
        record.subject.ref !== req.subject.ref ||
        record.retention.state === "forgotten"
      ) {
        continue;
      }
      const target = req.target;
      if (
        (target.kind === "record" && record.recordId !== target.recordId) ||
        (target.kind === "item" && record.ad.itemId !== target.itemId) ||
        (target.kind === "advertiser" && (record.lineage.advertiserRef ?? null) !== target.advertiserRef)
      ) {
        continue;
      }
      entry.record = toForgottenAdMemoryRecord(record, req.at, req.reason);
      forgottenRecordIds.push(entry.record.recordId);
    }
    forgottenRecordIds.sort();
    const result: AdForgetResult = {
      schema: "reckon.ad-forget-result",
      schemaVersion: "0.1.0",
      requestId: req.requestId,
      tenant: req.tenant,
      forgottenCount: forgottenRecordIds.length,
      forgottenRecordIds,
      at: req.at,
    };
    return AdForgetResultSchema.parse(result);
  }

  async applyPermissionTransition(
    tenant: TenantScope,
    recordId: string,
    transition: AdPermissionTransition,
  ): Promise<AdMemoryTransitionResult> {
    const validTransition = assertValidTransition(transition);
    const key = InMemoryAdMemoryStore.keyOf(tenant, recordId);
    const entry = this.#entries.get(key);
    if (entry === undefined) {
      throw new AdMemoryTransitionRejectedError(
        recordId,
        `unknown ad memory record '${recordId}' in this tenant scope — permission transitions are tenant-scoped by construction`,
      );
    }
    const current = entry.record;
    if (current.retention.state === "forgotten") {
      throw new AdMemoryTransitionRejectedError(
        recordId,
        `ad memory record '${recordId}' is forgotten — terminal (law 2); no permission transitions and no un-forget path exists`,
      );
    }
    let next: AdPermissionState;
    try {
      next = applyAdPermissionTransition(current.permissions, validTransition);
    } catch (cause) {
      throw new AdMemoryTransitionRejectedError(
        recordId,
        `applyAdPermissionTransition rejected the transition: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    if (validTransition.capability === "retain" && validTransition.to === "revoked") {
      // Same contract law as the PG store: retain-revoke forgets, terminally.
      const forgotten = AdMemoryRecordSchema.parse({
        ...toForgottenAdMemoryRecord(current, validTransition.at, validTransition.reason),
        permissions: next,
      });
      entry.record = forgotten;
      return { effect: "forgotten", recordId: forgotten.recordId, forgottenAt: validTransition.at };
    }
    const updated = AdMemoryRecordSchema.parse({ ...current, permissions: next });
    entry.record = updated;
    return { effect: "updated", record: updated };
  }
}
