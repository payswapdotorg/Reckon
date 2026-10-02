/**
 * P1-001/P1-003 — PgIdempotencyStore + authoritative state stores over a
 * REAL PostgreSQL server. Evidence class: controlled-local.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PgCatalogStore,
  PgContextStore,
  PgDecisionStore,
  PgIdempotencyStore,
  PgPlanStore,
  PgPreferenceStore,
  PgResearchJobStore,
  StateIdConflictError,
} from "../src/index.js";
import { startTestPostgres, type TestPostgres } from "./pg-harness.js";
import {
  ManualClock,
  makeCatalogItem,
  makeContextSnapshot,
  makeDecision,
  makePlan,
  makePreferenceDelta,
  makeRealization,
  subject,
  tenantA,
  tenantAWorkspace,
  tenantB,
} from "./fixtures.js";

let server: TestPostgres;
let clock: ManualClock;

beforeAll(async () => {
  server = await startTestPostgres();
  clock = new ManualClock(1_000);
}, 120_000);

afterAll(async () => {
  await server.stop();
}, 60_000);

describe("P1-003 PgIdempotencyStore", () => {
  it("stores and replays a response; tenant-scoped by PK", async () => {
    const store = new PgIdempotencyStore(server.executor);
    await store.store("t-idem", "POST /v1/decisions", "key-1", "digest-1", {
      statusCode: 200,
      body: { ok: true },
      headers: { "x-reckon": "yes" },
    });
    const hit = await store.lookup("t-idem", "POST /v1/decisions", "key-1");
    expect(hit?.requestDigest).toBe("digest-1");
    expect(hit?.response.statusCode).toBe(200);
    expect(hit?.response.body).toEqual({ ok: true });
    expect(hit?.response.headers?.["x-reckon"]).toBe("yes");

    const miss = await store.lookup("t-other", "POST /v1/decisions", "key-1");
    expect(miss).toBeUndefined();
  });

  it("last write wins on re-store (Map.set semantics, documented)", async () => {
    const store = new PgIdempotencyStore(server.executor);
    await store.store("t-idem2", "route", "k", "d1", { statusCode: 200, body: { v: 1 } });
    await store.store("t-idem2", "route", "k", "d2", { statusCode: 200, body: { v: 2 } });
    const hit = await store.lookup("t-idem2", "route", "k");
    expect(hit?.response.body).toEqual({ v: 2 });
  });
});

describe("P1-001 PgDecisionStore", () => {
  it("round-trips a decision; same digest is idempotent, different digest is a typed conflict", async () => {
    const store = new PgDecisionStore(server.executor);
    const decision = makeDecision({ decisionId: "ds-1", requestId: "rq-1" });
    const first = await store.put(decision, "req-digest-1");
    expect(first.duplicate).toBe(false);

    const again = await store.put(decision, "req-digest-1");
    expect(again.duplicate).toBe(true);

    await expect(store.put({ ...decision, action: "SWITCH" }, "req-digest-2")).rejects.toBeInstanceOf(
      StateIdConflictError,
    );

    const read = await store.get("tenant-a", "ds-1");
    expect(read?.decisionId).toBe("ds-1");
    expect(read?.action).toBe("HOLD");
    expect(await store.get("tenant-b", "ds-1")).toBeNull();
  });

  it("lists decisions tenant-scoped", async () => {
    const store = new PgDecisionStore(server.executor);
    await store.put(makeDecision({ decisionId: "ds-2", tenant: tenantB }), "d");
    await store.put(makeDecision({ decisionId: "ds-3", tenant: tenantAWorkspace }), "d");
    const listA = await store.list(tenantA);
    expect(listA.some((d) => d.decisionId === "ds-2")).toBe(false);
    expect(listA.some((d) => d.decisionId === "ds-3")).toBe(false);
    const listAWS = await store.list(tenantAWorkspace);
    expect(listAWS.some((d) => d.decisionId === "ds-3")).toBe(true);
  });
});

describe("P1-001 PgPlanStore — versioned append-only replan history", () => {
  it("create → replan appends versions (never overwrites); latest + history reads", async () => {
    const store = new PgPlanStore(server.executor);
    const plan = makePlan({ planId: "pl-1", createdAt: 10_000, updatedAt: 10_000 });
    await store.create(plan);
    await expect(store.create(plan)).rejects.toBeInstanceOf(StateIdConflictError);

    const v2 = await store.replan(
      makePlan({ planId: "pl-1", createdAt: 11_000, updatedAt: 11_000, version: 1 }),
      "outcome-observed",
    );
    expect(v2.version).toBe(2);
    const v3 = await store.replan(
      makePlan({ planId: "pl-1", createdAt: 12_000, updatedAt: 12_000, version: 2 }),
      "preference-shift",
    );
    expect(v3.version).toBe(3);

    const latest = await store.get(tenantA, "pl-1");
    expect(latest?.version).toBe(3);
    const history = await store.history(tenantA, "pl-1");
    expect(history.map((h) => h.version)).toEqual([1, 2, 3]);
    expect(history.map((h) => h.reason)).toEqual([null, "outcome-observed", "preference-shift"]);
    expect(await store.get(tenantB, "pl-1")).toBeNull();
  });
});

describe("P1-001 PgCatalogStore", () => {
  it("round-trips items and realizations, tenant-scoped", async () => {
    const store = new PgCatalogStore(server.executor);
    const item = makeCatalogItem({ itemId: "ci-1", kind: "commerce", labels: ["a", "b"] });
    expect((await store.putItem(tenantA, item)).duplicate).toBe(false);
    expect((await store.putItem(tenantA, item)).duplicate).toBe(true);
    expect((await store.getItem(tenantA, "ci-1"))?.labels).toEqual(["a", "b"]);
    expect(await store.getItem(tenantB, "ci-1")).toBeNull();

    const realization = makeRealization({ realizationId: "rz-1", itemId: "ci-1", kind: "checkout" });
    await store.putRealization(tenantA, realization);
    expect((await store.getRealization(tenantA, "rz-1"))?.kind).toBe("checkout");
    expect((await store.listRealizations(tenantA, "ci-1")).map((r) => r.realizationId)).toEqual(["rz-1"]);
    expect((await store.listItems(tenantAWorkspace)).length).toBe(0);
  });
});

describe("P1-001 PgPreferenceStore — append-only", () => {
  it("appends in order and reads back by subject", async () => {
    const store = new PgPreferenceStore(server.executor);
    const first = await store.append(makePreferenceDelta({ deltaId: "pd-1", timestamp: 21_000 }));
    const second = await store.append(
      makePreferenceDelta({ deltaId: "pd-2", timestamp: 22_000, dimension: "genre.doc" }),
    );
    expect(second.sequence).toBeGreaterThan(first.sequence);
    const bySubject = await store.bySubject(tenantA, subject);
    expect(bySubject.map((d) => d.deltaId)).toEqual(["pd-1", "pd-2"]);
    expect(await store.bySubject(tenantB, subject)).toHaveLength(0);
  });
});

describe("P1-001 PgContextStore", () => {
  it("round-trips context snapshots tenant-scoped", async () => {
    const store = new PgContextStore(server.executor);
    const snapshot = makeContextSnapshot({ contextId: "cx-1", at: 30_000, device: { class: "phone" } });
    expect((await store.put(tenantA, snapshot)).duplicate).toBe(false);
    expect((await store.get(tenantA, "cx-1"))?.device?.class).toBe("phone");
    expect(await store.get(tenantB, "cx-1")).toBeNull();
  });
});

describe("P1-001 PgResearchJobStore — durable jobs + worker leases (ADR-001)", () => {
  it("enqueues FIFO, claims with lease, completes", async () => {
    const store = new PgResearchJobStore(server.executor, clock);
    await store.enqueue({ jobId: "job-1", tenant: tenantA, kind: "offline-eval", payload: { run: 1 } });
    await store.enqueue({ jobId: "job-2", tenant: tenantA, kind: "simulation", payload: { run: 2 } });

    const claimed = await store.claim("worker-alpha", 5_000);
    expect(claimed?.jobId).toBe("job-1");
    expect(claimed?.state).toBe("leased");
    expect(claimed?.leaseOwner).toBe("worker-alpha");

    await store.complete("job-1", "r2://artifacts/job-1");
    const done = await store.get("job-1");
    expect(done?.state).toBe("done");
    expect(done?.resultRef).toBe("r2://artifacts/job-1");

    // Cannot complete an unleased job.
    await expect(store.complete("job-2", "x")).rejects.toThrow(/not leased/);
  });

  it("reclaims expired leases (crashed worker recovery)", async () => {
    const store = new PgResearchJobStore(server.executor, clock);
    // Drain the queue first: earlier tests in this file leave queued jobs
    // behind (FIFO order — claims go to the OLDEST queued job).
    for (let i = 0; i < 10; i += 1) {
      const drained = await store.claim("drainer", 60_000);
      if (drained === undefined) break;
      await store.complete(drained.jobId, `r2://drained/${drained.jobId}`);
    }
    await store.enqueue({ jobId: "job-3", tenant: tenantA, kind: "bandit-eval", payload: {} });
    const claimed = await store.claim("worker-beta", 1_000);
    expect(claimed?.jobId).toBe("job-3");

    // Lease still active → no reclaim, no second claim.
    expect(await store.claim("worker-gamma", 1_000)).toBeUndefined();
    expect(await store.reclaimExpired()).toEqual([]);

    // Advance the injected clock past the lease → reclaim + re-claim succeeds.
    clock.advance(2_000);
    expect(await store.reclaimExpired()).toEqual(["job-3"]);
    const reclaimed = await store.claim("worker-gamma", 5_000);
    expect(reclaimed?.jobId).toBe("job-3");
    expect(reclaimed?.leaseOwner).toBe("worker-gamma");

    await store.fail("job-3", "eval diverged");
    expect((await store.get("job-3"))?.state).toBe("failed");
  });

  it("rejects duplicate job ids", async () => {
    const store = new PgResearchJobStore(server.executor, clock);
    await store.enqueue({ jobId: "job-dup", tenant: tenantA, kind: "x", payload: {} });
    await expect(
      store.enqueue({ jobId: "job-dup", tenant: tenantB, kind: "x", payload: {} }),
    ).rejects.toThrow(/already exists/);
  });
});
