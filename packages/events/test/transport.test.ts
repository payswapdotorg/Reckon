import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contentDigest } from "@reckon/contracts";
import type { OutcomeEvent, SubjectReference, TenantScope } from "@reckon/contracts";
import {
  BufferedTransport,
  EventValidationError,
  EventsError,
  InMemoryEventStoreAdapter,
  InMemoryJournal,
  JsonlFileJournal,
  ManualClock,
  SystemClock,
  eventStoreSink,
  exponentialBackoff,
} from "../src/index.js";
import type { OutcomeSink, SinkResult, TransportFailure, TransportJournal } from "../src/index.js";
import { TransportJournalError } from "../src/index.js";

/**
 * W3-003 — durable outcome transport. Evidence class: controlled-local
 * (TEST INFRASTRUCTURE journals; the production PostgreSQL transport is a
 * later wave per the ADR-001 plan).
 */

const tenantA: TenantScope = { tenantId: "tenant-a" };
const tenantB: TenantScope = { tenantId: "tenant-b" };
const subject: SubjectReference = { kind: "user", ref: "user-9" };

let eventCounter = 0;
function makeEvent(overrides: Partial<OutcomeEvent> = {}): OutcomeEvent {
  eventCounter += 1;
  return {
    schema: "reckon.outcome-event",
    schemaVersion: "0.1.0",
    eventId: `ev-${eventCounter}`,
    tenant: tenantA,
    subject,
    eventType: "completion",
    occurredAt: 1_000,
    evidenceClass: "production-observed",
    idempotencyKey: `idem-${eventCounter}`,
    metrics: {},
    ...overrides,
  };
}

/** A sink that throws transiently N times, then delegates to the store. */
class FlakySink implements OutcomeSink {
  deliveries: (readonly OutcomeEvent[])[] = [];
  #failuresRemaining: number;

  constructor(
    private readonly store: InMemoryEventStoreAdapter,
    failuresRemaining = 0,
  ) {
    this.#failuresRemaining = failuresRemaining;
  }

  deliver(batch: readonly OutcomeEvent[]): readonly SinkResult[] {
    this.deliveries.push([...batch]);
    if (this.#failuresRemaining > 0) {
      this.#failuresRemaining -= 1;
      throw new Error(`transient sink failure (${this.#failuresRemaining + 1} remaining)`);
    }
    return batch.map((event): SinkResult => {
      try {
        return { status: "appended", result: this.store.append(event) };
      } catch (error) {
        if (error instanceof EventsError) return { status: "rejected", error };
        throw error;
      }
    });
  }
}

describe("W3-003 BufferedTransport — happy path and receipt laws", () => {
  it("delivers on publish (autoPump) with a delivered receipt", async () => {
    const store = new InMemoryEventStoreAdapter();
    const transport = new BufferedTransport({ sink: eventStoreSink(store), clock: new ManualClock(1_000) });
    const event = makeEvent({ decisionId: "dec-1" });

    const receipt = await transport.publish(event);
    expect(receipt.status).toBe("delivered");
    if (receipt.status === "delivered") {
      expect(receipt.sequence).toBe(1);
      expect(receipt.contentDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(receipt.attempts).toBe(1);
      expect(receipt.event.eventId).toBe(event.eventId);
    }
    expect([...store.stream(tenantA)]).toHaveLength(1);
    expect(transport.pending()).toHaveLength(0);
    expect(transport.failures()).toHaveLength(0);
  });

  it("validates published events against the frozen schema (typed error)", async () => {
    const transport = new BufferedTransport({
      sink: eventStoreSink(new InMemoryEventStoreAdapter()),
      clock: new ManualClock(0),
    });
    const bad = { ...makeEvent(), eventType: "not-a-real-type" } as unknown as OutcomeEvent;
    await expect(transport.publish(bad)).rejects.toBeInstanceOf(EventValidationError);
  });

  it("short-circuits a re-publish of a delivered key to a duplicate receipt", async () => {
    const store = new InMemoryEventStoreAdapter();
    const sink = eventStoreSink(store);
    const transport = new BufferedTransport({ sink, clock: new ManualClock(0) });
    const event = makeEvent();

    await transport.publish(event);
    const second = await transport.publish(event);
    expect(second.status).toBe("duplicate");
    if (second.status === "duplicate") {
      expect(second.originalEventId).toBe(event.eventId);
      expect(second.sequence).toBe(1);
    }
    // Exactly one stored record — the re-publish never re-delivered.
    expect([...store.stream(tenantA)]).toHaveLength(1);
    // The ENTRY's terminal state stays "delivered" (the original append);
    // only the re-publish RECEIPT reads as duplicate (collapsed).
    expect(transport.status(tenantA, event.idempotencyKey)).toMatchObject({
      state: "delivered",
    });
  });

  it("merges an in-flight re-publish (no second enqueue, single delivery)", async () => {
    const store = new InMemoryEventStoreAdapter();
    const recording = new FlakySink(store, 0);
    const transport = new BufferedTransport({
      sink: recording,
      clock: new ManualClock(0),
      autoPump: false,
    });
    const event = makeEvent();
    await transport.publish(event);
    await transport.publish(event); // in flight → merged
    expect(transport.pending()).toHaveLength(1);

    await transport.flush();
    expect(recording.deliveries).toHaveLength(1);
    expect(recording.deliveries[0]).toHaveLength(1);
    expect([...store.stream(tenantA)]).toHaveLength(1);
  });

  it("batches appends: flush delivers the whole buffer in one sink call", async () => {
    const store = new InMemoryEventStoreAdapter();
    const recording = new FlakySink(store, 0);
    const transport = new BufferedTransport({
      sink: recording,
      clock: new ManualClock(0),
      autoPump: false,
    });

    await transport.publish(makeEvent());
    await transport.publish(makeEvent());
    await transport.publish(makeEvent());
    expect(transport.pending()).toHaveLength(3);

    expect(await transport.flush()).toBe(0);
    expect(recording.deliveries).toHaveLength(1);
    expect(recording.deliveries[0]).toHaveLength(3);
    expect([...store.stream(tenantA)]).toHaveLength(3);
  });

  it("respects maxBatchSize across a flush", async () => {
    const store = new InMemoryEventStoreAdapter();
    const recording = new FlakySink(store, 0);
    const transport = new BufferedTransport({
      sink: recording,
      clock: new ManualClock(0),
      autoPump: false,
      maxBatchSize: 2,
    });
    for (let i = 0; i < 5; i += 1) {
      await transport.publish(makeEvent());
    }
    expect(await transport.flush()).toBe(0);
    expect(recording.deliveries.map((batch) => batch.length)).toEqual([2, 2, 1]);
  });
});

describe("W3-003 — at-least-once delivery with idempotencyKey dedup", () => {
  it("a transient failure after a partial write collapses to the original on retry", async () => {
    const store = new InMemoryEventStoreAdapter();
    // The classic at-least-once lost-response scenario: the FIRST call
    // appends to the store and THEN throws; subsequent calls succeed.
    let lostResponse = true;
    const partialWriteSink: OutcomeSink = {
      deliver(batch) {
        const results: SinkResult[] = batch.map((event): SinkResult => {
          try {
            return { status: "appended", result: store.append(event) };
          } catch (error) {
            if (error instanceof EventsError) return { status: "rejected", error };
            throw error;
          }
        });
        if (lostResponse) {
          lostResponse = false;
          throw new Error("response lost after partial write");
        }
        return results;
      },
    };
    const clock = new ManualClock(0);
    const transport = new BufferedTransport({ sink: partialWriteSink, clock });
    const event = makeEvent();

    const receipt = await transport.publish(event);
    // First delivery attempt appended but the call threw → buffered.
    expect(receipt.status).toBe("buffered");
    expect([...store.stream(tenantA)]).toHaveLength(1);

    // Advance the clock past the backoff and pump: the retry re-delivers,
    // the store dedups, and the entry resolves as duplicate (collapsed).
    clock.advance(exponentialBackoff()(1));
    expect(await transport.pump()).toBe(0);
    const status = transport.status(tenantA, event.idempotencyKey);
    expect(status).toMatchObject({ state: "duplicate" });
    if (status?.state === "duplicate") {
      expect(status.originalEventId).toBe(event.eventId);
      expect(status.sequence).toBe(1);
    }
    // Exactly ONE record — no duplicate rows.
    expect([...store.stream(tenantA)]).toHaveLength(1);
  });

  it("retry-then-success: deterministic backoff schedule from the injected clock", async () => {
    const store = new InMemoryEventStoreAdapter();
    const flaky = new FlakySink(store, 2); // fail twice, succeed on the third
    const clock = new ManualClock(10_000);
    const journal = new InMemoryJournal();
    const transport = new BufferedTransport({ sink: flaky, clock, journal, maxAttempts: 5 });
    const event = makeEvent();

    const receipt = await transport.publish(event); // attempt 1 fails
    expect(receipt.status).toBe("buffered");
    expect(transport.pending()[0]).toMatchObject({ eventId: event.eventId, attempts: 1 });

    // Not due yet — a pump before the backoff elapses consumes nothing.
    clock.advance(50);
    expect(await transport.pump()).toBe(1);
    expect(transport.pending()[0]).toMatchObject({ attempts: 1 });

    clock.advance(50); // exactly the 100ms first-attempt backoff
    expect(await transport.pump()).toBe(1); // attempt 2 fails
    expect(transport.pending()[0]).toMatchObject({ attempts: 2 });

    clock.advance(200); // exactly the 200ms second-attempt backoff
    expect(await transport.pump()).toBe(0); // attempt 3 succeeds

    expect(transport.status(tenantA, event.idempotencyKey)).toMatchObject({
      state: "delivered",
      attempts: 3,
    });
    expect([...store.stream(tenantA)]).toHaveLength(1);

    // Journal evidence: enqueue, two attempts, terminal delivered.
    expect(journal.readAll().map((r) => r.kind)).toEqual(["enqueue", "attempt", "attempt", "terminal"]);
  });

  it("retry-then-failure: terminal failure surfaced, retained, never dropped", async () => {
    const alwaysFails: OutcomeSink = {
      deliver() {
        throw new Error("sink permanently down");
      },
    };
    const clock = new ManualClock(0);
    const journal = new InMemoryJournal();
    const failures: TransportFailure[] = [];
    const transport = new BufferedTransport({
      sink: alwaysFails,
      clock,
      journal,
      maxAttempts: 3,
      onTerminalFailure: (failure) => failures.push(failure),
    });
    const event = makeEvent();

    const receipt = await transport.publish(event); // attempt 1 fails
    expect(receipt.status).toBe("buffered");

    clock.advance(100);
    expect(await transport.pump()).toBe(1); // attempt 2 fails
    clock.advance(200);
    expect(await transport.pump()).toBe(0); // attempt 3 fails → terminal

    expect(transport.pending()).toHaveLength(0);
    expect(transport.failures()).toHaveLength(1);
    const failure = transport.failures()[0]!;
    expect(failure).toMatchObject({
      eventId: event.eventId,
      idempotencyKey: event.idempotencyKey,
      attempts: 3,
    });
    expect(failure.reason.message).toBe("sink permanently down");
    expect(failure.event).toEqual(event);
    expect(failures).toHaveLength(1); // the callback surfaced exactly once
    expect(transport.status(tenantA, event.idempotencyKey)).toMatchObject({ state: "failed" });

    // Journal closes the entry as failed (append-only evidence).
    const terminalRecords = journal.readAll().filter((r) => r.kind === "terminal");
    expect(terminalRecords).toHaveLength(1);
    expect(terminalRecords[0]).toMatchObject({ status: "failed", attempts: 3 });
  });

  it("permanent sink rejections fail immediately without retry", async () => {
    const store = new InMemoryEventStoreAdapter();
    // Pre-seed the store so the next append conflicts on the eventId.
    const original = makeEvent();
    store.append(original);
    const conflicting = makeEvent({
      eventId: original.eventId,
      idempotencyKey: "different-key",
    });

    const clock = new ManualClock(0);
    const transport = new BufferedTransport({ sink: eventStoreSink(store), clock });
    const receipt = await transport.publish(conflicting);
    expect(receipt.status).toBe("failed");
    if (receipt.status === "failed") {
      expect(receipt.reason.code).toBe("EVENT_ID_CONFLICT");
      expect(receipt.attempts).toBe(1);
    }
    expect(transport.failures()).toHaveLength(1);
    // No retry was scheduled.
    expect(transport.pending()).toHaveLength(0);
    clock.advance(10_000);
    expect(await transport.pump()).toBe(0);
  });

  it("re-publishing a terminally-failed key requeues a fresh journaled round", async () => {
    const store = new InMemoryEventStoreAdapter();
    let down = true;
    const switchable: OutcomeSink = {
      deliver(batch) {
        if (down) throw new Error("temporarily down");
        return batch.map((event): SinkResult => {
          try {
            return { status: "appended", result: store.append(event) };
          } catch (error) {
            if (error instanceof EventsError) return { status: "rejected", error };
            throw error;
          }
        });
      },
    };
    const clock = new ManualClock(0);
    const journal = new InMemoryJournal();
    const transport = new BufferedTransport({ sink: switchable, clock, journal, maxAttempts: 1 });
    const event = makeEvent();

    const failed = await transport.publish(event);
    expect(failed.status).toBe("failed");

    // The sink recovers; the host re-publishes the SAME key: a fresh round.
    down = false;
    const retried = await transport.publish(event);
    expect(retried.status).toBe("delivered");
    expect([...store.stream(tenantA)]).toHaveLength(1);
    // Two enqueue rounds + two terminals in the journal.
    expect(journal.readAll().filter((r) => r.kind === "enqueue")).toHaveLength(2);
    expect(journal.readAll().filter((r) => r.kind === "terminal")).toHaveLength(2);
  });
});

describe("W3-003 — journals and replay recovery", () => {
  it("JsonlFileJournal writes one JSON line per record and round-trips", () => {
    const dir = mkdtempSync(join(tmpdir(), "reckon-journal-"));
    try {
      const path = join(dir, "outcomes.jsonl");
      const journal = new JsonlFileJournal(path);
      const event = makeEvent();
      const seq = journal.append({
        kind: "enqueue",
        at: 5,
        eventId: event.eventId,
        idempotencyKey: event.idempotencyKey,
        contentDigest: contentDigest(event),
        event,
      });
      expect(seq).toBe(1);

      const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.length > 0);
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toMatchObject({ kind: "enqueue", seq: 1 });

      const records = new JsonlFileJournal(path).readAll();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ kind: "enqueue", eventId: event.eventId });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("journal replay recovery: pending entries recover and deliver after restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "reckon-journal-"));
    try {
      const path = join(dir, "outcomes.jsonl");
      const store = new InMemoryEventStoreAdapter();
      const clock = new ManualClock(1_000);

      // Process 1: publish against a failing sink (one transient attempt),
      // then "crash" without delivering.
      const failing: OutcomeSink = {
        deliver() {
          throw new Error("process-1 sink down");
        },
      };
      const process1 = new BufferedTransport({
        sink: failing,
        clock,
        journal: new JsonlFileJournal(path),
        maxAttempts: 5,
      });
      const receipt = await process1.publish(makeEvent({ eventId: "ev-recover-1", idempotencyKey: "idem-recover-1" }));
      expect(receipt.status).toBe("buffered");

      // Process 2: same journal file, healthy sink, fresh transport state.
      const process2 = new BufferedTransport({
        sink: eventStoreSink(store),
        clock,
        journal: new JsonlFileJournal(path),
      });

      // The pending entry survived the restart WITH its attempt history.
      expect(process2.pending()).toHaveLength(1);
      expect(process2.pending()[0]).toMatchObject({ eventId: "ev-recover-1", attempts: 1 });

      // The retry is due at the recovered backoff boundary (1000 + 100).
      clock.advance(50);
      expect(await process2.pump()).toBe(1); // not due yet
      clock.advance(50);
      expect(await process2.pump()).toBe(0); // recovered delivery lands

      expect([...store.stream(tenantA)].map((s) => s.event.eventId)).toContain("ev-recover-1");
      expect(process2.pending()).toHaveLength(0);
      expect(process2.status(tenantA, "idem-recover-1")).toMatchObject({ state: "delivered" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("journal replay recovery: terminal failures re-surface after restart", async () => {
    const journal: TransportJournal = new InMemoryJournal();
    const alwaysFails: OutcomeSink = {
      deliver() {
        throw new Error("down");
      },
    };
    const clock = new ManualClock(0);
    const process1 = new BufferedTransport({ sink: alwaysFails, clock, journal, maxAttempts: 1 });
    await process1.publish(makeEvent({ eventId: "ev-fail-1", idempotencyKey: "idem-fail-1" }));
    expect(process1.failures()).toHaveLength(1);

    // Restart on the SAME journal: the failure is re-surfaced.
    const process2 = new BufferedTransport({
      sink: eventStoreSink(new InMemoryEventStoreAdapter()),
      clock,
      journal,
    });
    expect(process2.failures()).toHaveLength(1);
    expect(process2.failures()[0]).toMatchObject({ eventId: "ev-fail-1" });
    expect(process2.pending()).toHaveLength(0);
  });

  it("a tampered journal line fails recovery with a typed TransportJournalError", () => {
    const dir = mkdtempSync(join(tmpdir(), "reckon-journal-"));
    try {
      const path = join(dir, "outcomes.jsonl");
      const journal = new JsonlFileJournal(path);
      const event = makeEvent();
      journal.append({
        kind: "enqueue",
        at: 1,
        eventId: event.eventId,
        idempotencyKey: event.idempotencyKey,
        contentDigest: contentDigest(event),
        event,
      });

      // Tamper: mutate the journaled payload AFTER it was written.
      const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.length > 0);
      const record = JSON.parse(lines[0]!) as { event: { eventType: string } };
      record.event.eventType = "purchase"; // breaks the content digest
      writeFileSync(path, `${JSON.stringify(record)}\n`, "utf8");

      expect(
        () =>
          new BufferedTransport({
            sink: eventStoreSink(new InMemoryEventStoreAdapter()),
            clock: new ManualClock(0),
            journal: new JsonlFileJournal(path),
          }),
      ).toThrow(TransportJournalError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("W3-003 — tenant scoping and clocks", () => {
  it("transport keys are tenant-scoped: the same idempotencyKey in two tenants delivers both", async () => {
    const store = new InMemoryEventStoreAdapter();
    const transport = new BufferedTransport({ sink: eventStoreSink(store), clock: new ManualClock(0) });

    await transport.publish(makeEvent({ tenant: tenantA, idempotencyKey: "shared-key" }));
    await transport.publish(makeEvent({ tenant: tenantB, idempotencyKey: "shared-key" }));

    expect([...store.stream(tenantA)]).toHaveLength(1);
    expect([...store.stream(tenantB)]).toHaveLength(1);
    expect(transport.status(tenantA, "shared-key")).toMatchObject({ state: "delivered" });
    expect(transport.status(tenantB, "shared-key")).toMatchObject({ state: "delivered" });
  });

  it("SystemClock reads real time; ManualClock is fully deterministic", () => {
    expect(new SystemClock().now()).toBeGreaterThan(0);
    const manual = new ManualClock(50);
    expect(manual.now()).toBe(50);
    manual.advance(25);
    expect(manual.now()).toBe(75);
  });
});
