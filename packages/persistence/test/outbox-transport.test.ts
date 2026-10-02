/**
 * P1-003 — PgOutboxTransport durability semantics over a REAL PostgreSQL
 * server: at-least-once with idempotent dedup, transient-failure backoff,
 * typed terminal failures, and CRASH RECOVERY (a new transport instance
 * over the same database delivers rows a crashed process left pending).
 * Evidence class: controlled-local.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type OutcomeSink, type SinkResult } from "@reckon/events";
import type { OutcomeEvent } from "@reckon/contracts";
import { PgEventSink, PgOutboxTransport } from "../src/index.js";
import { startTestPostgres, type TestPostgres } from "./pg-harness.js";
import { ManualClock, makeEvent, tenantA } from "./fixtures.js";

let server: TestPostgres;
let sink: PgEventSink;
let clock: ManualClock;

beforeAll(async () => {
  server = await startTestPostgres();
  sink = new PgEventSink({ executor: server.executor });
  clock = new ManualClock(1_000);
}, 120_000);

afterAll(async () => {
  await server.stop();
}, 60_000);

function newTransport(options: { sink?: OutcomeSink; maxAttempts?: number; backoff?: (n: number) => number } = {}) {
  return new PgOutboxTransport({
    executor: server.executor,
    sink: options.sink ?? sink,
    clock,
    maxAttempts: options.maxAttempts,
    backoff: options.backoff,
  });
}

/** A sink wrapper that throws the first N deliveries (transient failures). */
class FlakySink {
  #failuresRemaining: number;
  readonly #delivered: OutcomeEvent[][] = [];
  constructor(
    private readonly inner: OutcomeSink,
    failures: number,
  ) {
    this.#failuresRemaining = failures;
  }
  get delivered(): readonly (readonly OutcomeEvent[])[] {
    return this.#delivered;
  }
  async deliver(batch: readonly OutcomeEvent[]): Promise<readonly SinkResult[]> {
    if (this.#failuresRemaining > 0) {
      this.#failuresRemaining -= 1;
      throw new Error("transient connection reset (flaky sink)");
    }
    this.#delivered.push([...batch]);
    return this.inner.deliver(batch);
  }
}

describe("P1-003 PgOutboxTransport — happy path", () => {
  it("delivers a published event and returns a full receipt", async () => {
    const transport = newTransport();
    const receipt = await transport.publish(
      makeEvent({ eventId: "ob-1", idempotencyKey: "ob-1", occurredAt: 1_500 }),
    );
    expect(receipt.status).toBe("delivered");
    if (receipt.status === "delivered") {
      expect(receipt.eventId).toBe("ob-1");
      expect(receipt.contentDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(receipt.sequence).toBeGreaterThan(0);
      expect(receipt.attempts).toBe(1);
    }
    expect(await transport.pending()).toHaveLength(0);
    expect((await transport.status(tenantA, "ob-1"))?.state).toBe("delivered");
  });

  it("collapses a re-publish of a delivered key to a duplicate receipt with the ORIGINAL", async () => {
    const transport = newTransport();
    await transport.publish(makeEvent({ eventId: "ob-2", idempotencyKey: "ob-2", metrics: { original: 1 } }));
    const again = await transport.publish(
      makeEvent({ eventId: "ob-2-OTHER", idempotencyKey: "ob-2", metrics: { mutated: 9 } }),
    );
    expect(again.status).toBe("duplicate");
    if (again.status === "duplicate") {
      expect(again.originalEventId).toBe("ob-2");
      expect(again.event.metrics).toEqual({ original: 1 });
    }
  });
});

describe("P1-003 PgOutboxTransport — transient failures + backoff", () => {
  it("retries with backoff until delivery (at-least-once, dedup collapses redelivery)", async () => {
    const flaky = new FlakySink(sink, 1);
    const backoffCalls: number[] = [];
    const transport = newTransport({
      sink: flaky,
      backoff: (attempt) => {
        backoffCalls.push(attempt);
        return 50 * attempt;
      },
    });
    // First publish: enqueue → pump attempts delivery → transient failure 1 → next attempt at +50.
    let receipt = await transport.publish(makeEvent({ eventId: "ob-3", idempotencyKey: "ob-3" }));
    expect(receipt.status).toBe("buffered");
    if (receipt.status === "buffered") expect(receipt.attempts).toBe(1);

    // Second pump while still not due: no progress.
    clock.advance(10);
    await transport.pump();
    receipt = await transport.publish(makeEvent({ eventId: "ob-3", idempotencyKey: "ob-3" }));
    expect(receipt.status).toBe("buffered");

    // Advance past the backoff window → delivery succeeds (attempt 2 of the flaky sink).
    clock.advance(100);
    receipt = await transport.publish(makeEvent({ eventId: "ob-3", idempotencyKey: "ob-3" }));
    expect(receipt.status).toBe("delivered");
    expect(backoffCalls).toEqual([1]);
    expect(flaky.delivered).toHaveLength(1);
  });

  it("marks terminal failure after maxAttempts exhausted transient failures", async () => {
    const alwaysFails: OutcomeSink = {
      deliver: () => Promise.reject(new Error("network partition")),
    };
    const failures: string[] = [];
    const wired = new PgOutboxTransport({
      executor: server.executor,
      sink: alwaysFails,
      clock,
      maxAttempts: 2,
      backoff: () => 0,
      onTerminalFailure: (failure) => failures.push(failure.reason.message),
    });
    const receipt = await wired.publish(makeEvent({ eventId: "ob-4", idempotencyKey: "ob-4" }));
    // publish pumps once: attempt 1 fails transiently, backoff 0 → due
    // immediately, but one publish = one pump → buffered with attempts=1.
    expect(receipt.status).toBe("buffered");
    if (receipt.status === "buffered") expect(receipt.attempts).toBe(1);
    // flush pumps again: attempt 2 ≥ maxAttempts → terminal failure.
    const pendingAfterFlush = await wired.flush();
    expect(pendingAfterFlush).toBe(0);
    const status = await wired.status(tenantA, "ob-4");
    expect(status?.state).toBe("failed");
    if (status?.state === "failed") {
      expect(status.reason.message).toBe("network partition");
      expect(status.attempts).toBe(2);
    }
    expect(wired.failures().map((f) => f.eventId)).toContain("ob-4");
    expect(failures).toContain("network partition");
  });

  it("terminal-fails a typed per-event rejection (EventIdConflict is permanent)", async () => {
    // Seed an event id in the sink under a different key.
    await sink.deliver([
      makeEvent({ eventId: "ob-5-taken", idempotencyKey: "ob-5-taken-seed" }),
    ]);
    const transport = newTransport();
    const receipt = await transport.publish(
      makeEvent({ eventId: "ob-5-taken", idempotencyKey: "ob-5-conflict" }),
    );
    expect(receipt.status).toBe("failed");
    const status = await transport.status(tenantA, "ob-5-conflict");
    expect(status?.state).toBe("failed");
    const failure = transport.failures().find((f) => f.idempotencyKey === "ob-5-conflict");
    expect(failure).toBeDefined();
    expect(failure!.reason.code).toBe("EVENT_ID_CONFLICT");
  });
});

describe("P1-003 PgOutboxTransport — CRASH RECOVERY (the durability proof)", () => {
  it("a NEW transport instance delivers rows a crashed process left pending", async () => {
    // Process 1: enqueue with a sink that fails transiently with an
    // effectively-infinite backoff (the row stays pending, publish returns buffered).
    const wedged: OutcomeSink = {
      deliver: () => Promise.reject(new Error("process crashed mid-delivery")),
    };
    const process1 = newTransport({ sink: wedged, backoff: () => 9_000_000_000 });
    const receipt = await process1.publish(
      makeEvent({ eventId: "crash-1", idempotencyKey: "crash-1", occurredAt: 9_999 }),
    );
    expect(receipt.status).toBe("buffered");

    // "Crash": process 1's in-memory state is gone; only the outbox rows remain.
    // Process 2 boots over the same database with a WORKING sink.
    const process2 = newTransport({ sink });
    const pendingBefore = await process2.pending();
    expect(pendingBefore.map((p) => p.eventId)).toContain("crash-1");

    // Elapsed wall-clock time carries past the stranded row's backoff
    // window (the manual clock models time actually passing).
    clock.advance(9_000_000_000);
    const remaining = await process2.flush();
    expect(remaining).toBe(0);

    const status = await process2.status(tenantA, "crash-1");
    expect(status?.state).toBe("delivered");
    const stored = await new (await import("../src/index.js")).PgEventQueries(server.executor).getByEventId(tenantA, "crash-1");
    expect(stored?.event.eventId).toBe("crash-1");
    expect(stored?.event.occurredAt).toBe(9_999);
  });

  it("requeues a terminally-failed key on explicit re-publish (fresh round)", async () => {
    const alwaysFails: OutcomeSink = { deliver: () => Promise.reject(new Error("first round fails")) };
    const process1 = newTransport({ sink: alwaysFails, maxAttempts: 1, backoff: () => 0 });
    const first = await process1.publish(makeEvent({ eventId: "requeue-1", idempotencyKey: "requeue-1" }));
    expect(first.status).toBe("failed");
    expect((await process1.status(tenantA, "requeue-1"))?.state).toBe("failed");

    // A later process re-publishes the same key with a working sink → delivered.
    const process2 = newTransport({ sink });
    const receipt = await process2.publish(
      makeEvent({ eventId: "requeue-1", idempotencyKey: "requeue-1", metrics: { round: 2 } }),
    );
    expect(receipt.status).toBe("delivered");
  });
});
