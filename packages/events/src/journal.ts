/**
 * Transport journal — append-only evidence for the outcome transport
 * (W3-003).
 *
 * EVIDENCE LABELS: both adapters here are TEST INFRASTRUCTURE
 * (controlled-local). The production durable transport (PostgreSQL) is a
 * LATER wave per the ADR-001 wave plan; this port defines the seam.
 */
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { OutcomeEventSchema, contentDigest } from "@reckon/contracts";
import type { Id, OutcomeEvent, TimestampMs } from "@reckon/contracts";
import { TransportJournalError } from "./transport.js";

/** Error summary persisted in journal records (serializable, no stack). */
export interface JournalErrorSummary {
  readonly message: string;
  readonly code?: string;
}

export function toErrorSummary(error: unknown): JournalErrorSummary {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return {
      message: error.message,
      ...(typeof code === "string" ? { code } : {}),
    };
  }
  return { message: String(error) };
}

/**
 * Journal records (append-only; `seq` is the journal-assigned line seq).
 *
 * - enqueue: an outcome accepted for delivery, with its contentDigest.
 * - attempt: a transient delivery failure for `refSeq` (the enqueue).
 * - terminal: the final outcome for `refSeq` (delivered / duplicate /
 *   failed) — closing the enqueue.
 */
export type JournalRecord =
  | {
      readonly kind: "enqueue";
      readonly seq: number;
      readonly at: TimestampMs;
      readonly eventId: Id;
      readonly idempotencyKey: Id;
      readonly contentDigest: string;
      readonly event: OutcomeEvent;
    }
  | {
      readonly kind: "attempt";
      readonly seq: number;
      readonly refSeq: number;
      readonly at: TimestampMs;
      readonly error: JournalErrorSummary;
    }
  | {
      readonly kind: "terminal";
      readonly seq: number;
      readonly refSeq: number;
      readonly at: TimestampMs;
      readonly status: "delivered" | "duplicate" | "failed";
      readonly attempts: number;
      readonly error?: JournalErrorSummary;
      /** Sink result metadata for delivered/duplicate terminals (recovery). */
      readonly result?: {
        readonly contentDigest: string;
        readonly sequence: number;
        readonly originalEventId?: Id;
      };
    };

/** Distributive Omit (Omit over a union collapses variants without it). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A record without the journal-assigned seq. */
export type JournalRecordInput = DistributiveOmit<JournalRecord, "seq">;

/**
 * TransportJournal PORT: append-only, ordered, readable for recovery.
 * Implementations must never rewrite or remove existing records
 * (calibration law: historical evidence is immutable).
 */
export interface TransportJournal {
  /** Append one record durably; returns the assigned seq. */
  append(record: JournalRecordInput): number;
  /** All records in append order (recovery read). */
  readAll(): readonly JournalRecord[];
}

/**
 * In-memory journal (TEST INFRASTRUCTURE, controlled-local) — the
 * default when no journal is configured. Not durable across processes.
 */
export class InMemoryJournal implements TransportJournal {
  readonly #records: JournalRecord[] = [];

  append(record: JournalRecordInput): number {
    const seq = this.#records.length + 1;
    this.#records.push(Object.freeze({ ...record, seq }) as JournalRecord);
    return seq;
  }

  readAll(): readonly JournalRecord[] {
    return [...this.#records];
  }
}

/**
 * Durable append-only JSONL file journal — TEST INFRASTRUCTURE
 * (controlled-local). One canonical-JSON line per record; `readAll`
 * verifies line shape and the enqueue contentDigest integrity.
 * Production PostgreSQL transport stays out of scope (ADR-001 wave plan).
 */
export class JsonlFileJournal implements TransportJournal {
  readonly #path: string;
  #nextSeq: number;

  constructor(path: string) {
    this.#path = path;
    const existing = existsSync(path) ? this.#readLines() : [];
    this.#nextSeq = existing.length + 1;
  }

  append(record: JournalRecordInput): number {
    const seq = this.#nextSeq;
    this.#nextSeq += 1;
    appendFileSync(this.#path, `${JSON.stringify({ ...record, seq })}\n`, "utf8");
    return seq;
  }

  readAll(): readonly JournalRecord[] {
    return this.#readLines().map((line, index) => parseRecord(line.line, index + 1, this.#path));
  }

  #readLines(): { line: string }[] {
    if (!existsSync(this.#path)) return [];
    const raw = readFileSync(this.#path, "utf8");
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => ({ line }));
  }
}

/** Loose structural view of a parsed journal line (pre-validation). */
interface RawJournalLine {
  readonly kind?: unknown;
  readonly seq?: unknown;
  readonly at?: unknown;
  readonly eventId?: unknown;
  readonly idempotencyKey?: unknown;
  readonly contentDigest?: unknown;
  readonly event?: unknown;
  readonly refSeq?: unknown;
  readonly error?: unknown;
  readonly status?: unknown;
  readonly attempts?: unknown;
  readonly result?: unknown;
}

/** Parse + integrity-check one journal line into a record. */
function parseRecord(line: string, lineNumber: number, path: string): JournalRecord {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (cause) {
    throw new TransportJournalError(`journal line ${lineNumber} is not valid JSON`, {
      lineNumber,
      path,
    });
  }
  if (typeof value !== "object" || value === null) {
    throw new TransportJournalError(`journal line ${lineNumber} is not an object`, { lineNumber, path });
  }
  const record = value as RawJournalLine;
  const fail = (reason: string): TransportJournalError =>
    new TransportJournalError(`journal line ${lineNumber} ${reason}`, { lineNumber, path });

  if (record.kind !== "enqueue" && record.kind !== "attempt" && record.kind !== "terminal") {
    throw fail(`has unknown kind '${String(record.kind)}'`);
  }
  if (typeof record.seq !== "number" || !Number.isInteger(record.seq)) {
    throw fail("lacks an integer seq");
  }
  if (record.at === undefined || record.at !== null && (typeof record.at !== "number" || record.at < 0)) {
    throw fail("lacks a non-negative at timestamp");
  }
  const at = record.at as number;

  if (record.kind === "enqueue") {
    if (typeof record.eventId !== "string" || typeof record.idempotencyKey !== "string") {
      throw fail("(enqueue) lacks eventId/idempotencyKey");
    }
    // Frozen-schema validation of the journaled event.
    const parsed = OutcomeEventSchema.safeParse(record.event);
    if (!parsed.success) {
      throw fail("(enqueue) failed OutcomeEventSchema validation");
    }
    // Content-digest integrity: a tampered payload must not replay.
    const digest = contentDigest(parsed.data);
    if (record.contentDigest !== digest) {
      throw fail("(enqueue) contentDigest mismatch — journal payload was tampered with");
    }
    return {
      kind: "enqueue",
      seq: record.seq,
      at,
      eventId: record.eventId,
      idempotencyKey: record.idempotencyKey,
      contentDigest: digest,
      event: parsed.data,
    };
  }

  if (typeof record.refSeq !== "number" || !Number.isInteger(record.refSeq)) {
    throw fail(`(${record.kind}) lacks an integer refSeq`);
  }

  if (record.kind === "attempt") {
    const error = isJournalErrorSummary(record.error) ? record.error : { message: "unknown transient failure" };
    return {
      kind: "attempt",
      seq: record.seq,
      refSeq: record.refSeq,
      at,
      error,
    };
  }

  const status = record.status === "duplicate" || record.status === "failed" ? record.status : "delivered";
  const attempts = typeof record.attempts === "number" && Number.isInteger(record.attempts) && record.attempts >= 0
    ? record.attempts
    : 0;
  if (status !== "delivered" && !isJournalErrorSummary(record.error)) {
    throw fail("(terminal) failed/duplicate terminals must carry an error summary");
  }
  return {
    kind: "terminal",
    seq: record.seq,
    refSeq: record.refSeq,
    at,
    status,
    attempts,
    ...(isJournalErrorSummary(record.error) ? { error: record.error } : {}),
    ...(isJournalResult(record.result) ? { result: record.result } : {}),
  };
}

function isJournalErrorSummary(value: unknown): value is JournalErrorSummary {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { message?: unknown }).message === "string" &&
    ((value as { code?: unknown }).code === undefined || typeof (value as { code?: unknown }).code === "string")
  );
}

function isJournalResult(value: unknown): value is { contentDigest: string; sequence: number; originalEventId?: Id } {
  if (typeof value !== "object" || value === null) return false;
  const rec = value as { contentDigest?: unknown; sequence?: unknown; originalEventId?: unknown };
  return (
    typeof rec.contentDigest === "string" &&
    typeof rec.sequence === "number" &&
    (rec.originalEventId === undefined || typeof rec.originalEventId === "string")
  );
}
