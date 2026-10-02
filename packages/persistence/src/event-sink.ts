/**
 * PgEventSink — the production PostgreSQL OutcomeSink (P1-001 / P1-003).
 *
 * Replicates the InMemoryEventStoreAdapter.append semantics EXACTLY
 * (validation → tenant-scoped idempotency → eventId immutability →
 * correction verification → append) over durable PostgreSQL tables, as an
 * async `OutcomeSink` whose error contract matches the frozen transport
 * law: typed per-event rejections are RETURNED as SinkResult.rejected;
 * thrown errors mean the whole batch transiently failed (the transport
 * retries the entire batch — partial writes are impossible because each
 * batch commits atomically in ONE transaction).
 *
 * Tenant isolation is structural: every statement filters on
 * (tenant_id, workspace_id); no query accepts an unscoped identifier.
 */
import {
  OutcomeEventSchema,
  contentDigest,
  canonicalJson,
  type Id,
  type OutcomeEvent,
  type SubjectReference,
  type TenantScope,
} from "@reckon/contracts";
import {
  CorrectionCrossTenantError,
  CorrectionEvidenceClassMismatchError,
  CorrectionTargetNotFoundError,
  EventIdConflictError,
  EventValidationError,
  isObservedEvidenceClass,
  toValidationIssues,
  type AppendResult,
  type SinkResult,
  type StoredOutcomeEvent,
  type OutcomeSink,
} from "@reckon/events";
import type { SqlExecutor } from "./executor.js";
import { StoredRecordParseError } from "./errors.js";

/** tenant_id + workspace_id ('' when absent) — mirrors tenantKey(). */
export function tenantColumns(tenant: TenantScope): { readonly tenantId: string; readonly workspaceId: string } {
  return { tenantId: tenant.tenantId, workspaceId: tenant.workspaceId ?? "" };
}

/** Parse one outcome_events row back into a StoredOutcomeEvent. */
export function rowToStoredOutcomeEvent(row: Record<string, unknown>): StoredOutcomeEvent {
  const raw = row.event_json;
  const parsed = OutcomeEventSchema.safeParse(typeof raw === "string" ? JSON.parse(raw) : raw);
  if (!parsed.success) {
    throw new StoredRecordParseError(
      "outcome_event",
      typeof row.event_id === "string" ? row.event_id : undefined,
      `stored outcome event failed OutcomeEventSchema validation: ${parsed.error.message}`,
    );
  }
  const sequence = Number(row.sequence);
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new StoredRecordParseError("outcome_event", undefined, `stored sequence invalid: ${String(row.sequence)}`);
  }
  const digest = typeof row.content_digest === "string" ? row.content_digest : "";
  return Object.freeze({
    event: parsed.data,
    contentDigest: digest,
    sequence,
  });
}

export interface PgEventSinkOptions {
  readonly executor: SqlExecutor;
}

/**
 * ```ts
 * const sink = new PgEventSink({ executor });
 * const wiring = new PgOutboxTransport({ executor, sink, clock });
 * ```
 */
export class PgEventSink implements OutcomeSink {
  readonly #executor: SqlExecutor;

  constructor(options: PgEventSinkOptions) {
    this.#executor = options.executor;
  }

  async deliver(batch: readonly OutcomeEvent[]): Promise<readonly SinkResult[]> {
    // ONE transaction per batch: either every append lands, or none does
    // (the at-least-once error contract — a partial write is impossible).
    return this.#executor.transaction(async (tx) =>
      Promise.all(batch.map((event) => this.#appendOne(tx, event))),
    );
  }

  async #appendOne(tx: SqlExecutor, event: OutcomeEvent): Promise<SinkResult> {
    // 1. Frozen-schema validation — typed rejection, never a raw throw.
    const parsed = OutcomeEventSchema.safeParse(event);
    if (!parsed.success) {
      return {
        status: "rejected",
        error: new EventValidationError(
          "outcome event failed OutcomeEventSchema validation",
          toValidationIssues(parsed.error),
          event,
        ),
      };
    }
    const record: OutcomeEvent = parsed.data;
    const { tenantId, workspaceId } = tenantColumns(record.tenant);

    // 2. Tenant-scoped idempotency: same (tenant, workspace, key) → the ORIGINAL.
    const byKey = await tx.query(
      `SELECT event_json, content_digest, sequence, event_id FROM outcome_events
       WHERE tenant_id = $1 AND workspace_id = $2 AND idempotency_key = $3`,
      [tenantId, workspaceId, record.idempotencyKey],
    );
    if (byKey.length > 0) {
      const original = rowToStoredOutcomeEvent(byKey[0]!);
      return {
        status: "appended",
        result: {
          event: original.event,
          contentDigest: original.contentDigest,
          duplicate: true,
          originalEventId: original.event.eventId,
          sequence: original.sequence,
        },
      };
    }

    // 3. eventId immutability (contracts #2): same eventId, different key.
    const byEventId = await tx.query(
      `SELECT idempotency_key FROM outcome_events
       WHERE tenant_id = $1 AND workspace_id = $2 AND event_id = $3`,
      [tenantId, workspaceId, record.eventId],
    );
    if (byEventId.length > 0) {
      const existingKey = String(byEventId[0]!.idempotency_key);
      return {
        status: "rejected",
        error: new EventIdConflictError(
          `${tenantId}|${workspaceId}`,
          record.eventId,
          existingKey,
        ),
      };
    }

    // 4. Correction verification (append law, contracts #8).
    if (record.correctsEventId !== undefined) {
      const target = await tx.query(
        `SELECT event_json, content_digest, sequence FROM outcome_events
         WHERE tenant_id = $1 AND workspace_id = $2 AND event_id = $3`,
        [tenantId, workspaceId, record.correctsEventId],
      );
      if (target.length === 0) {
        // Structural tenant isolation: distinguish cross-tenant targets.
        const anywhere = await tx.query(
          `SELECT tenant_id, workspace_id FROM outcome_events WHERE event_id = $1`,
          [record.correctsEventId],
        );
        if (anywhere.length > 0) {
          return {
            status: "rejected",
            error: new CorrectionCrossTenantError(
              `${tenantId}|${workspaceId}`,
              record.correctsEventId,
            ),
          };
        }
        return {
          status: "rejected",
          error: new CorrectionTargetNotFoundError(
            `${tenantId}|${workspaceId}`,
            record.correctsEventId,
          ),
        };
      }
      const targetEvent = rowToStoredOutcomeEvent(target[0]!).event;
      if (isObservedEvidenceClass(targetEvent.evidenceClass) !== isObservedEvidenceClass(record.evidenceClass)) {
        return {
          status: "rejected",
          error: new CorrectionEvidenceClassMismatchError(
            `${tenantId}|${workspaceId}`,
            record.correctsEventId,
            targetEvent.evidenceClass,
            record.evidenceClass,
          ),
        };
      }
    }

    // 5. Append the immutable record (canonical JSON + contentDigest;
    //    occurredAt stays caller-supplied — never rewritten).
    const digest = contentDigest(record);
    const inserted = await tx.query(
      `INSERT INTO outcome_events (
         tenant_id, workspace_id, event_id, idempotency_key,
         subject_kind, subject_ref, decision_id, experience_id,
         event_type, evidence_class, occurred_at, event_json, content_digest
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)
       RETURNING sequence`,
      [
        tenantId,
        workspaceId,
        record.eventId,
        record.idempotencyKey,
        record.subject.kind,
        record.subject.ref,
        record.decisionId ?? null,
        record.experienceId ?? null,
        record.eventType,
        record.evidenceClass,
        record.occurredAt,
        canonicalJson(record),
        digest,
      ],
    );
    const sequence = Number(inserted[0]!.sequence);
    return {
      status: "appended",
      result: { event: record, contentDigest: digest, duplicate: false, sequence },
    };
  }
}

/** Shared read helpers used by PgEventQueries (and tests). */
export interface EventQueryOptions {
  readonly fromMs?: number;
  readonly toMs?: number;
}

function rangeClause(range: EventQueryOptions | undefined, baseParamIndex: number): { clause: string; params: unknown[] } {
  if (!range || (range.fromMs === undefined && range.toMs === undefined)) {
    return { clause: "", params: [] };
  }
  const parts: string[] = [];
  const params: unknown[] = [];
  if (range.fromMs !== undefined) {
    params.push(range.fromMs);
    parts.push(`occurred_at >= $${baseParamIndex + params.length}`);
  }
  if (range.toMs !== undefined) {
    params.push(range.toMs);
    parts.push(`occurred_at <= $${baseParamIndex + params.length}`);
  }
  return { clause: ` AND ${parts.join(" AND ")}`, params };
}

/** Async tenant-scoped read side (PG cannot satisfy the sync EventStore port). */
export class PgEventQueries {
  readonly #executor: SqlExecutor;

  constructor(executor: SqlExecutor) {
    this.#executor = executor;
  }

  async getByDecision(tenant: TenantScope, decisionId: Id): Promise<readonly StoredOutcomeEvent[]> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const rows = await this.#executor.query(
      `SELECT event_json, content_digest, sequence FROM outcome_events
       WHERE tenant_id = $1 AND workspace_id = $2 AND decision_id = $3
       ORDER BY sequence ASC`,
      [tenantId, workspaceId, decisionId],
    );
    return rows.map(rowToStoredOutcomeEvent);
  }

  async getBySubject(
    tenant: TenantScope,
    subject: SubjectReference,
    range?: EventQueryOptions,
  ): Promise<readonly StoredOutcomeEvent[]> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const { clause, params } = rangeClause(range, 4);
    const rows = await this.#executor.query(
      `SELECT event_json, content_digest, sequence FROM outcome_events
       WHERE tenant_id = $1 AND workspace_id = $2 AND subject_kind = $3 AND subject_ref = $4${clause}
       ORDER BY sequence ASC`,
      [tenantId, workspaceId, subject.kind, subject.ref, ...params],
    );
    return rows.map(rowToStoredOutcomeEvent);
  }

  async getByExperience(tenant: TenantScope, experienceId: Id): Promise<readonly StoredOutcomeEvent[]> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const rows = await this.#executor.query(
      `SELECT event_json, content_digest, sequence FROM outcome_events
       WHERE tenant_id = $1 AND workspace_id = $2 AND experience_id = $3
       ORDER BY sequence ASC`,
      [tenantId, workspaceId, experienceId],
    );
    return rows.map(rowToStoredOutcomeEvent);
  }

  async getByEventId(tenant: TenantScope, eventId: Id): Promise<StoredOutcomeEvent | undefined> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const rows = await this.#executor.query(
      `SELECT event_json, content_digest, sequence FROM outcome_events
       WHERE tenant_id = $1 AND workspace_id = $2 AND event_id = $3`,
      [tenantId, workspaceId, eventId],
    );
    return rows.length > 0 ? rowToStoredOutcomeEvent(rows[0]!) : undefined;
  }

  async list(tenant: TenantScope, range?: EventQueryOptions): Promise<readonly StoredOutcomeEvent[]> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const { clause, params } = rangeClause(range, 2);
    const rows = await this.#executor.query(
      `SELECT event_json, content_digest, sequence FROM outcome_events
       WHERE tenant_id = $1 AND workspace_id = $2${clause}
       ORDER BY sequence ASC`,
      [tenantId, workspaceId, ...params],
    );
    return rows.map(rowToStoredOutcomeEvent);
  }

  /** Observed-evidence partition only (disjoint from research by construction). */
  async observed(tenant: TenantScope, range?: EventQueryOptions): Promise<readonly StoredOutcomeEvent[]> {
    return this.#partition(tenant, ["production-observed", "staging", "controlled-local"], range);
  }

  /** Research-evidence partition only. */
  async research(tenant: TenantScope, range?: EventQueryOptions): Promise<readonly StoredOutcomeEvent[]> {
    return this.#partition(tenant, ["simulated", "counterfactual", "fixture"], range);
  }

  async #partition(
    tenant: TenantScope,
    evidenceClasses: readonly ("production-observed" | "staging" | "controlled-local" | "simulated" | "counterfactual" | "fixture")[],
    range: EventQueryOptions | undefined,
  ): Promise<readonly StoredOutcomeEvent[]> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const { clause, params } = rangeClause(range, 2 + evidenceClasses.length);
    const placeholders = evidenceClasses.map((_, i) => `$${i + 3}`).join(", ");
    const rows = await this.#executor.query(
      `SELECT event_json, content_digest, sequence FROM outcome_events
       WHERE tenant_id = $1 AND workspace_id = $2 AND evidence_class IN (${placeholders})${clause}
       ORDER BY sequence ASC`,
      [tenantId, workspaceId, ...evidenceClasses, ...params],
    );
    return rows.map(rowToStoredOutcomeEvent);
  }
}
