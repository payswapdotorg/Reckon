import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  DecisionResultSchema,
  type DecisionResult,
  type OutcomeEvent,
  type PreferenceDelta,
} from "@reckon/contracts";
import { modelDriftDetectedEvent, type ReckonEventPublisher } from "@reckon/events";
import type { PartialHandlerPorts } from "../src/ports.js";
import {
  injectJson,
  validDecisionRequest,
  validOutcomeEvent,
  validPreferenceDelta,
} from "./fixtures.js";
import {
  buildWebhookServer,
  freshWhIdem,
  whHeaders,
  type WebhookTestServer,
} from "./webhook-helpers.js";

/**
 * S2-002 — the EMISSION SEAM wired into the domain paths: POST
 * /v1/decisions (schedule delta) → schedule.executed; POST /v1/outcomes
 * (impression delivery confirmation) → recommendation.delivered; POST
 * /v1/preferences → preference.updated; the drift monitor publishes
 * model.drift.detected through the same port. All through the REAL
 * route pipeline with the webhook system mounted (config.webhooks).
 */

async function close(server: { app: FastifyInstance }): Promise<void> {
  await server.app.close();
}

interface DeliveredEvent {
  id?: string;
  type?: string;
  created?: number;
  tenant?: { tenantId?: string };
  data?: { object?: Record<string, unknown> };
}

function deliveredEvents(server: WebhookTestServer): DeliveredEvent[] {
  return server.client.calls.map((call) => JSON.parse(call.rawBody) as DeliveredEvent);
}

/**
 * Deterministic domain handlers: a QUEUE decision with a schedule
 * delta, or a SUGGEST decision with a selected experience (both
 * persisted into a tenant-scoped store for the delivery-confirmation
 * lookup); outcome/preference echo.
 */
function domainHandlers(options: { readonly action?: "QUEUE" | "SUGGEST" } = {}): {
  handlers: PartialHandlerPorts;
  decisions: Map<string, DecisionResult>;
} {
  const action = options.action ?? "QUEUE";
  const decisions = new Map<string, DecisionResult>();
  return {
    decisions,
    handlers: {
      decisionHandler: {
        decide: async (request) => {
          const result = DecisionResultSchema.parse({
            decisionId: `dec-${request.idempotencyKey}`,
            requestId: request.requestId,
            tenant: request.tenant,
            action,
            ...(action === "SUGGEST"
              ? {
                  selectedExperience: {
                    experienceId: "exp-1",
                    itemId: "item-1",
                    realizationId: "real-1",
                    format: { kind: "full", params: {} },
                  },
                }
              : {
                  selectedExperience: {
                    experienceId: "exp-1",
                    itemId: "item-1",
                    realizationId: "real-1",
                    format: { kind: "full", params: {} },
                  },
                  scheduleDelta: {
                    action: "QUEUE",
                    planId: request.planId ?? "plan-default",
                    enqueue: ["exp-1"],
                    dequeue: [],
                  },
                }),
            policy: { policyId: request.policySelector.policyId, version: request.policySelector.version },
            at: request.at ?? 1_000,
            reasons: [{ code: "stub", message: `${action} decision for emission tests` }],
          });
          decisions.set(`${request.tenant.tenantId}|${result.decisionId}`, result);
          return result;
        },
      },
      decisionStore: {
        get: async (tenantId: string, decisionId: string) => decisions.get(`${tenantId}|${decisionId}`) ?? null,
      },
      outcomeIngest: {
        ingest: async (event: OutcomeEvent) => event,
      },
      preferenceIngest: {
        ingest: async (delta: PreferenceDelta) => delta,
      },
    },
  };
}

async function createEndpoint(server: WebhookTestServer, suffix: string, eventTypes?: string[]): Promise<void> {
  const res = await injectJson(server.app, "POST", "/v1/webhooks/endpoints", {
    payload: {
      url: `https://hooks.example.com/${suffix}`,
      ...(eventTypes !== undefined ? { eventTypes } : {}),
    },
    headers: whHeaders("wh-full", { "idempotency-key": freshWhIdem(`em-${suffix}`) }),
  });
  expect(res.status).toBe(200);
}

describe("webhook emission seam: domain routes fan events out", () => {
    const DEC_IDEM = freshWhIdem("dec");
    const DEC2_IDEM = freshWhIdem("dec-2");
    const OUT_IDEM = freshWhIdem("out");
    const DEC3_IDEM = freshWhIdem("dec-3");
    const OUT2_IDEM = freshWhIdem("out-2");
    const DEC4_IDEM = freshWhIdem("dec-4");
    const DEC5_IDEM = freshWhIdem("dec-5");

  let server: WebhookTestServer;
  afterEach(async () => {
    if (server !== undefined) await close(server);
  });

  it("POST /v1/decisions with a schedule delta emits schedule.executed (thin payload, signed delivery)", async () => {
    const domain = domainHandlers();
    server = buildWebhookServer({ handlers: domain.handlers });
    await createEndpoint(server, "sched", ["schedule.executed"]);

    const decision = await injectJson(server.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest({ planId: "plan-42", at: 5_000, idempotencyKey: DEC_IDEM }),
      headers: whHeaders("wh-full", { "idempotency-key": DEC_IDEM }),
    });
    expect(decision.status).toBe(200);
    const decisionId = (decision.body as { decisionId?: string }).decisionId;

    const events = deliveredEvents(server).filter((event) => event.type === "schedule.executed");
    expect(events).toHaveLength(1);
    expect(events[0]?.id).toMatch(/^evt_[A-Za-z0-9]+$/);
    expect(events[0]?.tenant).toEqual({ tenantId: "tenant-a" });
    expect(events[0]?.created).toBe(server.clock.now());
    expect(events[0]?.data?.object).toMatchObject({
      planId: "plan-42",
      decisionId,
      action: "QUEUE",
      enqueued: ["exp-1"],
      dequeued: [],
      executedAt: 5_000,
    });
    // The event is stored for replay too.
    const stored = await injectJson(server.app, "GET", `/v1/webhooks/events/${events[0]?.id}`, {
      headers: whHeaders("wh-full"),
    });
    expect(stored.status).toBe(200);
  });

  it("POST /v1/outcomes with an impression emits recommendation.delivered (resolved from the decision store)", async () => {
    const domain = domainHandlers({ action: "SUGGEST" });
    server = buildWebhookServer({ handlers: domain.handlers });
    await createEndpoint(server, "deliv", ["recommendation.delivered"]);

    const decision = await injectJson(server.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest({ planId: "plan-7", at: 5_000, idempotencyKey: DEC2_IDEM }),
      headers: whHeaders("wh-full", { "idempotency-key": DEC2_IDEM }),
    });
    const decisionId = (decision.body as { decisionId?: string }).decisionId;

    const outcome = await injectJson(server.app, "POST", "/v1/outcomes", {
      payload: validOutcomeEvent({
        decisionId,
        experienceId: "exp-1",
        eventType: "impression",
        occurredAt: 5_400,
        idempotencyKey: OUT_IDEM,
      }),
      headers: whHeaders("wh-full", { "idempotency-key": OUT_IDEM }),
    });
    expect(outcome.status).toBe(200);

    const events = deliveredEvents(server).filter((event) => event.type === "recommendation.delivered");
    expect(events).toHaveLength(1);
    expect(events[0]?.data?.object).toMatchObject({
      decisionId,
      requestId: "req-1",
      experienceId: "exp-1",
      itemId: "item-1",
      action: "SUGGEST",
      deliveredAt: 5_400,
    });
  });

  it("non-impression outcomes (e.g. completion) do NOT emit recommendation.delivered", async () => {
    const domain = domainHandlers({ action: "SUGGEST" });
    server = buildWebhookServer({ handlers: domain.handlers });
    await createEndpoint(server, "no-deliv", ["recommendation.delivered"]);

    const decision = await injectJson(server.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest({ planId: "plan-8", idempotencyKey: DEC3_IDEM }),
      headers: whHeaders("wh-full", { "idempotency-key": DEC3_IDEM }),
    });
    const decisionId = (decision.body as { decisionId?: string }).decisionId;
    await injectJson(server.app, "POST", "/v1/outcomes", {
      payload: validOutcomeEvent({ decisionId, eventType: "completion", occurredAt: 5_500, idempotencyKey: OUT2_IDEM }),
      headers: whHeaders("wh-full", { "idempotency-key": OUT2_IDEM }),
    });
    // No impression → no recommendation.delivered event delivered.
    expect(deliveredEvents(server).filter((event) => event.type === "recommendation.delivered")).toHaveLength(0);
  });

  it("POST /v1/preferences emits preference.updated for every appended delta", async () => {
    const domain = domainHandlers();
    server = buildWebhookServer({ handlers: domain.handlers });
    await createEndpoint(server, "pref", ["preference.updated"]);

    const res = await injectJson(server.app, "POST", "/v1/preferences/events", {
      payload: validPreferenceDelta({ deltaId: "delta-77", resultingConfidence: 0.61 }),
      headers: whHeaders("wh-full", { "idempotency-key": freshWhIdem("pref") }),
    });
    expect(res.status).toBe(200);

    const events = deliveredEvents(server).filter((event) => event.type === "preference.updated");
    expect(events).toHaveLength(1);
    expect(events[0]?.data?.object).toMatchObject({
      deltaId: "delta-77",
      subject: { kind: "user", ref: "user-9" },
      dimension: "genre.scifi",
      op: "add",
      resultingConfidence: 0.61,
      modelId: "m-1",
      modelVersion: "3",
    });
  });

  it("the drift monitor (research runtime) publishes model.drift.detected through the same port", async () => {
    server = buildWebhookServer();
    await createEndpoint(server, "drift", ["model.drift.detected"]);
    const publisher: ReckonEventPublisher = server.system;

    await publisher.publish(
      modelDriftDetectedEvent(
        {
          modelId: "pref-embed-v3",
          modelVersion: "12",
          driftScore: 0.41,
          threshold: 0.35,
          window: "72h",
          metric: "calibration_error",
          evaluatedAt: 6_000,
        },
        { tenantId: "tenant-a" },
        { id: "evt_drift_1", created: server.clock.now() },
      ),
    );

    const events = deliveredEvents(server).filter((event) => event.type === "model.drift.detected");
    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe("evt_drift_1");
    expect(events[0]?.data?.object).toMatchObject({
      modelId: "pref-embed-v3",
      modelVersion: "12",
      driftScore: 0.41,
      threshold: 0.35,
      metric: "calibration_error",
      evaluatedAt: 6_000,
    });
  });

  it("emission with NO matching endpoints is a no-op delivery-wise (the route still succeeds)", async () => {
    const domain = domainHandlers();
    server = buildWebhookServer({ handlers: domain.handlers });
    // No endpoints registered at all.
    const decision = await injectJson(server.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest({ planId: "plan-9", idempotencyKey: DEC4_IDEM }),
      headers: whHeaders("wh-full", { "idempotency-key": DEC4_IDEM }),
    });
    expect(decision.status).toBe(200);
    expect(server.client.calls).toHaveLength(0);
    // …and the delivery log is empty (nothing was attempted).
    const log = await injectJson(server.app, "GET", "/v1/webhooks/deliveries", {
      headers: whHeaders("wh-full"),
    });
    expect((log.body as { deliveries?: unknown[] }).deliveries).toEqual([]);
  });

  it("a decision with NO schedule delta emits nothing (mappers never invent anchors)", async () => {
    const decisions = new Map<string, DecisionResult>();
    const handlers: PartialHandlerPorts = {
      decisionHandler: {
        decide: async (request) => {
          // HOLD decision — no selectedExperience, no scheduleDelta.
          const result = DecisionResultSchema.parse({
            decisionId: `dec-${request.idempotencyKey}`,
            requestId: request.requestId,
            tenant: request.tenant,
            action: "HOLD",
            policy: { policyId: "greedy-v1", version: "1" },
            at: request.at ?? 1_000,
            reasons: [{ code: "stub", message: "hold" }],
          });
          decisions.set(result.decisionId, result);
          return result;
        },
      },
      outcomeIngest: { ingest: async (event: OutcomeEvent) => event },
      preferenceIngest: { ingest: async (delta: PreferenceDelta) => delta },
    };
    server = buildWebhookServer({ handlers });
    await createEndpoint(server, "all");

    const decision = await injectJson(server.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest({ idempotencyKey: DEC5_IDEM }),
      headers: whHeaders("wh-full", { "idempotency-key": DEC5_IDEM }),
    });
    expect(decision.status).toBe(200);
    // Only the endpoint's own creation event was delivered — the HOLD
    // decision emitted nothing.
    const types = deliveredEvents(server).map((event) => event.type);
    expect(types.filter((type) => type === "schedule.executed")).toHaveLength(0);
  });
});
