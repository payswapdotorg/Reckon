/**
 * Store-and-replay idempotency map for POST routes (Determinism +
 * idempotency law). A repeated key on the same tenant + route replays the
 * ORIGINAL response; the same key with a different request body is a 409
 * IDEMPOTENCY_CONFLICT. Only responses that executed successfully (2xx,
 * from a wired handler) are stored — 501 NotWired responses are never
 * stored, so wiring a handler later changes behavior immediately.
 *
 * Lookups are scoped by (tenantId, route, key): cross-tenant replay is
 * structurally impossible (TENANT LAW).
 */
export interface StoredIdempotentResponse {
  readonly statusCode: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

export interface StoredIdempotent {
  /** Deterministic digest (contentDigest from @reckon/contracts) of the parsed request body. */
  readonly requestDigest: string;
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

/** In-memory default. Persistence arrives in later waves (ADR-001). */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  readonly #map = new Map<string, StoredIdempotent>();

  get size(): number {
    return this.#map.size;
  }

  async lookup(tenantId: string, routeKey: string, idempotencyKey: string): Promise<StoredIdempotent | undefined> {
    return this.#map.get(`${tenantId}|${routeKey}|${idempotencyKey}`);
  }

  async store(
    tenantId: string,
    routeKey: string,
    idempotencyKey: string,
    requestDigest: string,
    response: StoredIdempotentResponse,
  ): Promise<void> {
    this.#map.set(`${tenantId}|${routeKey}|${idempotencyKey}`, { requestDigest, response });
  }
}
