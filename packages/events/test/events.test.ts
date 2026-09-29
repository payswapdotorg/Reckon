import { describe, it, expect } from "vitest";
import {
  OutcomeEventSchema,
  type OutcomeEvent,
  type SubjectReference,
  type TenantScope,
} from "@reckon/contracts";
import {
  InMemoryEventStoreAdapter,
  EventsError,
  EventValidationError,
  EventIdConflictError,
  CorrectionTargetNotFoundError,
  CorrectionCrossTenantError,
  CorrectionEvidenceClassMismatchError,
} from "../src/index.js";

const tenantA: TenantScope = { tenantId: "tenant-a" };
const tenantB: TenantScope = { tenantId: "tenant-b" };
const subject: SubjectReference = { kind: "user", ref: "user-9" };

function makeEvent(overrides: Partial<OutcomeEvent> = {}): OutcomeEvent {
  return {
    schema: "reckon.outcome-event",
    schemaVersion: "0.1.0",
    eventId: "ev-1",
    tenant: tenantA,
    subject,
    eventType: "completion",
    occurredAt: 1_000,
    evidenceClass: "production-observed",
    idempotencyKey: "idem-1",
    metrics: {},
    ...overrides,
  };
}

describe("W1-001 events — happy path and round-trip", () => {
  it("appends a valid event and round-trips it against the real frozen schema", () => {
    const store = new InMemoryEventStoreAdapter();
    const result = store.append(
      makeEvent({
        decisionId: "dec-1",
        experienceId: "exp-1",
        provenance: { system: "host-app", version: "1.2.0", correlationId: "corr-7" },
        metrics: { watchRatio: 0.92 },
      })
    );
    expect(result.duplicate).toBe(false);
    expect(result.sequence).toBe(1);
    expect(result.contentDigest).toMatch(/^[0-9a-f]{64}$/);
    // Round-trip through the REAL zod schema.
    const reparsed = OutcomeEventSchema.parse(result.event);
    expect(reparsed.eventId).toBe("ev-1");
    expect(reparsed.provenance?.system).toBe("host-app");
    expect(reparsed.metrics.watchRatio).toBe(0.92);
  });

  it("preserves provenance and caller-supplied occurredAt verbatim", () => {
    const store = new InMemoryEventStoreAdapter();
    const result = store.append(
      makeEvent({ occurredAt: 42_000, provenance: { system: "ingest-edge", version: "0.3" } })
    );
    expect(result.event.occurredAt).toBe(42_000);
    expect(result.event.provenance).toEqual({ system: "ingest-edge", version: "0.3" });
  });

  it("stores a frozen defensive copy — caller mutation cannot reach the store", () => {
    const store = new InMemoryEventStoreAdapter();
    const input = makeEvent({ metrics: { ratio: 1 } });
    const result = store.append(input);
    expect(Object.isFrozen(result.event)).toBe(true);
    // Mutating the caller's original object after append must not affect storage.
    (input as { metrics: Record<string, number> }).metrics.ratio = -1;
    const [stored] = [...store.stream(tenantA)];
    expect(stored?.event.metrics.ratio).toBe(1);
  });

  it("iterates stream() in deterministic append order", () => {
    const store = new InMemoryEventStoreAdapter();
    store.append(makeEvent({ eventId: "ev-a", idempotencyKey: "k-a", occurredAt: 5_000 }));
    store.append(makeEvent({ eventId: "ev-b", idempotencyKey: "k-b", occurredAt: 1_000 }));
    store.append(makeEvent({ eventId: "ev-c", idempotencyKey: "k-c", occurredAt: 9_000 }));
    const order = [...store.stream(tenantA)].map((r) => r.event.eventId);
    expect(order).toEqual(["ev-a", "ev-b", "ev-c"]); // append order, not occurredAt order
  });
});

describe("W1-001 events — idempotency (append law)", () => {
  it("returns the ORIGINAL record for a duplicate idempotencyKey — no second record", () => {
    const store = new InMemoryEventStoreAdapter();
    const first = store.append(makeEvent({ eventId: "ev-1", idempotencyKey: "idem-x" }));
    const second = store.append(
      makeEvent({ eventId: "ev-OTHER", idempotencyKey: "idem-x", occurredAt: 999 })
    );
    expect(second.duplicate).toBe(true);
    expect(second.originalEventId).toBe("ev-1");
    expect(second.event.eventId).toBe("ev-1");
    expect(second.event.occurredAt).toBe(first.event.occurredAt);
    expect(second.contentDigest).toBe(first.contentDigest);
    expect(second.sequence).toBe(first.sequence);
    expect([...store.stream(tenantA)]).toHaveLength(1);
  });

  it("scopes idempotency keys per tenant — the same key in another tenant is NOT a duplicate", () => {
    const store = new InMemoryEventStoreAdapter();
    store.append(makeEvent({ idempotencyKey: "idem-shared" }));
    const other = store.append(
      makeEvent({ tenant: tenantB, eventId: "ev-b1", idempotencyKey: "idem-shared" })
    );
    expect(other.duplicate).toBe(false);
    expect([...store.stream(tenantA)]).toHaveLength(1);
    expect([...store.stream(tenantB)]).toHaveLength(1);
  });

  it("rejects an eventId reused with a different idempotencyKey (IDs are immutable)", () => {
    const store = new InMemoryEventStoreAdapter();
    store.append(makeEvent({ eventId: "ev-dup", idempotencyKey: "k-1" }));
    expect(() =>
      store.append(makeEvent({ eventId: "ev-dup", idempotencyKey: "k-2" }))
    ).toThrowError(EventIdConflictError);
    try {
      store.append(makeEvent({ eventId: "ev-dup", idempotencyKey: "k-3" }));
    } catch (err) {
      const typed = err as EventsError;
      expect(typed.code).toBe("EVENT_ID_CONFLICT");
      expect(typed.details.tenantId).toBe("tenant-a|");
      expect(typed.details.eventId).toBe("ev-dup");
    }
  });
});

describe("W1-001 events — tenant isolation (structural)", () => {
  it("yields NOTHING for a foreign tenant on every query surface", () => {
    const store = new InMemoryEventStoreAdapter();
    store.append(
      makeEvent({ decisionId: "dec-1", experienceId: "exp-1", idempotencyKey: "k-i" })
    );
    const foreign: TenantScope = { tenantId: "tenant-foreign" };
    expect(store.getByDecision(foreign, "dec-1")).toEqual([]);
    expect(store.getByExperience(foreign, "exp-1")).toEqual([]);
    expect(store.getBySubject(foreign, subject)).toEqual([]);
    expect([...store.stream(foreign)]).toEqual([]);
    expect([...store.observed(foreign)]).toEqual([]);
    expect([...store.research(foreign)]).toEqual([]);
  });

  it("separates workspace scope inside a tenant", () => {
    const store = new InMemoryEventStoreAdapter();
    store.append(makeEvent({ tenant: { tenantId: "t", workspaceId: "ws-1" }, idempotencyKey: "k" }));
    expect([...store.stream({ tenantId: "t", workspaceId: "ws-2" })]).toEqual([]);
    expect([...store.stream({ tenantId: "t", workspaceId: "ws-1" })]).toHaveLength(1);
  });
});

describe("W1-001 events — corrections (append-oriented, never overwrite)", () => {
  it("appends a correction referencing an existing same-tenant event; original untouched", () => {
    const store = new InMemoryEventStoreAdapter();
    store.append(makeEvent({ eventId: "ev-orig", idempotencyKey: "k-orig" }));
    const correction = store.append(
      makeEvent({
        eventId: "ev-corr",
        idempotencyKey: "k-corr",
        eventType: "correction",
        correctsEventId: "ev-orig",
        metrics: { watchRatio: 0.5 },
      })
    );
    expect(correction.event.eventType).toBe("correction");
    expect(correction.event.correctsEventId).toBe("ev-orig");
    const stream = [...store.stream(tenantA)];
    expect(stream.map((r) => r.event.eventId)).toEqual(["ev-orig", "ev-corr"]);
    // The ORIGINAL record was not rewritten by the correction:
    const original = stream[0]!.event;
    expect(original.eventType).toBe("completion");
    expect(original.metrics).toEqual({});
  });

  it("rejects a correction whose target does not exist in the same tenant", () => {
    const store = new InMemoryEventStoreAdapter();
    expect(() =>
      store.append(
        makeEvent({
          eventId: "ev-bad",
          idempotencyKey: "k-bad",
          eventType: "correction",
          correctsEventId: "ev-missing",
        })
      )
    ).toThrowError(CorrectionTargetNotFoundError);
    try {
      store.append(
        makeEvent({
          eventId: "ev-bad2",
          idempotencyKey: "k-bad2",
          eventType: "correction",
          correctsEventId: "ev-missing",
        })
      );
    } catch (err) {
      expect((err as EventsError).code).toBe("CORRECTION_TARGET_NOT_FOUND");
      expect((err as EventsError).details.correctsEventId).toBe("ev-missing");
    }
    // Nothing was appended.
    expect([...store.stream(tenantA)]).toEqual([]);
  });

  it("detects a correction target that exists in a FOREIGN tenant", () => {
    const store = new InMemoryEventStoreAdapter();
    store.append(
      makeEvent({ tenant: tenantB, eventId: "ev-other-tenant", idempotencyKey: "k-ot" })
    );
    expect(() =>
      store.append(
        makeEvent({
          eventId: "ev-x",
          idempotencyKey: "k-x",
          eventType: "correction",
          correctsEventId: "ev-other-tenant",
        })
      )
    ).toThrowError(CorrectionCrossTenantError);
  });

  it("rejects corrections that would link the observed and research partitions", () => {
    const store = new InMemoryEventStoreAdapter();
    store.append(
      makeEvent({ eventId: "ev-obs", idempotencyKey: "k-obs", evidenceClass: "production-observed" })
    );
    expect(() =>
      store.append(
        makeEvent({
          eventId: "ev-sim-corr",
          idempotencyKey: "k-sim-corr",
          eventType: "correction",
          evidenceClass: "simulated",
          correctsEventId: "ev-obs",
        })
      )
    ).toThrowError(CorrectionEvidenceClassMismatchError);
  });
});

describe("W1-001 events — evidence-class partition (contracts #9)", () => {
  it("never lets research-class records cross into observed() and vice versa", () => {
    const store = new InMemoryEventStoreAdapter();
    store.append(makeEvent({ eventId: "e1", idempotencyKey: "k1", evidenceClass: "production-observed" }));
    store.append(makeEvent({ eventId: "e2", idempotencyKey: "k2", evidenceClass: "staging" }));
    store.append(makeEvent({ eventId: "e3", idempotencyKey: "k3", evidenceClass: "controlled-local" }));
    store.append(makeEvent({ eventId: "e4", idempotencyKey: "k4", evidenceClass: "simulated" }));
    store.append(makeEvent({ eventId: "e5", idempotencyKey: "k5", evidenceClass: "counterfactual" }));
    store.append(makeEvent({ eventId: "e6", idempotencyKey: "k6", evidenceClass: "fixture" }));

    const observedIds = [...store.observed(tenantA)].map((r) => r.event.eventId);
    const researchIds = [...store.research(tenantA)].map((r) => r.event.eventId);

    expect(observedIds).toEqual(["e1", "e2", "e3"]);
    expect(researchIds).toEqual(["e4", "e5", "e6"]);
    // Disjoint by construction:
    for (const id of observedIds) expect(researchIds).not.toContain(id);
    // Together they cover every record exactly once:
    expect(observedIds.length + researchIds.length).toBe([...store.stream(tenantA)].length);
  });
});

describe("W1-001 events — query surfaces", () => {
  it("getByDecision / getByExperience / getBySubject with inclusive time range", () => {
    const store = new InMemoryEventStoreAdapter();
    store.append(
      makeEvent({ eventId: "a", idempotencyKey: "ka", decisionId: "dec-9", experienceId: "exp-9", occurredAt: 100 })
    );
    store.append(
      makeEvent({ eventId: "b", idempotencyKey: "kb", decisionId: "dec-9", experienceId: "exp-8", occurredAt: 200 })
    );
    store.append(
      makeEvent({ eventId: "c", idempotencyKey: "kc", decisionId: "dec-8", experienceId: "exp-9", occurredAt: 300 })
    );
    store.append(
      makeEvent({
        eventId: "d",
        idempotencyKey: "kd",
        occurredAt: 400,
        subject: { kind: "user", ref: "user-2" },
      })
    );

    expect(store.getByDecision(tenantA, "dec-9").map((r) => r.event.eventId)).toEqual(["a", "b"]);
    expect(store.getByExperience(tenantA, "exp-9").map((r) => r.event.eventId)).toEqual(["a", "c"]);
    expect(store.getBySubject(tenantA, subject).map((r) => r.event.eventId)).toEqual(["a", "b", "c"]);
    // Inclusive bounds on occurredAt:
    expect(
      store.getBySubject(tenantA, subject, { fromMs: 200, toMs: 300 }).map((r) => r.event.eventId)
    ).toEqual(["b", "c"]);
    expect([...store.stream(tenantA, { toMs: 150 })].map((r) => r.event.eventId)).toEqual(["a"]);
  });
});

describe("W1-001 events — digest determinism", () => {
  it("identical content yields the identical digest across separate stores", () => {
    const store1 = new InMemoryEventStoreAdapter();
    const store2 = new InMemoryEventStoreAdapter();
    const r1 = store1.append(makeEvent());
    const r2 = store2.append(makeEvent());
    expect(r1.contentDigest).toBe(r2.contentDigest);
  });

  it("any semantic change changes the digest", () => {
    const store = new InMemoryEventStoreAdapter();
    const base = store.append(makeEvent()).contentDigest;
    const changedMetric = store.append(
      makeEvent({ eventId: "ev-m", idempotencyKey: "k-m", metrics: { watchRatio: 0.5 } })
    ).contentDigest;
    const changedTime = store.append(
      makeEvent({ eventId: "ev-t", idempotencyKey: "k-t", occurredAt: 1_001 })
    ).contentDigest;
    const changedProvenance = store.append(
      makeEvent({ eventId: "ev-p", idempotencyKey: "k-p", provenance: { system: "other" } })
    ).contentDigest;
    expect(new Set([base, changedMetric, changedTime, changedProvenance]).size).toBe(4);
  });
});

describe("W1-001 events — negative cases (typed errors, never raw strings)", () => {
  it("rejects an unknown record shape with a typed EventValidationError", () => {
    const store = new InMemoryEventStoreAdapter();
    const bad = { totally: "unknown", shape: true } as unknown as OutcomeEvent;
    expect(() => store.append(bad)).toThrowError(EventValidationError);
    try {
      store.append(bad);
    } catch (err) {
      const typed = err as EventValidationError;
      expect(typed.code).toBe("EVENT_VALIDATION_FAILED");
      expect(typed.name).toBe("EventValidationError");
      expect(Array.isArray(typed.issues)).toBe(true);
      expect(typed.issues.length).toBeGreaterThan(0);
      for (const issue of typed.issues) {
        expect(typeof issue.path).toBe("string");
        expect(typeof issue.message).toBe("string");
      }
    }
  });

  it("rejects records with an illegal evidenceClass value", () => {
    const store = new InMemoryEventStoreAdapter();
    expect(() =>
      store.append(makeEvent({ evidenceClass: "guessed" as OutcomeEvent["evidenceClass"] }))
    ).toThrowError(EventValidationError);
  });

  it("rejects records with a negative occurredAt (caller-supplied, non-negative)", () => {
    const store = new InMemoryEventStoreAdapter();
    expect(() => store.append(makeEvent({ occurredAt: -1 as OutcomeEvent["occurredAt"] }))).toThrowError(
      EventValidationError
    );
  });

  it("rejects records with a malformed idempotency key", () => {
    const store = new InMemoryEventStoreAdapter();
    expect(() =>
      store.append(makeEvent({ idempotencyKey: "has spaces!" as OutcomeEvent["idempotencyKey"] }))
    ).toThrowError(EventValidationError);
  });

  it("every thrown error is an instance of the typed EventsError base", () => {
    const store = new InMemoryEventStoreAdapter();
    const cases: Array<() => unknown> = [
      () => store.append({ nope: 1 } as unknown as OutcomeEvent),
      () => store.append(makeEvent({ eventType: "correction", correctsEventId: "ghost" })),
    ];
    for (const fn of cases) {
      try {
        fn();
        expect.unreachable("expected a typed error");
      } catch (err) {
        expect(err).toBeInstanceOf(EventsError);
        expect(typeof (err as EventsError).code).toBe("string");
      }
    }
  });
});
