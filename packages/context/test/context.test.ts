import { describe, it, expect } from "vitest";
import {
  ContextSnapshotSchema,
  type ContextSnapshot,
  type SubjectReference,
  type TenantScope,
} from "@reckon/contracts";
import {
  InMemoryContextStoreAdapter,
  ContextValidationError,
  deriveAttentionView,
} from "../src/index.js";

const tenantA: TenantScope = { tenantId: "tenant-a" };
const tenantB: TenantScope = { tenantId: "tenant-b" };
const subject: SubjectReference = { kind: "user", ref: "user-9" };

function makeSnapshot(overrides: Partial<ContextSnapshot> = {}): ContextSnapshot {
  return ContextSnapshotSchema.parse({
    contextId: "ctx-1",
    at: 1_000,
    ...overrides,
  });
}

function save(
  store: InMemoryContextStoreAdapter,
  snapshot: ContextSnapshot,
  tenant: TenantScope = tenantA,
  subj: SubjectReference = subject
) {
  return store.save({ tenant, subject: subj, snapshot });
}

describe("W1-002 context — happy path and round-trip", () => {
  it("saves and retrieves a valid snapshot, round-tripping the real schema", () => {
    const store = new InMemoryContextStoreAdapter();
    const snapshot = makeSnapshot({
      contextId: "ctx-rt",
      at: 5_000,
      time: { dayPart: "evening", timezone: "Africa/Accra" },
      device: { class: "tv", screenAvailable: true, audioRoute: "speaker" },
      network: { class: "wifi", bandwidthHint: "high" },
      activity: ["watching"],
      attention: { availableMs: 1_800_000, quality: "full" },
      session: { sessionId: "sess-1", positionInSession: 3 },
      fatigue: { repetitionLevel: 0.2, recentInterruptions: 1 },
      extra: { hostKey: "hostValue" },
    });
    const result = save(store, snapshot);
    expect(result.duplicate).toBe(false);
    expect(result.stored.contentDigest).toMatch(/^[0-9a-f]{64}$/);

    const fetched = store.get("ctx-rt", tenantA);
    expect(fetched).toBeDefined();
    const reparsed = ContextSnapshotSchema.parse(fetched!.snapshot);
    expect(reparsed.contextId).toBe("ctx-rt");
    expect(reparsed.device?.class).toBe("tv");
    expect(reparsed.attention?.availableMs).toBe(1_800_000);
    expect(reparsed.fatigue?.repetitionLevel).toBe(0.2);
    expect(reparsed.extra).toEqual({ hostKey: "hostValue" });
  });

  it("defaults labels/activity arrays and round-trips a minimal snapshot", () => {
    const store = new InMemoryContextStoreAdapter();
    const result = save(store, makeSnapshot({ contextId: "ctx-min", at: 10 }));
    const reparsed = ContextSnapshotSchema.parse(result.stored.snapshot);
    expect(reparsed.activity).toEqual([]);
  });
});

describe("W1-002 context — no-future-leakage / immutability", () => {
  it("a snapshot saved at T is never mutated by later saves or caller mutation", () => {
    const store = new InMemoryContextStoreAdapter();
    const first = makeSnapshot({
      contextId: "ctx-t1",
      at: 100,
      attention: { availableMs: 500, quality: "full" },
    });
    const result = save(store, first);
    const original = result.stored.snapshot;

    // Later events arrive (a later snapshot with the same subject):
    save(
      store,
      makeSnapshot({ contextId: "ctx-t2", at: 999_999, attention: { availableMs: 1, quality: "background" } })
    );

    // The earlier snapshot is unchanged:
    expect(store.get("ctx-t1", tenantA)!.snapshot).toEqual(original);
    expect(store.get("ctx-t1", tenantA)!.snapshot.attention?.availableMs).toBe(500);

    // Caller mutating its input object after save cannot reach the store:
    (first as { attention?: { availableMs?: number } }).attention!.availableMs = -42;
    expect(store.get("ctx-t1", tenantA)!.snapshot.attention?.availableMs).toBe(500);

    // The stored snapshot is structurally frozen:
    expect(Object.isFrozen(store.get("ctx-t1", tenantA)!.snapshot)).toBe(true);
  });

  it("history() never returns snapshots outside the requested time range", () => {
    const store = new InMemoryContextStoreAdapter();
    save(store, makeSnapshot({ contextId: "c1", at: 100 }));
    save(store, makeSnapshot({ contextId: "c2", at: 200 }));
    save(store, makeSnapshot({ contextId: "c3", at: 300 }));
    const windowed = store.history(subject, tenantA, { fromMs: 150, toMs: 250 });
    expect(windowed.map((s) => s.snapshot.contextId)).toEqual(["c2"]);
  });
});

describe("W1-002 context — deterministic latest() ordering", () => {
  it("orders latest() by caller-supplied at, NOT by save order", () => {
    const store = new InMemoryContextStoreAdapter();
    save(store, makeSnapshot({ contextId: "c-new", at: 9_000 }));
    save(store, makeSnapshot({ contextId: "c-old", at: 1_000 }));
    const latest = store.latest(subject, tenantA);
    expect(latest?.snapshot.contextId).toBe("c-new");
  });

  it("tie-breaks equal at by contextId (ascending — the max contextId wins)", () => {
    const store = new InMemoryContextStoreAdapter();
    // Saved in deliberately reversed id order:
    save(store, makeSnapshot({ contextId: "ctx-b", at: 5_000 }));
    save(store, makeSnapshot({ contextId: "ctx-a", at: 5_000 }));
    const latest = store.latest(subject, tenantA);
    expect(latest?.snapshot.contextId).toBe("ctx-b");

    // history() is ascending by (at, contextId) regardless of save order:
    const history = store.history(subject, tenantA);
    expect(history.map((h) => h.snapshot.contextId)).toEqual(["ctx-a", "ctx-b"]);
  });

  it("returns undefined for latest()/get() when nothing matches", () => {
    const store = new InMemoryContextStoreAdapter();
    expect(store.latest(subject, tenantA)).toBeUndefined();
    expect(store.get("ghost", tenantA)).toBeUndefined();
  });
});

describe("W1-002 context — tenant isolation (structural)", () => {
  it("never returns another tenant's snapshots on any surface", () => {
    const store = new InMemoryContextStoreAdapter();
    save(store, makeSnapshot({ contextId: "ctx-a", at: 100 }), tenantA);
    save(store, makeSnapshot({ contextId: "ctx-a", at: 100 }), tenantB); // same id, other tenant

    expect(store.get("ctx-a", tenantA)!.tenant).toEqual(tenantA);
    expect(store.get("ctx-a", tenantB)!.tenant).toEqual(tenantB);
    expect(store.get("ctx-a", { tenantId: "tenant-c" })).toBeUndefined();
    expect(store.latest({ kind: "user", ref: "user-9" }, { tenantId: "tenant-c" })).toBeUndefined();
    expect(store.history(subject, { tenantId: "tenant-c" })).toEqual([]);
  });

  it("separates subjects within a tenant", () => {
    const store = new InMemoryContextStoreAdapter();
    save(store, makeSnapshot({ contextId: "c-u1", at: 100 }), tenantA, { kind: "user", ref: "u1" });
    save(store, makeSnapshot({ contextId: "c-u2", at: 100 }), tenantA, { kind: "user", ref: "u2" });
    expect(store.history({ kind: "user", ref: "u1" }, tenantA).map((h) => h.snapshot.contextId)).toEqual([
      "c-u1",
    ]);
  });

  it("the same snapshot content under a different subject is NOT a duplicate", () => {
    const store = new InMemoryContextStoreAdapter();
    const snapshot = makeSnapshot({ contextId: "ctx-d", at: 1 });
    const r1 = save(store, snapshot, tenantA, { kind: "user", ref: "u1" });
    // A different subject needs its own contextId (ids are immutable
    // within the tenant) — same CONTENT, distinct record:
    const r2 = save(
      store,
      makeSnapshot({ contextId: "ctx-d2", at: 1 }),
      tenantA,
      { kind: "user", ref: "u2" }
    );
    expect(r1.duplicate).toBe(false);
    expect(r2.duplicate).toBe(false);
    // Identical repeat IS a duplicate:
    const r3 = save(store, snapshot, tenantA, { kind: "user", ref: "u1" });
    expect(r3.duplicate).toBe(true);
  });

  it("rejects re-saving a different snapshot under an existing contextId (ids are immutable)", () => {
    const store = new InMemoryContextStoreAdapter();
    save(store, makeSnapshot({ contextId: "ctx-fixed", at: 1 }));
    expect(() =>
      save(store, makeSnapshot({ contextId: "ctx-fixed", at: 2 }))
    ).toThrowError(ContextValidationError);
  });
});

describe("W1-002 context — consent boundary (ADR-003)", () => {
  it("rejects location without the explicit permitted marker (schema-enforced)", () => {
    const store = new InMemoryContextStoreAdapter();
    const bad = { contextId: "ctx-loc", at: 1, location: { coarse: "somewhere" } } as unknown as ContextSnapshot;
    expect(() => save(store, bad)).toThrowError(ContextValidationError);
  });

  it("accepts coarse location ONLY when explicitly permitted", () => {
    const store = new InMemoryContextStoreAdapter();
    const ok = makeSnapshot({
      contextId: "ctx-loc-ok",
      at: 1,
      location: { coarse: "region-x", permitted: true },
    });
    const result = save(store, ok);
    expect(result.stored.snapshot.location?.permitted).toBe(true);
    // The store never enriches or infers location: stored value is verbatim.
    expect(result.stored.snapshot.location?.coarse).toBe("region-x");
  });
});

describe("W1-002 context — negative cases (typed errors)", () => {
  it("rejects an unknown snapshot shape with a typed ContextValidationError", () => {
    const store = new InMemoryContextStoreAdapter();
    const bad = { contextId: "x", nope: true } as unknown as ContextSnapshot;
    expect(() => save(store, bad)).toThrowError(ContextValidationError);
    try {
      save(store, bad);
    } catch (err) {
      const typed = err as ContextValidationError;
      expect(typed.code).toBe("CONTEXT_VALIDATION_FAILED");
      expect(typed.name).toBe("ContextValidationError");
      expect(typed.issues.length).toBeGreaterThan(0);
    }
  });

  it("rejects a snapshot with a negative timestamp and a bad device class", () => {
    const store = new InMemoryContextStoreAdapter();
    expect(() =>
      save(store, { contextId: "x", at: -5 } as unknown as ContextSnapshot)
    ).toThrowError(ContextValidationError);
    expect(() =>
      save(
        store,
        { contextId: "x", at: 5, device: { class: "fridge" } } as unknown as ContextSnapshot
      )
    ).toThrowError(ContextValidationError);
  });
});

describe("W1-002 context — deriveAttentionView (pure, deterministic)", () => {
  it("returns a fully-unknown view when the snapshot carries no attention block", () => {
    const view = deriveAttentionView(makeSnapshot({ contextId: "c", at: 1 }));
    expect(view.estimated).toBe(false);
    expect(view.availableMs).toBeNull();
    expect(view.quality).toBe("unknown");
    expect(view.fatiguePenalty).toBe(0);
    expect(view.adjustedAvailableMs).toBeNull();
  });

  it("reports host attention verbatim when no fatigue signals exist", () => {
    const view = deriveAttentionView(
      makeSnapshot({
        contextId: "c",
        at: 1,
        attention: { availableMs: 600_000, quality: "partial" },
      })
    );
    expect(view.estimated).toBe(true);
    expect(view.availableMs).toBe(600_000);
    expect(view.quality).toBe("partial");
    expect(view.fatiguePenalty).toBe(0);
    expect(view.adjustedAvailableMs).toBe(600_000);
  });

  it("applies a deterministic fatigue penalty from repetition + interruptions", () => {
    const snapshot = makeSnapshot({
      contextId: "c",
      at: 1,
      attention: { availableMs: 1_000, quality: "full" },
      fatigue: { repetitionLevel: 0.5, recentInterruptions: 5 },
    });
    // 0.6 * 0.5 + 0.4 * (5/10) = 0.3 + 0.2 = 0.5
    const view = deriveAttentionView(snapshot);
    expect(view.fatiguePenalty).toBeCloseTo(0.5, 12);
    expect(view.adjustedAvailableMs).toBeCloseTo(500, 9);
    // Host quality classification is reported VERBATIM (never reclassified):
    expect(view.quality).toBe("full");
    // Pure: identical input ⇒ identical output:
    expect(deriveAttentionView(snapshot)).toEqual(view);
  });

  it("clamps the penalty components and the total (raw out-of-range host noise)", () => {
    // The frozen schema rejects out-of-range fatigue values at ingestion;
    // deriveAttentionView still defends when called directly on raw
    // host-shaped objects (pure function, defense in depth).
    const raw = {
      contextId: "c-raw",
      at: 1,
      attention: { availableMs: 1_000, quality: "background" },
      fatigue: { repetitionLevel: 5, recentInterruptions: 999 },
    } as unknown as ContextSnapshot;
    const saturated = deriveAttentionView(raw);
    expect(saturated.fatiguePenalty).toBe(0.9); // MAX_FATIGUE_PENALTY
    expect(saturated.adjustedAvailableMs).toBeCloseTo(100, 9);
  });

  it("computes fatigue penalty even without an attention estimate", () => {
    const view = deriveAttentionView(
      makeSnapshot({
        contextId: "c",
        at: 1,
        fatigue: { repetitionLevel: 1, recentInterruptions: 10 },
      })
    );
    expect(view.estimated).toBe(false);
    expect(view.availableMs).toBeNull();
    expect(view.adjustedAvailableMs).toBeNull();
    expect(view.fatiguePenalty).toBe(0.9);
  });

  it("penalty is monotone in repetitionLevel", () => {
    const base = { contextId: "c", at: 1 } as const;
    let prev = -1;
    for (const level of [0, 0.25, 0.5, 0.75, 1]) {
      const view = deriveAttentionView(
        makeSnapshot({ ...base, fatigue: { repetitionLevel: level } })
      );
      expect(view.fatiguePenalty).toBeGreaterThanOrEqual(prev);
      prev = view.fatiguePenalty;
    }
  });

  it("respects an explicit zero-attention estimate", () => {
    const view = deriveAttentionView(
      makeSnapshot({ contextId: "c", at: 1, attention: { availableMs: 0, quality: "interrupted" } })
    );
    expect(view.estimated).toBe(true);
    expect(view.availableMs).toBe(0);
    expect(view.adjustedAvailableMs).toBe(0);
  });
});

describe("W1-002 context — digest determinism", () => {
  it("identical associations produce identical digests; semantic changes differ", () => {
    const store1 = new InMemoryContextStoreAdapter();
    const store2 = new InMemoryContextStoreAdapter();
    const s = makeSnapshot({ contextId: "ctx-dd", at: 1, attention: { availableMs: 5 } });
    const r1 = store1.save({ tenant: tenantA, subject, snapshot: s });
    const r2 = store2.save({ tenant: tenantA, subject, snapshot: s });
    expect(r1.stored.contentDigest).toBe(r2.stored.contentDigest);

    const other = store1.save({
      tenant: tenantA,
      subject,
      snapshot: makeSnapshot({ contextId: "ctx-dd2", at: 1, attention: { availableMs: 6 } }),
    });
    expect(other.stored.contentDigest).not.toBe(r1.stored.contentDigest);
  });
});
