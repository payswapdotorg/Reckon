import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { WEBHOOK_EVENT_RETENTION_MS } from "@reckon/contracts";
import { createReckonEvent, type ReckonEventPublisher } from "@reckon/events";
import { injectJson, expectErrorEnvelope } from "./fixtures.js";
import {
  buildWebhookServer,
  freshWhIdem,
  whHeaders,
  type WebhookTestServer,
} from "./webhook-helpers.js";

/**
 * S2-002 — REPLAY (POST /v1/webhooks/events/{id}/replay): the stored
 * event is re-delivered with the SAME event id (at-least-once; receivers
 * dedupe), each replay creates its own delivery-log entries marked
 * `replayed: true`, the route itself is idempotent (Idempotency-Key),
 * unknown/cross-tenant events answer typed 404, and events older than
 * the documented 30-day retention are no longer replayable.
 */

async function close(server: { app: FastifyInstance }): Promise<void> {
  await server.app.close();
}

interface EndpointBody {
  id?: string;
  secret?: string;
}

interface DeliveryRow {
  id?: string;
  eventId?: string;
  endpointId?: string;
  attempts?: number;
  status?: string;
  replayed?: boolean;
}

async function createEndpoint(server: WebhookTestServer, suffix: string): Promise<EndpointBody> {
  const res = await injectJson(server.app, "POST", "/v1/webhooks/endpoints", {
    payload: { url: `https://hooks.example.com/${suffix}` },
    headers: whHeaders("wh-full", { "idempotency-key": freshWhIdem(`rp-${suffix}`) }),
  });
  expect(res.status).toBe(200);
  return res.body as EndpointBody;
}

function preferenceEvent(id: string): ReturnType<typeof createReckonEvent> {
  return createReckonEvent({
    id,
    type: "preference.updated",
    tenant: { tenantId: "tenant-a" },
    created: 1_500_000,
    data: {
      deltaId: "delta-9",
      subject: { kind: "user", ref: "user-9" },
      dimension: "genre.scifi",
      op: "add",
      modelId: "m-1",
      modelVersion: "3",
    },
  });
}

async function replay(
  server: WebhookTestServer,
  eventId: string,
  key = "wh-full",
  idempotencyKey = freshWhIdem("replay"),
): Promise<{ status: number; body: unknown; headers: Record<string, unknown> }> {
  return injectJson(server.app, "POST", `/v1/webhooks/events/${eventId}/replay`, {
    payload: {},
    headers: whHeaders(key, { "idempotency-key": idempotencyKey }),
  });
}

describe("webhook replay", () => {
  let server: WebhookTestServer;
  afterEach(async () => {
    if (server !== undefined) await close(server);
  });

  it("re-delivers the stored event with the SAME event id and marks the deliveries replayed", async () => {
    server = buildWebhookServer();
    const endpoint = await createEndpoint(server, "replay-target");
    const publisher: ReckonEventPublisher = server.system;
    await publisher.publish(preferenceEvent("evt_replay_1"));
    // 1 original delivery so far (the endpoint's creation event does not
    // match preference.updated; the published event delivered once).
    const original = server.client.calls.filter((call) =>
      (JSON.parse(call.rawBody) as { id?: string }).id === "evt_replay_1",
    );
    expect(original).toHaveLength(1);
    const originalBody = original[0]!.rawBody;

    const res = await replay(server, "evt_replay_1");
    expect(res.status).toBe(200);
    const body = res.body as { event?: { id?: string }; deliveries?: DeliveryRow[] };
    expect(body.event?.id).toBe("evt_replay_1");
    expect(body.deliveries).toHaveLength(1);
    expect(body.deliveries?.[0]?.endpointId).toBe(endpoint.id);
    expect(body.deliveries?.[0]?.replayed).toBe(true);
    expect(body.deliveries?.[0]?.status).toBe("succeeded");
    expect(body.deliveries?.[0]?.attempts).toBe(1);

    // The re-delivered POST carries the IDENTICAL raw body (same event
    // id — receivers dedupe on it, per the documented contract).
    const replayed = server.client.calls.filter(
      (call) => call.rawBody === originalBody,
    );
    expect(replayed).toHaveLength(2);

    // The delivery log now shows both the original and the replay row.
    const log = await injectJson(server.app, "GET", "/v1/webhooks/deliveries", {
      headers: whHeaders("wh-full"),
    });
    const rows = ((log.body as { deliveries?: DeliveryRow[] }).deliveries ?? []).filter(
      (row) => row.eventId === "evt_replay_1",
    );
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.replayed === true)).toHaveLength(1);
    expect(rows.filter((row) => row.replayed === false)).toHaveLength(1);
  });

  it("the route is idempotent: same Idempotency-Key replays the stored response without re-delivering", async () => {
    server = buildWebhookServer();
    await createEndpoint(server, "idem-replay");
    const publisher: ReckonEventPublisher = server.system;
    await publisher.publish(preferenceEvent("evt_replay_2"));

    const idem = freshWhIdem("replay-idem");
    const first = await replay(server, "evt_replay_2", "wh-full", idem);
    expect(first.status).toBe(200);
    const deliveriesAfterFirst = server.client.calls.length;

    const second = await replay(server, "evt_replay_2", "wh-full", idem);
    expect(second.status).toBe(200);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(second.body).toEqual(first.body);
    expect(server.client.calls.length).toBe(deliveriesAfterFirst); // no double delivery
  });

  it("unknown and cross-tenant events answer typed 404; missing Idempotency-Key answers typed 400", async () => {
    server = buildWebhookServer();
    await createEndpoint(server, "404s");
    const unknown = await replay(server, "evt_does_not_exist");
    expectErrorEnvelope(unknown.status, unknown.body, "NOT_FOUND");

    const publisher: ReckonEventPublisher = server.system;
    await publisher.publish(preferenceEvent("evt_replay_3"));
    const cross = await replay(server, "evt_replay_3", "wh-only");
    expectErrorEnvelope(cross.status, cross.body, "NOT_FOUND");

    const noKey = await injectJson(server.app, "POST", "/v1/webhooks/events/evt_replay_3/replay", {
      payload: {},
      headers: whHeaders("wh-full"),
    });
    expectErrorEnvelope(noKey.status, noKey.body, "VALIDATION_ERROR");
    expect((noKey.body as { error?: { param?: string } }).error?.param).toBe("idempotency-key");
  });

  it("events beyond the 30-day retention are swept: retrieval and replay answer 404", async () => {
    server = buildWebhookServer();
    await createEndpoint(server, "retention");
    const publisher: ReckonEventPublisher = server.system;
    // `created` follows the injected clock (the composition law); after
    // 31 days the sweep drops the event from replay retention.
    await publisher.publish(
      createReckonEvent({
        id: "evt_old_1",
        type: "preference.updated",
        tenant: { tenantId: "tenant-a" },
        created: server.clock.now(),
        data: {
          deltaId: "delta-9",
          subject: { kind: "user", ref: "user-9" },
          dimension: "genre.scifi",
          op: "add",
          modelId: "m-1",
          modelVersion: "3",
        },
      }),
    );
    // Advance 31 days: the sweep (run on publish/pump) drops the event.
    server.clock.advance(WEBHOOK_EVENT_RETENTION_MS + 60_000);
    await server.system.pump();

    const got = await injectJson(server.app, "GET", "/v1/webhooks/events/evt_old_1", {
      headers: whHeaders("wh-full"),
    });
    expect(got.status).toBe(404);
    const replayed = await replay(server, "evt_old_1");
    expectErrorEnvelope(replayed.status, replayed.body, "NOT_FOUND");
  });

  it("replay delivers to the CURRENT matching endpoints (filters applied at replay time)", async () => {
    server = buildWebhookServer();
    const all = await createEndpoint(server, "replay-all");
    const filtered = await injectJson(server.app, "POST", "/v1/webhooks/endpoints", {
      payload: { url: "https://hooks.example.com/replay-filtered", eventTypes: ["preference.updated"] },
      headers: whHeaders("wh-full", { "idempotency-key": freshWhIdem("rp-filtered") }),
    });
    const filteredId = (filtered.body as EndpointBody).id;
    expect(filtered.status).toBe(200);

    const publisher: ReckonEventPublisher = server.system;
    await publisher.publish(preferenceEvent("evt_replay_4"));

    const res = await replay(server, "evt_replay_4");
    expect(res.status).toBe(200);
    const deliveries = (res.body as { deliveries?: DeliveryRow[] }).deliveries ?? [];
    expect(deliveries.map((row) => row.endpointId).sort()).toEqual([all.id, filteredId].sort());

    // Now tighten: delete the filtered endpoint and replay again — only
    // the all-events endpoint receives this replay.
    await injectJson(server.app, "DELETE", `/v1/webhooks/endpoints/${filteredId}`, {
      headers: { authorization: "Bearer wh-full" },
    });
    const res2 = await replay(server, "evt_replay_4");
    const deliveries2 = (res2.body as { deliveries?: DeliveryRow[] }).deliveries ?? [];
    expect(deliveries2.map((row) => row.endpointId)).toEqual([all.id]);
  });
});
