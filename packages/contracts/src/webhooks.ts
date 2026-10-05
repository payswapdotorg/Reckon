import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod/v4";
import { IdSchema, TenantScopeSchema, TimestampMsSchema } from "./primitives.js";
import { SubjectReferenceSchema } from "./domain.js";
import { ScheduleActionSchema } from "./decision.js";
import { PREFERENCE_UPDATE_OPS } from "./preferences.js";
import type { KeyTokenGenerator } from "./api-platform.js";
import { API_KEY_TOKEN_ALPHABET } from "./api-platform.js";

/**
 * S2-002 — recommendation webhook contracts.
 *
 * This module EXTENDS the frozen contract surface additively: every type
 * here is new; no existing exported shape changes. It is the single
 * source of truth for the webhook target contract already documented by
 * the docs portal (apps/docs/src/content/webhooks.ts — S1-004 froze the
 * DOC; this file freezes the CODE; the two must stay in lockstep and the
 * apps/api test webhook-catalog.test.ts proves it by validating the docs
 * payload examples against these schemas).
 *
 * Implemented laws (per the documented contract):
 * - THIN EVENTS: `{id, object:"event", type, created, tenant, data:{object}}`
 *   where `data.object` carries ids + timestamps only; one GET (or an
 *   `?expand[]`) fetches the full frozen record.
 * - SIGNATURE: `Reckon-Signature: t=<unix-seconds>,v1=<hex>` — HMAC-SHA256
 *   over `"{t}.{rawBody}"` with the endpoint's `whsec_…` signing secret;
 *   5-minute tolerance on `t`; constant-time comparison.
 * - AT-LEAST-ONCE DELIVERY: the same event can arrive more than once;
 *   receivers dedupe on `event.id`. Replays reuse the SAME event id.
 * - RETENTION: events are retained for replay for 30 days.
 */

/* ================================================================== *
 * 1. Event catalog (types + thin payload schemas)
 * ================================================================== */

/**
 * The webhook event catalog. The first four are the documented loop
 * events (docs "Event catalog"); the last two are the delivery-lifecycle
 * events that fire when a tenant manages its webhook endpoints.
 */
export const WEBHOOK_EVENT_TYPES = [
  "recommendation.delivered",
  "model.drift.detected",
  "schedule.executed",
  "preference.updated",
  "webhook.endpoint.created",
  "webhook.endpoint.deleted",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];
export const WebhookEventTypeSchema = z.enum(WEBHOOK_EVENT_TYPES);

/** `recommendation.delivered` — a decision's experience became user-visible (host delivery confirmation). */
export const RecommendationDeliveredDataSchema = z.object({
  decisionId: IdSchema,
  requestId: IdSchema,
  experienceId: IdSchema,
  itemId: IdSchema,
  /** Only SUGGEST/SWITCH decisions are "delivered" (documented semantics). */
  action: z.enum(["SUGGEST", "SWITCH"]),
  deliveredAt: TimestampMsSchema,
});
export type RecommendationDeliveredData = z.infer<typeof RecommendationDeliveredDataSchema>;

/** `model.drift.detected` — a monitored model crossed its drift threshold. */
export const ModelDriftDetectedDataSchema = z.object({
  modelId: z.string().min(1).max(128),
  modelVersion: z.string().min(1).max(64),
  driftScore: z.number().nonnegative(),
  threshold: z.number().nonnegative(),
  /** Evaluation window label (opaque to the core, e.g. "72h"). */
  window: z.string().min(1).max(32),
  metric: z.string().min(1).max(128),
  evaluatedAt: TimestampMsSchema,
});
export type ModelDriftDetectedData = z.infer<typeof ModelDriftDetectedDataSchema>;

/** `schedule.executed` — the scheduler executed a plan's schedule delta. */
export const ScheduleExecutedDataSchema = z.object({
  planId: IdSchema,
  decisionId: IdSchema,
  action: ScheduleActionSchema,
  enqueued: z.array(IdSchema),
  dequeued: z.array(IdSchema),
  executedAt: TimestampMsSchema,
});
export type ScheduleExecutedData = z.infer<typeof ScheduleExecutedDataSchema>;

/** `preference.updated` — learning appended a preference delta for a subject. */
export const PreferenceUpdatedDataSchema = z.object({
  deltaId: IdSchema,
  subject: SubjectReferenceSchema,
  dimension: z.string().min(1).max(256),
  op: z.enum(PREFERENCE_UPDATE_OPS),
  resultingConfidence: z.number().min(0).max(1).optional(),
  modelId: z.string().min(1).max(128),
  modelVersion: z.string().min(1).max(64),
});
export type PreferenceUpdatedData = z.infer<typeof PreferenceUpdatedDataSchema>;

/** `webhook.endpoint.created` — a tenant registered a webhook endpoint. */
export const WebhookEndpointCreatedDataSchema = z.object({
  endpointId: IdSchema,
  url: z.string().min(11).max(2048),
  eventTypes: z.array(WebhookEventTypeSchema),
});
export type WebhookEndpointCreatedData = z.infer<typeof WebhookEndpointCreatedDataSchema>;

/** `webhook.endpoint.deleted` — a tenant deleted a webhook endpoint. */
export const WebhookEndpointDeletedDataSchema = z.object({
  endpointId: IdSchema,
  url: z.string().min(11).max(2048),
});
export type WebhookEndpointDeletedData = z.infer<typeof WebhookEndpointDeletedDataSchema>;

/** The thin-event envelope fields shared by every event type. */
const eventEnvelopeFields = {
  id: IdSchema,
  object: z.literal("event"),
  created: TimestampMsSchema,
  tenant: TenantScopeSchema,
} as const;

/**
 * A Reckon webhook event (discriminated by `type`): the THIN envelope
 * every delivery POSTs and every replay re-sends verbatim. `data.object`
 * is typed per event type (the catalog payload schemas above).
 */
export const ReckonEventSchema = z.discriminatedUnion("type", [
  z.object({
    ...eventEnvelopeFields,
    type: z.literal("recommendation.delivered"),
    data: z.object({ object: RecommendationDeliveredDataSchema }),
  }),
  z.object({
    ...eventEnvelopeFields,
    type: z.literal("model.drift.detected"),
    data: z.object({ object: ModelDriftDetectedDataSchema }),
  }),
  z.object({
    ...eventEnvelopeFields,
    type: z.literal("schedule.executed"),
    data: z.object({ object: ScheduleExecutedDataSchema }),
  }),
  z.object({
    ...eventEnvelopeFields,
    type: z.literal("preference.updated"),
    data: z.object({ object: PreferenceUpdatedDataSchema }),
  }),
  z.object({
    ...eventEnvelopeFields,
    type: z.literal("webhook.endpoint.created"),
    data: z.object({ object: WebhookEndpointCreatedDataSchema }),
  }),
  z.object({
    ...eventEnvelopeFields,
    type: z.literal("webhook.endpoint.deleted"),
    data: z.object({ object: WebhookEndpointDeletedDataSchema }),
  }),
]);
export type ReckonEvent = z.infer<typeof ReckonEventSchema>;

/* ================================================================== *
 * 2. Webhook endpoint resource (registration contract)
 * ================================================================== */

/** A webhook endpoint url: https, no whitespace, <= 2048 chars. */
export const WebhookUrlSchema = z
  .string()
  .min(11)
  .max(2048)
  .regex(/^https:\/\/[^\s/$.#][^\s]*$/, "webhook endpoint url must be a well-formed https:// URL");
export type WebhookUrl = z.infer<typeof WebhookUrlSchema>;

/**
 * POST /v1/webhooks/endpoints request. `eventTypes` is the delivery
 * filter: an EMPTY array means "deliver every event type" (documented).
 */
export const WebhookEndpointCreateSchema = z.object({
  url: WebhookUrlSchema,
  description: z.string().min(1).max(256).optional(),
  eventTypes: z.array(WebhookEventTypeSchema).default([]),
});
export type WebhookEndpointCreate = z.infer<typeof WebhookEndpointCreateSchema>;

/** The endpoint resource view (no signing secret — that is issued once at creation). */
export const WebhookEndpointViewSchema = z.object({
  id: IdSchema,
  object: z.literal("webhook_endpoint"),
  url: WebhookUrlSchema,
  description: z.string().min(1).max(256).optional(),
  eventTypes: z.array(WebhookEventTypeSchema),
  tenant: TenantScopeSchema,
  status: z.enum(["enabled"]),
  createdAt: TimestampMsSchema,
});
export type WebhookEndpointView = z.infer<typeof WebhookEndpointViewSchema>;

/** The creation response: the endpoint view plus the ONE-TIME signing secret. */
export const WebhookEndpointCreatedSchema = WebhookEndpointViewSchema.extend({
  secret: z.string().regex(/^whsec_[A-Za-z0-9]{24,256}$/),
});
export type WebhookEndpointCreated = z.infer<typeof WebhookEndpointCreatedSchema>;

/* ================================================================== *
 * 3. Delivery log record (queryable delivery evidence)
 * ================================================================== */

/** One delivery (original or replay) of one event to one endpoint. */
export const WebhookDeliveryViewSchema = z.object({
  id: IdSchema,
  object: z.literal("webhook_delivery"),
  eventId: IdSchema,
  endpointId: IdSchema,
  tenant: TenantScopeSchema,
  /** Total attempts consumed so far (0 = not yet attempted). */
  attempts: z.number().int().nonnegative(),
  status: z.enum(["pending", "succeeded", "failed"]),
  /** Last attempt's HTTP status code (null when the attempt errored before a response). */
  responseCode: z.number().int().min(100).max(599).nullable(),
  /** Last attempt's latency in ms (null when no attempt completed). */
  latencyMs: z.number().nonnegative().nullable(),
  /** Last attempt's failure summary (null when none). */
  error: z.string().nullable(),
  /** True when this delivery was created by POST …/events/{id}/replay. */
  replayed: z.boolean(),
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
});
export type WebhookDeliveryView = z.infer<typeof WebhookDeliveryViewSchema>;

/** POST /v1/webhooks/events/{id}/replay response: the event + the replay deliveries. */
export const WebhookReplayResponseSchema = z.object({
  event: ReckonEventSchema,
  deliveries: z.array(WebhookDeliveryViewSchema),
});
export type WebhookReplayResponse = z.infer<typeof WebhookReplayResponseSchema>;

/* ================================================================== *
 * 4. Signing secrets (whsec_…)
 * ================================================================== */

/** Signing-secret prefix (documented: per-endpoint `whsec_…` secret). */
export const WEBHOOK_SIGNING_SECRET_PREFIX = "whsec_" as const;
/** Minimum base62 token length after the prefix. */
export const WEBHOOK_SIGNING_SECRET_MIN_TOKEN_LENGTH = 24;
/** Generated token length (~190 bits of entropy). */
export const WEBHOOK_SIGNING_SECRET_GENERATED_TOKEN_LENGTH = 32;

/** A well-formed webhook signing secret (whsec_ + base62 token). */
export const WebhookSigningSecretSchema = z
  .string()
  .min(WEBHOOK_SIGNING_SECRET_PREFIX.length + WEBHOOK_SIGNING_SECRET_MIN_TOKEN_LENGTH)
  .max(WEBHOOK_SIGNING_SECRET_PREFIX.length + 256)
  .regex(
    new RegExp(`^${WEBHOOK_SIGNING_SECRET_PREFIX}[A-Za-z0-9]{${WEBHOOK_SIGNING_SECRET_MIN_TOKEN_LENGTH},}$`),
    `signing secret must be ${WEBHOOK_SIGNING_SECRET_PREFIX} followed by at least ${WEBHOOK_SIGNING_SECRET_MIN_TOKEN_LENGTH} base62 characters`,
  );
export type WebhookSigningSecret = z.infer<typeof WebhookSigningSecretSchema>;

function defaultWebhookTokenGenerator(length: number): string {
  const bytes = randomBytes(length);
  let token = "";
  for (let index = 0; index < length; index += 1) {
    token += API_KEY_TOKEN_ALPHABET[(bytes[index] ?? 0) % API_KEY_TOKEN_ALPHABET.length];
  }
  return token;
}

/**
 * Generate a new webhook signing secret. Secrets are ISSUED, never
 * discovered: the engine mints one per endpoint at creation and never
 * returns it again after the creation response (the same provisioning
 * posture as the S2-001 key model).
 */
export function generateWebhookSigningSecret(
  generateToken: KeyTokenGenerator = defaultWebhookTokenGenerator,
): string {
  return `${WEBHOOK_SIGNING_SECRET_PREFIX}${generateToken(WEBHOOK_SIGNING_SECRET_GENERATED_TOKEN_LENGTH)}`;
}

/* ================================================================== *
 * 5. Id prefixes + generators (evt_ / we_ / wd_)
 * ================================================================== */

export const WEBHOOK_EVENT_ID_PREFIX = "evt_" as const;
export const WEBHOOK_ENDPOINT_ID_PREFIX = "we_" as const;
export const WEBHOOK_DELIVERY_ID_PREFIX = "wd_" as const;
/** Generated id token length (base62, IdSchema-compatible). */
export const WEBHOOK_ID_TOKEN_LENGTH = 24;

function webhookId(
  prefix: string,
  generateToken: KeyTokenGenerator | undefined,
): string {
  const token = (generateToken ?? defaultWebhookTokenGenerator)(WEBHOOK_ID_TOKEN_LENGTH);
  return `${prefix}${token}`;
}

/** A new event id (`evt_…`). */
export function generateWebhookEventId(generateToken?: KeyTokenGenerator): string {
  return webhookId(WEBHOOK_EVENT_ID_PREFIX, generateToken);
}

/** A new endpoint id (`we_…`). */
export function generateWebhookEndpointId(generateToken?: KeyTokenGenerator): string {
  return webhookId(WEBHOOK_ENDPOINT_ID_PREFIX, generateToken);
}

/** A new delivery id (`wd_…`). */
export function generateWebhookDeliveryId(generateToken?: KeyTokenGenerator): string {
  return webhookId(WEBHOOK_DELIVERY_ID_PREFIX, generateToken);
}

/* ================================================================== *
 * 6. HMAC signatures (t=<unix-seconds>,v1=<hex>)
 * ================================================================== */

/** Header carrying the delivery signature (HTTP wire name is lowercase). */
export const WEBHOOK_SIGNATURE_HEADER = "reckon-signature" as const;
/** Canonical header spelling (documentation / clients). */
export const WEBHOOK_SIGNATURE_HEADER_CANONICAL = "Reckon-Signature" as const;
/** Timestamp tolerance on `t=` (seconds) — the replay-window guard. */
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Sign a webhook delivery payload. The signature is HMAC-SHA256 over
 * `"{t}.{rawBody}"` (the unix-seconds timestamp, a dot, then the RAW
 * request body exactly as sent) with the endpoint's signing secret —
 * the documented scheme, byte for byte.
 */
export function signWebhookPayload(secret: string, rawBody: string, timestampSeconds: number): string {
  const t = String(Math.floor(timestampSeconds));
  const v1 = createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest("hex");
  return `t=${t},v1=${v1}`;
}

/**
 * Verify a Reckon webhook signature — the REFERENCE implementation,
 * algorithmically identical to the docs' TypeScript + Python samples
 * (apps/docs/src/content/webhooks.ts): parse `t=`/`v1=` from the
 * comma-separated header, enforce the timestamp tolerance against
 * `nowMs`, recompute the HMAC over `"{t}.{rawBody}"` and compare in
 * CONSTANT TIME (`timingSafeEqual` after a length check).
 *
 * `nowMs` is injectable for deterministic tests; the default is
 * `Date.now()` exactly like the documented sample.
 */
export function verifyReckonSignature(
  rawBody: string,
  header: string,
  secret: string,
  toleranceSeconds: number = WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
  nowMs: number = Date.now(),
): boolean {
  const parts = new Map<string, string>();
  for (const piece of header.split(",")) {
    const eq = piece.indexOf("=");
    if (eq > 0) parts.set(piece.slice(0, eq).trim(), piece.slice(eq + 1).trim());
  }
  const timestamp = parts.get("t");
  const signature = parts.get("v1");
  if (timestamp === undefined || signature === undefined) return false;

  const age = Math.abs(nowMs / 1000 - Number(timestamp));
  if (Number.isNaN(age) || age > toleranceSeconds) return false; // replay guard

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ================================================================== *
 * 7. Delivery retry + retention policy (documented posture)
 * ================================================================== */

/**
 * Default retry policy for a failed delivery: 3 total attempts with
 * exponential backoff (100ms base, ×2, capped at 30s) over an injected
 * clock — fully deterministic, testable. The overall retry window
 * (WEBHOOK_RETRY_WINDOW_MS, 3 days per the docs) bounds the schedule:
 * a delivery still pending after the window is terminally failed
 * without further attempts. Production compositions may widen the
 * schedule to fill the full documented window.
 */
export const WEBHOOK_DELIVERY_MAX_ATTEMPTS = 3;
export const WEBHOOK_RETRY_BASE_DELAY_MS = 100;
export const WEBHOOK_RETRY_BACKOFF_FACTOR = 2;
export const WEBHOOK_RETRY_CAP_MS = 30_000;
/** Docs: "Failed deliveries retry with exponential backoff for up to 3 days." */
export const WEBHOOK_RETRY_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
/** Docs: "Events are retained for replay for 30 days." */
export const WEBHOOK_EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Per-attempt delivery timeout for the HTTP client port. */
export const WEBHOOK_DELIVERY_TIMEOUT_MS = 5_000;

/** The engine's retry schedule (all knobs injectable — deterministic tests). */
export interface WebhookRetryOptions {
  readonly maxAttempts: number;
  readonly baseMs: number;
  readonly factor: number;
  readonly capMs: number;
  readonly windowMs: number;
}

/** The shipped default retry schedule (constants above). */
export function defaultWebhookRetryOptions(): WebhookRetryOptions {
  return {
    maxAttempts: WEBHOOK_DELIVERY_MAX_ATTEMPTS,
    baseMs: WEBHOOK_RETRY_BASE_DELAY_MS,
    factor: WEBHOOK_RETRY_BACKOFF_FACTOR,
    capMs: WEBHOOK_RETRY_CAP_MS,
    windowMs: WEBHOOK_RETRY_WINDOW_MS,
  };
}

/** Deterministic backoff: delay ms before retry attempt N (1-based, capped). */
export function webhookBackoffMs(attempt: number, options: WebhookRetryOptions = defaultWebhookRetryOptions()): number {
  const n = Math.max(1, attempt);
  return Math.min(options.baseMs * options.factor ** (n - 1), options.capMs);
}
