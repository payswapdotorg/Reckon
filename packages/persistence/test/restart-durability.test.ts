/**
 * P1-001 — RESTART DURABILITY (Gate L semantics at the adapter level).
 *
 * Write authoritative state through every production store → STOP the
 * PostgreSQL server → RESTART it on the SAME data directory → reconnect →
 * every record still reads identically. Durable persistence is the whole
 * point of ADR-001; this test is the local proof.
 *
 * Evidence class: controlled-local (real PG engine, real restart, real
 * wire protocol, production executor). The deployed-infrastructure
 * equivalent (Neon restart/scale-to-zero) is exercised with a real
 * DATABASE_URL during deployment verification.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  PgCatalogStore,
  PgContextStore,
  PgDecisionStore,
  PgEventQueries,
  PgEventSink,
  PgIdempotencyStore,
  PgOutboxTransport,
  PgPlanStore,
  PgPreferenceStore,
  PgResearchJobStore,
  type PgPoolExecutor,
} from "../src/index.js";
import { startTestPostgres, type TestPostgres } from "./pg-harness.js";
import {
  ManualClock,
  makeCatalogItem,
  makeContextSnapshot,
  makeDecision,
  makeEvent,
  makePlan,
  makePreferenceDelta,
  makeRealization,
  subject,
  tenantA,
} from "./fixtures.js";

let server: TestPostgres;
let clock: ManualClock;

beforeAll(async () => {
  server = await startTestPostgres();
  clock = new ManualClock(1_000);
}, 120_000);

describe("P1-001 restart durability — Gate L at adapter level", () => {
  it("state written BEFORE a full server stop reads identically AFTER restart on the same data dir", async () => {
    const executor = server.executor;

    // ---------------- Phase 1: write through every store ----------------
    const sink = new PgEventSink({ executor });
    const delivered = await new PgOutboxTransport({ executor, sink, clock }).publish(
      makeEvent({
        eventId: "durable-ev-1",
        idempotencyKey: "durable-ev-1",
        occurredAt: 77_777,
        metrics: { durable: 1 },
        provenance: { system: "durability-proof", version: "1" },
      }),
    );
    expect(delivered.status).toBe("delivered");

    // Leave one row PENDING in the outbox (crash-in-flight state): the
    // sink rejects transiently with an effectively-infinite backoff, so
    // publish returns buffered and the row stays pending.
    const wedged = { deliver: () => Promise.reject(new Error("crash before delivery")) };
    const wedgedTransport = new PgOutboxTransport({ executor, sink: wedged, clock, backoff: () => 9_000_000_000 });
    const bufferedReceipt = await wedgedTransport.publish(
      makeEvent({ eventId: "durable-ev-2", idempotencyKey: "durable-ev-2", occurredAt: 88_888 }),
    );
    expect(bufferedReceipt.status).toBe("buffered");

    const decision = makeDecision({ decisionId: "durable-dec-1", at: 55_555 });
    await new PgDecisionStore(executor).put(decision, "durable-req-digest");

    const plan = makePlan({ planId: "durable-plan-1", createdAt: 11_111, updatedAt: 11_111 });
    const planStore = new PgPlanStore(executor);
    await planStore.create(plan);
    await planStore.replan(
      makePlan({ planId: "durable-plan-1", createdAt: 22_222, updatedAt: 22_222 }),
      "durability-check",
    );

    await new PgCatalogStore(executor).putItem(tenantA, makeCatalogItem({ itemId: "durable-item-1" }));
    await new PgCatalogStore(executor).putRealization(tenantA, makeRealization({ realizationId: "durable-rz-1" }));
    await new PgPreferenceStore(executor).append(makePreferenceDelta({ deltaId: "durable-pd-1" }));
    await new PgContextStore(executor).put(tenantA, makeContextSnapshot({ contextId: "durable-cx-1" }));
    await new PgIdempotencyStore(executor).store("durable-tenant", "route", "durable-key", "digest", {
      statusCode: 201,
      body: { durable: true },
    });
    const jobs = new PgResearchJobStore(executor, clock);
    await jobs.enqueue({ jobId: "durable-job-1", tenant: tenantA, kind: "offline-eval", payload: { n: 1 } });
    const claimed = await jobs.claim("durable-worker", 9_000_000_000);
    expect(claimed?.jobId).toBe("durable-job-1");

    // ---------------- Phase 2: full server stop → restart ----------------
    const executor2: PgPoolExecutor = await server.restart();

    // ---------------- Phase 3: everything reads identically ----------------
    const queries = new PgEventQueries(executor2);
    const ev1 = await queries.getByEventId(tenantA, "durable-ev-1");
    expect(ev1?.event.occurredAt).toBe(77_777);
    expect(ev1?.event.metrics).toEqual({ durable: 1 });
    expect(ev1?.event.provenance?.system).toBe("durability-proof");

    // The outbox row that was pending survives — and a new transport
    // (a "new process") delivers it once its backoff window has elapsed
    // (the manual clock models wall-clock time passing across the restart):
    // at-least-once across restart.
    const recovery = new PgOutboxTransport({ executor: executor2, sink: new PgEventSink({ executor: executor2 }), clock });
    expect((await recovery.pending()).map((p) => p.eventId)).toContain("durable-ev-2");
    clock.advance(9_000_000_000);
    expect(await recovery.flush()).toBe(0);
    const ev2 = await queries.getByEventId(tenantA, "durable-ev-2");
    expect(ev2?.event.occurredAt).toBe(88_888);

    const readDecision = await new PgDecisionStore(executor2).get("tenant-a", "durable-dec-1");
    expect(readDecision?.at).toBe(55_555);
    expect(readDecision?.decisionId).toBe("durable-dec-1");

    const readPlan = await new PgPlanStore(executor2).get(tenantA, "durable-plan-1");
    expect(readPlan?.version).toBe(2);
    const history = await new PgPlanStore(executor2).history(tenantA, "durable-plan-1");
    expect(history.map((h) => h.version)).toEqual([1, 2]);
    expect(history[1]?.reason).toBe("durability-check");

    const catStore = new PgCatalogStore(executor2);
    expect((await catStore.getItem(tenantA, "durable-item-1"))?.itemId).toBe("durable-item-1");
    expect((await catStore.getRealization(tenantA, "durable-rz-1"))?.realizationId).toBe("durable-rz-1");

    const deltas = await new PgPreferenceStore(executor2).bySubject(tenantA, subject);
    expect(deltas.map((d) => d.deltaId)).toEqual(["durable-pd-1"]);

    expect((await new PgContextStore(executor2).get(tenantA, "durable-cx-1"))?.contextId).toBe("durable-cx-1");

    const idem = await new PgIdempotencyStore(executor2).lookup("durable-tenant", "route", "durable-key");
    expect(idem?.response.body).toEqual({ durable: true });
    expect(idem?.response.statusCode).toBe(201);

    const job = await new PgResearchJobStore(executor2, clock).get("durable-job-1");
    expect(job?.state).toBe("leased");
    expect(job?.leaseOwner).toBe("durable-worker");
  }, 180_000);
});
