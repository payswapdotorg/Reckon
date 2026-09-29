import { describe, it, expect } from "vitest";
import {
  PreferenceDeltaSchema,
  type PreferenceDelta,
  type SubjectReference,
  type TenantScope,
} from "@reckon/contracts";
import {
  InMemoryPreferenceStoreAdapter,
  PreferenceValidationError,
  PreferenceDeltaConflictError,
  PreferenceOpError,
  PreferencesError,
  routeDelta,
  decayFactor,
} from "../src/index.js";

const tenantA: TenantScope = { tenantId: "tenant-a" };
const tenantB: TenantScope = { tenantId: "tenant-b" };
const subject: SubjectReference = { kind: "user", ref: "user-9" };

function makeDelta(overrides: Partial<PreferenceDelta> = {}): PreferenceDelta {
  // NOTE: deliberately NOT schema-parsed — invalid shapes constructed
  // here must reach the STORE's validation layer, which rejects them
  // with typed errors (never raw zod throws).
  return {
    schema: "reckon.preference-delta",
    schemaVersion: "0.1.0",
    deltaId: "d-1",
    tenant: tenantA,
    subject,
    dimension: "genre.scifi",
    op: "add",
    newValue: 0.1,
    model: { modelId: "m-1", version: "1" },
    timestamp: 1_000,
    ...overrides,
  };
}

describe("W1-003 preferences — happy path and round-trip", () => {
  it("applies a valid delta and round-trips the log entry against the real schema", () => {
    const store = new InMemoryPreferenceStoreAdapter();
    const delta = makeDelta({
      deltaId: "d-rt",
      op: "set",
      newValue: 0.8,
      provenance: { system: "learning-lane", version: "2" },
      confidenceDelta: 0.4,
    });
    const result = store.apply(delta);
    expect(result.duplicate).toBe(false);
    expect(result.routedScope).toBe("stable");
    expect(result.value).toBe(0.8);
    expect(result.confidence).toBe(0.4);

    const [entry] = store.log(subject, tenantA);
    expect(entry).toBeDefined();
    // Round-trip through the REAL zod schema:
    const reparsed = PreferenceDeltaSchema.parse(entry!.delta);
    expect(reparsed.deltaId).toBe("d-rt");
    expect(reparsed.provenance?.system).toBe("learning-lane");

    const [view] = store.dimensions(subject, tenantA);
    expect(view?.value).toBe(0.8);
    expect(view?.model).toEqual({ modelId: "m-1", version: "1" });
    expect(view?.updatedAt).toBe(1_000);
  });

  it("snapshot exposes subject, tenant, at and deterministic dimension ordering", () => {
    const store = new InMemoryPreferenceStoreAdapter();
    store.apply(makeDelta({ deltaId: "d-z", dimension: "genre.zzz", op: "set", newValue: 1 }));
    store.apply(makeDelta({ deltaId: "d-a", dimension: "genre.aaa", op: "set", newValue: 2 }));
    const snap = store.snapshot(subject, tenantA, 2_000);
    expect(snap.at).toBe(2_000);
    expect(snap.subject).toEqual(subject);
    expect(snap.tenant).toEqual(tenantA);
    expect(snap.stable.map((d) => d.dimension)).toEqual(["genre.aaa", "genre.zzz"]);
    expect(snap.stable.map((d) => d.value)).toEqual([2, 1]);
  });

  it("snapshot with no `at` returns the accumulated state (at = null)", () => {
    const store = new InMemoryPreferenceStoreAdapter();
    store.apply(
      makeDelta({ deltaId: "d-n", op: "set", newValue: 5, decay: { halfLifeSeconds: 100 } })
    );
    const snap = store.snapshot(subject, tenantA);
    expect(snap.at).toBeNull();
    expect(snap.stable[0]?.value).toBe(5); // undecayed
  });
});

describe("W1-003 preferences — stable vs situational routing (one-topic law)", () => {
  it("routes deltas without context scope to the stable store", () => {
    expect(routeDelta(makeDelta({ deltaId: "r1" }))).toBe("stable");
    expect(routeDelta(makeDelta({ deltaId: "r2", scope: {} }))).toBe("stable");
    expect(routeDelta(makeDelta({ deltaId: "r3", scope: { validFrom: 0, validUntil: 10 } }))).toBe(
      "stable"
    );
  });

  it("routes deltas carrying contextKind and/or contextId to the situational store", () => {
    expect(routeDelta(makeDelta({ deltaId: "r4", scope: { contextKind: "session" } }))).toBe(
      "situational"
    );
    expect(routeDelta(makeDelta({ deltaId: "r5", scope: { contextId: "ctx-77" } }))).toBe(
      "situational"
    );
    expect(
      routeDelta(makeDelta({ deltaId: "r6", scope: { contextKind: "session", contextId: "ctx-77" } }))
    ).toBe("situational");
  });

  it("ONE-TOPIC LAW: N situational deltas for genre.scifi never touch the stable value", () => {
    const store = new InMemoryPreferenceStoreAdapter();
    store.apply(
      makeDelta({ deltaId: "stable-1", op: "set", newValue: 0.8, confidenceDelta: 0.9 })
    );
    // N situational deltas on the SAME dimension:
    for (let i = 0; i < 5; i++) {
      store.apply(
        makeDelta({
          deltaId: `sit-${i}`,
          op: "add",
          newValue: 0.05,
          scope: { contextKind: "session", contextId: "sess-current" },
          confidenceDelta: 0.2,
        })
      );
    }
    const stable = store.dimensions(subject, tenantA, "stable");
    expect(stable).toHaveLength(1);
    expect(stable[0]?.value).toBe(0.8); // untouched
    expect(stable[0]?.deltaCount).toBe(1); // only the stable delta wrote it

    const situational = store.dimensions(subject, tenantA, "situational");
    expect(situational).toHaveLength(1);
    expect(situational[0]?.value).toBeCloseTo(0.05 * 5, 12);
    expect(situational[0]?.deltaCount).toBe(5);
    expect((situational[0] as { contextScope?: unknown }).contextScope).toEqual({
      contextKind: "session",
      contextId: "sess-current",
    });
  });

  it("separate situational slots per context scope", () => {
    const store = new InMemoryPreferenceStoreAdapter();
    store.apply(
      makeDelta({ deltaId: "s-a", op: "set", newValue: 1, scope: { contextId: "ctx-a" } })
    );
    store.apply(
      makeDelta({ deltaId: "s-b", op: "set", newValue: 2, scope: { contextId: "ctx-b" } })
    );
    store.apply(
      makeDelta({ deltaId: "s-kind", op: "set", newValue: 3, scope: { contextKind: "commute" } })
    );
    const situational = store.dimensions(subject, tenantA, "situational");
    expect(situational).toHaveLength(3);
    const values = situational.map((d) => d.value).sort();
    expect(values).toEqual([1, 2, 3]);
  });
});

describe("W1-003 preferences — decay and expiry math (pure, fixed timestamps)", () => {
  it("half-life decay: value halves each halfLifeSeconds", () => {
    const store = new InMemoryPreferenceStoreAdapter();
    store.apply(
      makeDelta({
        deltaId: "d-decay",
        op: "set",
        newValue: 8,
        timestamp: 1_000,
        decay: { halfLifeSeconds: 100 },
      })
    );
    // at = write time → undecayed
    expect(store.snapshot(subject, tenantA, 1_000).stable[0]?.value).toBe(8);
    // +100s → 4
    expect(store.snapshot(subject, tenantA, 101_000).stable[0]?.value).toBe(4);
    // +200s → 2
    expect(store.snapshot(subject, tenantA, 201_000).stable[0]?.value).toBe(2);
    // +300s → 1
    expect(store.snapshot(subject, tenantA, 301_000).stable[0]?.value).toBe(1);
  });

  it("querying BEFORE the first write yields nothing (no leakage) and decayFactor never amplifies", () => {
    const store = new InMemoryPreferenceStoreAdapter();
    store.apply(
      makeDelta({ deltaId: "d-past", op: "set", newValue: 8, timestamp: 10_000, decay: { halfLifeSeconds: 100 } })
    );
    // At t=0 the write has not happened yet — the dimension is absent:
    expect(store.snapshot(subject, tenantA, 0).stable).toHaveLength(0);
    // The pure factor is still clamped at 1 for pre-write times:
    expect(decayFactor(500, 1_000, 100)).toBe(1);
  });

  it("decayFactor is the pure 2^(-elapsed/halfLife) with elapsed clamped at 0", () => {
    expect(decayFactor(1_000, 1_000, 100)).toBe(1);
    expect(decayFactor(101_000, 1_000, 100)).toBeCloseTo(0.5, 12);
    expect(decayFactor(51_000, 1_000, 100)).toBeCloseTo(Math.SQRT1_2, 12);
    expect(decayFactor(500, 1_000, 100)).toBe(1); // pre-write clamp
  });

  it("expiresAt: the value is live AT expiresAt and gone strictly after", () => {
    const store = new InMemoryPreferenceStoreAdapter();
    store.apply(
      makeDelta({
        deltaId: "d-exp",
        op: "set",
        newValue: 1,
        timestamp: 1_000,
        decay: { expiresAt: 5_000 },
      })
    );
    expect(store.snapshot(subject, tenantA, 4_999).stable).toHaveLength(1);
    expect(store.snapshot(subject, tenantA, 5_000).stable).toHaveLength(1); // inclusive
    expect(store.snapshot(subject, tenantA, 5_001).stable).toHaveLength(0);
    // Without `at`, no expiry filtering is applied (as-accumulated view):
    expect(store.snapshot(subject, tenantA).stable).toHaveLength(1);
  });

  it("scope.validFrom/validUntil gate the dimension temporally", () => {
    const store = new InMemoryPreferenceStoreAdapter();
    store.apply(
      makeDelta({
        deltaId: "d-win",
        op: "set",
        newValue: 1,
        timestamp: 0,
        scope: { validFrom: 1_000, validUntil: 2_000 },
      })
    );
    expect(store.snapshot(subject, tenantA, 999).stable).toHaveLength(0);
    expect(store.snapshot(subject, tenantA, 1_000).stable).toHaveLength(1);
    expect(store.snapshot(subject, tenantA, 2_000).stable).toHaveLength(1);
    expect(store.snapshot(subject, tenantA, 2_001).stable).toHaveLength(0);
  });

  it("non-numeric values are not decayed; expiry still applies", () => {
    const store = new InMemoryPreferenceStoreAdapter();
    store.apply(
      makeDelta({
        deltaId: "d-str",
        op: "set",
        newValue: "favorite",
        timestamp: 1_000,
        decay: { halfLifeSeconds: 100, expiresAt: 500_000 },
      })
    );
    expect(store.snapshot(subject, tenantA, 1_000_000).stable).toHaveLength(0); // expired
    expect(store.snapshot(subject, tenantA, 400_000).stable[0]?.value).toBe("favorite"); // undecayed string
  });

  it("a later write re-anchors decay to the new timestamp (last-writer-wins)", () => {
    const store = new InMemoryPreferenceStoreAdapter();
    store.apply(
      makeDelta({ deltaId: "d-w1", op: "set", newValue: 8, timestamp: 0, decay: { halfLifeSeconds: 100 } })
    );
    store.apply(
      makeDelta({ deltaId: "d-w2", op: "set", newValue: 8, timestamp: 200_000, decay: { halfLifeSeconds: 100 } })
    );
    // Anchored at the SECOND write: at 300_000 → one half-life after 200_000.
    expect(store.snapshot(subject, tenantA, 300_000).stable[0]?.value).toBe(4);
    // Before the second write, the FIRST write is the visible state:
    // at 1_000 → 8 decayed by 1 second.
    expect(store.snapshot(subject, tenantA, 1_000).stable[0]?.value).toBeCloseTo(
      8 * decayFactor(1_000, 0, 100),
      12
    );
  });
});

describe("W1-003 preferences — confidence semantics", () => {
  it("confidenceDelta accumulates and clamps to [0, 1]", () => {
    const store = new InMemoryPreferenceStoreAdapter();
    store.apply(makeDelta({ deltaId: "c-1", op: "set", newValue: 1, confidenceDelta: 0.6 }));
    expect(store.dimensions(subject, tenantA)[0]?.confidence).toBe(0.6);
    store.apply(makeDelta({ deltaId: "c-2", op: "add", newValue: 1, confidenceDelta: 0.6 }));
    expect(store.dimensions(subject, tenantA)[0]?.confidence).toBe(1); // clamped high
    store.apply(makeDelta({ deltaId: "c-3", op: "add", newValue: 1, confidenceDelta: -0.9 }));
    expect(store.dimensions(subject, tenantA)[0]?.confidence).toBeCloseTo(0.1, 12);
    // Fresh dimension with only a negative delta clamps at 0:
    store.apply(
      makeDelta({ deltaId: "c-4", dimension: "other", op: "set", newValue: 1, confidenceDelta: -0.9 })
    );
    expect(store.dimensions(subject, tenantA).find((d) => d.dimension === "other")?.confidence).toBe(0);
  });

  it("resultingConfidence WINS over accumulation", () => {
    const store = new InMemoryPreferenceStoreAdapter();
    store.apply(makeDelta({ deltaId: "c-4", op: "set", newValue: 1, confidenceDelta: 0.9 }));
    store.apply(
      makeDelta({ deltaId: "c-5", op: "add", newValue: 1, confidenceDelta: 0.1, resultingConfidence: 0.42 })
    );
    expect(store.dimensions(subject, tenantA)[0]?.confidence).toBe(0.42);
  });

  it("stable and situational dimensions carry independent confidence", () => {
    const store = new InMemoryPreferenceStoreAdapter();
    store.apply(
      makeDelta({ deltaId: "cs-1", op: "set", newValue: 1, confidenceDelta: 0.9 })
    );
    store.apply(
      makeDelta({
        deltaId: "cs-2",
        op: "set",
        newValue: 1,
        scope: { contextKind: "session" },
        confidenceDelta: 0.1,
      })
    );
    const stable = store.dimensions(subject, tenantA, "stable")[0]!;
    const situational = store.dimensions(subject, tenantA, "situational")[0]!;
    expect(stable.confidence).toBe(0.9);
    expect(situational.confidence).toBe(0.1);
  });
});

describe("W1-003 preferences — update-op semantics (deterministic, total)", () => {
  it("set / add / multiply / decay / merge / remove", () => {
    const store = new InMemoryPreferenceStoreAdapter();
    store.apply(makeDelta({ deltaId: "op-1", dimension: "d1", op: "set", newValue: 10 }));
    store.apply(makeDelta({ deltaId: "op-2", dimension: "d1", op: "add", newValue: 5 }));
    store.apply(makeDelta({ deltaId: "op-3", dimension: "d1", op: "multiply", newValue: 2 }));
    store.apply(makeDelta({ deltaId: "op-4", dimension: "d1", op: "decay", newValue: 0.5 }));
    // ((10 + 5) * 2) * 0.5 = 15
    expect(store.dimensions(subject, tenantA, "stable")[0]?.value).toBe(15);

    store.apply(makeDelta({ deltaId: "op-5", dimension: "d2", op: "set", newValue: "genre:" }));
    store.apply(
      makeDelta({ deltaId: "op-6", dimension: "d2", op: "merge", newValue: undefined, value: "scifi" })
    );
    expect(store.dimensions(subject, tenantA, "stable").find((d) => d.dimension === "d2")?.value).toBe(
      "genre:scifi"
    );

    store.apply(makeDelta({ deltaId: "op-7", dimension: "d3", op: "set", newValue: false }));
    store.apply(
      makeDelta({ deltaId: "op-8", dimension: "d3", op: "merge", newValue: undefined, value: true })
    );
    expect(store.dimensions(subject, tenantA, "stable").find((d) => d.dimension === "d3")?.value).toBe(
      true
    );

    // remove tombstones the dimension:
    store.apply(makeDelta({ deltaId: "op-9", dimension: "d1", op: "remove" }));
    expect(store.dimensions(subject, tenantA, "stable").find((d) => d.dimension === "d1")).toBeUndefined();
    // ...and a later set revives it:
    store.apply(makeDelta({ deltaId: "op-10", dimension: "d1", op: "set", newValue: 7 }));
    expect(store.dimensions(subject, tenantA, "stable").find((d) => d.dimension === "d1")?.value).toBe(7);
  });

  it("first-write algebraic identities: add→0, multiply/decay→1, merge→operand", () => {
    const store = new InMemoryPreferenceStoreAdapter();
    store.apply(makeDelta({ deltaId: "id-1", dimension: "a", op: "add", newValue: 4 }));
    store.apply(makeDelta({ deltaId: "id-2", dimension: "m", op: "multiply", newValue: 4 }));
    store.apply(makeDelta({ deltaId: "id-3", dimension: "k", op: "decay", newValue: 0.25 }));
    store.apply(makeDelta({ deltaId: "id-4", dimension: "g", op: "merge", newValue: undefined, value: "seed" }));
    const byName = new Map(store.dimensions(subject, tenantA).map((d) => [d.dimension, d.value]));
    expect(byName.get("a")).toBe(4);
    expect(byName.get("m")).toBe(4);
    expect(byName.get("k")).toBe(0.25);
    expect(byName.get("g")).toBe("seed");
  });

  it("rejects type-incompatible ops with typed PreferenceOpError", () => {
    const store = new InMemoryPreferenceStoreAdapter();
    store.apply(makeDelta({ deltaId: "bad-0", dimension: "s", op: "set", newValue: "text" }));
    // add onto a string value:
    expect(() => store.apply(makeDelta({ deltaId: "bad-1", dimension: "s", op: "add", newValue: 1 }))).toThrowError(
      PreferenceOpError
    );
    // arithmetic op without a payload (both newValue and value absent):
    expect(() =>
      store.apply(makeDelta({ deltaId: "bad-2", dimension: "x", op: "multiply", newValue: undefined }))
    ).toThrowError(PreferenceOpError);
    // merge number into string:
    expect(() =>
      store.apply(makeDelta({ deltaId: "bad-3", dimension: "s", op: "merge", newValue: 3 }))
    ).toThrowError(PreferenceOpError);
    // All typed, with codes:
    try {
      store.apply(makeDelta({ deltaId: "bad-4", dimension: "s", op: "add", newValue: 1 }));
    } catch (err) {
      const typed = err as PreferencesError;
      expect(typed.code).toBe("PREFERENCE_OP_INCOMPATIBLE");
      expect(typed.details.dimension).toBe("s");
    }
  });
});

describe("W1-003 preferences — model lineage and the full delta log", () => {
  it("records last-writer model lineage per dimension while retaining the full log", () => {
    const store = new InMemoryPreferenceStoreAdapter();
    store.apply(
      makeDelta({ deltaId: "lin-1", op: "set", newValue: 1, model: { modelId: "model-a", version: "1" } })
    );
    store.apply(
      makeDelta({ deltaId: "lin-2", op: "add", newValue: 1, model: { modelId: "model-b", version: "7" } })
    );
    const [view] = store.dimensions(subject, tenantA);
    expect(view?.model).toEqual({ modelId: "model-b", version: "7" }); // last-writer-wins
    expect(view?.deltaCount).toBe(2);

    const log = store.log(subject, tenantA);
    expect(log).toHaveLength(2); // full history retained
    expect(log.map((e) => e.delta.model.modelId)).toEqual(["model-a", "model-b"]);
    expect(log.map((e) => e.sequence)).toEqual([1, 2]);
    for (const entry of log) expect(entry.contentDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("log() filters by scope without losing entries", () => {
    const store = new InMemoryPreferenceStoreAdapter();
    store.apply(makeDelta({ deltaId: "lg-1", op: "set", newValue: 1 }));
    store.apply(makeDelta({ deltaId: "lg-2", op: "set", newValue: 1, scope: { contextKind: "session" } }));
    expect(store.log(subject, tenantA, "stable")).toHaveLength(1);
    expect(store.log(subject, tenantA, "situational")).toHaveLength(1);
    expect(store.log(subject, tenantA)).toHaveLength(2);
  });

  it("digest determinism: identical deltas produce identical digests across stores", () => {
    const s1 = new InMemoryPreferenceStoreAdapter();
    const s2 = new InMemoryPreferenceStoreAdapter();
    const d = makeDelta({ deltaId: "dg-1", op: "set", newValue: 0.5 });
    s1.apply(d);
    s2.apply(d);
    expect(s1.log(subject, tenantA)[0]?.contentDigest).toBe(s2.log(subject, tenantA)[0]?.contentDigest);
  });
});

describe("W1-003 preferences — apply idempotency and deltaId immutability", () => {
  it("re-applying the IDENTICAL delta is idempotent (no double effects)", () => {
    const store = new InMemoryPreferenceStoreAdapter();
    const delta = makeDelta({ deltaId: "dup-1", op: "add", newValue: 0.5, confidenceDelta: 0.5 });
    const first = store.apply(delta);
    const second = store.apply(delta);
    expect(second.duplicate).toBe(true);
    expect(second.value).toBe(first.value);
    expect(second.confidence).toBe(first.confidence);
    expect(store.dimensions(subject, tenantA)[0]?.value).toBe(0.5); // NOT 1.0
    expect(store.dimensions(subject, tenantA)[0]?.confidence).toBe(0.5); // NOT 1.0
    expect(store.log(subject, tenantA)).toHaveLength(1); // log not duplicated
  });

  it("rejects deltaId reuse with DIFFERENT content (typed conflict)", () => {
    const store = new InMemoryPreferenceStoreAdapter();
    store.apply(makeDelta({ deltaId: "conf-1", op: "set", newValue: 1 }));
    expect(() =>
      store.apply(makeDelta({ deltaId: "conf-1", op: "set", newValue: 2 }))
    ).toThrowError(PreferenceDeltaConflictError);
    try {
      store.apply(makeDelta({ deltaId: "conf-1", op: "set", newValue: 3 }));
    } catch (err) {
      expect((err as PreferencesError).code).toBe("PREFERENCE_DELTA_CONFLICT");
      expect((err as PreferencesError).details.deltaId).toBe("conf-1");
    }
  });
});

describe("W1-003 preferences — tenant isolation (structural)", () => {
  it("state, snapshots and logs are all tenant-scoped", () => {
    const store = new InMemoryPreferenceStoreAdapter();
    store.apply(makeDelta({ deltaId: "ti-1", op: "set", newValue: 1 }));
    store.apply(
      makeDelta({ deltaId: "ti-2", op: "set", newValue: 2, tenant: tenantB })
    );
    expect(store.dimensions(subject, tenantA, "stable")[0]?.value).toBe(1);
    expect(store.dimensions(subject, tenantB, "stable")[0]?.value).toBe(2);
    expect(store.snapshot(subject, tenantB).stable).toHaveLength(1);
    expect(store.log(subject, tenantB)).toHaveLength(1);
    // Foreign tenant sees nothing:
    expect(store.dimensions(subject, { tenantId: "tenant-c" })).toEqual([]);
    expect(store.snapshot(subject, { tenantId: "tenant-c" }).stable).toEqual([]);
    expect(store.log(subject, { tenantId: "tenant-c" })).toEqual([]);
  });

  it("workspace scope partitions state within a tenant", () => {
    const store = new InMemoryPreferenceStoreAdapter();
    store.apply(
      makeDelta({ deltaId: "ws-1", op: "set", newValue: 1, tenant: { tenantId: "t", workspaceId: "w1" } })
    );
    expect(store.dimensions(subject, { tenantId: "t", workspaceId: "w2" })).toEqual([]);
    expect(store.dimensions(subject, { tenantId: "t", workspaceId: "w1" })).toHaveLength(1);
  });
});

describe("W1-003 preferences — snapshot immutability (no-future-leakage)", () => {
  it("an earlier snapshot object is never mutated by later deltas (no-future-leakage)", () => {
    const store = new InMemoryPreferenceStoreAdapter();
    store.apply(
      makeDelta({ deltaId: "fl-1", op: "set", newValue: 5, timestamp: 1_000, decay: { halfLifeSeconds: 100 } })
    );
    const before = store.snapshot(subject, tenantA, 101_000);
    expect(before.stable[0]?.value).toBe(2.5);
    // Later writes arrive (timestamped AFTER the query time):
    store.apply(
      makeDelta({ deltaId: "fl-2", op: "set", newValue: 999, timestamp: 500_000 })
    );
    // The previously returned snapshot object is unchanged:
    expect(before.stable[0]?.value).toBe(2.5);
    // A fresh snapshot at the SAME `at` still excludes the future write
    // (deterministic replay — only deltas with timestamp <= at fold in):
    const replay = store.snapshot(subject, tenantA, 101_000);
    expect(replay.stable).toHaveLength(1);
    expect(replay.stable[0]?.value).toBe(2.5);
    // ...and at a later time reflects the new write (fl-2 keeps the
    // dimension's decay params, so 999 halves over the 100s since the
    // 500_000 write):
    expect(store.snapshot(subject, tenantA, 600_000).stable[0]?.value).toBe(999 * 0.5);
  });
});

describe("W1-003 preferences — negative cases (typed errors)", () => {
  it("rejects an unknown delta shape with a typed PreferenceValidationError", () => {
    const store = new InMemoryPreferenceStoreAdapter();
    const bad = { wat: true } as unknown as PreferenceDelta;
    expect(() => store.apply(bad)).toThrowError(PreferenceValidationError);
    try {
      store.apply(bad);
    } catch (err) {
      const typed = err as PreferenceValidationError;
      expect(typed.code).toBe("PREFERENCE_VALIDATION_FAILED");
      expect(typed.issues.length).toBeGreaterThan(0);
    }
  });

  it("rejects deltas with a bad op enum, missing model, or bad confidence range", () => {
    const store = new InMemoryPreferenceStoreAdapter();
    expect(() =>
      store.apply(makeDelta({ op: "explode" as PreferenceDelta["op"] }))
    ).toThrowError(PreferenceValidationError);
    expect(() =>
      store.apply({ ...makeDelta({ deltaId: "x" }), model: undefined } as unknown as PreferenceDelta)
    ).toThrowError(PreferenceValidationError);
    expect(() =>
      store.apply(makeDelta({ deltaId: "y", confidenceDelta: 2 }))
    ).toThrowError(PreferenceValidationError);
  });

  it("every thrown error is an instance of the typed PreferencesError base", () => {
    const store = new InMemoryPreferenceStoreAdapter();
    const cases: Array<() => unknown> = [
      () => store.apply({ nope: 1 } as unknown as PreferenceDelta),
      () =>
        store.apply(
          makeDelta({
            deltaId: "z",
            dimension: "s",
            op: "merge",
            newValue: { deep: 1 } as unknown as number,
          })
        ),
    ];
    for (const fn of cases) {
      try {
        fn();
        expect.unreachable("expected a typed error");
      } catch (err) {
        expect(err).toBeInstanceOf(PreferencesError);
        expect(typeof (err as PreferencesError).code).toBe("string");
      }
    }
  });
});
