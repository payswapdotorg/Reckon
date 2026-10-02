/**
 * PgOutboxTransport — the DURABLE production OutcomeTransport (P1-003).
 *
 * The frozen `TransportJournal`/`BufferedTransport` pair is in-memory test
 * infrastructure (its sync journal port cannot carry a real PostgreSQL
 * write). This transport implements the same async `OutcomeTransport` PORT
 * over the classic durable-outbox pattern:
 *
 *   publish(event) → INSERT outbox row (UNIQUE per tenant+workspace+key,
 *                    idempotent) → pump due rows → deliver to the sink
 *                    inside a transaction → record terminal state.
 *
 * At-least-once across process crashes: the outbox table IS the journal.
 * A NEW transport instance over the same database continues delivering
 * rows a crashed process left pending (pump on first use + flush loop).
 * The sink dedups by idempotency key, so a redelivery after a crash
 * collapses to the original record — exactly-once visible effect,
 * at-least-once delivery.
 *
 * Deterministic replay semantics: the injected clock drives every
 * next_attempt_at / created_at value; no SQL-side time functions are used
 * for transport scheduling (caller-supplied time law).
 */
import {
  OutcomeEventSchema,
  canonicalJson,
  contentDigest,
  type Id,
  type OutcomeEvent,
  type TenantScope,
} from "@reckon/contracts";
import {
  EventValidationError,
  exponentialBackoff,
  toValidationIssues,
  type AppendResult,
  type BackoffStrategy,
  type OutcomeSink,
  type PendingOutcome,
  type PublishReceipt,
  type SinkResult,
  type TransportEntryStatus,
  type TransportFailure,
  type TransportClock,
  assertTransportable,
} from "@reckon/events";
import type { SqlExecutor } from "./executor.js";
import { tenantColumns } from "./event-sink.js";

export interface PgOutboxTransportOptions {
  readonly executor: SqlExecutor;
  readonly sink: OutcomeSink;
  /** Injected time source (ms epoch) — deterministic tests, host clock in production. */
  readonly clock: TransportClock;
  readonly backoff?: BackoffStrategy;
  readonly maxAttempts?: number;
  readonly maxBatchSize?: number;
  /** Terminal-failure surfacing (never dropped). */
  readonly onTerminalFailure?: (failure: TransportFailure) => void;
}

interface OutboxRow {
  readonly id: number;
  readonly event_json: unknown;
  readonly content_digest: string;
  readonly state: "pending" | "delivered" | "failed";
  readonly attempts: number;
  readonly next_attempt_at: number;
  readonly created_at: number;
  readonly last_error: string | null;
  readonly delivered_sequence: number | null;
  readonly delivered_digest: string | null;
  readonly event_id: string;
  readonly idempotency_key: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
}

function rowToOutbox(row: Record<string, unknown>): OutboxRow {
  return {
    id: Number(row.id),
    event_json: row.event_json,
    content_digest: String(row.content_digest),
    state: row.state as OutboxRow["state"],
    attempts: Number(row.attempts),
    next_attempt_at: Number(row.next_attempt_at),
    created_at: Number(row.created_at),
    last_error: row.last_error === null ? null : String(row.last_error),
    delivered_sequence: row.delivered_sequence === null ? null : Number(row.delivered_sequence),
    delivered_digest: row.delivered_digest === null ? null : String(row.delivered_digest),
    event_id: String(row.event_id),
    idempotency_key: String(row.idempotency_key),
    tenant_id: String(row.tenant_id),
    workspace_id: String(row.workspace_id),
  };
}

function parseStoredEvent(raw: unknown): OutcomeEvent {
  const parsed = OutcomeEventSchema.safeParse(typeof raw === "string" ? JSON.parse(raw) : raw);
  if (!parsed.success) {
    throw new EventValidationError(
      "stored outbox payload failed OutcomeEventSchema validation",
      toValidationIssues(parsed.error),
      raw,
    );
  }
  return parsed.data;
}

function toErrorSummary(error: unknown): { message: string; code?: string } {
  if (error instanceof Error) {
    const anyError = error as Error & { code?: string };
    return { message: error.message, ...(anyError.code !== undefined ? { code: anyError.code } : {}) };
  }
  return { message: String(error) };
}

export class PgOutboxTransport {
  readonly #executor: SqlExecutor;
  readonly #sink: OutcomeSink;
  readonly #clock: TransportClock;
  readonly #backoff: BackoffStrategy;
  readonly #maxAttempts: number;
  readonly #maxBatchSize: number;
  readonly #onTerminalFailure?: (failure: TransportFailure) => void;
  readonly #failures: TransportFailure[] = [];
  #pumpPromise: Promise<number> | undefined;

  constructor(options: PgOutboxTransportOptions) {
    this.#executor = options.executor;
    this.#sink = options.sink;
    this.#clock = options.clock;
    this.#backoff = options.backoff ?? exponentialBackoff();
    this.#maxAttempts = Math.max(1, options.maxAttempts ?? 5);
    this.#maxBatchSize = Math.max(1, options.maxBatchSize ?? 8);
    this.#onTerminalFailure = options.onTerminalFailure;
  }

  async publish(event: OutcomeEvent): Promise<PublishReceipt> {
    assertTransportable(event);
    const { tenantId, workspaceId } = tenantColumns(event.tenant);

    // Idempotent enqueue: first write wins; an existing row keeps its
    // identity and state (a delivered key answers "duplicate" below).
    const inserted = await this.#executor.query(
      `INSERT INTO outcome_outbox (
         tenant_id, workspace_id, event_id, idempotency_key,
         event_json, content_digest, state, attempts,
         next_attempt_at, created_at
       ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,'pending',0,$7,$7)
       ON CONFLICT (tenant_id, workspace_id, idempotency_key) DO NOTHING
       RETURNING id`,
      [
        tenantId,
        workspaceId,
        event.eventId,
        event.idempotencyKey,
        canonicalJson(event),
        contentDigest(event),
        this.#clock.now(),
      ],
    );

    if (inserted.length === 0) {
      const existing = await this.#selectRow(tenantId, workspaceId, event.idempotencyKey);
      if (existing === undefined) {
        throw new Error(
          "PgOutboxTransport.publish: outbox row vanished between insert-conflict and read",
        );
      }
      if (existing.state === "delivered") {
        // A previously-delivered key answers "duplicate" with the
        // original's identity — the sink dedup would collapse to it.
        const originalEventId = existing.event_id;
        return {
          status: "duplicate",
          eventId: originalEventId,
          idempotencyKey: existing.idempotency_key,
          attempts: existing.attempts,
          event: parseStoredEvent(existing.event_json),
          contentDigest: existing.delivered_digest ?? existing.content_digest,
          sequence: existing.delivered_sequence ?? 0,
          originalEventId,
        };
      }
      if (existing.state === "failed") {
        // Explicit requeue round for a terminally-failed key: attempts
        // reset, fresh payload (mirrors BufferedTransport requeue law).
        await this.#executor.query(
          `UPDATE outcome_outbox
           SET state = 'pending', attempts = 0, next_attempt_at = $1,
               event_json = $2::jsonb, content_digest = $3, last_error = NULL
           WHERE id = $4`,
          [this.#clock.now(), canonicalJson(event), contentDigest(event), existing.id],
        );
      }
      // state === 'pending': already in flight — merge, no second row.
    }

    await this.pump();
    return this.#receiptFor(tenantId, workspaceId, event.idempotencyKey);
  }

  async pump(): Promise<number> {
    if (this.#pumpPromise !== undefined) return this.#pumpPromise;
    this.#pumpPromise = this.#pumpInternal().finally(() => {
      this.#pumpPromise = undefined;
    });
    return this.#pumpPromise;
  }

  async flush(): Promise<number> {
    let lastPending = Number.POSITIVE_INFINITY;
    let pending = await this.pump();
    while (pending > 0 && pending < lastPending) {
      lastPending = pending;
      pending = await this.pump();
    }
    return pending;
  }

  failures(): readonly TransportFailure[] {
    return [...this.#failures];
  }

  async pending(): Promise<readonly PendingOutcome[]> {
    const rows = await this.#executor.query(
      `SELECT event_id, idempotency_key, attempts, next_attempt_at FROM outcome_outbox
       WHERE state = 'pending' ORDER BY id ASC`,
    );
    return rows.map((row) => ({
      eventId: String(row.event_id),
      idempotencyKey: String(row.idempotency_key),
      attempts: Number(row.attempts),
      ...(row.next_attempt_at !== null && row.next_attempt_at !== undefined
        ? { nextAttemptAt: Number(row.next_attempt_at) }
        : {}),
    }));
  }

  async status(tenant: TenantScope, idempotencyKey: Id): Promise<TransportEntryStatus | undefined> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const row = await this.#selectRow(tenantId, workspaceId, idempotencyKey);
    if (row === undefined) return undefined;
    if (row.state === "pending") {
      return {
        state: "pending",
        eventId: row.event_id,
        attempts: row.attempts,
        nextAttemptAt: row.next_attempt_at,
      };
    }
    if (row.state === "delivered") {
      return {
        state: "delivered",
        eventId: row.event_id,
        attempts: row.attempts,
        sequence: row.delivered_sequence ?? 0,
        contentDigest: row.delivered_digest ?? row.content_digest,
      };
    }
    return {
      state: "failed",
      eventId: row.event_id,
      attempts: row.attempts,
      reason: { message: row.last_error ?? "terminal delivery failure" },
      failedAt: row.next_attempt_at,
    };
  }

  /* ------------------------------ internals ------------------------------ */

  async #pumpInternal(): Promise<number> {
    const now = this.#clock.now();
    const dueRows = await this.#executor.query(
      `SELECT id FROM outcome_outbox
       WHERE state = 'pending' AND next_attempt_at <= $1
       ORDER BY id ASC LIMIT $2`,
      [now, this.#maxBatchSize],
    );
    if (dueRows.length === 0) {
      const pendingCount = await this.#executor.query(
        `SELECT count(*)::int AS n FROM outcome_outbox WHERE state = 'pending'`,
      );
      return Number(pendingCount[0]!.n);
    }
    for (const row of dueRows) {
      await this.#attemptDelivery(Number(row.id));
    }
    const pendingCount = await this.#executor.query(
      `SELECT count(*)::int AS n FROM outcome_outbox WHERE state = 'pending'`,
    );
    return Number(pendingCount[0]!.n);
  }

  /** One delivery attempt for one due row (crash-safe: state advances only on confirmed outcomes). */
  async #attemptDelivery(rowId: number): Promise<void> {
    const rowSelect = await this.#executor.query(
      `SELECT * FROM outcome_outbox WHERE id = $1`,
      [rowId],
    );
    if (rowSelect.length === 0) return;
    const row = rowToOutbox(rowSelect[0]!);
    if (row.state !== "pending") return;
    const event = parseStoredEvent(row.event_json);

    let results: readonly SinkResult[];
    try {
      results = await this.#sink.deliver([event]);
    } catch (transient) {
      await this.#recordTransientFailure(row, toErrorSummary(transient));
      return;
    }
    const outcome = results[0];
    if (outcome === undefined) {
      await this.#recordTransientFailure(
        row,
        toErrorSummary(new Error("sink returned a mismatched result count")),
      );
      return;
    }
    if (outcome.status === "rejected") {
      // Typed per-event rejection is PERMANENT → terminal failure.
      await this.#finalize(row, "failed", toErrorSummary(outcome.error), null, null);
      return;
    }
    const appended: AppendResult = outcome.result;
    await this.#finalize(
      row,
      appended.duplicate ? "delivered" : "delivered",
      null,
      appended.sequence,
      appended.contentDigest,
    );
  }

  async #recordTransientFailure(
    row: OutboxRow,
    reason: { message: string; code?: string },
  ): Promise<void> {
    const now = this.#clock.now();
    const attempts = row.attempts + 1;
    const nextAttemptAt = now + this.#backoff(attempts);
    if (attempts >= this.#maxAttempts) {
      await this.#finalize(row, "failed", reason, null, null);
      return;
    }
    await this.#executor.query(
      `UPDATE outcome_outbox
       SET attempts = $1, next_attempt_at = $2, last_error = $3
       WHERE id = $4`,
      [attempts, nextAttemptAt, reason.message, row.id],
    );
  }

  async #finalize(
    row: OutboxRow,
    state: "delivered" | "failed",
    reason: { message: string; code?: string } | null,
    deliveredSequence: number | null,
    deliveredDigest: string | null,
  ): Promise<void> {
    const now = this.#clock.now();
    const attempts = row.attempts + 1;
    await this.#executor.query(
      `UPDATE outcome_outbox
       SET state = $1, attempts = $2,
           delivered_sequence = $3, delivered_digest = $4,
           last_error = $5, next_attempt_at = $6
       WHERE id = $7`,
      [state, attempts, deliveredSequence, deliveredDigest, reason === null ? null : reason.message, now, row.id],
    );
    if (state === "failed") {
      const event = parseStoredEvent(row.event_json);
      const failure: TransportFailure = {
        eventId: row.event_id,
        idempotencyKey: row.idempotency_key,
        event,
        attempts,
        terminalAt: now,
        reason: reason ?? { message: "terminal delivery failure" },
      };
      this.#failures.push(failure);
      this.#onTerminalFailure?.(failure);
    }
  }

  async #selectRow(tenantId: string, workspaceId: string, idempotencyKey: string): Promise<OutboxRow | undefined> {
    const rows = await this.#executor.query(
      `SELECT * FROM outcome_outbox
       WHERE tenant_id = $1 AND workspace_id = $2 AND idempotency_key = $3`,
      [tenantId, workspaceId, idempotencyKey],
    );
    return rows.length > 0 ? rowToOutbox(rows[0]!) : undefined;
  }

  async #receiptFor(tenantId: string, workspaceId: string, idempotencyKey: string): Promise<PublishReceipt> {
    const row = await this.#selectRow(tenantId, workspaceId, idempotencyKey);
    if (row === undefined) {
      throw new Error("PgOutboxTransport.publish: outbox row missing after pump");
    }
    if (row.state === "delivered") {
      return {
        status: "delivered",
        eventId: row.event_id,
        idempotencyKey: row.idempotency_key,
        attempts: row.attempts,
        event: parseStoredEvent(row.event_json),
        contentDigest: row.delivered_digest ?? row.content_digest,
        sequence: row.delivered_sequence ?? 0,
      };
    }
    if (row.state === "failed") {
      return {
        status: "failed",
        eventId: row.event_id,
        idempotencyKey: row.idempotency_key,
        attempts: row.attempts,
        reason: { message: row.last_error ?? "terminal delivery failure" },
      };
    }
    return {
      status: "buffered",
      eventId: row.event_id,
      idempotencyKey: row.idempotency_key,
      attempts: row.attempts,
    };
  }
}
