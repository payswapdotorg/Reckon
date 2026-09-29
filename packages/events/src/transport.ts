/**
 * OutcomeTransport — the durable at-least-once delivery seam declared in
 * wave 1 (W1-001 port.ts: "Production persistence is a PostgreSQL adapter
 * owned by a LATER wave (W3-003 transport)").
 *
 * SEMANTICS (frozen by this work item):
 * - AT-LEAST-ONCE: a publish may be delivered to the sink more than once
 *   (e.g. a transient failure after a partial write); the sink's
 *   idempotencyKey dedup (wave-1 EventStore law) collapses re-deliveries
 *   to the ORIGINAL record.
 * - DETERMINISTIC RETRY: retries are scheduled by an INJECTED clock with
 *   a deterministic backoff strategy — no hidden timers, fully testable.
 * - APPEND-ONLY EVIDENCE: when a journal is attached, every enqueue,
 *   attempt and terminal outcome is journaled append-only; recovery
 *   replays pending entries (never rewrites history).
 * - TERMINAL FAILURES ARE NEVER DROPPED: exhausted retries surface through
 *   failures(), the onTerminalFailure callback, and the journal.
 *
 * EVIDENCE LABELS: the in-memory journal and the JSONL file journal are
 * TEST INFRASTRUCTURE (controlled-local). The production PostgreSQL
 * transport/sink remains out of scope per the ADR-001 wave plan.
 */
import { OutcomeEventSchema } from "@reckon/contracts";
import type { Id, OutcomeEvent, TenantScope } from "@reckon/contracts";
import type { AppendResult } from "./port.js";
import { EventValidationError } from "./errors.js";
import { EventsError } from "./errors.js";
import { toValidationIssues } from "./errors.js";

/* ------------------------------------------------------------------ *
 * Clock + backoff (determinism law: caller-supplied time)             *
 * ------------------------------------------------------------------ */

/** Injected time source (epoch ms). Deterministic replay uses ManualClock. */
export interface TransportClock {
  now(): number;
}

/** Real system time (production default). */
export class SystemClock implements TransportClock {
  now(): number {
    return Date.now();
  }
}

/**
 * Manually advanced clock — TEST INFRASTRUCTURE. Tests call advance(ms)
 * to move time forward deterministically; no real timers are involved.
 */
export class ManualClock implements TransportClock {
  #now: number;
  constructor(startAt = 0) {
    this.#now = startAt;
  }
  now(): number {
    return this.#now;
  }
  advance(ms: number): number {
    this.#now += ms;
    return this.#now;
  }
}

/** Deterministic backoff: delay ms before retry attempt N (1-based). */
export type BackoffStrategy = (attempt: number) => number;

export interface ExponentialBackoffOptions {
  readonly baseMs?: number;
  readonly factor?: number;
  readonly capMs?: number;
}

/** Default backoff: 100ms, 200ms, 400ms… capped (deterministic). */
export function exponentialBackoff(options: ExponentialBackoffOptions = {}): BackoffStrategy {
  const baseMs = options.baseMs ?? 100;
  const factor = options.factor ?? 2;
  const capMs = options.capMs ?? 30_000;
  return (attempt: number) => {
    const n = Math.max(1, attempt);
    return Math.min(baseMs * factor ** (n - 1), capMs);
  };
}

/* ------------------------------------------------------------------ *
 * Sink port (the delivery target)                                     *
 * ------------------------------------------------------------------ */

/**
 * Per-event delivery outcome. `rejected` = PERMANENT typed rejection
 * (e.g. EventIdConflictError): retrying cannot succeed, the entry goes
 * straight to terminal failure. `appended` = the sink stored it (or
 * collapsed it to the original — see AppendResult.duplicate).
 */
export type SinkResult =
  | { readonly status: "appended"; readonly result: AppendResult }
  | { readonly status: "rejected"; readonly error: EventsError };

/**
 * The sink receiving batches from the transport. The wave-1 EventStore
 * port satisfies this structurally through `eventStoreSink`.
 *
 * ERROR CONTRACT: a THROWN error means the whole call transiently failed
 * (network, lock, timeout) → the transport retries the ENTIRE batch with
 * backoff (at-least-once: a partial write before the throw is deduped by
 * the sink on the retry). Permanent per-event rejections are RETURNED,
 * not thrown.
 */
export interface OutcomeSink {
  deliver(batch: readonly OutcomeEvent[]): Promise<readonly SinkResult[]> | readonly SinkResult[];
}

/** Adapt the wave-1 EventStore port into an OutcomeSink (structural). */
export function eventStoreSink(store: { append(event: OutcomeEvent): AppendResult }): OutcomeSink {
  return {
    deliver(batch) {
      return batch.map((event) => {
        try {
          return { status: "appended", result: store.append(event) } as const;
        } catch (error) {
          if (error instanceof EventsError) {
            return { status: "rejected", error } as const;
          }
          throw error;
        }
      });
    },
  };
}

/* ------------------------------------------------------------------ *
 * Receipts / status / failures (the observable surface)               *
 * ------------------------------------------------------------------ */

/** Receipt for a publish call. */
export type PublishReceipt =
  | {
      readonly status: "buffered";
      readonly eventId: Id;
      readonly idempotencyKey: Id;
      /** Delivery attempts consumed so far (0 = not yet attempted). */
      readonly attempts: number;
    }
  | {
      readonly status: "delivered";
      readonly eventId: Id;
      readonly idempotencyKey: Id;
      readonly attempts: number;
      readonly event: OutcomeEvent;
      readonly contentDigest: string;
      readonly sequence: number;
    }
  | {
      readonly status: "duplicate";
      readonly eventId: Id;
      readonly idempotencyKey: Id;
      readonly attempts: number;
      /** The ORIGINAL stored event this publish collapsed to. */
      readonly event: OutcomeEvent;
      readonly contentDigest: string;
      readonly sequence: number;
      readonly originalEventId: Id;
    }
  | {
      /** Delivery terminally failed during the publish (surfaced, never dropped). */
      readonly status: "failed";
      readonly eventId: Id;
      readonly idempotencyKey: Id;
      readonly attempts: number;
      readonly reason: { readonly message: string; readonly code?: string };
    };

/** Post-publish state of one (tenant, idempotencyKey) entry. */
export type TransportEntryStatus =
  | {
      readonly state: "pending";
      readonly eventId: Id;
      readonly attempts: number;
      readonly nextAttemptAt?: number;
    }
  | {
      readonly state: "delivered";
      readonly eventId: Id;
      readonly attempts: number;
      readonly sequence: number;
      readonly contentDigest: string;
    }
  | {
      readonly state: "duplicate";
      readonly eventId: Id;
      readonly originalEventId: Id;
      readonly attempts: number;
      readonly sequence: number;
      readonly contentDigest: string;
    }
  | {
      readonly state: "failed";
      readonly eventId: Id;
      readonly attempts: number;
      readonly reason: { readonly message: string; readonly code?: string };
      readonly failedAt: number;
    };

/** A terminal failure surfaced by the transport (never dropped). */
export interface TransportFailure {
  readonly eventId: Id;
  readonly idempotencyKey: Id;
  /** The undeliverable payload, retained for host-side requeue/inspection. */
  readonly event: OutcomeEvent;
  readonly attempts: number;
  readonly terminalAt: number;
  readonly reason: { readonly message: string; readonly code?: string };
  readonly journalSeq?: number;
}

/** One pending (buffered / in-retry) entry snapshot. */
export interface PendingOutcome {
  readonly eventId: Id;
  readonly idempotencyKey: Id;
  readonly attempts: number;
  readonly nextAttemptAt?: number;
}

/* ------------------------------------------------------------------ *
 * The transport PORT                                                   *
 * ------------------------------------------------------------------ */

/**
 * OutcomeTransport port. Implementations MUST:
 * - validate published events against the frozen OutcomeEventSchema
 *   (typed EventValidationError, never raw throws);
 * - deliver at-least-once with idempotencyKey dedup at the sink;
 * - retry transient sink failures with deterministic injected-clock
 *   backoff;
 * - surface terminal failures (failures + onTerminalFailure) — never
 *   drop them silently;
 * - journal append-only when a journal is attached, and recover pending
 *   entries from it on construction.
 */
export interface OutcomeTransport {
  /** Enqueue an outcome event for durable delivery. */
  publish(event: OutcomeEvent): Promise<PublishReceipt>;
  /**
   * Attempt delivery of every batch that is DUE per the injected clock.
   * Returns the number of entries still pending. Idempotent.
   */
  pump(): Promise<number>;
  /**
   * Pump while progress is being made (entries completing or attempts
   * advancing). Returns the pending count when nothing more is due —
   * advance the clock (or wait) and pump/flush again.
   */
  flush(): Promise<number>;
  /** Terminal failures, in terminal order. Retained (never dropped). */
  failures(): readonly TransportFailure[];
  /** Snapshot of pending entries (FIFO order). */
  pending(): readonly PendingOutcome[];
  /** Latest state for one (tenant, idempotencyKey), if known. */
  status(tenant: TenantScope, idempotencyKey: Id): TransportEntryStatus | undefined;
}

/* ------------------------------------------------------------------ *
 * Typed transport errors (new codes — wave-1 error codes stay frozen) *
 * ------------------------------------------------------------------ */

/** Journal integrity failure (corrupt line / digest mismatch). */
export class TransportJournalError extends Error {
  readonly code = "TRANSPORT_JOURNAL_CORRUPT" as const;
  readonly lineNumber?: number;
  readonly path?: string;

  constructor(message: string, details: { lineNumber?: number; path?: string } = {}) {
    super(message);
    this.name = "TransportJournalError";
    this.lineNumber = details.lineNumber;
    this.path = details.path;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/* ------------------------------------------------------------------ *
 * Helpers                                                              *
 * ------------------------------------------------------------------ */

/** Composite tenant key (mirrors the wave-1 adapter's scoping). */
export function transportTenantKey(tenant: TenantScope): string {
  return `${tenant.tenantId}|${tenant.workspaceId ?? ""}`;
}

/** Validate an event against the frozen schema with a typed error. */
export function assertTransportable(event: OutcomeEvent): void {
  const parsed = OutcomeEventSchema.safeParse(event);
  if (!parsed.success) {
    throw new EventValidationError(
      "outcome event failed OutcomeEventSchema validation",
      toValidationIssues(parsed.error),
      event
    );
  }
}
