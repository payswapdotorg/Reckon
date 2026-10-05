import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import type { StaticKeyConfig } from "../src/auth.js";
import { generatePublishableKey } from "@reckon/contracts";
import { buildDefaultServer, injectJson, expectErrorEnvelope, WEBHOOKS_KEY } from "./fixtures.js";
import {
  buildWebhookServer,
  freshWhIdem,
  whAuthOnly,
  whHeaders,
  type WebhookTestServer,
} from "./webhook-helpers.js";

/**
 * S2-002 — webhook ENDPOINT CRUD + the auth matrix through the real
 * /v1/webhooks routes: key/scope/tenant gating per the S2-001 laws,
 * whsec_ secret issuance (ONCE), event-type filters, idempotent
 * creation, and the NotWired (501) default when no system is mounted.
 */

const PK_LIVE = generatePublishableKey("live");
function WEBHOOK_TEST_KEYS(): StaticKeyConfig[] {
  return [
    { apiKey: "wh-full", tenantId: "tenant-a", scopes: ["webhooks", "decisions"] },
    { apiKey: "wh-only", tenantId: "tenant-b", scopes: ["webhooks"] },
    { apiKey: "wh-none", tenantId: "tenant-a", scopes: ["decisions"] },
    { apiKey: "wh-ws", tenantId: "tenant-a", workspaceId: "ws-1", scopes: ["webhooks"] },
    { apiKey: PK_LIVE, tenantId: "tenant-a", scopes: ["webhooks"] },
  ];
}

async function close(server: { app: FastifyInstance }): Promise<void> {
  await server.app.close();
}

interface EndpointResponse {
  id?: string;
  object?: string;
  url?: string;
  description?: string;
  eventTypes?: string[];
  tenant?: { tenantId?: string };
  status?: string;
  createdAt?: number;
  secret?: string;
}

async function createEndpoint(
  server: WebhookTestServer,
  body: Record<string, unknown>,
  key = "wh-full",
  idempotencyKey = freshWhIdem("ep"),
): Promise<{ status: number; body: unknown; headers: Record<string, unknown> }> {
  return injectJson(server.app, "POST", "/v1/webhooks/endpoints", {
    payload: body,
    headers: whHeaders(key, { "idempotency-key": idempotencyKey }),
  });
}

describe("webhook endpoints: creation + secret issuance", () => {
  let server: WebhookTestServer;
  afterEach(async () => {
    if (server !== undefined) await close(server);
  });

  it("creates an endpoint, echoes the view + ONE-TIME whsec_ secret, and delivers the lifecycle event to it", async () => {
    server = buildWebhookServer();
    const res = await createEndpoint(server, {
      url: "https://hooks.example.com/reckon",
      description: "main receiver",
    });
    expect(res.status).toBe(200);
    const created = res.body as EndpointResponse;
    expect(created.id).toMatch(/^we_[A-Za-z0-9]+$/);
    expect(created.object).toBe("webhook_endpoint");
    expect(created.url).toBe("https://hooks.example.com/reckon");
    expect(created.description).toBe("main receiver");
    expect(created.eventTypes).toEqual([]); // empty = all events (documented)
    expect(created.tenant).toEqual({ tenantId: "tenant-a" });
    expect(created.status).toBe("enabled");
    expect(typeof created.createdAt).toBe("number");
    expect(created.secret).toMatch(/^whsec_[A-Za-z0-9]{24,}$/);

    // The endpoint (all-events filter) receives its own creation event
    // immediately — attempt 1 is inline (documented self-verification).
    expect(server.client.calls).toHaveLength(1);
    const delivered = JSON.parse(server.client.calls[0]?.rawBody ?? "{}") as { type?: string; data?: { object?: { endpointId?: string } } };
    expect(delivered.type).toBe("webhook.endpoint.created");
    expect(delivered.data?.object).toMatchObject({ endpointId: created.id, url: created.url, eventTypes: [] });
  });

  it("creation is idempotent (same key + body → replayed response, no second endpoint/event)", async () => {
    server = buildWebhookServer();
    const idem = freshWhIdem("idem-create");
    const first = await createEndpoint(server, { url: "https://hooks.example.com/a" }, "wh-full", idem);
    const eventsAfterFirst = server.client.calls.length;
    const second = await createEndpoint(server, { url: "https://hooks.example.com/a" }, "wh-full", idem);
    expect(second.status).toBe(200);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(second.body).toEqual(first.body);
    // No new lifecycle event delivery for the replay.
    expect(server.client.calls.length).toBe(eventsAfterFirst);

    const list = await injectJson(server.app, "GET", "/v1/webhooks/endpoints", { headers: whHeaders("wh-full") });
    const endpoints = (list.body as { endpoints?: unknown[] }).endpoints ?? [];
    expect(endpoints).toHaveLength(1);
  });

  it("same idempotency key + different body → typed 422 IDEMPOTENCY_CONFLICT", async () => {
    server = buildWebhookServer();
    const idem = freshWhIdem("idem-conflict");
    await createEndpoint(server, { url: "https://hooks.example.com/a" }, "wh-full", idem);
    const conflict = await createEndpoint(server, { url: "https://hooks.example.com/b" }, "wh-full", idem);
    expectErrorEnvelope(conflict.status, conflict.body, "IDEMPOTENCY_CONFLICT");
  });

  it("missing Idempotency-Key → typed 400 naming the header", async () => {
    server = buildWebhookServer();
    const res = await injectJson(server.app, "POST", "/v1/webhooks/endpoints", {
      payload: { url: "https://hooks.example.com/a" },
      headers: whHeaders("wh-full"),
    });
    expectErrorEnvelope(res.status, res.body, "VALIDATION_ERROR", "invalid_request_error");
    expect((res.body as { error?: { param?: string } }).error?.param).toBe("idempotency-key");
  });

  it("validation: http url, unknown event type, and unknown fields", async () => {
    server = buildWebhookServer();
    const badUrl = await createEndpoint(server, { url: "http://insecure.example.com/hook" });
    expectErrorEnvelope(badUrl.status, badUrl.body, "VALIDATION_ERROR");
    expect((badUrl.body as { error?: { param?: string } }).error?.param).toBe("url");

    const badType = await createEndpoint(server, {
      url: "https://hooks.example.com/hook",
      eventTypes: ["made.up.event"],
    });
    expectErrorEnvelope(badType.status, badType.body, "VALIDATION_ERROR");
    expect((badType.body as { error?: { param?: string } }).error?.param).toBe("eventTypes.0");

    const empty = await createEndpoint(server, {});
    expectErrorEnvelope(empty.status, empty.body, "VALIDATION_ERROR");
  });

  it("filtered endpoint does NOT receive its own creation event (no match)", async () => {
    server = buildWebhookServer();
    const res = await createEndpoint(server, {
      url: "https://hooks.example.com/filtered",
      eventTypes: ["preference.updated"],
    });
    expect(res.status).toBe(200);
    expect(server.client.calls).toHaveLength(0);
  });
});

describe("webhook endpoints: list / get / delete", () => {
  let server: WebhookTestServer;
  afterEach(async () => {
    if (server !== undefined) await close(server);
  });

  it("lists newest-first with pagination metadata; get returns the view WITHOUT the secret; delete removes it", async () => {
    server = buildWebhookServer();
    const first = (await createEndpoint(server, { url: "https://hooks.example.com/1" })).body as EndpointResponse;
    const second = (await createEndpoint(server, { url: "https://hooks.example.com/2" })).body as EndpointResponse;

    const list = await injectJson(server.app, "GET", "/v1/webhooks/endpoints", {
      headers: whHeaders("wh-full"),
    });
    expect(list.status).toBe(200);
    const body = list.body as { endpoints?: EndpointResponse[]; has_more?: boolean; next_cursor?: string | null };
    expect(body.endpoints?.map((e) => e.id)).toEqual([second.id, first.id]);
    expect(body.has_more).toBe(false);
    // next_cursor = the id of the LAST item of the page (feed back as starting_after).
    expect(body.next_cursor).toBe(first.id);
    for (const endpoint of body.endpoints ?? []) {
      expect("secret" in endpoint && endpoint.secret !== undefined).toBe(false);
    }

    const got = await injectJson(server.app, "GET", `/v1/webhooks/endpoints/${second.id}`, {
      headers: whHeaders("wh-full"),
    });
    expect(got.status).toBe(200);
    const view = got.body as EndpointResponse;
    expect(view.id).toBe(second.id);
    expect(view.secret).toBeUndefined();

    const deleted = await injectJson(server.app, "DELETE", `/v1/webhooks/endpoints/${second.id}`, {
      headers: whAuthOnly("wh-full"),
    });
    expect(deleted.status).toBe(200);
    expect((deleted.body as EndpointResponse).id).toBe(second.id);

    const gone = await injectJson(server.app, "GET", `/v1/webhooks/endpoints/${second.id}`, {
      headers: whHeaders("wh-full"),
    });
    expectErrorEnvelope(gone.status, gone.body, "NOT_FOUND");

    // Deleting the deletion event's endpoint: the deleted endpoint
    // receives webhook.endpoint.deleted only if another matching
    // endpoint exists — here the FIRST endpoint (all events) gets it.
    const types = server.client.calls.map((call) => (JSON.parse(call.rawBody) as { type?: string }).type);
    expect(types).toContain("webhook.endpoint.deleted");
  });

  it("unknown endpoint ids answer typed 404 (get and delete)", async () => {
    server = buildWebhookServer();
    const got = await injectJson(server.app, "GET", "/v1/webhooks/endpoints/we_missing", {
      headers: whHeaders("wh-full"),
    });
    expectErrorEnvelope(got.status, got.body, "NOT_FOUND");
    const del = await injectJson(server.app, "DELETE", "/v1/webhooks/endpoints/we_missing", {
      headers: whAuthOnly("wh-full"),
    });
    expectErrorEnvelope(del.status, del.body, "NOT_FOUND");
  });
});

describe("webhook endpoints: auth matrix (S2-001 laws on the webhooks scope)", () => {
  let server: WebhookTestServer;
  afterEach(async () => {
    if (server !== undefined) await close(server);
  });

  it("no Authorization → 401 authentication_error", async () => {
    server = buildWebhookServer();
    const res = await injectJson(server.app, "GET", "/v1/webhooks/endpoints", {});
    expectErrorEnvelope(res.status, res.body, "UNAUTHENTICATED", "authentication_error");
  });

  it("publishable key (pk_live_) → 401 with the dedicated message", async () => {
    const pk = generatePublishableKey("live");
    server = buildWebhookServer({
      keys: [{ apiKey: pk, tenantId: "tenant-a", scopes: ["webhooks"] }],
    });
    const res = await injectJson(server.app, "GET", "/v1/webhooks/endpoints", { headers: whHeaders(pk) });
    expectErrorEnvelope(res.status, res.body, "UNAUTHENTICATED", "authentication_error");
    expect((res.body as { error?: { message?: string } }).error?.message).toContain("Publishable keys");
  });

  it("unknown key → 401; key without the webhooks scope → 403 INSUFFICIENT_SCOPE with the required scope", async () => {
    server = buildWebhookServer();
    const unknown = await injectJson(server.app, "GET", "/v1/webhooks/endpoints", {
      headers: whHeaders("not-a-key"),
    });
    expectErrorEnvelope(unknown.status, unknown.body, "UNAUTHENTICATED");

    const scoped = await injectJson(server.app, "GET", "/v1/webhooks/endpoints", {
      headers: whHeaders("wh-none"),
    });
    expectErrorEnvelope(scoped.status, scoped.body, "INSUFFICIENT_SCOPE", "permission_error");
    const details = (scoped.body as { error?: { details?: { requiredScope?: string } } }).error?.details;
    expect(details?.requiredScope).toBe("webhooks");
  });

  it("tenant isolation: tenant-b sees only its endpoints; cross-tenant get → 404 (never a leak)", async () => {
    server = buildWebhookServer();
    const a = (await createEndpoint(server, { url: "https://hooks.example.com/a" }, "wh-full")).body as EndpointResponse;
    const b = (await createEndpoint(server, { url: "https://hooks.example.com/b" }, "wh-only", freshWhIdem("b"))).body as EndpointResponse;

    const listB = await injectJson(server.app, "GET", "/v1/webhooks/endpoints", { headers: whHeaders("wh-only") });
    const endpointsB = (listB.body as { endpoints?: EndpointResponse[] }).endpoints ?? [];
    expect(endpointsB.map((e) => e.id)).toEqual([b.id]);

    const crossGet = await injectJson(server.app, "GET", `/v1/webhooks/endpoints/${a.id}`, {
      headers: whHeaders("wh-only"),
    });
    expectErrorEnvelope(crossGet.status, crossGet.body, "NOT_FOUND");

    // Events emitted for tenant-a never reach tenant-b's endpoint.
    const bUrlCalls = server.client.calls.filter((call) => call.url === "https://hooks.example.com/b");
    const types = bUrlCalls.map((call) => (JSON.parse(call.rawBody) as { tenant?: { tenantId?: string } }).tenant?.tenantId);
    for (const tenantId of types) expect(tenantId).toBe("tenant-b");
  });

  it("workspace-scoped keys operate inside their workspace only (structural tenant law)", async () => {
    server = buildWebhookServer();
    const wsEndpoint = (await createEndpoint(server, { url: "https://hooks.example.com/ws" }, "wh-ws")).body as EndpointResponse;
    expect(wsEndpoint.tenant).toEqual({ tenantId: "tenant-a", workspaceId: "ws-1" });

    // The plain tenant-a key does not see the workspace endpoint.
    const plainList = await injectJson(server.app, "GET", "/v1/webhooks/endpoints", {
      headers: whHeaders("wh-full"),
    });
    expect((plainList.body as { endpoints?: unknown[] }).endpoints).toEqual([]);

    // And the workspace key sees only its own.
    const wsList = await injectJson(server.app, "GET", "/v1/webhooks/endpoints", {
      headers: whHeaders("wh-ws"),
    });
    expect((wsList.body as { endpoints?: EndpointResponse[] }).endpoints?.map((e) => e.id)).toEqual([wsEndpoint.id]);
  });

  it("body tenant mismatch → 403 TENANT_MISMATCH (the security-first peek applies to webhook bodies too)", async () => {
    server = buildWebhookServer();
    const res = await injectJson(server.app, "POST", "/v1/webhooks/endpoints", {
      payload: { url: "https://hooks.example.com/x", tenant: { tenantId: "tenant-b" } },
      headers: whHeaders("wh-full", { "idempotency-key": freshWhIdem("t") }),
    });
    expectErrorEnvelope(res.status, res.body, "TENANT_MISMATCH", "permission_error");
  });
});

describe("webhook routes: NotWired default (no system mounted)", () => {
  it("every webhook route answers typed 501 NOT_WIRED on the default server", async () => {
    const app = buildDefaultServer();
    try {
      const res = await injectJson(app, "GET", "/v1/webhooks/endpoints", { headers: whHeaders(WEBHOOKS_KEY) });
      expectErrorEnvelope(res.status, res.body, "NOT_WIRED", "api_error");
      const create = await injectJson(app, "POST", "/v1/webhooks/endpoints", {
        payload: { url: "https://hooks.example.com/x" },
        headers: whHeaders(WEBHOOKS_KEY, { "idempotency-key": "nw-1" }),
      });
      expectErrorEnvelope(create.status, create.body, "NOT_WIRED");
      const deliveries = await injectJson(app, "GET", "/v1/webhooks/deliveries", { headers: whHeaders(WEBHOOKS_KEY) });
      expectErrorEnvelope(deliveries.status, deliveries.body, "NOT_WIRED");
    } finally {
      await app.close();
    }
  });
});

describe("webhook system mount guard", () => {
  it("mounting config.webhooks AND handlers.webhookHandler together fails fast (ConfigError)", async () => {
    const { buildServer } = await import("../src/server.js");
    const { createInMemoryWebhookSystem } = await import("../src/webhooks/in-memory.js");
    const system = createInMemoryWebhookSystem({ httpClient: { post: async () => ({ statusCode: 200, latencyMs: 0 }) } });
    expect(() =>
      buildServer({
        keys: [{ apiKey: "k", tenantId: "t", scopes: ["webhooks"] }],
        webhooks: system,
        handlers: { webhookHandler: system },
      }),
    ).toThrowError(/not both/);
  });
});
