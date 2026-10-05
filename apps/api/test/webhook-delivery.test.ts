import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { verifyReckonSignature } from "@reckon/contracts";
import { createReckonEvent, type ReckonEventPublisher } from "@reckon/events";
import { injectJson } from "./fixtures.js";
import {
  buildWebhookServer,
  freshWhIdem,
  whHeaders,
  RecordingWebhookClient,
  type WebhookTestServer,
} from "./webhook-helpers.js";

/**
 * S2-002 — the DELIVERY ENGINE through the real composition: signed
 * payloads (verified with the issued secret + the reference verifier),
 * event-type filters, deterministic retry (injected clock, 3 attempts,
 * exponential backoff, 3-day window bound), terminal failures recorded
 * in the delivery log, and tenant isolation of the log.
 */

async function close(server: { app: FastifyInstance }): Promise<void> {
  await server.app.close();
}

interface DeliveryRow {
  id?: string;
  eventId?: string;
  endpointId?: string;
  attempts?: number;
  status?: string;
  responseCode?: number | null;
  latencyMs?: number | null;
  error?: string | null;
  replayed?: boolean;
}

async function listDeliveries(
  server: WebhookTestServer,
  key = "wh-full",
  query = "",
): Promise<{ status: number; rows: DeliveryRow[]; body: unknown }> {
  const res = await injectJson(server.app, "GET", `/v1/webhooks/deliveries${query}`, {
    headers: whHeaders(key),
  });
  return { status: res.status, rows: ((res.body as { deliveries?: DeliveryRow[] }).deliveries ?? []) as DeliveryRow[], body: res.body };
}

/** Create an endpoint via the route; returns (id, secret, url). */
async function registerEndpoint(
  server: WebhookTestServer,
  suffix: string,
  eventTypes?: string[],
  key = "wh-full",
): Promise<{ id: string; secret: string; url: string }> {
  const res = await injectJson(server.app, "POST", "/v1/webhooks/endpoints", {
    payload: {
      url: `https://hooks.example.com/${suffix}`,
      ...(eventTypes !== undefined ? { eventTypes } : {}),
    },
    headers: whHeaders(key, { "idempotency-key": freshWhIdem(`ep-${suffix}`) }),
  });
  const body = res.body as { id?: string; secret?: string };
  expect(res.status).toBe(200);
  return { id: body.id ?? "", secret: body.secret ?? "", url: `https://hooks.example.com/${suffix}` };
}

function preferenceEvent(id: string): ReturnType<typeof createReckonEvent> {
  return createReckonEvent({
    id,
    type: "preference.updated",
    tenant: { tenantId: "tenant-a" },
    created: 2_000_000,
    data: {
      deltaId: "delta-1",
      subject: { kind: "user", ref: "user-9" },
      dimension: "genre.scifi",
      op: "add",
      modelId: "m-1",
      modelVersion: "3",
    },
  });
}

describe("webhook delivery: signatures end-to-end", () => {
  let server: WebhookTestServer;
  afterEach(async () => {
    if (server !== undefined) await close(server);
  });

  it("the delivered POST carries a verifiable Reckon-Signature over the exact raw bytes", async () => {
    server = buildWebhookServer();
    const endpoint = await registerEndpoint(server, "signed");
    // The all-events endpoint received its own creation event inline.
    expect(server.client.calls.length).toBeGreaterThanOrEqual(1);
    const call = server.client.calls[0]!;
    expect(call.url).toBe(endpoint.url);
    expect(call.headers["content-type"]).toBe("application/json");
    const header = call.headers["reckon-signature"];
    expect(typeof header).toBe("string");
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    // THE lockstep assertion: the reference verifier accepts the
    // delivery with the secret issued at creation, over the raw body
    // (nowMs = the engine's injected clock — the signature's `t` comes
    // from that clock, so the 300s tolerance is evaluated there).
    expect(verifyReckonSignature(call.rawBody, header ?? "", endpoint.secret, 300, server.clock.now())).toBe(true);
    // The raw body is the canonical JSON of a valid thin event.
    const event = JSON.parse(call.rawBody) as { id?: string; object?: string; type?: string };
    expect(event.object).toBe("event");
    expect(event.type).toBe("webhook.endpoint.created");
    // Tampering the body must break the signature.
    expect(verifyReckonSignature(`${call.rawBody}x`, header ?? "", endpoint.secret, 300, server.clock.now())).toBe(false);
    expect(verifyReckonSignature(call.rawBody, header ?? "", `whsec_${"w".repeat(32)}`, 300, server.clock.now())).toBe(false);
  });

  it("event-type filters route each event only to matching endpoints (empty filter = all)", async () => {
    server = buildWebhookServer();
    const all = await registerEndpoint(server, "all");
    const prefOnly = await registerEndpoint(server, "pref-only", ["preference.updated"]);
    const publisher: ReckonEventPublisher = server.system;

    await publisher.publish(preferenceEvent("evt_pref_1"));
    // Only the all-events + preference-filtered endpoints receive it.
    const urls = server.client.calls.map((call) => call.url);
    expect(urls).toContain(all.url);
    expect(urls).toContain(prefOnly.url);

    const callsBefore = server.client.calls.length;
    await publisher.publish(
      createReckonEvent({
        id: "evt_sched_1",
        type: "schedule.executed",
        tenant: { tenantId: "tenant-a" },
        created: 2_000_100,
        data: {
          planId: "plan-1",
          decisionId: "dec-1",
          action: "QUEUE",
          enqueued: ["exp-1"],
          dequeued: [],
          executedAt: 2_000_090,
        },
      }),
    );
    const newCalls = server.client.calls.slice(callsBefore);
    expect(newCalls.map((call) => call.url)).toEqual([all.url]);
    // …and the payload is the schedule.executed thin event.
    const delivered = JSON.parse(newCalls[0]?.rawBody ?? "{}") as { type?: string; data?: { object?: { planId?: string } } };
    expect(delivered.type).toBe("schedule.executed");
    expect(delivered.data?.object?.planId).toBe("plan-1");
  });

  it("duplicate publish of the same event id is deduped at the seam (no second fan-out)", async () => {
    server = buildWebhookServer();
    const endpoint = await registerEndpoint(server, "dedupe");
    const callsAfterCreate = server.client.calls.length;
    const publisher: ReckonEventPublisher = server.system;
    await publisher.publish(preferenceEvent("evt_dupe_1"));
    const callsAfterFirst = server.client.calls.length;
    expect(callsAfterFirst).toBe(callsAfterCreate + 1);
    await publisher.publish(preferenceEvent("evt_dupe_1"));
    expect(server.client.calls.length).toBe(callsAfterFirst);
    // But the event remains retrievable (retained for replay).
    const res = await injectJson(server.app, "GET", "/v1/webhooks/events/evt_dupe_1", {
      headers: whHeaders("wh-full"),
    });
    expect(res.status).toBe(200);
    expect((res.body as { id?: string }).id).toBe("evt_dupe_1");
  });
});

describe("webhook delivery: deterministic retry policy", () => {
  let server: WebhookTestServer;
  afterEach(async () => {
    if (server !== undefined) await close(server);
  });

  it("retries with exponential backoff over the injected clock and succeeds on attempt 3", async () => {
    let failures = 0;
    server = buildWebhookServer({
      client: new RecordingWebhookClient(() => {
        failures += 1;
        return failures < 3 ? { statusCode: 500, latencyMs: 2 } : { statusCode: 200, latencyMs: 3 };
      }),
    });
    const endpoint = await registerEndpoint(server, "retry-ok");
    expect(failures).toBe(1); // attempt 1 inline (http 500)

    // Backoff schedule: attempt 2 due at +100ms, attempt 3 at +200ms.
    server.clock.advance(50);
    await server.system.pump();
    expect(failures).toBe(1); // not due yet

    server.clock.advance(50); // now at +100ms
    await server.system.pump();
    expect(failures).toBe(2); // attempt 2 (http 500), next at +200ms

    server.clock.advance(100);
    await server.system.pump();
    expect(failures).toBe(2); // still not due

    server.clock.advance(100); // +200ms since attempt 2
    const pending = await server.system.flush();
    expect(failures).toBe(3); // attempt 3 (2xx)
    expect(pending).toBe(0);

    const log = await listDeliveries(server);
    const row = log.rows.find((r) => r.endpointId === endpoint.id && r.eventId?.startsWith("evt_"));
    expect(row?.status).toBe("succeeded");
    expect(row?.attempts).toBe(3);
    expect(row?.responseCode).toBe(200);
    expect(row?.latencyMs).toBe(3);
    expect(row?.error).toBeNull();
    expect(row?.replayed).toBe(false);
  });

  it("terminal failure after max attempts: recorded, never dropped (http status)", async () => {
    server = buildWebhookServer({
      client: new RecordingWebhookClient(() => ({ statusCode: 500, latencyMs: 2 })),
    });
    const endpoint = await registerEndpoint(server, "retry-fail");
    server.clock.advance(100);
    await server.system.pump();
    server.clock.advance(200);
    await server.system.pump();
    const pending = await server.system.flush();
    expect(pending).toBe(0);

    const log = await listDeliveries(server);
    const row = log.rows.find((r) => r.endpointId === endpoint.id);
    expect(row?.status).toBe("failed");
    expect(row?.attempts).toBe(3);
    expect(row?.responseCode).toBe(500);
    expect(row?.error).toBe("http 500");
  });

  it("transport errors (thrown) leave responseCode null and record the message", async () => {
    server = buildWebhookServer({
      client: new RecordingWebhookClient(() => {
        throw new Error("ECONNREFUSED hooks.example.com");
      }),
    });
    const endpoint = await registerEndpoint(server, "retry-throw");
    server.clock.advance(100);
    await server.system.pump();
    server.clock.advance(200);
    await server.system.pump();
    await server.system.flush();

    const log = await listDeliveries(server);
    const row = log.rows.find((r) => r.endpointId === endpoint.id);
    expect(row?.status).toBe("failed");
    expect(row?.attempts).toBe(3);
    expect(row?.responseCode).toBeNull();
    expect(row?.error).toContain("ECONNREFUSED");
  });

  it("a delivery still pending after the retry window is terminally failed (documented 3-day bound)", async () => {
    server = buildWebhookServer({
      client: new RecordingWebhookClient(() => ({ statusCode: 500, latencyMs: 1 })),
      retry: { maxAttempts: 50, baseMs: 10, factor: 2, capMs: 30_000, windowMs: 1_000 },
    });
    const endpoint = await registerEndpoint(server, "window");
    // Leave it pending: attempt 1 failed, retry scheduled, but the
    // window (1s) elapses before the retry is due.
    server.clock.advance(2_000);
    const pending = await server.system.pump();
    expect(pending).toBe(0);

    const log = await listDeliveries(server);
    const row = log.rows.find((r) => r.endpointId === endpoint.id);
    expect(row?.status).toBe("failed");
    expect(row?.attempts).toBe(1); // the window guard fired before any retry
    expect(row?.error).toContain("retry window exhausted");
  });

  it("deleting the endpoint mid-retry marks the delivery failed (no silent drop)", async () => {
    server = buildWebhookServer({
      client: new RecordingWebhookClient(() => ({ statusCode: 500, latencyMs: 1 })),
    });
    const endpoint = await registerEndpoint(server, "mid-delete");
    const del = await injectJson(server.app, "DELETE", `/v1/webhooks/endpoints/${endpoint.id}`, {
      headers: { authorization: "Bearer wh-full" },
    });
    expect(del.status).toBe(200);
    server.clock.advance(100);
    await server.system.pump();

    const log = await listDeliveries(server);
    const row = log.rows.find((r) => r.endpointId === endpoint.id);
    expect(row?.status).toBe("failed");
    expect(row?.error).toContain("no longer exists");
  });
});

describe("webhook delivery: the delivery log surface", () => {
  let server: WebhookTestServer;
  afterEach(async () => {
    if (server !== undefined) await close(server);
  });

  it("rows are tenant-scoped: tenant-b's key sees only tenant-b deliveries", async () => {
    server = buildWebhookServer();
    await registerEndpoint(server, "a-ep");
    await registerEndpoint(server, "b-ep", undefined, "wh-only");
    const logA = await listDeliveries(server, "wh-full");
    for (const row of logA.rows) expect(row.endpointId).not.toBeUndefined();
    const logB = await listDeliveries(server, "wh-only");
    expect(logB.rows.length).toBeGreaterThan(0);
    const bEndpointIds = logB.rows.map((row) => row.endpointId);
    const aEndpointIds = logA.rows.map((row) => row.endpointId);
    for (const id of bEndpointIds) expect(aEndpointIds).not.toContain(id);
  });

  it("event retrieval (GET /v1/webhooks/events/:id) answers the stored thin event", async () => {
    server = buildWebhookServer();
    await registerEndpoint(server, "get-event");
    const publisher: ReckonEventPublisher = server.system;
    await publisher.publish(preferenceEvent("evt_get_1"));
    const res = await injectJson(server.app, "GET", "/v1/webhooks/events/evt_get_1", {
      headers: whHeaders("wh-full"),
    });
    expect(res.status).toBe(200);
    const event = res.body as { id?: string; object?: string; type?: string; data?: { object?: { deltaId?: string } } };
    expect(event.id).toBe("evt_get_1");
    expect(event.object).toBe("event");
    expect(event.type).toBe("preference.updated");
    expect(event.data?.object?.deltaId).toBe("delta-1");

    const unknown = await injectJson(server.app, "GET", "/v1/webhooks/events/evt_nope", {
      headers: whHeaders("wh-full"),
    });
    expect(unknown.status).toBe(404);
    const cross = await injectJson(server.app, "GET", "/v1/webhooks/events/evt_get_1", {
      headers: whHeaders("wh-only"),
    });
    expect(cross.status).toBe(404); // tenant-scoped: invisible cross-tenant
  });
});
