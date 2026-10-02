/**
 * PgIdempotencyStore — durable route idempotency (P1-003).
 *
 * Structurally satisfies the IdempotencyStore port declared in
 * apps/api/src/idempotency.ts (same method signatures — TypeScript
 * structural typing mounts it directly behind the API routes):
 *
 * - lookup(tenantId, routeKey, idempotencyKey)
 * - store(tenantId, routeKey, idempotencyKey, requestDigest, response)
 *
 * Semantics mirror the in-memory Map implementation exactly: the LAST
 * stored response for a key wins (Map.set overwrite). The route layer
 * only stores once per executed key, so in practice first-write-wins.
 * Tenant scoping is structural (PK includes tenant_id).
 */
import type { SqlExecutor } from "./executor.js";

export interface StoredIdempotentResponse {
  readonly statusCode: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

export interface StoredIdempotent {
  readonly requestDigest: string;
  readonly response: StoredIdempotentResponse;
}

export class PgIdempotencyStore {
  readonly #executor: SqlExecutor;

  constructor(executor: SqlExecutor) {
    this.#executor = executor;
  }

  async lookup(
    tenantId: string,
    routeKey: string,
    idempotencyKey: string,
  ): Promise<StoredIdempotent | undefined> {
    const rows = await this.#executor.query(
      `SELECT request_digest, status_code, response_body, response_headers
       FROM idempotent_responses
       WHERE tenant_id = $1 AND route_key = $2 AND idempotency_key = $3`,
      [tenantId, routeKey, idempotencyKey],
    );
    if (rows.length === 0) return undefined;
    const row = rows[0]!;
    const headers = row.response_headers;
    return {
      requestDigest: String(row.request_digest),
      response: {
        statusCode: Number(row.status_code),
        body: row.response_body,
        ...(headers !== null && headers !== undefined
          ? { headers: headers as Record<string, string> }
          : {}),
      },
    };
  }

  async store(
    tenantId: string,
    routeKey: string,
    idempotencyKey: string,
    requestDigest: string,
    response: StoredIdempotentResponse,
  ): Promise<void> {
    const storedAt = new Date().toISOString(); // infra bookkeeping time, not contract time
    await this.#executor.query(
      `INSERT INTO idempotent_responses (
         tenant_id, route_key, idempotency_key, request_digest,
         status_code, response_body, response_headers, stored_at
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)
       ON CONFLICT (tenant_id, route_key, idempotency_key)
       DO UPDATE SET request_digest = EXCLUDED.request_digest,
                     status_code = EXCLUDED.status_code,
                     response_body = EXCLUDED.response_body,
                     response_headers = EXCLUDED.response_headers,
                     stored_at = EXCLUDED.stored_at`,
      [
        tenantId,
        routeKey,
        idempotencyKey,
        requestDigest,
        response.statusCode,
        JSON.stringify(response.body ?? null),
        response.headers === undefined ? null : JSON.stringify(response.headers),
        storedAt,
      ],
    );
  }
}
