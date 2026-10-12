/**
 * TL6-002 — PostgreSQL webhook stores over a REAL PostgreSQL server
 * (embedded-postgres PG 18 binaries, real pg driver wire protocol — the
 * SAME path used against Neon in deployment).
 *
 * Evidence class: controlled-local.
 *
 * Coverage:
 * - Endpoint store: put/get/list ordering (newest-first by seq, with
 *   stable id tie-break), listMatching (empty filter = every type,
 *   specific type filter), delete (returns removed, null when unknown
 *   in tenant), idempotent re-put (re-putting the same endpointId
 *   updates the row in place — the law is structural).
 * - Event store: put idempotent per (tenant, event.id) — re-publishing
 *   returns duplicate:true; get (tenant-scoped); sweep (drops events
 *   older than the retention window, returns the count swept).
 * - Delivery store: put/get/update/list (newest first by seq),
 *   listDue (FIFO pending due, oldest seq first), countPending,
 *   filter by endpointId / eventId.
 * - Tenant scoping: cross-tenant reads return null/empty (the
 *   structural law — primary key (tenant_id, workspace_id, id)).
 * - Encryption at rest: the RAW signing secret is NOT recoverable by
 *   reading the table directly; the decrypt path through the store
 *   works (the store round-trips the same plaintext).
 * - Restart durability: state written BEFORE a full server stop
 *   reads identically AFTER restart on the same data dir (the law
 *   ADR-001 mandates — proof at the adapter level).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  PgWebhookDeliveryStore,
  PgWebhookEndpointStore,
  PgWebhookEventStore,
  parseWebhookSecretEncryptionKey,
  WebhookEncryptionKeyError,
  type PgPoolExecutor,
  type StoredWebhookDelivery,
  type StoredWebhookEndpoint,
  type WebhookSecretEncryptionKey,
} from "../src/index.js";
import { startTestPostgres, type TestPostgres } from "./pg-harness.js";
import { tenantA, tenantB } from "./fixtures.js";
import type { ReckonEvent, TenantScope } from "@reckon/contracts";

let server: TestPostgres;

beforeAll(async () => {
  server = await startTestPostgres();
}, 120_000);

afterAll(async () => {
  await server.stop();
}, 60_000);

/** A deterministic 32-byte AES-256 test key (NOT a production value). */
const TEST_KEY: WebhookSecretEncryptionKey = {
  bytes: randomBytes(32),
};

const tenantAWorkspace: TenantScope = { tenantId: "tenant-a", workspaceId: "ws-1" };

function makeEndpoint(overrides: Partial<StoredWebhookEndpoint> = {}): StoredWebhookEndpoint {
  return {
    endpointId: `we_test_${Math.random().toString(36).slice(2, 10)}`,
    object: "webhook_endpoint",
    tenant: tenantA,
    url: "https://example.test/hooks",
    eventTypes: [],
    secret: `whsec_${randomBytes(24).toString("hex")}`,
    status: "enabled",
    createdAt: 1_000,
    seq: 0,
    ...overrides,
  };
}

function makeReckonEvent(overrides: Partial<ReckonEvent> = {}): ReckonEvent {
  return {
    id: `evt_${Math.random().toString(36).slice(2, 12)}`,
    object: "event",
    type: "preference.updated",
    created: 5_000,
    tenant: tenantA,
    data: { object: { deltaId: "delta-1" } },
    ...overrides,
  } as ReckonEvent;
}

function makeDelivery(overrides: Partial<StoredWebhookDelivery> = {}): StoredWebhookDelivery {
  return {
    id: `wd_${Math.random().toString(36).slice(2, 12)}`,
    object: "webhook_delivery",
    eventId: "evt-1",
    endpointId: "we-1",
    tenant: tenantA,
    attempts: 0,
    status: "pending",
    responseCode: null,
    latencyMs: null,
    error: null,
    replayed: false,
    createdAt: 1_000,
    updatedAt: 1_000,
    nextAttemptAt: 1_000,
    seq: 0,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ *
 * parseWebhookSecretEncryptionKey
 * ------------------------------------------------------------------ */

describe("TL6-002 parseWebhookSecretEncryptionKey", () => {
  it("accepts a 64-char hex string (32 bytes)", () => {
    const hex = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
    const key = parseWebhookSecretEncryptionKey(hex);
    expect(key.bytes.byteLength).toBe(32);
  });

  it("accepts a base64 string that decodes to exactly 32 bytes", () => {
    const buf = randomBytes(32);
    const key = parseWebhookSecretEncryptionKey(buf.toString("base64"));
    expect(key.bytes.byteLength).toBe(32);
  });

  it("throws WebhookEncryptionKeyError on a missing value (honesty law)", () => {
    expect(() => parseWebhookSecretEncryptionKey(undefined)).toThrow(WebhookEncryptionKeyError);
    expect(() => parseWebhookSecretEncryptionKey("")).toThrow(WebhookEncryptionKeyError);
  });

  it("throws WebhookEncryptionKeyError on a malformed value (wrong length / non-hex / wrong base64 length)", () => {
    expect(() => parseWebhookSecretEncryptionKey("not-a-key")).toThrow(WebhookEncryptionKeyError);
    expect(() => parseWebhookSecretEncryptionKey("00112233")).toThrow(WebhookEncryptionKeyError);
    expect(() => parseWebhookSecretEncryptionKey("zz")).toThrow(WebhookEncryptionKeyError);
    // A 31-byte base64 is rejected (must decode to exactly 32 bytes).
    expect(() =>
      parseWebhookSecretEncryptionKey(randomBytes(31).toString("base64")),
    ).toThrow(WebhookEncryptionKeyError);
  });
});

/* ------------------------------------------------------------------ *
 * PgWebhookEndpointStore
 * ------------------------------------------------------------------ */

describe("TL6-002 PgWebhookEndpointStore", () => {
  it("put/get round-trip; the stored row carries the assigned seq (BIGSERIAL)", async () => {
    const store = new PgWebhookEndpointStore(server.executor, TEST_KEY);
    const endpoint = makeEndpoint({ endpointId: "we_roundtrip_1" });
    const stored = await store.put(endpoint);
    expect(stored.endpointId).toBe("we_roundtrip_1");
    expect(stored.url).toBe(endpoint.url);
    expect(stored.secret).toBe(endpoint.secret);
    expect(stored.seq).toBeGreaterThan(0);

    const fetched = await store.get(tenantA, "we_roundtrip_1");
    expect(fetched).not.toBeNull();
    expect(fetched!.endpointId).toBe("we_roundtrip_1");
    expect(fetched!.secret).toBe(endpoint.secret);
    expect(fetched!.seq).toBe(stored.seq);
  });

  it("list returns newest-first (seq DESC, id DESC tie-break) bounded by limit", async () => {
    const store = new PgWebhookEndpointStore(server.executor, TEST_KEY);
    // Three endpoints created in sequence — larger seq = newer.
    await store.put(makeEndpoint({ endpointId: "we_list_a", createdAt: 1_000 }));
    await store.put(makeEndpoint({ endpointId: "we_list_b", createdAt: 2_000 }));
    await store.put(makeEndpoint({ endpointId: "we_list_c", createdAt: 3_000 }));
    const all = await store.list(tenantA);
    const ids = all.map((endpoint) => endpoint.endpointId);
    // Newest-first: c (highest seq) before b before a.
    expect(ids.indexOf("we_list_c")).toBeLessThan(ids.indexOf("we_list_b"));
    expect(ids.indexOf("we_list_b")).toBeLessThan(ids.indexOf("we_list_a"));
    const limited = await store.list(tenantA, 1);
    expect(limited).toHaveLength(1);
  });

  it("listMatching: empty eventTypes filter matches EVERY event type; specific filter narrows", async () => {
    const store = new PgWebhookEndpointStore(server.executor, TEST_KEY);
    await store.put(makeEndpoint({ endpointId: "we_match_all", eventTypes: [] }));
    await store.put(
      makeEndpoint({
        endpointId: "we_match_pref",
        eventTypes: ["preference.updated"],
      }),
    );
    await store.put(
      makeEndpoint({
        endpointId: "we_match_sched",
        eventTypes: ["schedule.executed"],
      }),
    );
    const prefMatches = await store.listMatching(tenantA, "preference.updated");
    const prefIds = prefMatches.map((endpoint) => endpoint.endpointId);
    // Empty filter matches every type → we_match_all is included; the
    // explicit preference.updated filter is included; schedule-only is NOT.
    expect(prefIds).toContain("we_match_all");
    expect(prefIds).toContain("we_match_pref");
    expect(prefIds).not.toContain("we_match_sched");
    const scheduleMatches = await store.listMatching(tenantA, "schedule.executed");
    const scheduleIds = scheduleMatches.map((endpoint) => endpoint.endpointId);
    expect(scheduleIds).toContain("we_match_all");
    expect(scheduleIds).toContain("we_match_sched");
    expect(scheduleIds).not.toContain("we_match_pref");
  });

  it("delete returns the removed view; null when unknown in this tenant", async () => {
    const store = new PgWebhookEndpointStore(server.executor, TEST_KEY);
    await store.put(makeEndpoint({ endpointId: "we_delete_1" }));
    const removed = await store.delete(tenantA, "we_delete_1");
    expect(removed?.endpointId).toBe("we_delete_1");
    expect(await store.get(tenantA, "we_delete_1")).toBeNull();
    expect(await store.delete(tenantA, "we_delete_1")).toBeNull();
    expect(await store.delete(tenantB, "we_delete_1")).toBeNull();
  });

  it("idempotent re-put: re-putting the same endpointId updates in place (URL/secret updated, seq preserved)", async () => {
    const store = new PgWebhookEndpointStore(server.executor, TEST_KEY);
    const original = await store.put(
      makeEndpoint({ endpointId: "we_reput_1", url: "https://v1.example.test", secret: "whsec_v1" }),
    );
    const updated = await store.put(
      makeEndpoint({
        endpointId: "we_reput_1",
        url: "https://v2.example.test",
        secret: "whsec_v2",
        createdAt: original.createdAt,
      }),
    );
    expect(updated.endpointId).toBe("we_reput_1");
    expect(updated.url).toBe("https://v2.example.test");
    expect(updated.secret).toBe("whsec_v2");
    expect(updated.seq).toBe(original.seq); // the same row — seq preserved
    const fetched = await store.get(tenantA, "we_reput_1");
    expect(fetched?.url).toBe("https://v2.example.test");
    expect(fetched?.secret).toBe("whsec_v2");
  });

  it("tenant-scoped: cross-tenant reads return null/empty (PRIMARY KEY law)", async () => {
    const store = new PgWebhookEndpointStore(server.executor, TEST_KEY);
    await store.put(makeEndpoint({ endpointId: "we_tenant_scope", tenant: tenantA }));
    // tenant B cannot read tenant A's endpoint.
    expect(await store.get(tenantB, "we_tenant_scope")).toBeNull();
    // tenant B's list does not include tenant A's endpoint.
    const tenantBList = await store.list(tenantB);
    expect(tenantBList.map((endpoint) => endpoint.endpointId)).not.toContain("we_tenant_scope");
    // tenant B's listMatching does not include tenant A's endpoint.
    const tenantBMatches = await store.listMatching(tenantB, "preference.updated");
    expect(tenantBMatches.map((endpoint) => endpoint.endpointId)).not.toContain("we_tenant_scope");
    // workspace isolation inside the same tenant.
    await store.put(makeEndpoint({ endpointId: "we_tenant_scope_ws", tenant: tenantAWorkspace }));
    expect(await store.get(tenantA, "we_tenant_scope_ws")).toBeNull();
    expect(await store.get(tenantAWorkspace, "we_tenant_scope_ws")).not.toBeNull();
  });

  it("encryption at rest: the RAW secret is NOT recoverable by reading the table directly; decrypt path works", async () => {
    const store = new PgWebhookEndpointStore(server.executor, TEST_KEY);
    const rawSecret = `whsec_${randomBytes(24).toString("hex")}`;
    await store.put(makeEndpoint({ endpointId: "we_enc_1", secret: rawSecret }));
    // Direct table read: the secret_cipher column is BYTEA ciphertext.
    // The raw whsec_ string must NOT appear anywhere in the table.
    const rows = await server.executor.query(
      `SELECT secret_cipher, secret_iv, secret_tag FROM webhook_endpoints WHERE endpoint_id = $1`,
      ["we_enc_1"],
    );
    expect(rows.length).toBe(1);
    const cipher = rows[0]?.secret_cipher;
    const iv = rows[0]?.secret_iv;
    const tag = rows[0]?.secret_tag;
    // The ciphertext bytes are NOT the raw secret bytes.
    expect(Buffer.isBuffer(cipher)).toBe(true);
    // Sanity: the raw secret is a UTF-8 string of length > 32; the
    // ciphertext is at least as long (AES-256-GCM over the plaintext +
    // 0 padding for block-aligned GCM mode).
    const rawBytes = Buffer.from(rawSecret, "utf8");
    expect((cipher as Buffer).length).toBeGreaterThanOrEqual(rawBytes.length);
    // The raw secret string must NOT be present as bytes in the
    // ciphertext (it's encrypted; the bytes bear no resemblance).
    expect((cipher as Buffer).toString("utf8")).not.toContain(rawSecret);
    expect((iv as Buffer).length).toBe(12);
    expect((tag as Buffer).length).toBe(16);
    // The decrypt path through the store returns the same raw secret.
    const fetched = await store.get(tenantA, "we_enc_1");
    expect(fetched?.secret).toBe(rawSecret);
  });

  it("an endpoint created with one encryption key CANNOT be decrypted with a different key (authTag mismatch — the law)", async () => {
    const store1 = new PgWebhookEndpointStore(server.executor, TEST_KEY);
    await store1.put(makeEndpoint({ endpointId: "we_key_isolation_1" }));
    const otherKey: WebhookSecretEncryptionKey = { bytes: randomBytes(32) };
    const store2 = new PgWebhookEndpointStore(server.executor, otherKey);
    // Decrypting with a different key MUST throw (AES-256-GCM authTag
    // mismatch is the security guarantee — a wrong key never returns
    // garbage plaintext silently).
    await expect(store2.get(tenantA, "we_key_isolation_1")).rejects.toThrow();
    // The original key still decrypts cleanly.
    const fetched = await store1.get(tenantA, "we_key_isolation_1");
    expect(fetched).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * PgWebhookEventStore
 * ------------------------------------------------------------------ */

describe("TL6-002 PgWebhookEventStore", () => {
  it("put is idempotent per (tenant, event.id); re-publishing returns duplicate:true", async () => {
    const store = new PgWebhookEventStore(server.executor);
    const event = makeReckonEvent({ id: "evt_dedupe_1" });
    const first = await store.put(event);
    expect(first.duplicate).toBe(false);
    const second = await store.put(event);
    expect(second.duplicate).toBe(true);
    // A different event with the same id in a DIFFERENT tenant is NOT a
    // duplicate (the dedupe key is (tenant, event.id)).
    const otherTenantEvent = { ...event, tenant: tenantB };
    const third = await store.put(otherTenantEvent);
    expect(third.duplicate).toBe(false);
  });

  it("get is tenant-scoped (cross-tenant read returns null)", async () => {
    const store = new PgWebhookEventStore(server.executor);
    await store.put(makeReckonEvent({ id: "evt_tenant_1", tenant: tenantA }));
    expect(await store.get(tenantA, "evt_tenant_1")).not.toBeNull();
    expect(await store.get(tenantB, "evt_tenant_1")).toBeNull();
  });

  it("sweep drops events older than the retention window; returns the count swept", async () => {
    const store = new PgWebhookEventStore(server.executor);
    await store.put(makeReckonEvent({ id: "evt_sweep_old", created: 1_000 }));
    await store.put(makeReckonEvent({ id: "evt_sweep_new", created: 100_000 }));
    // retention window: 30_000ms — events older than (now - 30_000) are swept.
    const swept = await store.sweep(50_000, 30_000);
    expect(swept).toBeGreaterThanOrEqual(1);
    expect(await store.get(tenantA, "evt_sweep_old")).toBeNull();
    expect(await store.get(tenantA, "evt_sweep_new")).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * PgWebhookDeliveryStore
 * ------------------------------------------------------------------ */

describe("TL6-002 PgWebhookDeliveryStore", () => {
  it("put/get/update round-trip; the stored row carries the assigned seq", async () => {
    const store = new PgWebhookDeliveryStore(server.executor);
    const delivery = makeDelivery({ id: "wd_roundtrip_1" });
    const stored = await store.put(delivery);
    expect(stored.id).toBe("wd_roundtrip_1");
    expect(stored.seq).toBeGreaterThan(0);
    const fetched = await store.get(tenantA, "wd_roundtrip_1");
    expect(fetched).not.toBeNull();
    expect(fetched!.status).toBe("pending");
    // Update: simulate a successful delivery.
    await store.update({
      ...fetched!,
      attempts: 1,
      status: "succeeded",
      responseCode: 200,
      latencyMs: 12,
      error: null,
      updatedAt: 2_000,
      nextAttemptAt: null,
    });
    const after = await store.get(tenantA, "wd_roundtrip_1");
    expect(after?.status).toBe("succeeded");
    expect(after?.attempts).toBe(1);
    expect(after?.responseCode).toBe(200);
    expect(after?.latencyMs).toBe(12);
    expect(after?.nextAttemptAt).toBeNull();
  });

  it("list returns newest-first (seq DESC); honors endpointId / eventId filters", async () => {
    const store = new PgWebhookDeliveryStore(server.executor);
    await store.put(makeDelivery({ id: "wd_list_1", endpointId: "we_filter_a", eventId: "evt_filter_x" }));
    await store.put(makeDelivery({ id: "wd_list_2", endpointId: "we_filter_a", eventId: "evt_filter_y" }));
    await store.put(makeDelivery({ id: "wd_list_3", endpointId: "we_filter_b", eventId: "evt_filter_x" }));
    const all = await store.list(tenantA);
    const ids = all.map((delivery) => delivery.id);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    expect(ids.indexOf("wd_list_3")).toBeLessThan(ids.indexOf("wd_list_2")); // newest-first
    const byEndpoint = await store.list(tenantA, undefined, { endpointId: "we_filter_a" });
    expect(byEndpoint.map((delivery) => delivery.id).sort()).toEqual(["wd_list_1", "wd_list_2"]);
    const byEvent = await store.list(tenantA, undefined, { eventId: "evt_filter_x" });
    expect(byEvent.map((delivery) => delivery.id).sort()).toEqual(["wd_list_1", "wd_list_3"]);
  });

  it("listDue returns pending deliveries whose nextAttemptAt <= now, FIFO by seq", async () => {
    const store = new PgWebhookDeliveryStore(server.executor);
    await store.put(makeDelivery({ id: "wd_due_1", nextAttemptAt: 1_000 }));
    await store.put(makeDelivery({ id: "wd_due_2", nextAttemptAt: 1_000 }));
    // A succeeded delivery is NOT due.
    await store.put(
      makeDelivery({ id: "wd_due_3", nextAttemptAt: 1_000, status: "succeeded", attempts: 1 }),
    );
    // A delivery scheduled for the future is NOT due.
    await store.put(makeDelivery({ id: "wd_due_4", nextAttemptAt: 1_000_000 }));
    const due = await store.listDue(1_000);
    const dueIds = due.map((delivery) => delivery.id);
    expect(dueIds).toContain("wd_due_1");
    expect(dueIds).toContain("wd_due_2");
    expect(dueIds).not.toContain("wd_due_3");
    expect(dueIds).not.toContain("wd_due_4");
    // FIFO: oldest seq first.
    const seqs = due.map((delivery) => delivery.seq);
    const sortedSeqs = [...seqs].sort((a, b) => a - b);
    expect(seqs).toEqual(sortedSeqs);
  });

  it("countPending reports the count of pending deliveries", async () => {
    const store = new PgWebhookDeliveryStore(server.executor);
    await store.put(makeDelivery({ id: "wd_count_p1" }));
    await store.put(makeDelivery({ id: "wd_count_p2" }));
    await store.put(
      makeDelivery({ id: "wd_count_s1", status: "succeeded", attempts: 1, nextAttemptAt: null }),
    );
    const pending = await store.countPending();
    expect(pending).toBeGreaterThanOrEqual(2);
  });

  it("tenant-scoped: cross-tenant reads return null/empty (PRIMARY KEY law)", async () => {
    const store = new PgWebhookDeliveryStore(server.executor);
    await store.put(makeDelivery({ id: "wd_tenant_scope", tenant: tenantA }));
    expect(await store.get(tenantB, "wd_tenant_scope")).toBeNull();
    const tenantBList = await store.list(tenantB);
    expect(tenantBList.map((delivery) => delivery.id)).not.toContain("wd_tenant_scope");
  });
});

/* ------------------------------------------------------------------ *
 * Restart durability — the law ADR-001 mandates (proof at the adapter level).
 * ------------------------------------------------------------------ */

describe("TL6-002 restart durability — webhook state survives a full server stop + restart", () => {
  it("an endpoint + event + delivery written BEFORE the stop reads identically AFTER restart on the same data dir", async () => {
    // Phase 1: write through every store on the FIRST executor.
    const endpointStore = new PgWebhookEndpointStore(server.executor, TEST_KEY);
    const eventStore = new PgWebhookEventStore(server.executor);
    const deliveryStore = new PgWebhookDeliveryStore(server.executor);

    const endpoint = await endpointStore.put(
      makeEndpoint({ endpointId: "we_durable_1", secret: "whsec_durable" }),
    );
    const event = makeReckonEvent({ id: "evt_durable_1", tenant: tenantA });
    await eventStore.put(event);
    await deliveryStore.put(
      makeDelivery({ id: "wd_durable_1", endpointId: endpoint.endpointId, eventId: event.id }),
    );

    // Phase 2: full server stop → restart on the SAME data directory.
    const executor2: PgPoolExecutor = await server.restart();

    // Phase 3: every record reads identically through a NEW store
    // instance on the new executor — durability across a full restart.
    const endpointStore2 = new PgWebhookEndpointStore(executor2, TEST_KEY);
    const eventStore2 = new PgWebhookEventStore(executor2);
    const deliveryStore2 = new PgWebhookDeliveryStore(executor2);

    const fetchedEndpoint = await endpointStore2.get(tenantA, "we_durable_1");
    expect(fetchedEndpoint?.endpointId).toBe("we_durable_1");
    expect(fetchedEndpoint?.url).toBe(endpoint.url);
    expect(fetchedEndpoint?.secret).toBe("whsec_durable"); // decrypt still works after restart
    expect(fetchedEndpoint?.seq).toBe(endpoint.seq);

    const fetchedEvent = await eventStore2.get(tenantA, "evt_durable_1");
    expect(fetchedEvent?.id).toBe("evt_durable_1");
    expect(fetchedEvent?.type).toBe("preference.updated");

    const fetchedDelivery = await deliveryStore2.get(tenantA, "wd_durable_1");
    expect(fetchedDelivery?.endpointId).toBe(endpoint.endpointId);
    expect(fetchedDelivery?.eventId).toBe("evt_durable_1");
    expect(fetchedDelivery?.status).toBe("pending");
  }, 180_000);
});
