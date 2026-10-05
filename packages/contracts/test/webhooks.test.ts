import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  ModelDriftDetectedDataSchema,
  PreferenceUpdatedDataSchema,
  RecommendationDeliveredDataSchema,
  ReckonEventSchema,
  ScheduleExecutedDataSchema,
  WEBHOOK_DELIVERY_MAX_ATTEMPTS,
  WEBHOOK_EVENT_RETENTION_MS,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_RETRY_BACKOFF_FACTOR,
  WEBHOOK_RETRY_BASE_DELAY_MS,
  WEBHOOK_RETRY_CAP_MS,
  WEBHOOK_RETRY_WINDOW_MS,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_SIGNATURE_HEADER_CANONICAL,
  WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
  WEBHOOK_SIGNING_SECRET_PREFIX,
  WebhookDeliveryViewSchema,
  WebhookEndpointCreateSchema,
  WebhookEndpointCreatedSchema,
  WebhookEndpointCreatedDataSchema,
  WebhookEndpointDeletedDataSchema,
  WebhookEndpointViewSchema,
  WebhookReplayResponseSchema,
  WebhookSigningSecretSchema,
  WebhookUrlSchema,
  defaultWebhookRetryOptions,
  generateWebhookDeliveryId,
  generateWebhookEndpointId,
  generateWebhookEventId,
  generateWebhookSigningSecret,
  signWebhookPayload,
  verifyReckonSignature,
  webhookBackoffMs,
} from "../src/index.js";

/**
 * S2-002 — the webhook contract surface (webhooks.ts): thin event
 * envelope, event catalog, endpoint/delivery resources, signing
 * secrets, ids, HMAC signatures and the documented retry/retention
 * constants. Additive-only extension of the frozen contracts.
 */

const TENANT = { tenantId: "demo" } as const;

/** The four documented event payloads (docs portal examples, verbatim shapes). */
const DOCS_EVENTS = [
  {
    id: "evt_01J9C4F7K3",
    object: "event",
    type: "recommendation.delivered",
    created: 1769997722000,
    tenant: TENANT,
    data: {
      object: {
        decisionId: "dec_01J8ZWM6X4",
        requestId: "req_01J8ZWK3Q7",
        experienceId: "exp_01J8ZWM8T2",
        itemId: "item_reef_doc",
        action: "SUGGEST",
        deliveredAt: 1769997721500,
      },
    },
  },
  {
    id: "evt_01J9C7H2M8",
    object: "event",
    type: "model.drift.detected",
    created: 1770084120000,
    tenant: TENANT,
    data: {
      object: {
        modelId: "pref-embed-v3",
        modelVersion: "12",
        driftScore: 0.41,
        threshold: 0.35,
        window: "72h",
        metric: "calibration_error",
        evaluatedAt: 1770084000000,
      },
    },
  },
  {
    id: "evt_01J9C9J5N2",
    object: "event",
    type: "schedule.executed",
    created: 1769997720400,
    tenant: TENANT,
    data: {
      object: {
        planId: "plan_01J9B4M7Q2",
        decisionId: "dec_01J8ZWM6X4",
        action: "QUEUE",
        enqueued: ["exp_01J8ZWM9F7"],
        dequeued: [],
        executedAt: 1769997720123,
      },
    },
  },
  {
    id: "evt_01J9CAK8P4",
    object: "event",
    type: "preference.updated",
    created: 1769998921000,
    tenant: TENANT,
    data: {
      object: {
        deltaId: "pfd_01J9A7C2M6",
        subject: { kind: "user", ref: "usr_88213" },
        dimension: "topic.calm-nature",
        op: "add",
        resultingConfidence: 0.61,
        modelId: "pref-embed-v3",
        modelVersion: "12",
      },
    },
  },
] as const;

const deliveredEvent = DOCS_EVENTS[0];

describe("webhooks: event catalog", () => {
  it("the catalog carries the four documented loop events plus the two lifecycle events", () => {
    expect(WEBHOOK_EVENT_TYPES).toContain("recommendation.delivered");
    expect(WEBHOOK_EVENT_TYPES).toContain("model.drift.detected");
    expect(WEBHOOK_EVENT_TYPES).toContain("schedule.executed");
    expect(WEBHOOK_EVENT_TYPES).toContain("preference.updated");
    expect(WEBHOOK_EVENT_TYPES).toContain("webhook.endpoint.created");
    expect(WEBHOOK_EVENT_TYPES).toContain("webhook.endpoint.deleted");
    expect(WEBHOOK_EVENT_TYPES).toHaveLength(6);
  });

  it("each documented payload shape validates standalone", () => {
    expect(
      RecommendationDeliveredDataSchema.safeParse(deliveredEvent.data.object).success,
    ).toBe(true);
    expect(
      ModelDriftDetectedDataSchema.safeParse(DOCS_EVENTS[1].data.object).success,
    ).toBe(true);
    expect(ScheduleExecutedDataSchema.safeParse(DOCS_EVENTS[2].data.object).success).toBe(true);
    expect(PreferenceUpdatedDataSchema.safeParse(DOCS_EVENTS[3].data.object).success).toBe(true);
  });

  it("lifecycle payload schemas: endpoint created carries url + filter, deleted carries url", () => {
    expect(
      WebhookEndpointCreatedDataSchema.safeParse({
        endpointId: "we_1",
        url: "https://hooks.example.com/reckon",
        eventTypes: ["schedule.executed"],
      }).success,
    ).toBe(true);
    expect(
      WebhookEndpointDeletedDataSchema.safeParse({
        endpointId: "we_1",
        url: "https://hooks.example.com/reckon",
      }).success,
    ).toBe(true);
  });
});

describe("webhooks: thin event envelope", () => {
  it("every documented event validates against the discriminated union", () => {
    for (const event of DOCS_EVENTS) {
      const parsed = ReckonEventSchema.safeParse(event);
      expect(parsed.success, `event ${event.type} must validate`).toBe(true);
    }
  });

  it("envelope fields are exactly the documented thin shape", () => {
    const parsed = ReckonEventSchema.parse(deliveredEvent);
    expect(Object.keys(parsed).sort()).toEqual(["created", "data", "id", "object", "tenant", "type"]);
    expect(parsed.object).toBe("event");
    expect(Object.keys(parsed.data).sort()).toEqual(["object"]);
  });

  it("rejects unknown types, wrong object literal, missing tenant and bad payloads", () => {
    expect(ReckonEventSchema.safeParse({ ...deliveredEvent, type: "nope.nope" }).success).toBe(false);
    expect(ReckonEventSchema.safeParse({ ...deliveredEvent, object: "webhook" }).success).toBe(false);
    const { tenant, ...withoutTenant } = deliveredEvent;
    expect(void tenant).toBeUndefined();
    expect(ReckonEventSchema.safeParse(withoutTenant).success).toBe(false);
    expect(
      ReckonEventSchema.safeParse({
        ...deliveredEvent,
        created: 1.5,
      }).success,
    ).toBe(false);
    expect(
      ReckonEventSchema.safeParse({
        ...deliveredEvent,
        data: { object: { ...deliveredEvent.data.object, action: "HOLD" } },
      }).success,
    ).toBe(false);
  });

  it("created is a non-negative integer timestamp (epoch ms per the documented wire form)", () => {
    expect(ReckonEventSchema.safeParse({ ...deliveredEvent, created: 1.5 }).success).toBe(false);
    expect(ReckonEventSchema.safeParse({ ...deliveredEvent, created: -1 }).success).toBe(false);
  });
});

describe("webhooks: endpoint resource schemas", () => {
  it("create schema requires https urls and defaults eventTypes to [] (all events)", () => {
    const parsed = WebhookEndpointCreateSchema.parse({ url: "https://example.com/hook" });
    expect(parsed).toEqual({ url: "https://example.com/hook", eventTypes: [] });
    expect(WebhookEndpointCreateSchema.safeParse({ url: "http://example.com/hook" }).success).toBe(
      false,
    );
    expect(WebhookUrlSchema.safeParse("ftp://example.com/hook").success).toBe(false);
    expect(WebhookUrlSchema.safeParse("https://exa mple.com/hook").success).toBe(false);
    expect(
      WebhookEndpointCreateSchema.safeParse({ url: "https://example.com/hook", eventTypes: ["made.up"] })
        .success,
    ).toBe(false);
  });

  it("eventTypes validation failure names the array path (typed 400 param)", () => {
    const result = WebhookEndpointCreateSchema.safeParse({
      url: "https://example.com/hook",
      eventTypes: ["made.up"],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path.join(".")).toBe("eventTypes.0");
    }
  });

  it("the view schema never carries a secret; the created schema requires one", () => {
    const view = {
      id: "we_abc123",
      object: "webhook_endpoint",
      url: "https://example.com/hook",
      eventTypes: ["preference.updated"],
      tenant: TENANT,
      status: "enabled",
      createdAt: 5,
    };
    expect(WebhookEndpointViewSchema.safeParse(view).success).toBe(true);
    expect("secret" in WebhookEndpointViewSchema.parse({ ...view, secret: "whsec_leak" })).toBe(
      false,
    );
    expect(WebhookEndpointCreatedSchema.safeParse({ ...view, secret: "nope" }).success).toBe(false);
    expect(
      WebhookEndpointCreatedSchema.safeParse({ ...view, secret: `whsec_${"a".repeat(24)}` }).success,
    ).toBe(true);
  });

  it("delivery view schema: nullable outcome fields, integer attempts, tri-state status", () => {
    const base = {
      id: "wd_1",
      object: "webhook_delivery",
      eventId: "evt_1",
      endpointId: "we_1",
      tenant: TENANT,
      attempts: 2,
      status: "failed",
      responseCode: 500,
      latencyMs: 12,
      error: "http 500",
      replayed: true,
      createdAt: 1,
      updatedAt: 2,
    };
    expect(WebhookDeliveryViewSchema.safeParse(base).success).toBe(true);
    expect(
      WebhookDeliveryViewSchema.safeParse({ ...base, status: "pending", responseCode: null, latencyMs: null, error: null })
        .success,
    ).toBe(true);
    expect(WebhookDeliveryViewSchema.safeParse({ ...base, attempts: 1.5 }).success).toBe(false);
    expect(WebhookDeliveryViewSchema.safeParse({ ...base, status: "retrying" }).success).toBe(false);
    expect(WebhookDeliveryViewSchema.safeParse({ ...base, responseCode: 99 }).success).toBe(false);
  });

  it("replay response schema: the event plus its replay deliveries", () => {
    const response = {
      event: deliveredEvent,
      deliveries: [
        {
          id: "wd_1",
          object: "webhook_delivery",
          eventId: deliveredEvent.id,
          endpointId: "we_1",
          tenant: TENANT,
          attempts: 1,
          status: "succeeded",
          responseCode: 200,
          latencyMs: 3,
          error: null,
          replayed: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
    expect(WebhookReplayResponseSchema.safeParse(response).success).toBe(true);
    expect(WebhookReplayResponseSchema.safeParse({ ...response, event: { type: "x" } }).success).toBe(
      false,
    );
  });
});

describe("webhooks: signing secrets", () => {
  it("generated secrets match the documented whsec_ prefix and validate", () => {
    for (let index = 0; index < 10; index += 1) {
      const secret = generateWebhookSigningSecret();
      expect(secret.startsWith(`${WEBHOOK_SIGNING_SECRET_PREFIX}`)).toBe(true);
      expect(WebhookSigningSecretSchema.safeParse(secret).success).toBe(true);
    }
  });

  it("generation honors the injected token generator (deterministic provisioning)", () => {
    const secret = generateWebhookSigningSecret((length) => "k".repeat(length));
    expect(secret).toBe(`whsec_${"k".repeat(32)}`);
  });

  it("the schema rejects non-whsec and too-short secrets", () => {
    expect(WebhookSigningSecretSchema.safeParse("sk_live_not-a-real-key!!").success).toBe(
      false,
    );
    expect(WebhookSigningSecretSchema.safeParse("whsec_short").success).toBe(false);
  });
});

describe("webhooks: id generators", () => {
  it("ids carry the evt_/we_/wd_ prefixes and are IdSchema-compatible", () => {
    expect(generateWebhookEventId()).toMatch(/^evt_[A-Za-z0-9]{24}$/);
    expect(generateWebhookEndpointId()).toMatch(/^we_[A-Za-z0-9]{24}$/);
    expect(generateWebhookDeliveryId()).toMatch(/^wd_[A-Za-z0-9]{24}$/);
  });

  it("generation is injectable for deterministic tests", () => {
    const token = (length: number) => "z".repeat(length);
    expect(generateWebhookEventId(token)).toBe(`evt_${"z".repeat(24)}`);
    expect(generateWebhookEndpointId(token)).toBe(`we_${"z".repeat(24)}`);
    expect(generateWebhookDeliveryId(token)).toBe(`wd_${"z".repeat(24)}`);
  });
});

describe("webhooks: HMAC signature scheme", () => {
  const SECRET = `whsec_${"s".repeat(32)}`;
  const RAW_BODY = JSON.stringify(deliveredEvent);
  const NOW_SECONDS = Math.floor(Date.now() / 1000);

  it("the header constants and tolerance match the documented contract", () => {
    expect(WEBHOOK_SIGNATURE_HEADER).toBe("reckon-signature");
    expect(WEBHOOK_SIGNATURE_HEADER_CANONICAL).toBe("Reckon-Signature");
    expect(WEBHOOK_SIGNATURE_TOLERANCE_SECONDS).toBe(300);
  });

  it("signWebhookPayload emits the documented t=<unix>,v1=<hex> format", () => {
    const header = signWebhookPayload(SECRET, RAW_BODY, NOW_SECONDS);
    expect(header).toMatch(/^t=\d{10},v1=[0-9a-f]{64}$/);
  });

  it("the signature is the HMAC-SHA256 over `${t}.${rawBody}` (byte-for-byte)", () => {
    const header = signWebhookPayload(SECRET, RAW_BODY, NOW_SECONDS);
    const t = header.split(",")[0]?.slice(2) ?? "";
    const expected = createHmac("sha256", SECRET).update(`${t}.${RAW_BODY}`, "utf8").digest("hex");
    expect(header).toBe(`t=${t},v1=${expected}`);
  });

  it("verifies a fresh signature; rejects tampered body, wrong secret, stale and future t", () => {
    const header = signWebhookPayload(SECRET, RAW_BODY, NOW_SECONDS);
    const nowMs = (NOW_SECONDS + 1) * 1000;
    expect(verifyReckonSignature(RAW_BODY, header, SECRET, 300, nowMs)).toBe(true);
    expect(verifyReckonSignature(`${RAW_BODY} `, header, SECRET, 300, nowMs)).toBe(false);
    expect(verifyReckonSignature(RAW_BODY, header, `whsec_${"q".repeat(32)}`, 300, nowMs)).toBe(false);
    expect(
      verifyReckonSignature(RAW_BODY, signWebhookPayload(SECRET, RAW_BODY, NOW_SECONDS - 302), SECRET, 300, nowMs),
    ).toBe(false);
    expect(
      verifyReckonSignature(RAW_BODY, signWebhookPayload(SECRET, RAW_BODY, NOW_SECONDS + 302), SECRET, 300, nowMs),
    ).toBe(false);
    // Boundary: exactly at the tolerance edge the age is 300 → accepted.
    expect(
      verifyReckonSignature(RAW_BODY, signWebhookPayload(SECRET, RAW_BODY, NOW_SECONDS - 300), SECRET, 300, NOW_SECONDS * 1000),
    ).toBe(true);
  });

  it("rejects malformed headers: missing t, missing v1, garbage, non-numeric t", () => {
    const nowMs = (NOW_SECONDS + 1) * 1000;
    expect(verifyReckonSignature(RAW_BODY, "v1=abcdef", SECRET, 300, nowMs)).toBe(false);
    expect(verifyReckonSignature(RAW_BODY, `t=${NOW_SECONDS}`, SECRET, 300, nowMs)).toBe(false);
    expect(verifyReckonSignature(RAW_BODY, "nonsense", SECRET, 300, nowMs)).toBe(false);
    expect(
      verifyReckonSignature(RAW_BODY, `t=banana,v1=${"0".repeat(64)}`, SECRET, 300, nowMs),
    ).toBe(false);
    expect(verifyReckonSignature(RAW_BODY, "", SECRET, 300, nowMs)).toBe(false);
  });

  it("rejects a valid-length but wrong signature (constant-time comparison path)", () => {
    const header = signWebhookPayload(SECRET, RAW_BODY, NOW_SECONDS);
    const wrong = header.replace(/v1=[0-9a-f]{64}/, `v1=${"0".repeat(64)}`) as string;
    expect(wrong).not.toBe(header);
    expect(verifyReckonSignature(RAW_BODY, wrong, SECRET, 300, (NOW_SECONDS + 1) * 1000)).toBe(
      false,
    );
    // Length-mismatched signature (short v1) → false, never a throw.
    expect(
      verifyReckonSignature(RAW_BODY, `t=${NOW_SECONDS},v1=abcd`, SECRET, 300, (NOW_SECONDS + 1) * 1000),
    ).toBe(false);
    // Non-hex v1 decodes to a short buffer → length mismatch → false.
    expect(
      verifyReckonSignature(RAW_BODY, `t=${NOW_SECONDS},v1=${"z".repeat(64)}`, SECRET, 300, (NOW_SECONDS + 1) * 1000),
    ).toBe(false);
  });

  it("uppercase hex v1 verifies (Node hex-decode semantics, mirrored from the reference sample)", () => {
    const header = signWebhookPayload(SECRET, RAW_BODY, NOW_SECONDS);
    const upper = header.replace(/v1=([0-9a-f]+)/, (_m, hex: string) => `v1=${hex.toUpperCase()}`) as string;
    expect(verifyReckonSignature(RAW_BODY, upper, SECRET, 300, (NOW_SECONDS + 1) * 1000)).toBe(true);
  });

  it("header pieces tolerate spaces and extra fields (Stripe-style parsing)", () => {
    const header = signWebhookPayload(SECRET, RAW_BODY, NOW_SECONDS);
    expect(
      verifyReckonSignature(RAW_BODY, ` t=${NOW_SECONDS} , ${header.split(",")[1]} `, SECRET, 300, (NOW_SECONDS + 1) * 1000),
    ).toBe(true);
  });
});

describe("webhooks: retry + retention constants", () => {
  it("the documented posture is frozen: 3-day retry window, 30-day retention", () => {
    expect(WEBHOOK_RETRY_WINDOW_MS).toBe(3 * 24 * 60 * 60 * 1000);
    expect(WEBHOOK_EVENT_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("the shipped default schedule: 3 attempts, 100ms base, ×2, 30s cap", () => {
    const defaults = defaultWebhookRetryOptions();
    expect(defaults).toEqual({
      maxAttempts: WEBHOOK_DELIVERY_MAX_ATTEMPTS,
      baseMs: WEBHOOK_RETRY_BASE_DELAY_MS,
      factor: WEBHOOK_RETRY_BACKOFF_FACTOR,
      capMs: WEBHOOK_RETRY_CAP_MS,
      windowMs: WEBHOOK_RETRY_WINDOW_MS,
    });
    expect(WEBHOOK_DELIVERY_MAX_ATTEMPTS).toBe(3);
    expect(WEBHOOK_RETRY_BASE_DELAY_MS).toBe(100);
    expect(WEBHOOK_RETRY_BACKOFF_FACTOR).toBe(2);
    expect(WEBHOOK_RETRY_CAP_MS).toBe(30_000);
  });

  it("backoff doubles and caps: 100, 200, 400 … 30000", () => {
    expect(webhookBackoffMs(1)).toBe(100);
    expect(webhookBackoffMs(2)).toBe(200);
    expect(webhookBackoffMs(3)).toBe(400);
    expect(webhookBackoffMs(10)).toBe(30_000);
    expect(webhookBackoffMs(0)).toBe(100);
  });
});
