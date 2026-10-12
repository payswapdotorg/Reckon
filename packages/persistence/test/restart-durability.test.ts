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
import { AdForgetRequestSchema, finalizeAdMemoryRecord } from "@reckon/contracts";
import {
  PgAdMemoryStore,
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

    // AD-002: Personal Ad Memory — the state that must survive the restart
    // below: a current record, its superseded predecessor (re-encounter),
    // a forgotten tombstone, and an append-only permission history.
    const adStore = new PgAdMemoryStore(executor);
    const adMemoryContent = (outcomeEventId: string, recordedAt: number, itemId: string) => ({
      tenant: tenantA,
      subject,
      ad: { itemId, kind: "advertising" as const, labels: ["travel"], attributes: { headline: "Durable hotel ad" } },
      realizations: [],
      lineage: { source: "host-ad-server", advertiserRef: "adv-durable", campaignRef: "camp-d", creativeRefs: ["cr-d"] },
      retention: {
        state: "active" as const,
        basis: { kind: "explicit-user-consent" as const, establishedAt: 1_000, basisRef: "consent-durable" },
        retainedAt: 1_000,
        expiresAt: 9_000_000,
      },
      permissions: { retain: "granted" as const, present: "granted" as const, history: [] },
      provenance: {
        kind: "observed-encounter" as const,
        evidence: {
          outcomeEventId,
          evidenceClass: "production-observed" as const,
          encounteredAt: 1_000,
          context: { contextId: "ctx-durable" },
          surface: "in-stream",
        },
      },
      rights: { redistributionPermitted: false, gates: ["host-rights-gate"], usageRestrictions: [] },
      recordedAt,
    });
    const adFirst = finalizeAdMemoryRecord(adMemoryContent("durable-enc-1", 10_000, "durable-ad-1"));
    const adSecond = finalizeAdMemoryRecord(adMemoryContent("durable-enc-2", 20_000, "durable-ad-1")); // re-encounter: supersedes adFirst
    await adStore.put(adFirst);
    await adStore.put(adSecond);
    const adForgettable = finalizeAdMemoryRecord(adMemoryContent("durable-enc-3", 30_000, "durable-ad-2"));
    await adStore.put(adForgettable);
    const adForgotten = await adStore.forget(
      AdForgetRequestSchema.parse({
        requestId: "durable-forget-1",
        tenant: tenantA,
        subject,
        target: { kind: "record", recordId: adForgettable.recordId },
        reason: "restart-durability forget",
        at: 40_000,
        idempotencyKey: "durable-forget-idem",
      }),
    );
    expect(adForgotten.forgottenCount).toBe(1);
    // present-revoke on the current record — the history must survive restart
    await adStore.applyPermissionTransition(tenantA, adSecond.recordId, {
      capability: "present",
      from: "granted",
      to: "revoked",
      at: 50_000,
      reason: "paused for restart",
    });

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

    // AD-002: ad memory reads identically after the full restart —
    // current record verbatim (with its permission history), the
    // superseded predecessor still readable by id, the forgotten
    // tombstone unretrievable forever, and the lane answering correctly.
    const adStore2 = new PgAdMemoryStore(executor2);
    const adCurrent = await adStore2.get(tenantA, adSecond.recordId);
    expect(adCurrent?.recordId).toBe(adSecond.recordId);
    expect(adCurrent?.provenance).toEqual(adSecond.provenance);
    expect(adCurrent?.permissions.history).toEqual([
      { capability: "present", from: "granted", to: "revoked", at: 50_000, reason: "paused for restart" },
    ]);
    expect(await adStore2.get(tenantA, adFirst.recordId)).toEqual(adFirst); // superseded row: verbatim, readable (audit)
    // the lane: current record is present-revoked, predecessor superseded,
    // tombstone forgotten → nothing retrievable at any clock after 50_000
    expect(await adStore2.listRemembered(tenantA, subject, 60_000)).toHaveLength(0);
    // re-granting present AFTER the restart works and the record returns
    const regranted = await adStore2.applyPermissionTransition(tenantA, adSecond.recordId, {
      capability: "present",
      from: "revoked",
      to: "granted",
      at: 70_000,
    });
    expect(regranted.effect).toBe("updated");
    expect((await adStore2.listRemembered(tenantA, subject, 80_000)).map((r) => r.recordId)).toEqual([
      adSecond.recordId,
    ]);
    // the forgotten record stays unretrievable across the restart (law 2)
    expect(await adStore2.get(tenantA, adForgettable.recordId)).toBeNull();
    const resurrectAttempt = await adStore2.put(adForgettable);
    expect(resurrectAttempt.outcome).toBe("duplicate");
    expect(resurrectAttempt.record).toBeNull();
    expect(resurrectAttempt.forgottenAt).toBe(40_000);
  }, 180_000);
});
