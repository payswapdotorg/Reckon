import type {
  ReckonEvent,
  TenantScope,
  TimestampMs,
  WebhookEventType,
  WebhookRetryOptions,
} from "@reckon/contracts";
import type { ReckonEventPublisher } from "@reckon/events";
import type { WebhookHandler } from "../ports.js";

/**
 * S2-002 — webhook delivery engine PORTS (apps/api).
 *
 * The engine owns three stores (endpoints, events, deliveries) and one
 * outbound HTTP port; every store is tenant-scoped BY INTERFACE (the
 * same structural tenant law as the wave-1 EventStore). The
 * in-memory adapters (in-memory.ts) are TEST INFRASTRUCTURE
 * (controlled-local) and the seam a PostgreSQL wave plugs into; the
 * real outbound POST is the WebhookHttpClient port (http.ts ships the
 * fetch-based production adapter).
 *
 * DELIVERY SEMANTICS (frozen with the documented contract):
 * - AT-LEAST-ONCE: an event can be delivered (and re-delivered via
 *   replay) more than once; receivers dedupe on event.id.
 * - DETERMINISTIC RETRY: retries are scheduled by the injected clock
 *   with the frozen exponential backoff — no hidden timers.
 * - TERMINAL, NEVER DROPPED: exhausted deliveries land in the delivery
 *   log as `failed` with the last response code / error.
 */

/* ------------------------------------------------------------------ *
 * Endpoint store                                                        *
 * ------------------------------------------------------------------ */

/**
 * A registered webhook endpoint. The RAW signing secret is retained
 * (the engine signs with it); it never leaves the store except ONCE,
 * in the creation response. The production PG adapter is responsible
 * for encrypting it at rest.
 */
export interface StoredWebhookEndpoint {
  readonly endpointId: string;
  readonly object: "webhook_endpoint";
  readonly tenant: TenantScope;
  readonly url: string;
  readonly description?: string;
  /** Delivery filter — EMPTY means every event type (documented). */
  readonly eventTypes: readonly WebhookEventType[];
  readonly secret: string;
  readonly status: "enabled";
  readonly createdAt: TimestampMs;
  /** Store-assigned insertion order (stable newest-first tie-break). */
  readonly seq: number;
}

/** Tenant-scoped endpoint persistence (list = newest first). */
export interface WebhookEndpointStore {
  put(endpoint: StoredWebhookEndpoint): Promise<StoredWebhookEndpoint>;
  get(tenant: TenantScope, endpointId: string): Promise<StoredWebhookEndpoint | null>;
  /** Newest first, bounded by `limit`. */
  list(tenant: TenantScope, limit?: number): Promise<readonly StoredWebhookEndpoint[]>;
  /** Endpoints whose event-type filter matches `eventType` (empty filter = match). */
  listMatching(tenant: TenantScope, eventType: WebhookEventType): Promise<readonly StoredWebhookEndpoint[]>;
  /** Remove; returns the removed record (null when unknown in this tenant). */
  delete(tenant: TenantScope, endpointId: string): Promise<StoredWebhookEndpoint | null>;
}

/* ------------------------------------------------------------------ *
 * Event store (replay retention)                                        *
 * ------------------------------------------------------------------ */

/** Tenant-scoped thin-event retention (docs: 30 days). */
export interface WebhookEventStore {
  /**
   * Append an event. Idempotent per (tenant, event.id): re-publishing
   * the same id returns duplicate:true and the engine does NOT fan out
   * again (at-least-once producer, one delivery fan-out per publish).
   */
  put(event: ReckonEvent): Promise<{ duplicate: boolean }>;
  get(tenant: TenantScope, eventId: string): Promise<ReckonEvent | null>;
  /** Drop events older than the retention window; returns the count swept. */
  sweep(now: TimestampMs, retentionMs: number): Promise<number>;
}

/* ------------------------------------------------------------------ *
 * Delivery store (the delivery log)                                     *
 * ------------------------------------------------------------------ */

/** The full delivery record (internal retry bookkeeping included). */
export interface StoredWebhookDelivery {
  readonly id: string;
  readonly object: "webhook_delivery";
  readonly eventId: string;
  readonly endpointId: string;
  readonly tenant: TenantScope;
  /** Attempts consumed so far (0 = not yet attempted). */
  attempts: number;
  status: "pending" | "succeeded" | "failed";
  /** Last attempt's HTTP status code (null when the attempt errored pre-response). */
  responseCode: number | null;
  /** Last attempt's latency in ms (null when no attempt completed). */
  latencyMs: number | null;
  /** Last attempt's failure summary (null when none). */
  error: string | null;
  /** True when created by POST /v1/webhooks/events/{id}/replay. */
  replayed: boolean;
  readonly createdAt: TimestampMs;
  updatedAt: number;
  /** Next scheduled attempt (null when none scheduled). Internal field — stripped from API views. */
  nextAttemptAt: number | null;
  /** Store-assigned insertion order (stable newest-first tie-break). */
  readonly seq: number;
}

/** Optional delivery-log filters (all tenant-scoped on top). */
export interface WebhookDeliveryFilter {
  readonly endpointId?: string;
  readonly eventId?: string;
}

/** Tenant-scoped delivery-log persistence (list = newest first). */
export interface WebhookDeliveryStore {
  put(delivery: StoredWebhookDelivery): Promise<StoredWebhookDelivery>;
  get(tenant: TenantScope, deliveryId: string): Promise<StoredWebhookDelivery | null>;
  update(delivery: StoredWebhookDelivery): Promise<void>;
  /** Newest first, bounded by `limit`, optional filters. */
  list(
    tenant: TenantScope,
    limit?: number,
    filter?: WebhookDeliveryFilter,
  ): Promise<readonly StoredWebhookDelivery[]>;
  /** Every pending delivery DUE at `nowMs` (engine worker view — the records themselves stay tenant-scoped). */
  listDue(nowMs: number, limit?: number): Promise<readonly StoredWebhookDelivery[]>;
  /** Total pending (undelivered, retryable) deliveries — the worker's backlog size. */
  countPending(): Promise<number>;
}

/* ------------------------------------------------------------------ *
 * Outbound HTTP port                                                    *
 * ------------------------------------------------------------------ */

/** One outbound POST result. A THROWN error = transient/transport failure → retry. */
export interface WebhookHttpResponse {
  readonly statusCode: number;
  readonly latencyMs: number;
}

/**
 * The outbound delivery POST. Implementations MUST send `rawBody`
 * byte-for-byte (the signature covers exactly those bytes) with the
 * supplied headers (Content-Type + Reckon-Signature). Non-2xx status
 * codes are RETURNED (the engine decides retry); transport errors are
 * THROWN.
 */
export interface WebhookHttpClient {
  post(
    url: string,
    headers: Record<string, string>,
    rawBody: string,
    options?: { readonly timeoutMs?: number },
  ): Promise<WebhookHttpResponse>;
}

/* ------------------------------------------------------------------ *
 * The composed system                                                    *
 * ------------------------------------------------------------------ */

/**
 * The full webhook system mounted by buildServer: the WebhookHandler
 * port surface (routes), the ReckonEventPublisher surface (domain
 * emission seam) and the deterministic worker pump/flush.
 */
export interface WebhookSystem extends WebhookHandler, ReckonEventPublisher {
  /** Delivery clock (injected — deterministic tests). */
  clock(): number;
  /** Mint a new event id (evt_…). */
  newEventId(): string;
  /** Attempt delivery of every pending delivery DUE per the clock. Returns the pending count. */
  pump(): Promise<number>;
  /** Pump while progress is being made. Advance the clock (or wait) and flush again. */
  flush(): Promise<number>;
  /** The retry schedule in force (documented posture). */
  retryOptions(): WebhookRetryOptions;
}

/** Options for the shipped in-memory system (createInMemoryWebhookSystem). */
export interface InMemoryWebhookSystemOptions {
  /** Outbound delivery POST (required — tests inject a recorder/failing client). */
  readonly httpClient: WebhookHttpClient;
  /** Injected clock (default: Date.now). */
  readonly clock?: () => number;
  /** Event/endpoint/delivery id token generator (default: crypto-random base62). */
  readonly tokenGenerator?: (length: number) => string;
  /** Signing-secret token generator (default: crypto-random base62). */
  readonly secretTokenGenerator?: (length: number) => string;
  /** Retry schedule overrides (defaults: the frozen contracts constants). */
  readonly retry?: Partial<WebhookRetryOptions>;
  /** Per-attempt delivery timeout passed to the HTTP client (default 5s). */
  readonly timeoutMs?: number;
  /** Inject custom stores (tests / alternative embeddings); default: the in-memory adapters. */
  readonly endpointStore?: WebhookEndpointStore;
  readonly eventStore?: WebhookEventStore;
  readonly deliveryStore?: WebhookDeliveryStore;
}
