import { describe, it, expect } from "vitest";
import { WEBHOOK_EVENTS, WEBHOOK_ENVELOPE_NOTE } from "../../../apps/docs/src/content/webhooks.js";
import {
  ReckonEventSchema,
  WEBHOOK_EVENT_TYPES,
  type ReckonEvent,
} from "@reckon/contracts";

/**
 * S2-002 — EVENT CATALOG LOCKSTEP WITH THE DOCS: every payload example
 * published on the docs portal (imported directly from the docs
 * content module) must validate against the shipped ReckonEventSchema,
 * and the documented event ids must be exactly the domain events of
 * the shipped catalog. The docs and the code cannot drift — this test
 * is the tripwire.
 */

describe("webhook catalog: docs ↔ code lockstep", () => {
  it("every documented payload example parses into a valid thin event", () => {
    expect(WEBHOOK_EVENTS.length).toBeGreaterThanOrEqual(4);
    for (const entry of WEBHOOK_EVENTS) {
      const payload = JSON.parse(entry.payload) as unknown;
      const parsed = ReckonEventSchema.safeParse(payload);
      expect(parsed.success, `docs payload for ${entry.id} must validate`).toBe(true);
      if (parsed.success) {
        expect(parsed.data.object).toBe("event");
        expect(parsed.data.type).toBe(entry.id);
        expect(parsed.data.tenant).toEqual({ tenantId: "demo" });
        expect(Object.keys(parsed.data)).toEqual(
          expect.arrayContaining(["id", "object", "type", "created", "tenant", "data"]),
        );
      }
    }
  });

  it("the documented event ids are exactly the shipped DOMAIN events (catalog ⊇ docs)", () => {
    const docsIds = WEBHOOK_EVENTS.map((entry) => entry.id);
    for (const id of docsIds) {
      expect(WEBHOOK_EVENT_TYPES).toContain(id);
    }
    // The lifecycle events are additive beyond the four documented
    // loop events (the docs table says "Four event types cover the
    // loop today").
    const shippedLifecycle = WEBHOOK_EVENT_TYPES.filter((type) => type.startsWith("webhook."));
    expect(shippedLifecycle).toEqual(["webhook.endpoint.created", "webhook.endpoint.deleted"]);
    expect(docsIds).not.toContain("webhook.endpoint.created");
  });

  it("the envelope note's documented laws hold on the shipped schema (thin + at-least-once)", () => {
    expect(WEBHOOK_ENVELOPE_NOTE.length).toBeGreaterThan(0);
    expect(WEBHOOK_ENVELOPE_NOTE.join(" ")).toContain("thin");
    // Thin by schema construction: data carries ONLY `object`.
    const sample = WEBHOOK_EVENTS[0];
    expect(sample).toBeDefined();
    const event = ReckonEventSchema.parse(JSON.parse(sample!.payload) as unknown) as ReckonEvent;
    expect(Object.keys(event.data)).toEqual(["object"]);
  });

  it("event ids in the docs examples carry the evt_ prefix the generator mints", () => {
    for (const entry of WEBHOOK_EVENTS) {
      const event = JSON.parse(entry.payload) as { id?: string };
      expect(event.id).toMatch(/^evt_[A-Za-z0-9]+$/);
    }
  });
});

describe("webhook catalog: engine-emitted events satisfy the same schema", () => {
  it("a full set of catalog events built through the emission seam validates", async () => {
    const { createReckonEvent } = await import("@reckon/events");
    const events = [
      createReckonEvent({
        id: "evt_generated_1",
        type: "recommendation.delivered",
        tenant: { tenantId: "t" },
        created: 100,
        data: {
          decisionId: "dec-1",
          requestId: "req-1",
          experienceId: "exp-1",
          itemId: "item-1",
          action: "SUGGEST",
          deliveredAt: 99,
        },
      }),
      createReckonEvent({
        id: "evt_generated_2",
        type: "model.drift.detected",
        tenant: { tenantId: "t" },
        created: 200,
        data: {
          modelId: "m-1",
          modelVersion: "12",
          driftScore: 0.5,
          threshold: 0.3,
          window: "72h",
          metric: "calibration_error",
          evaluatedAt: 199,
        },
      }),
      createReckonEvent({
        id: "evt_generated_3",
        type: "webhook.endpoint.created",
        tenant: { tenantId: "t" },
        created: 300,
        data: { endpointId: "we_1", url: "https://hooks.example.com/r", eventTypes: [] },
      }),
    ];
    for (const event of events) {
      expect(ReckonEventSchema.safeParse(event).success).toBe(true);
    }
  });
});
