import {
  WEBHOOK_EVENT_RETENTION_MS,
  WEBHOOK_SIGNATURE_HEADER,
  canonicalJson,
  defaultWebhookRetryOptions,
  generateWebhookDeliveryId,
  generateWebhookEndpointId,
  generateWebhookEventId,
  generateWebhookSigningSecret,
  signWebhookPayload,
  webhookBackoffMs,
  type ReckonEvent,
  type TenantScope,
  type WebhookDeliveryView,
  type WebhookEndpointCreated,
  type WebhookEndpointView,
  type WebhookEventType,
  type WebhookRetryOptions,
} from "@reckon/contracts";
import {
  webhookEndpointCreatedEvent,
  webhookEndpointDeletedEvent,
  type ReckonEventPublisher,
} from "@reckon/events";
import type { AuthContext } from "../types.js";
import type {
  WebhookCreateEndpointRequest,
  WebhookHandler,
  WebhookReplayResult,
} from "../ports.js";
import type {
  InMemoryWebhookSystemOptions,
  StoredWebhookDelivery,
  StoredWebhookEndpoint,
  WebhookDeliveryFilter,
  WebhookDeliveryStore,
  WebhookEndpointStore,
  WebhookEventStore,
  WebhookHttpClient,
  WebhookSystem,
} from "./ports.js";

/**
 * S2-002 — the in-memory webhook system: three stores + the delivery
 * engine implementing the WebhookHandler port AND the
 * ReckonEventPublisher emission seam.
 *
 * EVIDENCE LABEL: TEST INFRASTRUCTURE (controlled-local), exactly like
 * InMemoryIdempotencyStore / the wave-1 in-memory adapters. Production
 * persistence (PostgreSQL) is a later wave per the ADR-001 plan; the
 * ports in ./ports.ts are the seam it plugs into. Hosts and tests wire
 * it through buildServer({ webhooks }).
 *
 * DELIVERY LAWS (documented + tested):
 * - The raw body is the CANONICAL JSON of the event (deterministic
 *   serialization law) and the signature covers exactly those bytes.
 * - Attempt 1 runs inline at emission/replay; retries are scheduled
 *   with the deterministic exponential backoff over the INJECTED clock
 *   and driven by pump()/flush() — no hidden timers.
 * - A delivery is terminal `succeeded` on any 2xx; terminal `failed`
 *   after maxAttempts, when the retry window (3 days) is exhausted, or
 *   when its endpoint/event no longer exists — NEVER silently dropped;
 *   every state lands in the delivery log.
 */

/* ------------------------------------------------------------------ *
 * In-memory stores                                                      *
 * ------------------------------------------------------------------ */

function tenantKey(tenant: TenantScope): string {
  return `${tenant.tenantId}|${tenant.workspaceId ?? ""}`;
}

/** In-memory endpoint store (TEST INFRASTRUCTURE, controlled-local). */
export class InMemoryWebhookEndpointStore implements WebhookEndpointStore {
  readonly #records: StoredWebhookEndpoint[] = [];
  readonly #byId = new Map<string, number>();
  #nextSeq = 1;

  async put(endpoint: StoredWebhookEndpoint): Promise<StoredWebhookEndpoint> {
    const stored: StoredWebhookEndpoint = Object.freeze({ ...endpoint, seq: this.#nextSeq });
    this.#nextSeq += 1;
    this.#records.push(stored);
    this.#byId.set(`${tenantKey(endpoint.tenant)}|${endpoint.endpointId}`, this.#records.length - 1);
    return stored;
  }

  async get(tenant: TenantScope, endpointId: string): Promise<StoredWebhookEndpoint | null> {
    const index = this.#byId.get(`${tenantKey(tenant)}|${endpointId}`);
    return index === undefined ? null : this.#records[index] ?? null;
  }

  async list(tenant: TenantScope, limit?: number): Promise<readonly StoredWebhookEndpoint[]> {
    const scoped = this.#records.filter((record) => tenantKey(record.tenant) === tenantKey(tenant));
    const newestFirst = [...scoped].sort((a, b) => b.seq - a.seq);
    return limit === undefined ? newestFirst : newestFirst.slice(0, limit);
  }

  async listMatching(tenant: TenantScope, eventType: WebhookEventType): Promise<readonly StoredWebhookEndpoint[]> {
    const scoped = this.#records.filter((record) => tenantKey(record.tenant) === tenantKey(tenant));
    // Empty filter = every event type (documented).
    return scoped.filter((record) => record.eventTypes.length === 0 || record.eventTypes.includes(eventType));
  }

  async delete(tenant: TenantScope, endpointId: string): Promise<StoredWebhookEndpoint | null> {
    const index = this.#byId.get(`${tenantKey(tenant)}|${endpointId}`);
    if (index === undefined) return null;
    const removed = this.#records[index] ?? null;
    if (removed !== null) this.#records.splice(index, 1);
    this.#reindex();
    return removed;
  }

  #reindex(): void {
    this.#byId.clear();
    this.#records.forEach((record, index) => {
      this.#byId.set(`${tenantKey(record.tenant)}|${record.endpointId}`, index);
    });
  }
}

/** In-memory thin-event retention store (TEST INFRASTRUCTURE, controlled-local). */
export class InMemoryWebhookEventStore implements WebhookEventStore {
  readonly #events: ReckonEvent[] = [];

  async put(event: ReckonEvent): Promise<{ duplicate: boolean }> {
    if (this.#events.some((stored) => stored.id === event.id && tenantKey(stored.tenant) === tenantKey(event.tenant))) {
      return { duplicate: true };
    }
    this.#events.push(event);
    return { duplicate: false };
  }

  async get(tenant: TenantScope, eventId: string): Promise<ReckonEvent | null> {
    const found = this.#events.find((stored) => stored.id === eventId && tenantKey(stored.tenant) === tenantKey(tenant));
    return found ?? null;
  }

  async sweep(nowMs: number, retentionMs: number): Promise<number> {
    const cutoff = nowMs - retentionMs;
    let swept = 0;
    for (let index = this.#events.length - 1; index >= 0; index -= 1) {
      if ((this.#events[index]?.created ?? 0) < cutoff) {
        this.#events.splice(index, 1);
        swept += 1;
      }
    }
    return swept;
  }
}

/** In-memory delivery-log store (TEST INFRASTRUCTURE, controlled-local). */
export class InMemoryWebhookDeliveryStore implements WebhookDeliveryStore {
  readonly #records: StoredWebhookDelivery[] = [];
  #nextSeq = 1;

  async put(delivery: StoredWebhookDelivery): Promise<StoredWebhookDelivery> {
    const stored: StoredWebhookDelivery = { ...delivery, seq: this.#nextSeq };
    this.#nextSeq += 1;
    this.#records.push(stored);
    return stored;
  }

  async get(tenant: TenantScope, deliveryId: string): Promise<StoredWebhookDelivery | null> {
    const found = this.#records.find(
      (record) => record.id === deliveryId && tenantKey(record.tenant) === tenantKey(tenant),
    );
    return found === undefined ? null : { ...found };
  }

  async update(delivery: StoredWebhookDelivery): Promise<void> {
    const index = this.#records.findIndex((record) => record.id === delivery.id);
    if (index >= 0) this.#records[index] = { ...delivery };
  }

  async list(
    tenant: TenantScope,
    limit?: number,
    filter?: WebhookDeliveryFilter,
  ): Promise<readonly StoredWebhookDelivery[]> {
    let scoped = this.#records.filter((record) => tenantKey(record.tenant) === tenantKey(tenant));
    if (filter?.endpointId !== undefined) {
      scoped = scoped.filter((record) => record.endpointId === filter.endpointId);
    }
    if (filter?.eventId !== undefined) {
      scoped = scoped.filter((record) => record.eventId === filter.eventId);
    }
    const newestFirst = [...scoped].sort((a, b) => b.seq - a.seq);
    const page = limit === undefined ? newestFirst : newestFirst.slice(0, limit);
    return page.map((record) => ({ ...record }));
  }

  async listDue(nowMs: number, limit?: number): Promise<readonly StoredWebhookDelivery[]> {
    const due = this.#records
      .filter((record) => record.status === "pending" && record.nextAttemptAt !== null && record.nextAttemptAt <= nowMs)
      .sort((a, b) => a.seq - b.seq); // FIFO: oldest delivery first
    const bounded = limit === undefined ? due : due.slice(0, limit);
    return bounded.map((record) => ({ ...record }));
  }

  async countPending(): Promise<number> {
    return this.#records.filter((record) => record.status === "pending").length;
  }
}

/* ------------------------------------------------------------------ *
 * Views (contract-facing; internal fields stripped)                     *
 * ------------------------------------------------------------------ */

function endpointView(endpoint: StoredWebhookEndpoint): WebhookEndpointView {
  return {
    id: endpoint.endpointId,
    object: "webhook_endpoint",
    url: endpoint.url,
    ...(endpoint.description !== undefined ? { description: endpoint.description } : {}),
    eventTypes: [...endpoint.eventTypes],
    tenant: endpoint.tenant,
    status: endpoint.status,
    createdAt: endpoint.createdAt,
  };
}

function deliveryView(delivery: StoredWebhookDelivery): WebhookDeliveryView {
  return {
    id: delivery.id,
    object: "webhook_delivery",
    eventId: delivery.eventId,
    endpointId: delivery.endpointId,
    tenant: delivery.tenant,
    attempts: delivery.attempts,
    status: delivery.status,
    responseCode: delivery.responseCode,
    latencyMs: delivery.latencyMs,
    error: delivery.error,
    replayed: delivery.replayed,
    createdAt: delivery.createdAt,
    updatedAt: delivery.updatedAt,
  };
}

function authTenant(auth: AuthContext): TenantScope {
  return {
    tenantId: auth.tenantId,
    ...(auth.workspaceId !== undefined ? { workspaceId: auth.workspaceId } : {}),
  };
}

/* ------------------------------------------------------------------ *
 * The engine                                                            *
 * ------------------------------------------------------------------ */

export class InMemoryWebhookSystem implements WebhookSystem, WebhookHandler, ReckonEventPublisher {
  readonly #endpoints: WebhookEndpointStore;
  readonly #events: WebhookEventStore;
  readonly #deliveries: WebhookDeliveryStore;
  readonly #httpClient: WebhookHttpClient;
  readonly #clock: () => number;
  readonly #token: (length: number) => string;
  readonly #secretToken: (length: number) => string;
  readonly #retry: WebhookRetryOptions;
  readonly #timeoutMs: number;

  constructor(options: InMemoryWebhookSystemOptions) {
    this.#endpoints = options.endpointStore ?? new InMemoryWebhookEndpointStore();
    this.#events = options.eventStore ?? new InMemoryWebhookEventStore();
    this.#deliveries = options.deliveryStore ?? new InMemoryWebhookDeliveryStore();
    this.#httpClient = options.httpClient;
    this.#clock = options.clock ?? (() => Date.now());
    this.#token = options.tokenGenerator ?? randomBase62;
    this.#secretToken = options.secretTokenGenerator ?? randomBase62;
    this.#retry = { ...defaultWebhookRetryOptions(), ...options.retry };
    this.#timeoutMs = options.timeoutMs ?? 5_000;
  }

  clock(): number {
    return this.#clock();
  }

  retryOptions(): WebhookRetryOptions {
    return { ...this.#retry };
  }

  newEventId(): string {
    return generateWebhookEventId(this.#token);
  }

  /* ---------------- emission seam (ReckonEventPublisher) -------------- */

  /**
   * Emit one thin event: retain it (30-day replay window), then fan out
   * to every matching endpoint of the event's tenant with attempt 1
   * inline. Re-publishing the same (tenant, event.id) is a no-op
   * (duplicate) — the at-least-once producer dedupes at the seam.
   * NEVER throws: delivery failures land in the delivery log.
   */
  async publish(event: ReckonEvent): Promise<void> {
    try {
      await this.#events.sweep(this.#clock(), WEBHOOK_EVENT_RETENTION_MS);
      const { duplicate } = await this.#events.put(event);
      if (duplicate) return;
      for (const endpoint of await this.#endpoints.listMatching(event.tenant, event.type)) {
        await this.#startDelivery(event, endpoint, false);
      }
    } catch {
      // Total by law (ReckonEventPublisher contract): the delivery log
      // is the evidence surface; emission must never break a domain route.
    }
  }

  /* ---------------- retry worker -------------------------------------- */

  async pump(): Promise<number> {
    await this.#events.sweep(this.#clock(), WEBHOOK_EVENT_RETENTION_MS);
    const due = await this.#deliveries.listDue(this.#clock());
    for (const delivery of due) {
      // Retry-window guard (documented 3-day bound): terminal, never dropped.
      if (this.#clock() - delivery.createdAt > this.#retry.windowMs) {
        await this.#finish(delivery, {
          status: "failed",
          error: `retry window exhausted (${this.#retry.windowMs}ms) without a successful delivery`,
        });
        continue;
      }
      await this.#attempt(delivery);
    }
    return this.#deliveries.countPending();
  }

  async flush(): Promise<number> {
    // Pump while work is due (zero-delay backoff converges; bounded guard).
    for (let iteration = 0; iteration < 10_000; iteration += 1) {
      const due = await this.#deliveries.listDue(this.#clock());
      if (due.length === 0) return this.#deliveries.countPending();
      await this.pump();
    }
    return this.#deliveries.countPending();
  }

  /* ---------------- WebhookHandler: endpoint CRUD --------------------- */

  async createEndpoint(
    request: WebhookCreateEndpointRequest,
    auth: AuthContext,
  ): Promise<WebhookEndpointCreated> {
    const tenant = authTenant(auth);
    const endpointId = generateWebhookEndpointId(this.#token);
    const secret = generateWebhookSigningSecret(this.#secretToken);
    const stored = await this.#endpoints.put({
      endpointId,
      object: "webhook_endpoint",
      tenant,
      url: request.url,
      ...(request.description !== undefined ? { description: request.description } : {}),
      eventTypes: [...request.eventTypes],
      secret,
      status: "enabled",
      createdAt: this.#clock(),
      seq: 0,
    });
    // Delivery-lifecycle event (documented catalog): fires to every
    // matching endpoint — including this one when it filters on it.
    await this.publish(
      webhookEndpointCreatedEvent(
        { endpointId: stored.endpointId, url: stored.url, eventTypes: stored.eventTypes },
        tenant,
        { id: this.newEventId(), created: this.#clock() },
      ),
    );
    return { ...endpointView(stored), secret };
  }

  async listEndpoints(auth: AuthContext, limit?: number): Promise<readonly WebhookEndpointView[]> {
    const scoped = await this.#endpoints.list(authTenant(auth), limit);
    return scoped.map(endpointView);
  }

  async getEndpoint(endpointId: string, auth: AuthContext): Promise<WebhookEndpointView | null> {
    const found = await this.#endpoints.get(authTenant(auth), endpointId);
    return found === null ? null : endpointView(found);
  }

  async deleteEndpoint(endpointId: string, auth: AuthContext): Promise<WebhookEndpointView | null> {
    const tenant = authTenant(auth);
    const removed = await this.#endpoints.delete(tenant, endpointId);
    if (removed === null) return null;
    await this.publish(
      webhookEndpointDeletedEvent(
        { endpointId: removed.endpointId, url: removed.url },
        tenant,
        { id: this.newEventId(), created: this.#clock() },
      ),
    );
    return endpointView(removed);
  }

  /* ---------------- WebhookHandler: events + replay + log ------------- */

  async getEvent(eventId: string, auth: AuthContext): Promise<ReckonEvent | null> {
    return this.#events.get(authTenant(auth), eventId);
  }

  async replayEvent(eventId: string, auth: AuthContext): Promise<WebhookReplayResult | null> {
    const tenant = authTenant(auth);
    const event = await this.#events.get(tenant, eventId);
    if (event === null) return null;
    const deliveries: WebhookDeliveryView[] = [];
    // Re-deliver to the CURRENTLY matching endpoints (the documented
    // semantics: same event id, at-least-once, receivers dedupe).
    for (const endpoint of await this.#endpoints.listMatching(tenant, event.type)) {
      const record = await this.#startDelivery(event, endpoint, true);
      deliveries.push(deliveryView(record));
    }
    return { event, deliveries };
  }

  async listDeliveries(
    auth: AuthContext,
    limit?: number,
    filter?: WebhookDeliveryFilter,
  ): Promise<readonly WebhookDeliveryView[]> {
    const scoped = await this.#deliveries.list(authTenant(auth), limit, filter);
    return scoped.map(deliveryView);
  }

  /* ---------------- internal delivery machinery ----------------------- */

  /** Create a delivery record and run attempt 1 inline. */
  async #startDelivery(
    event: ReckonEvent,
    endpoint: StoredWebhookEndpoint,
    replayed: boolean,
  ): Promise<StoredWebhookDelivery> {
    const now = this.#clock();
    const record = await this.#deliveries.put({
      id: generateWebhookDeliveryId(this.#token),
      object: "webhook_delivery",
      eventId: event.id,
      endpointId: endpoint.endpointId,
      tenant: event.tenant,
      attempts: 0,
      status: "pending",
      responseCode: null,
      latencyMs: null,
      error: null,
      replayed,
      createdAt: now,
      updatedAt: now,
      nextAttemptAt: now,
      seq: 0,
    });
    await this.#attempt(record);
    return (await this.#deliveries.get(event.tenant, record.id)) ?? record;
  }

  /** One signed delivery attempt; updates the delivery log record. */
  async #attempt(input: StoredWebhookDelivery): Promise<void> {
    const record: StoredWebhookDelivery = { ...input };
    const event = await this.#events.get(record.tenant, record.eventId);
    if (event === null) {
      // Retention swept the event (or it never existed): terminal, recorded.
      await this.#finish(record, { status: "failed", error: `event ${record.eventId} no longer retained` });
      return;
    }
    const endpoint = await this.#endpoints.get(record.tenant, record.endpointId);
    if (endpoint === null) {
      await this.#finish(record, { status: "failed", error: `webhook endpoint ${record.endpointId} no longer exists` });
      return;
    }

    const rawBody = canonicalJson(event);
    const timestampSeconds = Math.floor(this.#clock() / 1000);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      [WEBHOOK_SIGNATURE_HEADER]: signWebhookPayload(endpoint.secret, rawBody, timestampSeconds),
    };

    record.attempts += 1;
    try {
      const response = await this.#httpClient.post(endpoint.url, headers, rawBody, {
        timeoutMs: this.#timeoutMs,
      });
      record.responseCode = response.statusCode;
      record.latencyMs = response.latencyMs;
      if (response.statusCode >= 200 && response.statusCode < 300) {
        await this.#finish(record, { status: "succeeded", error: null });
        return;
      }
      const failure = `http ${response.statusCode}`;
      if (record.attempts >= this.#retry.maxAttempts) {
        await this.#finish(record, { status: "failed", error: failure });
        return;
      }
      await this.#finish(record, { status: "pending", error: failure, scheduleRetry: true, attempts: record.attempts });
      return;
    } catch (error) {
      record.responseCode = null;
      record.latencyMs = null;
      const message = error instanceof Error ? error.message : String(error);
      if (record.attempts >= this.#retry.maxAttempts) {
        await this.#finish(record, { status: "failed", error: message });
        return;
      }
      await this.#finish(record, { status: "pending", error: message, scheduleRetry: true, attempts: record.attempts });
    }
  }

  /** Commit a terminal/pending state to the delivery store. */
  async #finish(
    record: StoredWebhookDelivery,
    outcome: {
      status: "pending" | "succeeded" | "failed";
      error: string | null;
      scheduleRetry?: boolean;
      attempts?: number;
    },
  ): Promise<void> {
    const updated: StoredWebhookDelivery = {
      ...record,
      attempts: outcome.attempts ?? record.attempts,
      status: outcome.status,
      error: outcome.error,
      updatedAt: this.#clock(),
      nextAttemptAt:
        outcome.scheduleRetry === true
          ? this.#clock() + webhookBackoffMs(record.attempts, this.#retry)
          : null,
    };
    await this.#deliveries.update(updated);
  }
}

/** Crypto-random base62 token (the default id/secret generator). */
function randomBase62(length: number): string {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let token = "";
  for (let index = 0; index < length; index += 1) {
    token += ALPHABET[(bytes[index] ?? 0) % ALPHABET.length];
  }
  return token;
}

/**
 * Build the in-memory webhook system (endpoints + events + deliveries +
 * engine). `httpClient` is required: tests inject recorders/failing
 * clients; production hosts inject FetchWebhookHttpClient (http.ts) or
 * their own adapter.
 */
export function createInMemoryWebhookSystem(options: InMemoryWebhookSystemOptions): InMemoryWebhookSystem {
  return new InMemoryWebhookSystem(options);
}

/** Deterministic monotonic clock for tests (ManualClock-style). */
export class ManualWebhookClock {
  #now: number;
  constructor(startAt: number = 1_000_000) {
    this.#now = startAt;
  }
  now(): number {
    return this.#now;
  }
  advance(ms: number): number {
    this.#now += ms;
    return this.#now;
  }
  set(now: number): number {
    this.#now = now;
    return this.#now;
  }
}
