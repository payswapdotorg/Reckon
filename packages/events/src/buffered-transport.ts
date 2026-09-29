/**
 * BufferedTransport — the reference OutcomeTransport implementation
 * (W3-003).
 *
 * Delivery model:
 * - publish() validates against the frozen OutcomeEventSchema, journals an
 *   enqueue record (append-only, with contentDigest), and buffers the entry.
 * - pump() delivers DUE entries (per the injected clock) to the sink in
 *   FIFO batches of up to maxBatchSize. Transient sink failures (thrown)
 *   retry with deterministic backoff; permanent per-event rejections
 *   (returned) fail terminally without retry.
 * - At-least-once: a transient failure after a partial sink write is
 *   retried as a whole batch; the sink's idempotencyKey dedup collapses
 *   re-deliveries to the ORIGINAL record (wave-1 law).
 * - Terminal failures are retained + surfaced (failures(),
 *   onTerminalFailure) — never dropped.
 * - Construction replays the journal: pending entries (enqueue without a
 *   terminal) are recovered with their attempt history; terminal failures
 *   are re-surfaced through failures().
 *
 * EVIDENCE LABEL: the journals usable here are TEST INFRASTRUCTURE
 * (in-memory / JSONL file); the production PostgreSQL transport is a
 * later wave (ADR-001 plan). No hidden timers — time is injected.
 */
import { contentDigest } from "@reckon/contracts";
import type { Id, OutcomeEvent, TenantScope } from "@reckon/contracts";
import type { AppendResult } from "./port.js";
import type { JournalErrorSummary, TransportJournal } from "./journal.js";
import { InMemoryJournal } from "./journal.js";
import { toErrorSummary } from "./journal.js";
import type {
  BackoffStrategy,
  OutcomeSink,
  OutcomeTransport,
  PendingOutcome,
  PublishReceipt,
  SinkResult,
  TransportClock,
  TransportEntryStatus,
  TransportFailure,
} from "./transport.js";
import { assertTransportable, exponentialBackoff, transportTenantKey } from "./transport.js";

/** A live buffered entry. */
interface PendingEntry {
  readonly journalSeq: number;
  readonly event: OutcomeEvent;
  readonly eventId: Id;
  readonly idempotencyKey: Id;
  readonly key: string;
  attempts: number;
  lastAttemptAt?: number;
  nextAttemptAt?: number;
}

/** A resolved terminal record (kept for receipts + status). */
interface TerminalRecord {
  readonly kind: "delivered" | "duplicate" | "failed";
  readonly eventId: Id;
  readonly idempotencyKey: Id;
  readonly attempts: number;
  readonly at: number;
  readonly journalSeq: number;
  /** Sink-stored event (delivered/duplicate). */
  readonly event?: OutcomeEvent;
  readonly contentDigest?: string;
  readonly sequence?: number;
  readonly originalEventId?: Id;
  readonly reason?: JournalErrorSummary;
}

export interface BufferedTransportOptions {
  /** The delivery target (e.g. eventStoreSink(store)). */
  readonly sink: OutcomeSink;
  /** Injected time source — deterministic backoff and journal stamps. */
  readonly clock: TransportClock;
  /** Deterministic retry delay per attempt (default: exponential 100ms×2ⁿ, cap 30s). */
  readonly backoff?: BackoffStrategy;
  /** Max delivery attempts per entry before terminal failure (default 5). */
  readonly maxAttempts?: number;
  /** Max events per sink.deliver batch (default 8). */
  readonly maxBatchSize?: number;
  /** Journal (default: in-memory — TEST INFRASTRUCTURE). */
  readonly journal?: TransportJournal;
  /** Pump due batches automatically inside publish() (default true). */
  readonly autoPump?: boolean;
  /** Live terminal-failure notifications (recovered failures are surfaced via failures() only). */
  readonly onTerminalFailure?: (failure: TransportFailure) => void;
}

export class BufferedTransport implements OutcomeTransport {
  readonly #sink: OutcomeSink;
  readonly #clock: TransportClock;
  readonly #backoff: BackoffStrategy;
  readonly #maxAttempts: number;
  readonly #maxBatchSize: number;
  readonly #journal: TransportJournal;
  readonly #autoPump: boolean;
  readonly #onTerminalFailure?: (failure: TransportFailure) => void;

  readonly #pending: PendingEntry[] = [];
  readonly #terminals = new Map<string, TerminalRecord>();
  readonly #keyStates = new Map<string, TransportEntryStatus>();
  readonly #failures: TransportFailure[] = [];
  #pumpPromise: Promise<number> | undefined;

  constructor(options: BufferedTransportOptions) {
    this.#sink = options.sink;
    this.#clock = options.clock;
    this.#backoff = options.backoff ?? exponentialBackoff();
    this.#maxAttempts = Math.max(1, options.maxAttempts ?? 5);
    this.#maxBatchSize = Math.max(1, options.maxBatchSize ?? 8);
    this.#journal = options.journal ?? new InMemoryJournal();
    this.#autoPump = options.autoPump ?? true;
    this.#onTerminalFailure = options.onTerminalFailure;
    this.#recoverFromJournal();
  }

  async publish(event: OutcomeEvent): Promise<PublishReceipt> {
    assertTransportable(event);
    const key = `${transportTenantKey(event.tenant)}|${event.idempotencyKey}`;

    const existingTerminal = this.#terminals.get(key);
    if (existingTerminal !== undefined && existingTerminal.kind !== "failed") {
      // Delivered/duplicate key: the sink's idempotency dedup would
      // collapse this re-publish to the original — short-circuit honestly.
      // A prior DELIVERED terminal therefore reads as "duplicate" here:
      // that is exactly what the sink would answer for a re-publish.
      return this.#republishReceipt(existingTerminal);
    }

    const inFlight = this.#findPendingByKey(key);
    if (inFlight === undefined) {
      // Fresh key, or an explicit requeue round for a terminally-failed key
      // (maxAttempts applies per round; every round is journaled).
      this.#enqueue(event, key);
    }
    // else: already in flight → merge (no second enqueue record).

    if (this.#autoPump) {
      await this.pump();
    }
    const terminal = this.#terminals.get(key);
    if (terminal !== undefined) {
      return this.#terminalReceipt(terminal);
    }
    const entry = this.#findPendingByKey(key);
    if (entry !== undefined) {
      return { status: "buffered", eventId: entry.eventId, idempotencyKey: entry.idempotencyKey, attempts: entry.attempts };
    }
    // Unreachable: an entry exists (enqueued or in flight) unless it
    // resolved terminally during the pump (handled above).
    return { status: "buffered", eventId: event.eventId, idempotencyKey: event.idempotencyKey, attempts: 0 };
  }

  async pump(): Promise<number> {
    if (this.#pumpPromise !== undefined) {
      return this.#pumpPromise;
    }
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

  pending(): readonly PendingOutcome[] {
    return this.#pending.map((entry) => ({
      eventId: entry.eventId,
      idempotencyKey: entry.idempotencyKey,
      attempts: entry.attempts,
      ...(entry.nextAttemptAt !== undefined ? { nextAttemptAt: entry.nextAttemptAt } : {}),
    }));
  }

  status(tenant: TenantScope, idempotencyKey: Id): TransportEntryStatus | undefined {
    return this.#keyStates.get(`${transportTenantKey(tenant)}|${idempotencyKey}`);
  }

  /* ------------------------------ internals ------------------------------ */

  #enqueue(event: OutcomeEvent, key: string): PendingEntry {
    const seq = this.#journal.append({
      kind: "enqueue",
      at: this.#clock.now(),
      eventId: event.eventId,
      idempotencyKey: event.idempotencyKey,
      contentDigest: contentDigest(event),
      event,
    });
    const entry: PendingEntry = {
      journalSeq: seq,
      event,
      eventId: event.eventId,
      idempotencyKey: event.idempotencyKey,
      key,
      attempts: 0,
    };
    this.#pending.push(entry);
    this.#keyStates.set(key, { state: "pending", eventId: entry.eventId, attempts: 0 });
    return entry;
  }

  async #pumpInternal(): Promise<number> {
    const now = this.#clock.now();
    const due = this.#pending.filter(
      (entry) => entry.nextAttemptAt === undefined || entry.nextAttemptAt <= now,
    );
    for (let index = 0; index < due.length; index += this.#maxBatchSize) {
      const batchEntries = due.slice(index, index + this.#maxBatchSize);
      await this.#deliverBatch(batchEntries);
    }
    return this.#pending.length;
  }

  async #deliverBatch(entries: readonly PendingEntry[]): Promise<void> {
    const batch = entries.map((entry) => entry.event);
    let results: readonly SinkResult[];
    try {
      results = await this.#sink.deliver(batch);
    } catch (transient) {
      this.#handleTransientFailure(entries, transient);
      return;
    }
    for (const [position, entry] of entries.entries()) {
      const outcome: SinkResult | undefined = results[position];
      if (outcome === undefined) {
        // Sink contract violation (result count mismatch): transient retry.
        this.#handleTransientFailure([entry], new Error("sink returned a mismatched result count"));
        continue;
      }
      if (outcome.status === "rejected") {
        this.#finalize(entry, {
          kind: "failed",
          attempts: entry.attempts + 1,
          reason: toErrorSummary(outcome.error),
        });
        continue;
      }
      const appended: AppendResult = outcome.result;
      this.#finalize(entry, {
        kind: appended.duplicate ? "duplicate" : "delivered",
        attempts: entry.attempts + 1,
        event: appended.event,
        contentDigest: appended.contentDigest,
        sequence: appended.sequence,
        ...(appended.originalEventId !== undefined ? { originalEventId: appended.originalEventId } : {}),
      });
    }
  }

  #handleTransientFailure(entries: readonly PendingEntry[], error: unknown): void {
    const now = this.#clock.now();
    for (const entry of entries) {
      entry.attempts += 1;
      entry.lastAttemptAt = now;
      entry.nextAttemptAt = now + this.#backoff(entry.attempts);
      this.#journal.append({
        kind: "attempt",
        refSeq: entry.journalSeq,
        at: now,
        error: toErrorSummary(error),
      });
      if (entry.attempts >= this.#maxAttempts) {
        this.#finalize(entry, { kind: "failed", attempts: entry.attempts, reason: toErrorSummary(error) });
        continue;
      }
      this.#keyStates.set(entry.key, {
        state: "pending",
        eventId: entry.eventId,
        attempts: entry.attempts,
        nextAttemptAt: entry.nextAttemptAt,
      });
    }
  }

  #finalize(
    entry: PendingEntry,
    outcome: {
      kind: "delivered" | "duplicate" | "failed";
      attempts: number;
      event?: OutcomeEvent;
      contentDigest?: string;
      sequence?: number;
      originalEventId?: Id;
      reason?: JournalErrorSummary;
    },
  ): void {
    const at = this.#clock.now();
    const pendingIndex = this.#pending.indexOf(entry);
    if (pendingIndex >= 0) this.#pending.splice(pendingIndex, 1);

    const terminal: TerminalRecord = {
      kind: outcome.kind,
      eventId: entry.eventId,
      idempotencyKey: entry.idempotencyKey,
      attempts: outcome.attempts,
      at,
      journalSeq: entry.journalSeq,
      ...(outcome.event !== undefined ? { event: outcome.event } : {}),
      ...(outcome.contentDigest !== undefined ? { contentDigest: outcome.contentDigest } : {}),
      ...(outcome.sequence !== undefined ? { sequence: outcome.sequence } : {}),
      ...(outcome.originalEventId !== undefined ? { originalEventId: outcome.originalEventId } : {}),
      ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}),
    };
    this.#terminals.set(entry.key, terminal);

    this.#journal.append({
      kind: "terminal",
      refSeq: entry.journalSeq,
      at,
      status: outcome.kind,
      attempts: outcome.attempts,
      ...(outcome.reason !== undefined ? { error: outcome.reason } : {}),
      ...(outcome.kind !== "failed" && outcome.contentDigest !== undefined && outcome.sequence !== undefined
        ? {
            result: {
              contentDigest: outcome.contentDigest,
              sequence: outcome.sequence,
              ...(outcome.originalEventId !== undefined ? { originalEventId: outcome.originalEventId } : {}),
            },
          }
        : {}),
    });

    if (outcome.kind === "failed") {
      const failure: TransportFailure = {
        eventId: entry.eventId,
        idempotencyKey: entry.idempotencyKey,
        event: entry.event,
        attempts: outcome.attempts,
        terminalAt: at,
        reason: outcome.reason ?? { message: "unknown failure" },
        journalSeq: entry.journalSeq,
      };
      this.#failures.push(failure);
      this.#keyStates.set(entry.key, {
        state: "failed",
        eventId: entry.eventId,
        attempts: outcome.attempts,
        reason: failure.reason,
        failedAt: at,
      });
      this.#onTerminalFailure?.(failure);
      return;
    }

    if (outcome.kind === "delivered") {
      this.#keyStates.set(entry.key, {
        state: "delivered",
        eventId: entry.eventId,
        attempts: outcome.attempts,
        sequence: outcome.sequence ?? 0,
        contentDigest: outcome.contentDigest ?? "",
      });
      return;
    }
    this.#keyStates.set(entry.key, {
      state: "duplicate",
      eventId: entry.eventId,
      originalEventId: outcome.originalEventId ?? entry.eventId,
      attempts: outcome.attempts,
      sequence: outcome.sequence ?? 0,
      contentDigest: outcome.contentDigest ?? "",
    });
  }

  #terminalReceipt(terminal: TerminalRecord): PublishReceipt {
    if (terminal.kind === "failed") {
      return {
        status: "failed",
        eventId: terminal.eventId,
        idempotencyKey: terminal.idempotencyKey,
        attempts: terminal.attempts,
        reason: terminal.reason ?? { message: "terminal delivery failure" },
      };
    }
    const shared = {
      eventId: terminal.eventId,
      idempotencyKey: terminal.idempotencyKey,
      attempts: terminal.attempts,
      // Live terminals carry the sink-stored event. Recovered duplicate
      // terminals carry the journaled payload (the sink's original is
      // identified by originalEventId and is not duplicated into the
      // journal).
      event: terminal.event ?? ({} as OutcomeEvent),
      contentDigest: terminal.contentDigest ?? "",
      sequence: terminal.sequence ?? 0,
    };
    if (terminal.kind === "duplicate") {
      return { status: "duplicate", ...shared, originalEventId: terminal.originalEventId ?? terminal.eventId };
    }
    return { status: "delivered", ...shared };
  }

  /**
   * Receipt for a publish that short-circuits on an existing non-failed
   * terminal: the sink's idempotency dedup would collapse the re-publish
   * to the ORIGINAL record, so even a previously-delivered key answers
   * "duplicate" with the original's identity.
   */
  #republishReceipt(terminal: TerminalRecord): PublishReceipt {
    const asDuplicate: TerminalRecord =
      terminal.kind === "delivered"
        ? { ...terminal, kind: "duplicate", originalEventId: terminal.eventId }
        : terminal;
    return this.#terminalReceipt(asDuplicate);
  }

  #findPendingByKey(key: string): PendingEntry | undefined {
    return this.#pending.find((entry) => entry.key === key);
  }

  /**
   * Journal replay recovery: walk records in append order. An enqueue
   * without a terminal record (or superseded by a later enqueue round for
   * the same key) is recovered as pending with its attempt history.
   * Terminal failures are re-surfaced through failures().
   */
  #recoverFromJournal(): void {
    const records = this.#journal.readAll();
    const liveBySeq = new Map<number, PendingEntry>();
    const keyToSeq = new Map<string, number>();
    const attemptsBySeq = new Map<number, number>();

    for (const record of records) {
      if (record.kind === "enqueue") {
        const key = `${transportTenantKey(record.event.tenant)}|${record.idempotencyKey}`;
        const previousSeq = keyToSeq.get(key);
        if (previousSeq !== undefined) {
          // Superseded enqueue round (host requeue after terminal failure):
          // the earlier round's entry is dead; its terminal already ran.
          const previous = liveBySeq.get(previousSeq);
          if (previous !== undefined) {
            liveBySeq.delete(previousSeq);
            const index = this.#pending.indexOf(previous);
            if (index >= 0) this.#pending.splice(index, 1);
          }
        }
        const entry: PendingEntry = {
          journalSeq: record.seq,
          event: record.event,
          eventId: record.eventId,
          idempotencyKey: record.idempotencyKey,
          key,
          attempts: 0,
        };
        liveBySeq.set(record.seq, entry);
        keyToSeq.set(key, record.seq);
        attemptsBySeq.set(record.seq, 0);
        this.#pending.push(entry);
        this.#keyStates.set(key, { state: "pending", eventId: record.eventId, attempts: 0 });
        continue;
      }

      if (record.kind === "attempt") {
        const live = liveBySeq.get(record.refSeq);
        if (live === undefined) continue;
        const attempts = (attemptsBySeq.get(record.refSeq) ?? 0) + 1;
        attemptsBySeq.set(record.refSeq, attempts);
        live.attempts = attempts;
        live.lastAttemptAt = record.at;
        live.nextAttemptAt = record.at + this.#backoff(attempts);
        this.#keyStates.set(live.key, {
          state: "pending",
          eventId: live.eventId,
          attempts: live.attempts,
          nextAttemptAt: live.nextAttemptAt,
        });
        continue;
      }

      // terminal record
      const live = liveBySeq.get(record.refSeq);
      if (live === undefined) continue;
      liveBySeq.delete(record.refSeq);
      const index = this.#pending.indexOf(live);
      if (index >= 0) this.#pending.splice(index, 1);

      const terminal: TerminalRecord = {
        kind: record.status,
        eventId: live.eventId,
        idempotencyKey: live.idempotencyKey,
        attempts: record.attempts,
        at: record.at,
        journalSeq: record.refSeq,
        // The journaled payload: identical content for delivered; for
        // duplicate terminals the sink's original is identified by
        // originalEventId (not duplicated into the journal).
        event: live.event,
        ...(record.result?.contentDigest !== undefined ? { contentDigest: record.result.contentDigest } : {}),
        ...(record.result?.sequence !== undefined ? { sequence: record.result.sequence } : {}),
        ...(record.result?.originalEventId !== undefined ? { originalEventId: record.result.originalEventId } : {}),
        ...(record.error !== undefined ? { reason: record.error } : {}),
      };
      this.#terminals.set(live.key, terminal);

      if (record.status === "failed") {
        const reason = record.error ?? { message: "recovered terminal failure" };
        this.#failures.push({
          eventId: live.eventId,
          idempotencyKey: live.idempotencyKey,
          event: live.event,
          attempts: record.attempts,
          terminalAt: record.at,
          reason,
          journalSeq: record.refSeq,
        });
        this.#keyStates.set(live.key, {
          state: "failed",
          eventId: live.eventId,
          attempts: record.attempts,
          reason,
          failedAt: record.at,
        });
      } else if (record.status === "delivered") {
        this.#keyStates.set(live.key, {
          state: "delivered",
          eventId: live.eventId,
          attempts: record.attempts,
          sequence: record.result?.sequence ?? 0,
          contentDigest: record.result?.contentDigest ?? "",
        });
      } else {
        this.#keyStates.set(live.key, {
          state: "duplicate",
          eventId: live.eventId,
          originalEventId: record.result?.originalEventId ?? live.eventId,
          attempts: record.attempts,
          sequence: record.result?.sequence ?? 0,
          contentDigest: record.result?.contentDigest ?? "",
        });
      }
    }
  }
}
