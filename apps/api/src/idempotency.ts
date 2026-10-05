import { IDEMPOTENCY_WINDOW_MS } from "@reckon/contracts";

/**
 * Store-and-replay idempotency map for POST routes (Determinism +
 * idempotency law, hardened S2-001 to full Stripe-style semantics):
 *
 * - Same key + same body (canonical content digest) → the ORIGINAL
 *   stored response is replayed with `Idempotent-Replayed: true` (the
 *   legacy lowercase `idempotent-replay` header is also sent during the
 *   transition so existing clients keep working).
 * - Same key + DIFFERENT body → 422 IDEMPOTENCY_CONFLICT (typed).
 * - Stored responses are replayable for 24 hours (IDEMPOTENCY_WINDOW_MS);
 *   after the window the key is forgotten — a later request with the same
 *   key (any body) executes fresh.
 * - Only responses that executed successfully (2xx, from a wired
 *   handler) are stored — 501 NotWired responses are never stored, so
 *   wiring a handler later changes behavior immediately.
 *
 * Lookups are scoped by (tenantId, route, key): cross-tenant replay is
 * structurally impossible (TENANT LAW).
 *
 * Persistence seam: external stores (e.g. the PostgreSQL-backed
 * PgIdempotencyStore from @reckon/persistence) implement the same
 * interface; entries that do not carry `storedAt` are treated as
 * non-expiring (the pipeline never evicts data it did not stamp).
 */
export interface StoredIdempotentResponse {
  readonly statusCode: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

export interface StoredIdempotent {
  /** Deterministic digest (contentDigest from @reckon/contracts) of the parsed request body. */
  readonly requestDigest: string;
  /** Epoch-ms when the response was stored; expiry is `storedAt + windowMs`. Absent = non-expiring. */
  readonly storedAt?: number;
  readonly response: StoredIdempotentResponse;
}

export interface IdempotencyStore {
  lookup(tenantId: string, routeKey: string, idempotencyKey: string): Promise<StoredIdempotent | undefined>;
  store(
    tenantId: string,
    routeKey: string,
    idempotencyKey: string,
    requestDigest: string,
    response: StoredIdempotentResponse,
  ): Promise<void>;
}

export interface InMemoryIdempotencyStoreOptions {
  /** Injected clock (default: Date.now) — deterministic tests. */
  readonly clock?: () => number;
  /** Replay window in ms (default: 24h per the frozen contract constant). */
  readonly windowMs?: number;
}

/** Default implementation: in-memory with the 24h replay window. */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  readonly #map = new Map<string, StoredIdempotent>();
  readonly #clock: () => number;
  readonly #windowMs: number;

  constructor(options: InMemoryIdempotencyStoreOptions = {}) {
    this.#clock = options.clock ?? (() => Date.now());
    this.#windowMs = options.windowMs ?? IDEMPOTENCY_WINDOW_MS;
  }

  get size(): number {
    return this.#map.size;
  }

  async lookup(tenantId: string, routeKey: string, idempotencyKey: string): Promise<StoredIdempotent | undefined> {
    const key = `${tenantId}|${routeKey}|${idempotencyKey}`;
    const stored = this.#map.get(key);
    if (stored === undefined) return undefined;
    if (this.isExpired(stored)) {
      this.#map.delete(key);
      return undefined;
    }
    return stored;
  }

  async store(
    tenantId: string,
    routeKey: string,
    idempotencyKey: string,
    requestDigest: string,
    response: StoredIdempotentResponse,
  ): Promise<void> {
    this.#map.set(`${tenantId}|${routeKey}|${idempotencyKey}`, {
      requestDigest,
      storedAt: this.#clock(),
      response,
    });
  }

  /** A stored entry is replayable only inside the window. */
  private isExpired(stored: StoredIdempotent): boolean {
    if (stored.storedAt === undefined) return false;
    return this.#clock() - stored.storedAt >= this.#windowMs;
  }
}
