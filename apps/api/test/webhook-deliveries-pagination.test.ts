import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createReckonEvent, type ReckonEventPublisher } from "@reckon/events";
import { injectJson, expectErrorEnvelope } from "./fixtures.js";
import {
  buildWebhookServer,
  freshWhIdem,
  whHeaders,
  type WebhookTestServer,
} from "./webhook-helpers.js";

/**
 * S2-002 — DELIVERY-LOG PAGINATION (reusing the S2-001 cursor engine):
 * limit bounds with typed 400s, has_more/next_cursor exactness, the
 * starting_after anchor walk (pages never overlap), unknown-cursor
 * rejection, and the endpoint_id / event_id filters.
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
}

/** Publish N preference events (each delivered to the one endpoint) → N delivery rows, newest first. */
async function seedDeliveries(server: WebhookTestServer, count: number): Promise<string[]> {
  const publisher: ReckonEventPublisher = server.system;
  const eventIds: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const eventId = `evt_page_${index + 1}`;
    eventIds.push(eventId);
    await publisher.publish(
      createReckonEvent({
        id: eventId,
        type: "preference.updated",
        tenant: { tenantId: "tenant-a" },
        created: server.clock.now(),
        data: {
          deltaId: `delta-${index + 1}`,
          subject: { kind: "user", ref: "user-9" },
          dimension: "genre.scifi",
          op: "add",
          modelId: "m-1",
          modelVersion: "3",
        },
      }),
    );
  }
  return eventIds;
}

async function deliveries(
  server: WebhookTestServer,
  query: string,
  key = "wh-full",
): Promise<{ status: number; rows: DeliveryRow[]; meta: { has_more?: boolean; next_cursor?: string | null }; body: unknown }> {
  const res = await injectJson(server.app, "GET", `/v1/webhooks/deliveries${query}`, {
    headers: whHeaders(key),
  });
  const body = res.body as { deliveries?: DeliveryRow[]; has_more?: boolean; next_cursor?: string | null };
  return { status: res.status, rows: (body.deliveries ?? []) as DeliveryRow[], meta: body, body: res.body };
}

describe("webhook delivery log: cursor pagination", () => {
  let server: WebhookTestServer;
  afterEach(async () => {
    if (server !== undefined) await close(server);
  });

  it("pages are exact, newest-first, non-overlapping; the cursor walk covers everything once", async () => {
    server = buildWebhookServer();
    await injectJson(server.app, "POST", "/v1/webhooks/endpoints", {
      payload: { url: "https://hooks.example.com/paged", eventTypes: ["preference.updated"] },
      headers: whHeaders("wh-full", { "idempotency-key": freshWhIdem("paged") }),
    });
    await seedDeliveries(server, 7);

    // First page: limit 3 of 7.
    const page1 = await deliveries(server, "?limit=3");
    expect(page1.status).toBe(200);
    expect(page1.rows).toHaveLength(3);
    expect(page1.meta.has_more).toBe(true);
    expect(page1.meta.next_cursor).toBe(page1.rows[2]?.id);

    // Follow the cursor: page 2.
    const page2 = await deliveries(server, `?limit=3&starting_after=${page1.meta.next_cursor}`);
    expect(page2.rows).toHaveLength(3);
    expect(page2.meta.has_more).toBe(true);
    // Newest-first: every id on page 2 is NEWER than page 1's (lower seq).
    expect(page2.rows.map((r) => r.eventId)).toEqual(["evt_page_4", "evt_page_3", "evt_page_2"]);

    // Final page: 1 row, exhausted.
    const page3 = await deliveries(server, `?limit=3&starting_after=${page2.meta.next_cursor}`);
    expect(page3.rows.map((r) => r.eventId)).toEqual(["evt_page_1"]);
    expect(page3.meta.has_more).toBe(false);
    expect(page3.meta.next_cursor).toBe(page3.rows[0]?.id);

    // The walk covered all 7 rows exactly once.
    const all = [...page1.rows, ...page2.rows, ...page3.rows];
    expect(all).toHaveLength(7);
    expect(new Set(all.map((r) => r.id)).size).toBe(7);
  });

  it("limit bounds are typed 400s naming the param; default limit is 20", async () => {
    server = buildWebhookServer();
    await injectJson(server.app, "POST", "/v1/webhooks/endpoints", {
      payload: { url: "https://hooks.example.com/bounds", eventTypes: ["preference.updated"] },
      headers: whHeaders("wh-full", { "idempotency-key": freshWhIdem("bounds") }),
    });
    await seedDeliveries(server, 2);

    for (const bad of ["?limit=0", "?limit=101", "?limit=-1", "?limit=abc", "?limit=1.5"]) {
      const res = await deliveries(server, bad);
      expectErrorEnvelope(res.status, res.body, "VALIDATION_ERROR", "invalid_request_error");
      expect((res.body as { error?: { param?: string } }).error?.param).toBe("limit");
    }
    // Default: no limit → up to 20 rows, no overlap issues.
    const whole = await deliveries(server, "");
    expect(whole.status).toBe(200);
    expect(whole.rows).toHaveLength(2);
    expect(whole.meta.has_more).toBe(false);
  });

  it("an unresolvable starting_after cursor is a typed 400 (never a silent empty page)", async () => {
    server = buildWebhookServer();
    await injectJson(server.app, "POST", "/v1/webhooks/endpoints", {
      payload: { url: "https://hooks.example.com/cursor", eventTypes: ["preference.updated"] },
      headers: whHeaders("wh-full", { "idempotency-key": freshWhIdem("cursor") }),
    });
    await seedDeliveries(server, 2);

    const unknown = await deliveries(server, "?starting_after=wd_not_in_this_list");
    expectErrorEnvelope(unknown.status, unknown.body, "VALIDATION_ERROR");
    expect((unknown.body as { error?: { param?: string } }).error?.param).toBe("starting_after");

    // A well-formed-but-foreign cursor (from another tenant) also fails.
    const foreign = await deliveries(server, "?starting_after=wd_from_tenant_b");
    expectErrorEnvelope(foreign.status, foreign.body, "VALIDATION_ERROR");
  });

  it("endpoint_id and event_id filters narrow the log; malformed ids are typed 400s", async () => {
    server = buildWebhookServer();
    const first = await injectJson(server.app, "POST", "/v1/webhooks/endpoints", {
      payload: { url: "https://hooks.example.com/f-one", eventTypes: ["preference.updated"] },
      headers: whHeaders("wh-full", { "idempotency-key": freshWhIdem("f-one") }),
    });
    const second = await injectJson(server.app, "POST", "/v1/webhooks/endpoints", {
      payload: { url: "https://hooks.example.com/f-two", eventTypes: ["preference.updated"] },
      headers: whHeaders("wh-full", { "idempotency-key": freshWhIdem("f-two") }),
    });
    const firstId = (first.body as { id?: string }).id;
    const secondId = (second.body as { id?: string }).id;
    await seedDeliveries(server, 3); // each event → deliveries to BOTH endpoints

    const byEndpoint = await deliveries(server, `?endpoint_id=${firstId}`);
    expect(byEndpoint.rows).toHaveLength(3);
    for (const row of byEndpoint.rows) expect(row.endpointId).toBe(firstId);

    const byEvent = await deliveries(server, `?event_id=evt_page_2`);
    expect(byEvent.rows.map((r) => r.eventId)).toEqual(["evt_page_2", "evt_page_2"]);
    expect(new Set(byEvent.rows.map((r) => r.endpointId))).toEqual(new Set([firstId, secondId]));

    const both = await deliveries(server, `?endpoint_id=${secondId}&event_id=evt_page_3`);
    expect(both.rows).toHaveLength(1);
    expect(both.rows[0]?.endpointId).toBe(secondId);

    const badFilter = await deliveries(server, "?endpoint_id=!!not-an-id!!");
    expectErrorEnvelope(badFilter.status, badFilter.body, "VALIDATION_ERROR");
    expect((badFilter.body as { error?: { param?: string } }).error?.param).toBe("endpoint_id");
    const badEventFilter = await deliveries(server, "?event_id=!!");
    expectErrorEnvelope(badEventFilter.status, badEventFilter.body, "VALIDATION_ERROR");
    expect((badEventFilter.body as { error?: { param?: string } }).error?.param).toBe("event_id");
  });

  it("the log is tenant-scoped (tenant-b sees none of tenant-a's rows)", async () => {
    server = buildWebhookServer();
    await injectJson(server.app, "POST", "/v1/webhooks/endpoints", {
      payload: { url: "https://hooks.example.com/ta", eventTypes: ["preference.updated"] },
      headers: whHeaders("wh-full", { "idempotency-key": freshWhIdem("ta") }),
    });
    await seedDeliveries(server, 3);
    const tenantB = await deliveries(server, "", "wh-only");
    expect(tenantB.status).toBe(200);
    expect(tenantB.rows).toEqual([]);
    expect(tenantB.meta.has_more).toBe(false);
    expect(tenantB.meta.next_cursor).toBeNull();
  });
});
