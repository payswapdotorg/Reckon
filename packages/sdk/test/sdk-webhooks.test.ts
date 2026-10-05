import { describe, it, expect } from "vitest";
import { createReckonClient, verifyWebhook, verifyReckonSignature } from "../src/index.js";
import { buildHarness, SDK_TEST_KEY, TENANT_A, type SdkTestHarness } from "./harness.js";
import { WEBHOOK_SIGNATURE_HEADER } from "@reckon/contracts";
import type { ReckonClient } from "../src/index.js";

/**
 * S2-004 — the /v1/webhooks route family through the typed SDK, against
 * the REAL in-process API with the REAL in-memory webhook system mounted
 * through the real composition path (config.webhooks): endpoint CRUD,
 * the one-time secret, cursor pagination + auto-iterators, event
 * retrieval + replay, the delivery log, and SIGNATURE VERIFICATION of
 * the exact bytes the engine signed (accept/reject matrix). Evidence
 * class: controlled-local.
 */

function webhookHarness(): SdkTestHarness {
  return buildHarness({ webhooks: true });
}

function webhookClient(harness: SdkTestHarness, apiKey: string = SDK_TEST_KEY): ReckonClient {
  return createReckonClient({ baseUrl: "http://reckon.test", apiKey, fetchImpl: harness.fetch });
}

describe("S2-004 SDK — webhook endpoint CRUD", () => {
  it("creates an endpoint and returns the ONE-TIME whsec_ signing secret", async () => {
    const harness = webhookHarness();
    const client = webhookClient(harness);
    const created = await client.webhookEndpoints.create({ url: "https://hooks.example.com/accept" });
    expect(created.object).toBe("webhook_endpoint");
    expect(created.url).toBe("https://hooks.example.com/accept");
    expect(created.status).toBe("enabled");
    expect(created.tenant).toEqual({ tenantId: TENANT_A });
    // The signing secret is issued exactly once, at creation.
    expect(created.secret).toMatch(/^whsec_[A-Za-z0-9]{24,}$/);
    // Creating an endpoint emits the delivery-lifecycle event — the
    // endpoint itself (empty filter = every event type) received it.
    expect(harness.webhookClient?.calls.length).toBe(1);
    expect(harness.webhookClient?.calls[0]?.url).toBe("https://hooks.example.com/accept");
    await harness.app.close();
  });

  it("gets, lists and deletes endpoints; unknown ids are typed 404s", async () => {
    const harness = webhookHarness();
    const client = webhookClient(harness);
    const created = await client.webhookEndpoints.create({ url: "https://hooks.example.com/crud" });

    const fetched = await client.webhookEndpoints.get(created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.url).toBe(created.url);

    // The view (GET) never carries the secret — only creation does.
    expect("secret" in fetched).toBe(false);

    const removed = await client.webhookEndpoints.delete(created.id);
    expect(removed.id).toBe(created.id);

    await expect(client.webhookEndpoints.get(created.id)).rejects.toMatchObject({
      name: "ReckonNotFoundError",
      code: "NOT_FOUND",
      statusCode: 404,
    });
    await expect(client.webhookEndpoints.delete(created.id)).rejects.toMatchObject({
      name: "ReckonNotFoundError",
      code: "NOT_FOUND",
      statusCode: 404,
    });
    await harness.app.close();
  });

  it("validates the endpoint input client-side before anything is sent (SDK_REQUEST_INVALID)", async () => {
    const harness = webhookHarness();
    const client = webhookClient(harness);
    // http:// (not https://) fails the frozen WebhookUrlSchema before the wire.
    await expect(
      client.webhookEndpoints.create({ url: "http://insecure.example.com/nope" }),
    ).rejects.toMatchObject({ name: "ReckonValidationError", code: "SDK_REQUEST_INVALID", statusCode: undefined });
    expect(harness.webhookClient?.calls.length).toBe(0);
    await harness.app.close();
  });

  it("keys without the webhooks scope get 403 INSUFFICIENT_SCOPE", async () => {
    const harness = webhookHarness();
    // sdk-beta carries only the decisions scope.
    const client = createReckonClient({ baseUrl: "http://reckon.test", apiKey: "sdk-beta", fetchImpl: harness.fetch });
    await expect(client.webhookEndpoints.listPage()).rejects.toMatchObject({
      name: "ReckonScopeError",
      code: "INSUFFICIENT_SCOPE",
      statusCode: 403,
    });
    await harness.app.close();
  });

  it("replays the create response for a repeated explicit Idempotency-Key", async () => {
    const harness = webhookHarness();
    const client = webhookClient(harness);
    const body = { url: "https://hooks.example.com/idem" };
    const first = await client.webhookEndpoints.create(body, { idempotencyKey: "wh-idem-1" });
    const second = await client.webhookEndpoints.create(body, { idempotencyKey: "wh-idem-1" });
    expect(second.id).toBe(first.id);
    // One endpoint + one lifecycle event → exactly one delivered POST.
    expect(harness.webhookClient?.calls.length).toBe(1);
    await harness.app.close();
  });
});

describe("S2-004 SDK — webhook cursor pagination + auto-iterators", () => {
  it("paginates endpoints newest-first with exact has_more/next_cursor chaining", async () => {
    const harness = webhookHarness();
    const client = webhookClient(harness);
    const a = await client.webhookEndpoints.create({ url: "https://hooks.example.com/a" });
    const b = await client.webhookEndpoints.create({ url: "https://hooks.example.com/b" });
    const c = await client.webhookEndpoints.create({ url: "https://hooks.example.com/c" });

    const page1 = await client.webhookEndpoints.listPage({ limit: 2 });
    expect(page1.endpoints.map((e) => e.id)).toEqual([c.id, b.id]);
    expect(page1.has_more).toBe(true);
    expect(page1.next_cursor).toBe(b.id);

    const page2 = await client.webhookEndpoints.listPage({ limit: 2, startingAfter: page1.next_cursor ?? undefined });
    expect(page2.endpoints.map((e) => e.id)).toEqual([a.id]);
    expect(page2.has_more).toBe(false);

    // A cursor that cannot resolve is a typed 400 naming the param.
    await expect(
      client.webhookEndpoints.listPage({ startingAfter: "we_unknown_cursor" }),
    ).rejects.toMatchObject({ name: "ReckonValidationError", code: "VALIDATION_ERROR", statusCode: 400, param: "starting_after" });
    await harness.app.close();
  });

  it("auto-paginating list() iterates every endpoint across pages", async () => {
    const harness = webhookHarness();
    const client = webhookClient(harness);
    const created = await Promise.all(
      ["a", "b", "c", "d"].map((suffix) => client.webhookEndpoints.create({ url: `https://hooks.example.com/it-${suffix}` })),
    );
    const seen: string[] = [];
    for await (const endpoint of client.webhookEndpoints.list({ limit: 3 })) {
      seen.push(endpoint.id);
    }
    expect(seen).toEqual([...created].reverse().map((e) => e.id));
    await harness.app.close();
  });

  it("paginates the delivery log and honors the endpoint_id filter", async () => {
    const harness = webhookHarness();
    const client = webhookClient(harness);
    const target = await client.webhookEndpoints.create({ url: "https://hooks.example.com/target" });
    const other = await client.webhookEndpoints.create({ url: "https://hooks.example.com/other" });
    // Each endpoint creation delivered its own lifecycle event to itself…
    // and endpoint.created of the SECOND endpoint also reached the FIRST
    // (empty filter = every event). Filter to the target endpoint only.
    const page = await client.webhookDeliveries.listPage({ endpointId: target.id });
    expect(page.deliveries.length).toBeGreaterThanOrEqual(1);
    expect(page.deliveries.every((d) => d.endpointId === target.id)).toBe(true);
    expect(other.id).not.toBe(target.id);

    const all = await client.webhookDeliveries.listPage({ limit: 1 });
    expect(all.has_more).toBe(true);
    expect(all.next_cursor).toBe(all.deliveries[0]?.id ?? null);

    const everyDelivery: string[] = [];
    for await (const delivery of client.webhookDeliveries.list({ limit: 2 })) {
      everyDelivery.push(delivery.id);
    }
    // Fan-out math: endpoint A (created first, empty filter) received its
    // own created-event AND B's created-event; endpoint B received only
    // its own — 3 deliveries total across 2 events.
    expect(everyDelivery).toHaveLength(3);
    await harness.app.close();
  });
});

describe("S2-004 SDK — event retrieval + replay", () => {
  it("retrieves a stored event by id (404 when unknown)", async () => {
    const harness = webhookHarness();
    const client = webhookClient(harness);
    await client.webhookEndpoints.create({ url: "https://hooks.example.com/ev" });
    const [delivery] = (await client.webhookDeliveries.listPage()).deliveries;
    expect(delivery).toBeDefined();

    const event = await client.webhookEvents.get(delivery.eventId);
    expect(event.id).toBe(delivery.eventId);
    expect(event.object).toBe("event");
    expect(event.type).toBe("webhook.endpoint.created");
    expect(event.data.object).toMatchObject({ endpointId: expect.any(String) });

    await expect(client.webhookEvents.get("evt_unknown_404")).rejects.toMatchObject({
      name: "ReckonNotFoundError",
      code: "NOT_FOUND",
      statusCode: 404,
    });
    await harness.app.close();
  });

  it("replays the SAME event id and marks the new deliveries replayed", async () => {
    const harness = webhookHarness();
    const client = webhookClient(harness);
    await client.webhookEndpoints.create({ url: "https://hooks.example.com/replay" });
    const [delivery] = (await client.webhookDeliveries.listPage()).deliveries;

    const before = harness.webhookClient?.calls.length ?? 0;
    const replay = await client.webhookEvents.replay(delivery.eventId);
    expect(replay.event.id).toBe(delivery.eventId);
    expect(replay.deliveries).toHaveLength(1);
    expect(replay.deliveries[0]?.replayed).toBe(true);
    expect(replay.deliveries[0]?.eventId).toBe(delivery.eventId);
    // The engine re-POSTed the same event bytes (at-least-once; the
    // receiver dedupes on event.id).
    expect(harness.webhookClient?.calls.length ?? 0).toBe(before + 1);

    const unknown = await client.webhookEvents.replay("evt_unknown_404").catch((e: unknown) => e);
    expect(unknown).toMatchObject({ name: "ReckonNotFoundError", code: "NOT_FOUND", statusCode: 404 });
    await harness.app.close();
  });
});

describe("S2-004 SDK — signature verification of real deliveries", () => {
  it("verifies the engine's own signed POST against the issued secret (accept)", async () => {
    const harness = webhookHarness();
    const client = webhookClient(harness);
    const created = await client.webhookEndpoints.create({ url: "https://hooks.example.com/sig" });

    const call = harness.webhookClient?.last();
    expect(call).toBeDefined();
    const header = call?.headers[WEBHOOK_SIGNATURE_HEADER];
    expect(typeof header).toBe("string");
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);

    // The SDK's verifyWebhook (the docs-named alias of the canonical
    // contracts implementation) accepts the REAL delivery bytes.
    expect(verifyWebhook(call!.rawBody, header!, created.secret)).toBe(true);
    expect(verifyReckonSignature(call!.rawBody, header!, created.secret)).toBe(true);
    await harness.app.close();
  });

  it("rejects tampered bodies, wrong secrets and stale timestamps", async () => {
    const harness = webhookHarness();
    const client = webhookClient(harness);
    const created = await client.webhookEndpoints.create({ url: "https://hooks.example.com/reject" });
    const call = harness.webhookClient?.last();
    const header = call?.headers[WEBHOOK_SIGNATURE_HEADER] ?? "";

    // Tampered body (one byte appended).
    expect(verifyWebhook(`${call!.rawBody} `, header, created.secret)).toBe(false);
    // Mutated JSON payload.
    expect(verifyWebhook(call!.rawBody.replace("webhook.endpoint.created", "webhook.endpoint.deleted"), header, created.secret)).toBe(false);
    // Wrong secret.
    expect(verifyWebhook(call!.rawBody, header, "whsec_wrong_wrong_wrong_wrong_wrong")).toBe(false);
    // Stale timestamp (t far outside the 300s tolerance).
    const stale = header.replace(/^t=\d+/, "t=1000000000");
    expect(verifyWebhook(call!.rawBody, stale, created.secret)).toBe(false);
    // Malformed headers.
    expect(verifyWebhook(call!.rawBody, "nonsense", created.secret)).toBe(false);
    expect(verifyWebhook(call!.rawBody, "", created.secret)).toBe(false);
    await harness.app.close();
  });
});
