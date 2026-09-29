/**
 * W1-005 acceptance tests — WorldModel port + deterministic implementation.
 *
 * Proves: determinism (byte-identical digest + serialization), cutoff
 * enforcement (no future leakage), evidence-class separation, tenant
 * and subject scoping, and the negative (typed-error) cases.
 */
import { describe, it, expect } from "vitest";
import {
  ContextSnapshotSchema,
  contentDigest,
  type CatalogItem,
  type ContextSnapshot,
  type Experience,
  type OutcomeEvent,
  type Realization,
  type SubjectReference,
  type TenantScope,
} from "@reckon/contracts";
import {
  createWorldModel,
  observedHistoryEvents,
  researchHistoryEvents,
  serializeWorldModelState,
  worldModelDigestContent,
  WORLD_MODEL_VERSION,
  SimulationCutoffViolationError,
  SimulationClockViolationError,
  SimulationEvidenceClassViolationError,
  SimulationSeedInvalidError,
  SimulationSubjectMismatchError,
  SimulationTenantMismatchError,
  SimulationValidationError,
  type PreferenceSnapshotShape,
  type WorldModelInput,
} from "../src/index.js";

const subject: SubjectReference = { kind: "user", ref: "user-7" };
const tenant: TenantScope = { tenantId: "tenant-a" };
const otherTenant: TenantScope = { tenantId: "tenant-b" };
const otherSubject: SubjectReference = { kind: "user", ref: "user-8" };

const CUTOFF = 10_000;

function makeContext(overrides: Record<string, unknown> = {}): ContextSnapshot {
  return ContextSnapshotSchema.parse({ contextId: "ctx-1", at: 9_500, ...overrides });
}

function makeItem(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    itemId: "item-1",
    kind: "media",
    labels: ["genre.scifi"],
    attributes: { runtimeMinutes: 118 },
    ...overrides,
  } as CatalogItem;
}

function makeExperience(overrides: Partial<Experience> = {}): Experience {
  return {
    experienceId: "exp-1",
    itemId: "item-1",
    realizationId: "real-1",
    format: { kind: "full", params: {} },
    duration: 253,
    locale: "en-US",
    requirements: { deviceClass: ["tv"], requiresScreen: true },
    transformations: [],
    constraints: [],
    ...overrides,
  } as Experience;
}

function makeRealization(overrides: Partial<Realization> = {}): Realization {
  return {
    realizationId: "real-1",
    itemId: "item-1",
    kind: "stream-source",
    locale: "en-US",
    constraints: {},
    ...overrides,
  } as Realization;
}

function makeEvent(overrides: Partial<OutcomeEvent> = {}): OutcomeEvent {
  return {
    eventId: "ev-1",
    tenant,
    subject,
    eventType: "completion",
    occurredAt: 9_000,
    evidenceClass: "production-observed",
    idempotencyKey: "idem-1",
    metrics: {},
    ...overrides,
  } as OutcomeEvent;
}

function makePreferences(): PreferenceSnapshotShape {
  return {
    stable: [{ dimension: "genre.scifi", value: 0.8, confidence: 0.9 }],
    situational: [
      {
        dimension: "genre.scifi",
        value: 0.1,
        confidence: 0.5,
        contextScope: { contextKind: "session", contextId: "sess-1" },
      },
    ],
    at: 9_000,
  };
}

function makeFeatures() {
  return {
    families: { context: [3, 1, 24_000], bias: [1] },
    names: { context: ["dayPart", "screen", "attentionMs"], bias: ["bias"] },
    digest: "deadbeefdeadbeef",
  };
}

function makeInput(overrides: Partial<WorldModelInput> = {}): WorldModelInput {
  return {
    tenant,
    subject,
    informationCutoff: CUTOFF,
    seed: "123456789",
    contextSnapshot: makeContext(),
    items: [makeItem()],
    realizations: [makeRealization()],
    experiences: [makeExperience()],
    preferences: makePreferences(),
    features: makeFeatures(),
    recentEvents: [makeEvent()],
    ...overrides,
  };
}

const worldModel = createWorldModel();

describe("W1-005 WorldModel — determinism", () => {
  it("same inputs ⇒ byte-identical digest and canonical serialization", () => {
    const a = worldModel.build(makeInput());
    const b = worldModel.build(makeInput()); // independently constructed, structurally equal
    expect(a.stateDigest).toBe(b.stateDigest);
    expect(serializeWorldModelState(a)).toBe(serializeWorldModelState(b));
    expect(a.stateDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stateDigest equals the content digest over the state minus the digest field", () => {
    const state = worldModel.build(makeInput());
    expect(contentDigest(worldModelDigestContent(state))).toBe(state.stateDigest);
  });

  it("any semantic change ⇒ a different digest", () => {
    const base = worldModel.build(makeInput());
    const changedSeed = worldModel.build(makeInput({ seed: "987654321" }));
    const changedItem = worldModel.build(
      makeInput({ items: [makeItem({ labels: ["genre.drama"] })] })
    );
    const changedPrefs = worldModel.build(
      makeInput({
        preferences: {
          stable: [{ dimension: "genre.scifi", value: 0.9, confidence: 0.9 }],
          situational: [],
          at: 9_000,
        },
      })
    );
    expect(changedSeed.stateDigest).not.toBe(base.stateDigest);
    expect(changedItem.stateDigest).not.toBe(base.stateDigest);
    expect(changedPrefs.stateDigest).not.toBe(base.stateDigest);
  });

  it("records world model version, seed, configuration and reward version", () => {
    const state = worldModel.build(makeInput());
    expect(state.worldModelVersion).toBe(WORLD_MODEL_VERSION);
    expect(state.seed).toBe("123456789");
    expect(state.informationCutoff).toBe(CUTOFF);
    expect(state.rewardVersion).toBe("unset");
    expect(state.simulationClock).toBe(CUTOFF); // virtual clock starts at the cutoff
    expect(state.stepCount).toBe(0);
    expect(state.configuration.stepDurationMs).toBeGreaterThan(0);

    const withReward = worldModel.build(
      makeInput({
        reward: {
          rewardId: "host.reward",
          version: "3",
          terms: [{ termId: "t1", version: "1", kind: "task-success", weight: 1, params: {} }],
        },
      })
    );
    expect(withReward.rewardVersion).toBe("host.reward@3");
  });

  it("state is deeply frozen (immutable)", () => {
    const state = worldModel.build(makeInput());
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.configuration)).toBe(true);
    expect(() => {
      (state as unknown as { simulationClock: number }).simulationClock = 0;
    }).toThrow();
  });
});

describe("W1-005 WorldModel — cutoff enforcement (no future leakage)", () => {
  it("drops events after the cutoff and counts them; keeps at/before cutoff", () => {
    const state = worldModel.build(
      makeInput({
        recentEvents: [
          makeEvent({ eventId: "ev-past", occurredAt: 8_000, idempotencyKey: "k1" }),
          makeEvent({ eventId: "ev-at", occurredAt: CUTOFF, idempotencyKey: "k2" }),
          makeEvent({ eventId: "ev-future-1", occurredAt: CUTOFF + 1, idempotencyKey: "k3" }),
          makeEvent({ eventId: "ev-future-2", occurredAt: CUTOFF + 9_999, idempotencyKey: "k4" }),
        ],
      })
    );
    expect(state.history.map((event) => event.eventId)).toEqual(["ev-past", "ev-at"]);
    expect(state.droppedFutureEventCount).toBe(2);
  });

  it("identical history + one extra future event ⇒ same digest (future cannot leak)", () => {
    const clean = worldModel.build(makeInput({ recentEvents: [] }));
    const tainted = worldModel.build(
      makeInput({
        recentEvents: [
          makeEvent({ eventId: "ev-future", occurredAt: CUTOFF + 5, idempotencyKey: "k9" }),
        ],
      })
    );
    // The future event is dropped, so the digests must be byte-identical.
    expect(tainted.stateDigest).toBe(clean.stateDigest);
    expect(tainted.droppedFutureEventCount).toBe(1);
  });

  it("rejects a context snapshot dated after the cutoff (typed error)", () => {
    expect(() =>
      worldModel.build(makeInput({ contextSnapshot: makeContext({ at: CUTOFF + 1 }) }))
    ).toThrow(SimulationCutoffViolationError);
  });
});

describe("W1-005 WorldModel — evidence-class separation", () => {
  it("advance accepts only evidenceClass=simulated records", () => {
    const state = worldModel.build(makeInput());
    const simulatedEvent = makeEvent({
      eventId: "sim-ev-1",
      evidenceClass: "simulated",
      occurredAt: CUTOFF,
      idempotencyKey: "sim-k1",
    });
    const next = worldModel.advance(state, { events: [simulatedEvent], clockAdvanceMs: 60_000 });
    expect(next.simulatedEvents.map((event) => event.eventId)).toEqual(["sim-ev-1"]);
    expect(next.simulatedEvents.every((event) => event.evidenceClass === "simulated")).toBe(true);

    for (const badClass of [
      "production-observed",
      "staging",
      "controlled-local",
      "counterfactual",
      "fixture",
    ] as const) {
      expect(() =>
        worldModel.advance(state, {
          events: [
            makeEvent({ eventId: "bad-ev", evidenceClass: badClass, idempotencyKey: "bad-k" }),
          ],
          clockAdvanceMs: 60_000,
        })
      ).toThrow(SimulationEvidenceClassViolationError);
    }
  });

  it("partitions history views: observed history never contains simulated output", () => {
    const state = worldModel.build(
      makeInput({
        recentEvents: [
          makeEvent({
            eventId: "obs-1",
            evidenceClass: "production-observed",
            occurredAt: 9_000,
            idempotencyKey: "o1",
          }),
          makeEvent({
            eventId: "fix-1",
            evidenceClass: "fixture",
            occurredAt: 9_100,
            idempotencyKey: "f1",
          }),
        ],
      })
    );
    const next = worldModel.advance(state, {
      events: [
        makeEvent({
          eventId: "sim-1",
          evidenceClass: "simulated",
          occurredAt: CUTOFF,
          idempotencyKey: "s1",
        }),
      ],
      clockAdvanceMs: 60_000,
    });
    const observed = observedHistoryEvents(next);
    const research = researchHistoryEvents(next);
    expect(observed.map((event) => event.eventId)).toEqual(["obs-1"]);
    expect(research.map((event) => event.eventId)).toEqual(["fix-1", "sim-1"]);
    // Disjoint by construction:
    expect(observed.some((event) => event.evidenceClass === "simulated")).toBe(false);
    expect(research.some((event) => event.evidenceClass === "production-observed")).toBe(false);
  });

  it("advance recomputes the digest and does not mutate the input state", () => {
    const state = worldModel.build(makeInput());
    const digestBefore = state.stateDigest;
    const next = worldModel.advance(state, {
      events: [
        makeEvent({
          eventId: "sim-2",
          evidenceClass: "simulated",
          occurredAt: CUTOFF,
          idempotencyKey: "s2",
        }),
      ],
      clockAdvanceMs: 60_000,
    });
    expect(next.stateDigest).not.toBe(digestBefore);
    expect(state.stateDigest).toBe(digestBefore); // input untouched
    expect(state.simulatedEvents).toHaveLength(0);
    expect(next.simulatedEvents).toHaveLength(1);
    expect(next.stepCount).toBe(1);
    expect(next.simulationClock).toBe(CUTOFF + 60_000);
    expect(contentDigest(worldModelDigestContent(next))).toBe(next.stateDigest);
  });

  it("rejects an event stamped before the simulation clock (monotonic virtual time)", () => {
    const state = worldModel.build(makeInput());
    expect(() =>
      worldModel.advance(state, {
        events: [
          makeEvent({
            eventId: "sim-old",
            evidenceClass: "simulated",
            occurredAt: CUTOFF - 1,
            idempotencyKey: "s-old",
          }),
        ],
        clockAdvanceMs: 60_000,
      })
    ).toThrow(SimulationClockViolationError);
  });
});

describe("W1-005 WorldModel — tenant and subject scoping", () => {
  it("rejects events from another tenant (typed, never silently mixed)", () => {
    expect(() =>
      worldModel.build(
        makeInput({
          recentEvents: [
            makeEvent({ eventId: "foreign", tenant: otherTenant, idempotencyKey: "fk" }),
          ],
        })
      )
    ).toThrow(SimulationTenantMismatchError);
  });

  it("rejects advance events from another tenant", () => {
    const state = worldModel.build(makeInput());
    expect(() =>
      worldModel.advance(state, {
        events: [
          makeEvent({
            eventId: "foreign-sim",
            tenant: otherTenant,
            evidenceClass: "simulated",
            idempotencyKey: "fk2",
          }),
        ],
        clockAdvanceMs: 60_000,
      })
    ).toThrow(SimulationTenantMismatchError);
  });

  it("rejects events from another subject", () => {
    expect(() =>
      worldModel.build(
        makeInput({
          recentEvents: [
            makeEvent({ eventId: "other-subj", subject: otherSubject, idempotencyKey: "os" }),
          ],
        })
      )
    ).toThrow(SimulationSubjectMismatchError);
  });

  it("tenant scope is part of the digest (two tenants ⇒ different worlds)", () => {
    const a = worldModel.build(makeInput({ tenant }));
    // The other-tenant world must not consume tenant-a events (which
    // would be a tenant-mismatch rejection) — evidence-free comparison.
    const b = worldModel.build(
      makeInput({ tenant: otherTenant, recentEvents: [] })
    );
    expect(a.stateDigest).not.toBe(b.stateDigest);
  });
});

describe("W1-005 WorldModel — negative cases (typed errors)", () => {
  it("rejects invalid seeds", () => {
    expect(() => worldModel.build(makeInput({ seed: "-1" }))).toThrow(SimulationSeedInvalidError);
    expect(() => worldModel.build(makeInput({ seed: "abc" }))).toThrow(SimulationSeedInvalidError);
    expect(() => worldModel.build(makeInput({ seed: -5 }))).toThrow(SimulationSeedInvalidError);
    // uint64 domain boundary: 2^64 is invalid, 2^64 − 1 is valid.
    expect(() => worldModel.build(makeInput({ seed: "18446744073709551616" }))).toThrow(
      SimulationSeedInvalidError
    );
    expect(() => worldModel.build(makeInput({ seed: "18446744073709551615" }))).not.toThrow();
  });

  it("rejects schema-invalid records with typed validation errors", () => {
    expect(() =>
      worldModel.build(
        makeInput({ contextSnapshot: { contextId: "x" } as unknown as ContextSnapshot })
      )
    ).toThrow(SimulationValidationError);
    expect(() =>
      worldModel.build(
        makeInput({
          recentEvents: [{ nope: true } as unknown as OutcomeEvent],
        })
      )
    ).toThrow(SimulationValidationError);
  });

  it("rejects structurally invalid feature vectors and preference snapshots", () => {
    expect(() =>
      worldModel.build(
        makeInput({
          features: {
            families: { context: [1, 2] },
            names: { context: ["only.one"] }, // misaligned
            digest: "x",
          },
        })
      )
    ).toThrow(SimulationValidationError);

    expect(() =>
      worldModel.build(
        makeInput({
          preferences: {
            stable: [{ dimension: "d", value: 0.5, confidence: 9 }], // confidence out of range
            situational: [],
          },
        })
      )
    ).toThrow(SimulationValidationError);
  });

  it("rejects invalid configuration", () => {
    expect(() => worldModel.build(makeInput({ configuration: { stepDurationMs: 0 } }))).toThrow();
    expect(() => worldModel.build(makeInput({ configuration: { maxSteps: -1 } }))).toThrow();
    expect(() =>
      worldModel.build(
        makeInput({ configuration: { params: { bad: "not-a-number" as unknown as number } } })
      )
    ).toThrow();
  });

  it("reseed returns a new state with a different digest and the new seed", () => {
    const state = worldModel.build(makeInput());
    const reseeded = worldModel.reseed(state, "42");
    expect(reseeded.seed).toBe("42");
    expect(reseeded.stateDigest).not.toBe(state.stateDigest);
    expect(state.seed).toBe("123456789"); // input untouched
  });
});
