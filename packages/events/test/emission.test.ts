import { describe, it, expect } from "vitest";
import { DecisionResultSchema, OutcomeEventSchema, PreferenceDeltaSchema } from "@reckon/contracts";
import {
  FanoutEventPublisher,
  NullEventPublisher,
  createReckonEvent,
  modelDriftDetectedEvent,
  preferenceUpdatedEvent,
  recommendationDeliveredEvent,
  scheduleExecutedEvent,
  webhookEndpointCreatedEvent,
  webhookEndpointDeletedEvent,
} from "../src/emission.js";

/**
 * S2-002 — the emission seam: domain mappers produce schema-valid thin
 * events; unresolvable anchors yield null (never invented fields); the
 * publisher port is a structural seam for any bus.
 */

const TENANT = { tenantId: "tenant-a" } as const;
const IDS = { id: "evt_test_1", created: 10_000 } as const;

const decision = (overrides: Record<string, unknown> = {}) =>
  DecisionResultSchema.parse({
    decisionId: "dec-1",
    requestId: "req-1",
    tenant: TENANT,
    action: "SUGGEST",
    selectedExperience: {
      experienceId: "exp-1",
      itemId: "item-1",
      realizationId: "real-1",
      format: { kind: "full", params: {} },
    },
    policy: { policyId: "greedy-v1", version: "1" },
    at: 9_500,
    ...overrides,
  });

const outcome = (overrides: Record<string, unknown> = {}) =>
  OutcomeEventSchema.parse({
    eventId: "ev-1",
    tenant: TENANT,
    decisionId: "dec-1",
    experienceId: "exp-1",
    subject: { kind: "user", ref: "user-9" },
    eventType: "impression",
    occurredAt: 9_900,
    evidenceClass: "production-observed",
    idempotencyKey: "idem-1",
    ...overrides,
  });

const delta = (overrides: Record<string, unknown> = {}) =>
  PreferenceDeltaSchema.parse({
    deltaId: "delta-1",
    tenant: TENANT,
    subject: { kind: "user", ref: "user-9" },
    dimension: "genre.scifi",
    op: "add",
    value: 0.25,
    model: { modelId: "m-1", version: "3" },
    timestamp: 5_000,
    ...overrides,
  });

describe("emission: schedule.executed", () => {
  it("maps a decision's schedule delta (delta.planId wins; request planId is the fallback)", () => {
    const withDelta = decision({
      action: "QUEUE",
      scheduleDelta: { action: "QUEUE", planId: "plan-1", enqueue: ["exp-1"], dequeue: [] },
    });
    const event = scheduleExecutedEvent(withDelta, IDS);
    expect(event).not.toBeNull();
    expect(event).toMatchObject({
      id: "evt_test_1",
      object: "event",
      type: "schedule.executed",
      created: 10_000,
      tenant: TENANT,
      data: {
        object: {
          planId: "plan-1",
          decisionId: "dec-1",
          action: "QUEUE",
          enqueued: ["exp-1"],
          dequeued: [],
          executedAt: 9_500,
        },
      },
    });
  });

  it("uses the REQUEST planId when the delta itself carries none", () => {
    const withDelta = decision({ scheduleDelta: { action: "SWITCH", enqueue: [], dequeue: ["exp-0"] } });
    const event = scheduleExecutedEvent(withDelta, IDS, "plan-from-request");
    expect(event?.data.object).toMatchObject({ planId: "plan-from-request", action: "SWITCH" });
  });

  it("returns null when there is no delta, or no plan anchor anywhere", () => {
    expect(scheduleExecutedEvent(decision(), IDS)).toBeNull();
    const withDelta = decision({ scheduleDelta: { action: "QUEUE", enqueue: [], dequeue: [] } });
    expect(scheduleExecutedEvent(withDelta, IDS)).toBeNull();
    expect(scheduleExecutedEvent(withDelta, IDS, undefined)).toBeNull();
  });
});

describe("emission: recommendation.delivered", () => {
  it("maps an impression outcome + its SUGGEST decision (outcome anchors win)", () => {
    const event = recommendationDeliveredEvent(outcome(), decision(), IDS);
    expect(event).not.toBeNull();
    expect(event).toMatchObject({
      type: "recommendation.delivered",
      data: {
        object: {
          decisionId: "dec-1",
          requestId: "req-1",
          experienceId: "exp-1",
          itemId: "item-1",
          action: "SUGGEST",
          deliveredAt: 9_900,
        },
      },
    });
  });

  it("resolves the experience from the decision when the outcome omits it", () => {
    const event = recommendationDeliveredEvent(outcome({ experienceId: undefined }), decision(), IDS);
    expect(event?.data.object).toMatchObject({ experienceId: "exp-1" });
  });

  it("returns null for non-SUGGEST/SWITCH decisions or unresolvable anchors", () => {
    expect(recommendationDeliveredEvent(outcome(), decision({ action: "HOLD" }), IDS)).toBeNull();
    expect(
      recommendationDeliveredEvent(outcome({ decisionId: undefined }), decision({ selectedExperience: undefined }), IDS),
    ).toBeNull();
    // No selectedExperience on the decision → no itemId anchor → null.
    const noExperience = decision({ selectedExperience: undefined });
    expect(recommendationDeliveredEvent(outcome(), noExperience, IDS)).toBeNull();
  });

  it("carries the outcome's occurredAt as deliveredAt (host time authority)", () => {
    const event = recommendationDeliveredEvent(outcome({ occurredAt: 123456 }), decision(), IDS);
    expect(event?.data.object).toMatchObject({ deliveredAt: 123456 });
  });
});

describe("emission: preference.updated", () => {
  it("maps an appended delta, including optional resultingConfidence only when present", () => {
    const event = preferenceUpdatedEvent(delta(), IDS);
    expect(event).toMatchObject({
      type: "preference.updated",
      data: {
        object: {
          deltaId: "delta-1",
          subject: { kind: "user", ref: "user-9" },
          dimension: "genre.scifi",
          op: "add",
          modelId: "m-1",
          modelVersion: "3",
        },
      },
    });
    expect("resultingConfidence" in (event?.data.object ?? {})).toBe(false);

    const withConfidence = preferenceUpdatedEvent(delta({ resultingConfidence: 0.61 }), IDS);
    expect(withConfidence.data.object).toMatchObject({ resultingConfidence: 0.61 });
  });
});

describe("emission: model.drift.detected + lifecycle events", () => {
  it("maps the drift monitor payload verbatim (validated thin fields)", () => {
    const event = modelDriftDetectedEvent(
      {
        modelId: "pref-embed-v3",
        modelVersion: "12",
        driftScore: 0.41,
        threshold: 0.35,
        window: "72h",
        metric: "calibration_error",
        evaluatedAt: 1_777,
      },
      TENANT,
      IDS,
    );
    expect(event).toMatchObject({
      type: "model.drift.detected",
      data: {
        object: {
          modelId: "pref-embed-v3",
          driftScore: 0.41,
          threshold: 0.35,
          metric: "calibration_error",
        },
      },
    });
  });

  it("maps endpoint created/deleted lifecycle events", () => {
    const created = webhookEndpointCreatedEvent(
      { endpointId: "we_1", url: "https://hooks.example.com/r", eventTypes: ["schedule.executed"] },
      TENANT,
      IDS,
    );
    expect(created).toMatchObject({
      type: "webhook.endpoint.created",
      data: { object: { endpointId: "we_1", eventTypes: ["schedule.executed"] } },
    });
    const deleted = webhookEndpointDeletedEvent(
      { endpointId: "we_1", url: "https://hooks.example.com/r" },
      TENANT,
      IDS,
    );
    expect(deleted).toMatchObject({ type: "webhook.endpoint.deleted", data: { object: { endpointId: "we_1" } } });
  });
});

describe("emission: construction is validated against the frozen envelope", () => {
  it("createReckonEvent throws the typed EventValidationError on malformed payloads", () => {
    expect(() =>
      createReckonEvent({ id: "evt_1", type: "schedule.executed", tenant: TENANT, created: 1, data: { nope: true } }),
    ).toThrowError(/ReckonEventSchema/);
  });

  it("every mapper output round-trips through the envelope schema (parse === identity)", () => {
    for (const event of [
      scheduleExecutedEvent(decision({ scheduleDelta: { action: "QUEUE", planId: "p", enqueue: [], dequeue: [] } }), IDS),
      recommendationDeliveredEvent(outcome(), decision(), IDS),
      preferenceUpdatedEvent(delta(), IDS),
      webhookEndpointCreatedEvent({ endpointId: "we_1", url: "https://x.example.com", eventTypes: [] }, TENANT, IDS),
    ]) {
      expect(event).not.toBeNull();
      const again = JSON.parse(JSON.stringify(event)) as typeof event;
      expect(again).toEqual(event);
    }
  });
});

describe("emission: publisher port", () => {
  it("NullEventPublisher drops; FanoutEventPublisher delivers to every subscriber in order", async () => {
    const seen: string[] = [];
    const recorder = {
      publish: (event: { readonly type: string }) => {
        seen.push(event.type);
      },
    };
    const fanout = new FanoutEventPublisher([recorder, recorder]);
    await fanout.publish(preferenceUpdatedEvent(delta(), IDS));
    expect(seen).toEqual(["preference.updated", "preference.updated"]);

    const none = new NullEventPublisher();
    expect(none.publish(preferenceUpdatedEvent(delta(), IDS))).toBeUndefined();
  });
});
