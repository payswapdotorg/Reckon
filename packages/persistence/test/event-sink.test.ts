/**
 * P1-001 — PgEventSink semantic conformance over a REAL PostgreSQL server.
 *
 * Mirrors the events-package in-memory adapter test cases (validation,
 * idempotency, eventId immutability, correction verification, tenant
 * isolation, append order, partition split) against the production sink.
 * Evidence class: controlled-local (real PG engine + real pg driver).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CorrectionCrossTenantError,
  CorrectionEvidenceClassMismatchError,
  CorrectionTargetNotFoundError,
  EventIdConflictError,
  EventValidationError,
} from "@reckon/events";
import { PgEventQueries, PgEventSink, rowToStoredOutcomeEvent } from "../src/index.js";
import { startTestPostgres, type TestPostgres } from "./pg-harness.js";
import { makeEvent, subject, tenantA, tenantAWorkspace, tenantB } from "./fixtures.js";

let server: TestPostgres;
let sink: PgEventSink;
let queries: PgEventQueries;

beforeAll(async () => {
  server = await startTestPostgres();
  sink = new PgEventSink({ executor: server.executor });
  queries = new PgEventQueries(server.executor);
}, 120_000);

afterAll(async () => {
  await server.stop();
}, 60_000);

async function append(event: ReturnType<typeof makeEvent>) {
  const results = await sink.deliver([event]);
  return results[0]!;
}

describe("P1-001 PgEventSink — frozen-schema validation", () => {
  it("rejects an unknown event shape with a typed EventValidationError (never throws)", async () => {
    const result = await append({ nonsense: true } as unknown as ReturnType<typeof makeEvent>);
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.error).toBeInstanceOf(EventValidationError);
    }
  });

  it("rejects an out-of-enum eventType", async () => {
    const result = await append(makeEvent({ eventId: "bad-type", idempotencyKey: "bad-type", eventType: "not-a-type" as never }));
    expect(result.status).toBe("rejected");
  });
});

describe("P1-001 PgEventSink — idempotency + eventId immutability", () => {
  it("returns the ORIGINAL record with duplicate:true on key reuse", async () => {
    const first = await append(makeEvent({ eventId: "idem-ev", idempotencyKey: "idem-key" }));
    expect(first.status).toBe("appended");
    if (first.status === "appended") expect(first.result.duplicate).toBe(false);

    const second = await append(
      makeEvent({ eventId: "idem-ev-OTHER", idempotencyKey: "idem-key", metrics: { changed: 1 } }),
    );
    expect(second.status).toBe("appended");
    if (second.status === "appended") {
      expect(second.result.duplicate).toBe(true);
      expect(second.result.originalEventId).toBe("idem-ev");
      expect(second.result.event.metrics).toEqual({});
      expect(second.result.sequence).toBe(first.status === "appended" ? first.result.sequence : 0);
    }
  });

  it("rejects eventId reuse under a DIFFERENT idempotency key (contracts #2)", async () => {
    const result = await append(
      makeEvent({ eventId: "idem-ev", idempotencyKey: "idem-key-2" }),
    );
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.error).toBeInstanceOf(EventIdConflictError);
    }
  });
});

describe("P1-001 PgEventSink — correction verification (append law, contracts #8)", () => {
  it("rejects a correction whose target does not exist", async () => {
    const result = await append(
      makeEvent({
        eventId: "corr-1",
        idempotencyKey: "corr-1",
        correctsEventId: "no-such-event",
      }),
    );
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.error).toBeInstanceOf(CorrectionTargetNotFoundError);
    }
  });

  it("surfaces a cross-tenant correction target explicitly", async () => {
    // Seed an event in tenant B…
    await append(makeEvent({ tenant: tenantB, eventId: "tb-ev", idempotencyKey: "tb-key" }));
    // …then try to correct it from tenant A.
    const result = await append(
      makeEvent({ eventId: "xa-ev", idempotencyKey: "xa-key", correctsEventId: "tb-ev" }),
    );
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.error).toBeInstanceOf(CorrectionCrossTenantError);
    }
  });

  it("rejects corrections that cross the observed/research partition", async () => {
    await append(
      makeEvent({ eventId: "obs-ev", idempotencyKey: "obs-key", evidenceClass: "production-observed" }),
    );
    const result = await append(
      makeEvent({
        eventId: "sim-ev",
        idempotencyKey: "sim-key",
        evidenceClass: "simulated",
        correctsEventId: "obs-ev",
      }),
    );
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.error).toBeInstanceOf(CorrectionEvidenceClassMismatchError);
    }
  });

  it("accepts a same-partition correction", async () => {
    await append(makeEvent({ eventId: "c-ok-1", idempotencyKey: "c-ok-1" }));
    const result = await append(
      makeEvent({ eventId: "c-ok-2", idempotencyKey: "c-ok-2", correctsEventId: "c-ok-1" }),
    );
    expect(result.status).toBe("appended");
  });
});

describe("P1-001 PgEventSink — tenant + workspace isolation (structural)", () => {
  it("tenant A never observes tenant B's events; workspace scopes are distinct", async () => {
    await append(makeEvent({ tenant: tenantB, eventId: "iso-b", idempotencyKey: "iso-b" }));
    await append(
      makeEvent({ tenant: tenantAWorkspace, eventId: "iso-aws", idempotencyKey: "iso-aws" }),
    );
    const forA = await queries.list(tenantA);
    const forAWS = await queries.list(tenantAWorkspace);
    const forB = await queries.list(tenantB);
    expect(forA.some((s) => s.event.eventId === "iso-b")).toBe(false);
    expect(forA.some((s) => s.event.eventId === "iso-aws")).toBe(false);
    expect(forAWS.some((s) => s.event.eventId === "iso-aws")).toBe(true);
    expect(forB.every((s) => s.event.tenant.tenantId === "tenant-b")).toBe(true);
  });
});

describe("P1-001 PgEventQueries — read side", () => {
  it("orders by append sequence and filters by decision / subject / experience", async () => {
    const t = { tenantId: "read-tenant" } as const;
    for (const n of [1, 2, 3]) {
      await append(
        makeEvent({
          tenant: t,
          eventId: `rd-${n}`,
          idempotencyKey: `rd-${n}`,
          decisionId: n === 2 ? "dec-2" : "dec-1",
          experienceId: n === 3 ? "exp-3" : undefined,
          occurredAt: n * 100,
          subject,
        }),
      );
    }
    const byDecision = await queries.getByDecision(t, "dec-1");
    expect(byDecision.map((s) => s.event.eventId)).toEqual(["rd-1", "rd-3"]);
    const byExperience = await queries.getByExperience(t, "exp-3");
    expect(byExperience.map((s) => s.event.eventId)).toEqual(["rd-3"]);
    const bySubject = await queries.getBySubject(t, subject, { fromMs: 150 });
    expect(bySubject.map((s) => s.event.eventId)).toEqual(["rd-2", "rd-3"]);
    const all = await queries.list(t);
    expect(all.map((s) => s.sequence)).toEqual([...all.map((s) => s.sequence)].sort((a, b) => a - b));
  });

  it("splits the observed/research partitions disjointly", async () => {
    const t = { tenantId: "part-tenant" } as const;
    await append(makeEvent({ tenant: t, eventId: "pt-o", idempotencyKey: "pt-o", evidenceClass: "production-observed" }));
    await append(makeEvent({ tenant: t, eventId: "pt-c", idempotencyKey: "pt-c", evidenceClass: "controlled-local" }));
    await append(makeEvent({ tenant: t, eventId: "pt-s", idempotencyKey: "pt-s", evidenceClass: "simulated" }));
    await append(makeEvent({ tenant: t, eventId: "pt-f", idempotencyKey: "pt-f", evidenceClass: "fixture" }));
    const observed = await queries.observed(t);
    const research = await queries.research(t);
    expect(observed.map((s) => s.event.eventId).sort()).toEqual(["pt-c", "pt-o"]);
    expect(research.map((s) => s.event.eventId).sort()).toEqual(["pt-f", "pt-s"]);
  });

  it("round-trips canonical JSON through the frozen schema (digest stable)", async () => {
    const event = makeEvent({
      tenant: tenantA,
      eventId: "rt-1",
      idempotencyKey: "rt-1",
      provenance: { system: "round-trip", version: "9" },
      metrics: { ratio: 0.5, count: 2 },
    });
    const result = await append(event);
    expect(result.status).toBe("appended");
    const stored = await queries.getByEventId(tenantA, "rt-1");
    expect(stored).toBeDefined();
    expect(stored!.event).toEqual(event);
    expect(stored!.contentDigest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("P1-001 rowToStoredOutcomeEvent — stored-record integrity", () => {
  it("fails LOUDLY on a corrupted stored payload (never silently accepted)", () => {
    expect(() =>
      rowToStoredOutcomeEvent({ event_json: { nonsense: true }, content_digest: "x", sequence: 1, event_id: "bad" }),
    ).toThrow(/failed OutcomeEventSchema validation/);
  });
});
