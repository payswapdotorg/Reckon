import { describe, it, expect } from "vitest";
import {
  CatalogItemSchema,
  ContextSnapshotSchema,
  type CatalogItem,
  type ContextSnapshot,
  type Experience,
  type OutcomeEvent,
  type Realization,
  type SubjectReference,
  type TenantScope,
} from "@reckon/contracts";
import {
  createFeatureAssembler,
  FeatureValidationError,
  FeaturePreferenceSnapshotError,
  FeaturesError,
  stableBucket,
  bucketCounts,
  FEATURE_FAMILIES,
  itemFeatures,
  temporalFeatures,
  contextFeatures,
  preferenceFeatures,
  uncertaintyFeatures,
  realizationFeatures,
  experienceFeatures,
  type FeatureInput,
  type PreferenceSnapshotInput,
} from "../src/index.js";

const subject: SubjectReference = { kind: "user", ref: "user-9" };
const tenant: TenantScope = { tenantId: "tenant-a" };

function makeContext(overrides: Record<string, unknown> = {}): ContextSnapshot {
  return ContextSnapshotSchema.parse({ contextId: "ctx-1", at: 1_000, ...overrides });
}

function makeItem(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return CatalogItemSchema.parse({
    schema: "reckon.catalog-item",
    schemaVersion: "0.1.0",
    itemId: "item-1",
    kind: "media",
    labels: ["genre.scifi", "era.recent"],
    attributes: { runtimeMinutes: 118 },
    ...overrides,
  });
}

function makeRealization(overrides: Partial<Realization> = {}): Realization {
  return {
    schema: "reckon.realization",
    schemaVersion: "0.1.0",
    realizationId: "real-1",
    itemId: "item-1",
    kind: "stream-source",
    locale: "en-US",
    constraints: { maxBitrate: 4_000 },
    ...overrides,
  };
}

function makeExperience(overrides: Partial<Experience> = {}): Experience {
  return {
    schema: "reckon.experience",
    schemaVersion: "0.1.0",
    experienceId: "exp-1",
    itemId: "item-1",
    realizationId: "real-1",
    format: { kind: "full", params: {} },
    duration: 253,
    locale: "en-US",
    requirements: { deviceClass: ["tv"], requiresScreen: true, requiresAudio: true, minBandwidth: "high" },
    transformations: [],
    constraints: [],
    ...overrides,
  };
}

function makeEvent(overrides: Partial<OutcomeEvent> = {}): OutcomeEvent {
  return {
    schema: "reckon.outcome-event",
    schemaVersion: "0.1.0",
    eventId: "ev-1",
    tenant,
    subject,
    eventType: "completion",
    occurredAt: 900,
    evidenceClass: "production-observed",
    idempotencyKey: "idem-1",
    metrics: {},
    ...overrides,
  };
}

function makePreferences(overrides: Partial<PreferenceSnapshotInput> = {}): PreferenceSnapshotInput {
  return {
    stable: [
      { dimension: "genre.scifi", value: 0.8, confidence: 0.9 },
      { dimension: "genre.drama", value: 0.4, confidence: 0.2 },
    ],
    situational: [
      {
        dimension: "genre.scifi",
        value: 0.1,
        confidence: 0.5,
        contextScope: { contextKind: "session", contextId: "sess-1" },
      },
    ],
    at: 1_000,
    ...overrides,
  };
}

function makeInput(overrides: Partial<FeatureInput> = {}): FeatureInput {
  return {
    subject,
    tenant,
    at: 1_000,
    contextSnapshot: makeContext(),
    items: [makeItem()],
    realizations: [makeRealization()],
    experiences: [makeExperience()],
    preferences: makePreferences(),
    recentEvents: [makeEvent()],
    ...overrides,
  };
}

const assembler = createFeatureAssembler();

describe("W1-004 features — happy path: families and names", () => {
  it("assembles all seven families with parallel values/names arrays", () => {
    const vector = assembler.assemble(makeInput());
    expect(Object.keys(vector.families)).toEqual([...FEATURE_FAMILIES]);
    for (const family of FEATURE_FAMILIES) {
      expect(vector.families[family].length).toBe(vector.names[family].length);
      expect(vector.families[family].length).toBeGreaterThan(0);
    }
    expect(vector.subject).toEqual(subject);
    expect(vector.tenant).toEqual(tenant);
    expect(vector.at).toBe(1_000);
    expect(vector.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("assembles with only the required inputs (optional families go empty/zero)", () => {
    const vector = assembler.assemble({
      subject,
      tenant,
      at: 1_000,
      contextSnapshot: makeContext(),
      items: [],
    });
    expect(vector.families.item).toEqual([]);
    expect(vector.families.realization).toEqual([]);
    expect(vector.families.experience).toEqual([]);
    // Preference + uncertainty default to zero-valued aggregates:
    expect(vector.families.preference.every((v) => v === 0)).toBe(true);
    expect(vector.families.uncertainty.every((v) => v === 0 || v === -1)).toBe(true);
    // Temporal: no events.
    expect(vector.families.temporal[0]).toBe(0); // eventCount
    expect(vector.families.temporal[1]).toBe(0); // droppedFutureCount
    expect(vector.families.temporal[2]).toBe(-1); // mostRecentAgeMs absent marker
  });

  it("item features: kind code, label buckets (commutative), counts", () => {
    const items = [makeItem({ labels: ["a", "b", "a"] })];
    const { values, names } = itemFeatures(items);
    // 2 + 16 + 2 = 20 per item:
    expect(values).toHaveLength(20);
    expect(names[0]).toBe("item[0].kindCode");
    expect(values[0]).toBe(0); // "media" is index 0
    expect(values[1]).toBe(3); // labelCount (duplicates count)
    const bucketVector = values.slice(2, 18);
    expect(bucketVector.reduce((a, b) => a + b, 0)).toBe(3); // all labels land somewhere
    expect(values[18]).toBe(0); // no availability window
    expect(values[19]).toBe(1); // one attribute key
    // Label order is commutative for bucket counts:
    const reordered = itemFeatures([makeItem({ labels: ["a", "a", "b"] })]);
    expect(reordered.values).toEqual(values);
  });

  it("realization features: hashed host vocabulary, never raw strings", () => {
    const { values, names } = realizationFeatures([makeRealization()]);
    expect(values).toHaveLength(4);
    expect(values[0]).toBe(stableBucket("stream-source"));
    expect(values[1]).toBe(1); // hasLocale
    expect(values[2]).toBe(stableBucket("en-US"));
    expect(values[3]).toBe(1); // constraintCount
    for (const name of names) expect(name).not.toContain("stream-source");
  });

  it("experience features: format code, duration, requirements, fit", () => {
    const { values } = experienceFeatures([makeExperience()]);
    expect(values).toHaveLength(13);
    expect(values[0]).toBe(0); // "full" is index 0 of FORMAT_KINDS
    expect(values[1]).toBe(1); // hasDuration
    expect(values[2]).toBe(253); // numeric duration seconds
    expect(values[3]).toBe(1); // hasLocale
    expect(values[5]).toBe(1); // requiresScreen true
    expect(values[6]).toBe(1); // requiresAudio true
    expect(values[7]).toBe(2); // minBandwidth "high" = index 2
    expect(values[11]).toBe(-1); // objectiveFitScore absent marker
    expect(values[12]).toBe(1); // deviceClass count
    // ISO-string durations are opaque to the core:
    const iso = experienceFeatures([makeExperience({ duration: "PT4M13S" })]);
    expect(iso.values[1]).toBe(1); // present
    expect(iso.values[2]).toBe(-1); // but not numeric
  });

  it("context features: typed enum codes only; location contributes ONLY the permitted flag", () => {
    const snapshot = makeContext({
      time: { dayPart: "evening" },
      device: { class: "tv", screenAvailable: true, audioRoute: "speaker" },
      network: { class: "wifi", bandwidthHint: "high" },
      attention: { availableMs: 600_000, quality: "full" },
      fatigue: { repetitionLevel: 0.3, recentInterruptions: 2 },
      activity: ["watching", "browsing"],
      session: { sessionId: "s1", positionInSession: 4 },
      location: { coarse: "region-x", permitted: true },
    });
    const { values, names } = contextFeatures(snapshot);
    expect(values[0]).toBe(2); // dayPart "evening" = index 2
    expect(values[1]).toBe(3); // device "tv" = index 3
    expect(values[2]).toBe(1); // audioRoute "speaker" = index 1
    expect(values[3]).toBe(2); // network "wifi" = index 2
    expect(values[4]).toBe(2); // bandwidth "high" = index 2
    expect(values[5]).toBe(1); // screenAvailable true
    expect(values[6]).toBe(0); // attentionQuality "full" = index 0
    expect(values[7]).toBe(1); // hasAttentionEstimate
    expect(values[8]).toBe(600_000);
    expect(values[9]).toBeCloseTo(0.3, 12);
    expect(values[10]).toBe(2);
    expect(values[11]).toBe(2); // activityCount
    expect(values[12]).toBe(4); // sessionPosition
    expect(values[13]).toBe(1); // locationPermitted
    // ADR-003: the coarse location VALUE never appears in any feature:
    const flat = JSON.stringify({ values, names });
    expect(flat).not.toContain("region-x");
    // Without permission, the flag is 0:
    const noLocation = contextFeatures(makeContext());
    expect(noLocation.values[13]).toBe(0);
  });

  it("preference + uncertainty features propagate confidence", () => {
    const prefs = makePreferences();
    const pref = preferenceFeatures(prefs);
    expect(pref.values[0]).toBe(2); // stable count
    expect(pref.values[1]).toBe(1); // situational count
    expect(pref.values[2]).toBeCloseTo((0.9 + 0.2) / 2, 12);
    expect(pref.values[3]).toBe(0.5);
    expect(pref.values[4]).toBeCloseTo(1.2, 12); // |0.8| + |0.4|
    expect(pref.values[5]).toBeCloseTo(0.1, 12);

    const unc = uncertaintyFeatures(prefs);
    expect(unc.values[0]).toBe(3); // 2 stable + 1 situational
    expect(unc.values[1]).toBeCloseTo((0.9 + 0.2 + 0.5) / 3, 12);
    expect(unc.values[2]).toBeCloseTo(0.2, 12); // min
    expect(unc.values[3]).toBeCloseTo(0.9, 12); // max
    expect(unc.values[4]).toBeCloseTo(0.7, 12); // spread
    expect(unc.values[5]).toBeCloseTo(1 / 3, 12); // only 0.2 < 0.3
  });
});

describe("W1-004 features — NO-FUTURE-LEAKAGE (the law, tested)", () => {
  it("temporal features read ONLY events with occurredAt <= at", () => {
    const events = [
      makeEvent({ eventId: "e-past-1", idempotencyKey: "k1", occurredAt: 500, eventType: "impression" }),
      makeEvent({ eventId: "e-past-2", idempotencyKey: "k2", occurredAt: 1_000, eventType: "completion" }),
      makeEvent({ eventId: "e-future-1", idempotencyKey: "k3", occurredAt: 1_001, eventType: "share" }),
      makeEvent({ eventId: "e-future-2", idempotencyKey: "k4", occurredAt: 9_999, eventType: "purchase" }),
    ];
    const { values, names } = temporalFeatures(events, 1_000);
    const byName = new Map(names.map((n, i) => [n, values[i]!]));
    expect(byName.get("temporal.eventCount")).toBe(2); // only past events
    expect(byName.get("temporal.droppedFutureCount")).toBe(2); // leakage observable
    expect(byName.get("temporal.mostRecentAgeMs")).toBe(0); // at - 1_000
    expect(byName.get("temporal.meanAgeMs")).toBe(250); // (500 + 0)/2
    expect(byName.get("temporal.eventTypeCount.impression")).toBe(1);
    expect(byName.get("temporal.eventTypeCount.completion")).toBe(1);
    // FUTURE-typed events must not appear in ANY family value:
    expect(byName.get("temporal.eventTypeCount.share")).toBe(0);
    expect(byName.get("temporal.eventTypeCount.purchase")).toBe(0);
    // Boundary: occurredAt == at is INCLUDED (<=).
  });

  it("a future event changes NOTHING except the explicit dropped-count", () => {
    const base = makeInput();
    const baseVector = assembler.assemble(base);
    const withFuture = assembler.assemble(
      makeInput({
        recentEvents: [
          ...base.recentEvents!,
          makeEvent({ eventId: "ev-future", idempotencyKey: "k-f", occurredAt: 5_000 }),
        ],
      })
    );
    // Same digest EXCEPT the temporal family records the dropped event:
    expect(withFuture.digest).not.toBe(baseVector.digest); // digest sees the family change
    const nameIdx = withFuture.names.temporal.indexOf("temporal.droppedFutureCount");
    expect(withFuture.families.temporal[nameIdx]).toBe(1);
    // All other families are byte-identical:
    for (const family of FEATURE_FAMILIES) {
      if (family === "temporal") continue;
      expect(withFuture.families[family]).toEqual(baseVector.families[family]);
    }
    // And within temporal, only eventCount-related aggregates that
    // EXCLUDE future events are unchanged in their meaning:
    const pastOnly = withFuture.families.temporal;
    const baseTemporal = baseVector.families.temporal;
    expect(pastOnly[withFuture.names.temporal.indexOf("temporal.eventCount")]).toBe(
      baseTemporal[baseVector.names.temporal.indexOf("temporal.eventCount")]
    );
  });

  it("all-identical past events: per-type frequency counts are exact", () => {
    const events = Array.from({ length: 3 }, (_, i) =>
      makeEvent({ eventId: `e-${i}`, idempotencyKey: `k-${i}`, occurredAt: 800, eventType: "start" })
    );
    const { values, names } = temporalFeatures(events, 1_000);
    const byName = new Map(names.map((n, i) => [n, values[i]!]));
    expect(byName.get("temporal.eventTypeCount.start")).toBe(3);
    expect(byName.get("temporal.mostRecentAgeMs")).toBe(200);
    expect(byName.get("temporal.meanAgeMs")).toBe(200);
  });
});

describe("W1-004 features — digest determinism", () => {
  it("identical inputs ⇒ identical digest (across separate assemblers)", () => {
    const a = createFeatureAssembler();
    const b = createFeatureAssembler();
    expect(a.assemble(makeInput()).digest).toBe(b.assemble(makeInput()).digest);
  });

  it("label ORDER within an item does not change the digest (commutative buckets)", () => {
    const v1 = assembler.assemble(makeInput({ items: [makeItem({ labels: ["x", "y", "z"] })] }));
    const v2 = assembler.assemble(makeInput({ items: [makeItem({ labels: ["z", "x", "y"] })] }));
    expect(v1.digest).toBe(v2.digest);
  });

  it("any SEMANTIC change ⇒ a different digest", () => {
    const base = assembler.assemble(makeInput()).digest;
    const variants: Array<Partial<FeatureInput>> = [
      { at: 1_001 },
      { items: [makeItem({ labels: ["genre.scifi", "era.recent", "extra"] })] },
      { items: [makeItem({ kind: "commerce" })] },
      { contextSnapshot: makeContext({ device: { class: "phone" } }) },
      { preferences: makePreferences({ stable: [{ dimension: "genre.scifi", value: 0.9, confidence: 0.9 }] }) },
      { recentEvents: [makeEvent({ occurredAt: 800 })] },
      { subject: { kind: "user", ref: "user-10" } },
      { tenant: { tenantId: "tenant-b" } },
    ];
    for (const overrides of variants) {
      expect(assembler.assemble(makeInput(overrides)).digest).not.toBe(base);
    }
  });

  it("item ORDER is semantic (indexed names) — reordered items change the digest", () => {
    const items = [
      makeItem({ itemId: "i-a", labels: ["l1"] }),
      makeItem({ itemId: "i-b", labels: ["l2"] }),
    ];
    const v1 = assembler.assemble(makeInput({ items }));
    const v2 = assembler.assemble(makeInput({ items: [items[1]!, items[0]!] }));
    expect(v1.digest).not.toBe(v2.digest);
  });

  it("the vector is frozen — callers cannot tamper with assembly output", () => {
    const vector = assembler.assemble(makeInput());
    expect(Object.isFrozen(vector)).toBe(true);
    expect(Object.isFrozen(vector.families)).toBe(true);
  });
});

describe("W1-004 features — negative cases (typed errors, never raw strings)", () => {
  it("rejects an invalid context snapshot with a typed FeatureValidationError", () => {
    const bad = { contextId: "x", at: -1 } as unknown as ContextSnapshot;
    expect(() => assembler.assemble({ ...makeInput(), contextSnapshot: bad })).toThrowError(
      FeatureValidationError
    );
    try {
      assembler.assemble({ ...makeInput(), contextSnapshot: bad });
    } catch (err) {
      const typed = err as FeatureValidationError;
      expect(typed.code).toBe("FEATURE_VALIDATION_FAILED");
      expect(typed.issues.length).toBeGreaterThan(0);
    }
  });

  it("rejects invalid catalog items / realizations / experiences / events", () => {
    expect(() =>
      assembler.assemble(makeInput({ items: [{ itemId: "" }] as unknown as CatalogItem[] }))
    ).toThrowError(FeatureValidationError);
    expect(() =>
      assembler.assemble(
        makeInput({ realizations: [{ itemId: "x" }] as unknown as Realization[] })
      )
    ).toThrowError(FeatureValidationError);
    expect(() =>
      assembler.assemble(
        makeInput({ experiences: [{ format: { kind: "nope" } }] as unknown as Experience[] })
      )
    ).toThrowError(FeatureValidationError);
    expect(() =>
      assembler.assemble(
        makeInput({ recentEvents: [{ occurredAt: -3 }] as unknown as OutcomeEvent[] })
      )
    ).toThrowError(FeatureValidationError);
  });

  it("rejects a structurally invalid preference snapshot with a typed error", () => {
    const bad = { stable: "nope" } as unknown as PreferenceSnapshotInput;
    expect(() => assembler.assemble(makeInput({ preferences: bad }))).toThrowError(
      FeaturePreferenceSnapshotError
    );
    const badConfidence = {
      stable: [{ dimension: "d", value: 1, confidence: 5 }],
      situational: [],
    } as unknown as PreferenceSnapshotInput;
    expect(() =>
      assembler.assemble(makeInput({ preferences: badConfidence }))
    ).toThrowError(FeaturePreferenceSnapshotError);
    try {
      assembler.assemble(makeInput({ preferences: badConfidence }));
    } catch (err) {
      const typed = err as FeaturePreferenceSnapshotError;
      expect(typed.code).toBe("FEATURE_PREFERENCE_SNAPSHOT_INVALID");
      expect(typed.issues[0]?.path).toContain("confidence");
    }
  });

  it("every thrown error is an instance of the typed FeaturesError base", () => {
    const cases: Array<() => unknown> = [
      () => assembler.assemble({ ...makeInput(), contextSnapshot: {} as unknown as ContextSnapshot }),
      () => assembler.assemble(makeInput({ preferences: null as unknown as PreferenceSnapshotInput })),
    ];
    for (const fn of cases) {
      try {
        fn();
        expect.unreachable("expected a typed error");
      } catch (err) {
        expect(err).toBeInstanceOf(FeaturesError);
        expect(typeof (err as FeaturesError).code).toBe("string");
      }
    }
  });
});

describe("W1-004 features — hashing determinism", () => {
  it("stableBucket and bucketCounts are process-stable and commutative", () => {
    expect(stableBucket("genre.scifi")).toBe(stableBucket("genre.scifi"));
    expect(stableBucket("a")).toBeGreaterThanOrEqual(0);
    expect(stableBucket("a")).toBeLessThan(16);
    expect(bucketCounts(["a", "b", "a"])).toEqual(bucketCounts(["a", "a", "b"]));
    expect(bucketCounts(["a", "b", "a"]).reduce((x, y) => x + y, 0)).toBe(3);
  });

  it("distinct strings are distributed (not all one bucket)", () => {
    const buckets = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h"].map((s) => stableBucket(s))
    );
    expect(buckets.size).toBeGreaterThan(1);
  });
});

describe("W1-004 features — structural preference-snapshot contract", () => {
  it("accepts snapshots shaped exactly like @reckon/preferences output (incl. extra fields)", () => {
    // Field-for-field the shape returned by
    // InMemoryPreferenceStoreAdapter.snapshot(); extra fields (model,
    // updatedAt, deltaCount) are structurally compatible additions.
    const snapshotLike = {
      subject,
      tenant,
      at: 1_000,
      stable: [
        {
          dimension: "genre.scifi",
          value: 0.8,
          confidence: 0.9,
          model: { modelId: "m-1", version: "1" },
          updatedAt: 900,
          deltaCount: 2,
        },
      ],
      situational: [
        {
          dimension: "genre.scifi",
          value: 0.1,
          confidence: 0.5,
          model: { modelId: "m-1", version: "1" },
          updatedAt: 950,
          deltaCount: 1,
          contextScope: { contextKind: "session", contextId: "sess-1" },
        },
      ],
    };
    const vector = assembler.assemble(makeInput({ preferences: snapshotLike }));
    expect(vector.families.preference[0]).toBe(1);
    expect(vector.families.preference[1]).toBe(1);
    expect(vector.digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
