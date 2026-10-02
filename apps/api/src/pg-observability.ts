/**
 * PgObservabilitySink — production observability sink (P1-002).
 *
 * The frozen ObservabilitySink port is synchronous (`record(): void`), so
 * a durable PostgreSQL write cannot happen inline. This sink enqueues
 * records and drains them to the `observability_records` table through a
 * background writer with batching; `flush()` awaits the queue; `close()`
 * flushes and stops.
 *
 * HONESTY NOTE (deliberate, documented): observability records are
 * telemetry, NOT authoritative state — the authoritative decision/
 * outcome/preference truth lives in their own tables (ADR-001). On a
 * process crash, in-flight telemetry records may be lost; no evidence
 * claim ever depends on them. The sink never fabricates records and
 * never blocks the request path.
 */
import type { ObservabilityRecord, ObservabilitySink } from "@reckon/observability";
import { canonicalJson, contentDigest } from "@reckon/contracts";
import type { SqlExecutor } from "@reckon/persistence";

export interface PgObservabilitySinkOptions {
  readonly executor: SqlExecutor;
  /** Drain interval (default 200ms). */
  readonly intervalMs?: number;
  readonly clock?: { now(): number };
}

export class PgObservabilitySink implements ObservabilitySink {
  readonly #executor: SqlExecutor;
  readonly #intervalMs: number;
  readonly #clock: { now(): number };
  readonly #queue: ObservabilityRecord[] = [];
  #draining: Promise<void> = Promise.resolve();
  #timer: NodeJS.Timeout | undefined;
  #closed = false;
  #written = 0;

  constructor(options: PgObservabilitySinkOptions) {
    this.#executor = options.executor;
    this.#intervalMs = options.intervalMs ?? 200;
    this.#clock = options.clock ?? { now: () => Date.now() };
    this.#timer = setInterval(() => void this.#drain(), this.#intervalMs);
    this.#timer.unref?.();
  }

  record(entry: ObservabilityRecord): void {
    if (this.#closed) {
      throw new Error("PgObservabilitySink.record: sink already closed");
    }
    this.#queue.push(entry);
  }

  /** Await the full drain of every queued record. */
  async flush(): Promise<void> {
    while (this.#queue.length > 0) {
      await this.#drain();
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#timer !== undefined) clearInterval(this.#timer);
    await this.flush();
  }

  /** Number of records durably written (test observability). */
  get written(): number {
    return this.#written;
  }

  async #drain(): Promise<void> {
    // Chain onto the in-flight drain so concurrent callers (interval
    // timer + flush) never interleave two splicing loops.
    this.#draining = this.#draining.then(() => this.#drainInternal());
    await this.#draining;
  }

  async #drainInternal(): Promise<void> {
    while (this.#queue.length > 0) {
      const batch = this.#queue.splice(0, 64);
      const params: unknown[] = [];
      const values: string[] = [];
      for (const [index, entry] of batch.entries()) {
        // Stable record identity: kind + content digest (no per-variant
        // field access on the record union).
        const recordId = `${entry.kind}-${contentDigest(entry).slice(0, 24)}`;
        const tenant = (entry as { tenant?: { tenantId?: string } }).tenant?.tenantId ?? null;
        const n = index * 5;
        params.push(
          recordId,
          tenant,
          entry.kind,
          canonicalJson(entry),
          this.#clock.now(),
        );
        values.push(`($${n + 1}, $${n + 2}, $${n + 3}, $${n + 4}::jsonb, $${n + 5})`);
      }
      try {
        await this.#executor.query(
          `INSERT INTO observability_records (record_id, tenant_id, scope, record_json, recorded_at)
           VALUES ${values.join(", ")}`,
          params,
        );
        this.#written += batch.length;
      } catch (error) {
        // Telemetry write failure must never take the API down: surface
        // on stderr and drop the batch (documented lossy telemetry —
        // authoritative state is elsewhere).
        process.stderr.write(
          `[PgObservabilitySink] telemetry batch dropped: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        continue;
      }
    }
  }
}

/** sha256 digest of a record (stable telemetry identity, ADR-001 lineage). */
export function observabilityDigest(record: ObservabilityRecord): string {
  return contentDigest(record);
}
