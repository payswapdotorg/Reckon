/**
 * TL6-002 — PostgreSQL webhook stores implementing the frozen
 * `WebhookEndpointStore`, `WebhookEventStore`, `WebhookDeliveryStore`
 * ports declared in `apps/api/src/webhooks/ports.ts`.
 *
 * Laws honored (frozen ports; the in-memory adapters shipped first and
 * the production PG wave plugs into the SAME seam):
 *
 * - ALL SQL through the SqlExecutor port, parameters only — no string
 *   interpolation of values into SQL.
 * - tenant-scoped BY CONSTRUCTION (tenant_id + workspace_id columns,
 *   the SAME structural tenant law as the wave-1 EventStore; primary
 *   keys are (tenant_id, workspace_id, id) so cross-tenant reads miss
 *   by construction).
 * - The RAW signing secret is stored ENCRYPTED AT REST: AES-256-GCM
 *   via `node:crypto`. A 12-byte random IV per record; ciphertext +
 *   authTag + iv persisted in three BYTEA columns. Decryption needs
 *   only the row + the same encryption key (deterministically). The
 *   plaintext secret NEVER appears in SQL parameters after creation,
 *   NEVER in error messages, NEVER in logs. If the encryption key is
 *   missing in production mode: the composition FAILS LOUDLY at boot
 *   (honesty law — never silently fall back to plaintext).
 * - AT-LEAST-ONCE delivery, deterministic retry backoff, terminal-
 *   never-dropped — frozen in ports.ts and preserved byte-for-byte
 *   by these adapters (the engine drives them through the SAME port
 *   shapes the in-memory adapters answer).
 * - idempotent writes where the port semantics demand (event store
 *   `put` is idempotent per (tenant, event.id) — re-publishing the
 *   same event returns `{ duplicate: true }` and the engine does NOT
 *   fan out again; delivery store `update` is idempotent and reads
 *   through the row's primary key).
 *
 * Evidence class for everything produced through this module:
 * controlled-local (real embedded-postgres PG 18 wire, same pg driver
 * path used against Neon in deployment — Gate L is a real
 * DATABASE_URL run).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  contentDigest,
  type ReckonEvent,
  type TenantScope,
  type TimestampMs,
  type WebhookEventType,
} from "@reckon/contracts";
import type { SqlExecutor, SqlRow } from "./executor.js";

/* ------------------------------------------------------------------ *
 * Local port-shape declarations (STRUCTURALLY COMPATIBLE with the
 * apps/api/src/webhooks/ports.ts interfaces — persistence cannot
 * import apps/api; the structural typing means the SAME adapter
 * implementation satisfies both ports. The shapes mirror the frozen
 * ports byte-for-byte; ANY drift between them is a contract violation
 * caught by the apps/api composition + tests.
 * ------------------------------------------------------------------ */

/**
 * Stored webhook endpoint (mirrors apps/api/src/webhooks/ports.ts
 * StoredWebhookEndpoint). The `secret` field is the RAW signing
 * secret (decrypted on read); the production PG adapter persists it
 * ENCRYPTED AT REST and NEVER in plaintext.
 */
export interface StoredWebhookEndpoint {
  readonly endpointId: string;
  readonly object: "webhook_endpoint";
  readonly tenant: TenantScope;
  readonly url: string;
  readonly description?: string;
  readonly eventTypes: readonly WebhookEventType[];
  readonly secret: string;
  readonly status: "enabled";
  readonly createdAt: TimestampMs;
  readonly seq: number;
}

/** Delivery-log record (mirrors StoredWebhookDelivery in apps/api). */
export interface StoredWebhookDelivery {
  readonly id: string;
  readonly object: "webhook_delivery";
  readonly eventId: string;
  readonly endpointId: string;
  readonly tenant: TenantScope;
  attempts: number;
  status: "pending" | "succeeded" | "failed";
  responseCode: number | null;
  latencyMs: number | null;
  error: string | null;
  replayed: boolean;
  readonly createdAt: TimestampMs;
  updatedAt: number;
  nextAttemptAt: number | null;
  readonly seq: number;
}

/** Optional delivery-log filters (all tenant-scoped on top). */
export interface WebhookDeliveryFilter {
  readonly endpointId?: string;
  readonly eventId?: string;
}

/**
 * The endpoint-store port shape (mirrors WebhookEndpointStore in
 * apps/api). List = newest first; listMatching matches the eventType
 * against the eventTypes filter (empty = every type, documented).
 */
export interface WebhookEndpointStore {
  put(endpoint: StoredWebhookEndpoint): Promise<StoredWebhookEndpoint>;
  get(tenant: TenantScope, endpointId: string): Promise<StoredWebhookEndpoint | null>;
  list(tenant: TenantScope, limit?: number): Promise<readonly StoredWebhookEndpoint[]>;
  listMatching(tenant: TenantScope, eventType: WebhookEventType): Promise<readonly StoredWebhookEndpoint[]>;
  delete(tenant: TenantScope, endpointId: string): Promise<StoredWebhookEndpoint | null>;
}

/** The event-store port shape (mirrors WebhookEventStore in apps/api). */
export interface WebhookEventStore {
  put(event: ReckonEvent): Promise<{ duplicate: boolean }>;
  get(tenant: TenantScope, eventId: string): Promise<ReckonEvent | null>;
  sweep(nowMs: number, retentionMs: number): Promise<number>;
}

/** The delivery-store port shape (mirrors WebhookDeliveryStore in apps/api). */
export interface WebhookDeliveryStore {
  put(delivery: StoredWebhookDelivery): Promise<StoredWebhookDelivery>;
  get(tenant: TenantScope, deliveryId: string): Promise<StoredWebhookDelivery | null>;
  update(delivery: StoredWebhookDelivery): Promise<void>;
  list(
    tenant: TenantScope,
    limit?: number,
    filter?: WebhookDeliveryFilter,
  ): Promise<readonly StoredWebhookDelivery[]>;
  listDue(nowMs: number, limit?: number): Promise<readonly StoredWebhookDelivery[]>;
  countPending(): Promise<number>;
}

/* ------------------------------------------------------------------ *
 * Encryption at rest (AES-256-GCM)
 * ------------------------------------------------------------------ */

/**
 * The encryption key for webhook signing secrets at rest. Production
 * loads this from the `WEBHOOK_SECRET_ENCRYPTION_KEY` env var (32-byte
 * hex OR base64 string — both supported, parsed by
 * `parseWebhookSecretEncryptionKey`). Tests inject a deterministic
 * 32-byte key. NEVER log the key itself — wrap it in a branded type so
 * the surface that takes it is honest about what it is.
 */
export interface WebhookSecretEncryptionKey {
  /** The raw 32-byte AES-256 key (NEVER persisted, NEVER logged). */
  readonly bytes: Readonly<Uint8Array>;
}

/** Branded error for a missing/malformed encryption key (honest fail-fast). */
export class WebhookEncryptionKeyError extends Error {
  readonly code = "WEBHOOK_ENCRYPTION_KEY_INVALID" as const;
  constructor(message: string) {
    super(message);
    this.name = "WebhookEncryptionKeyError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const KEY_LENGTH_BYTES = 32; // AES-256
const IV_LENGTH_BYTES = 12; // 96-bit IV (GCM standard)
const AUTH_TAG_LENGTH_BYTES = 16;

/**
 * Parse the `WEBHOOK_SECRET_ENCRYPTION_KEY` env value into the 32-byte
 * AES-256 key. Accepts either a 64-char hex string OR a base64 string
 * that decodes to exactly 32 bytes. Any other shape fails FAST with a
 * typed WebhookEncryptionKeyError — the composition never silently
 * falls back to plaintext (honesty law).
 */
export function parseWebhookSecretEncryptionKey(raw: string | undefined): WebhookSecretEncryptionKey {
  if (raw === undefined || raw === "") {
    throw new WebhookEncryptionKeyError(
      "WEBHOOK_SECRET_ENCRYPTION_KEY is not set — production webhook signing secrets cannot be encrypted at rest (honesty law: never fall back to plaintext silently)",
    );
  }
  // Try hex (64 chars → 32 bytes) first; this is the documented
  // primary form.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return { bytes: Buffer.from(raw, "hex") };
  }
  // Fall back to base64. MUST decode to exactly 32 bytes.
  let decoded: Buffer;
  try {
    decoded = Buffer.from(raw, "base64");
  } catch (error) {
    throw new WebhookEncryptionKeyError(
      `WEBHOOK_SECRET_ENCRYPTION_KEY is not valid base64 or 64-char hex: ${(error as Error).message}`,
    );
  }
  if (decoded.length !== KEY_LENGTH_BYTES) {
    throw new WebhookEncryptionKeyError(
      `WEBHOOK_SECRET_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256); got ${decoded.length} bytes`,
    );
  }
  return { bytes: decoded };
}

/** The encrypted-at-rest secret payload (three BYTEA columns). */
interface EncryptedSecret {
  readonly cipher: Buffer;
  readonly iv: Buffer;
  readonly tag: Buffer;
}

/** Encrypt a raw signing secret (AES-256-GCM, random 12-byte IV). */
function encryptSecret(key: WebhookSecretEncryptionKey, plaintext: string): EncryptedSecret {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key.bytes as Uint8Array, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { cipher: encrypted, iv, tag };
}

/** Decrypt a secret payload back to the raw signing secret (deterministic). */
function decryptSecret(key: WebhookSecretEncryptionKey, payload: EncryptedSecret): string {
  const decipher = createDecipheriv("aes-256-gcm", key.bytes as Uint8Array, payload.iv);
  decipher.setAuthTag(payload.tag);
  const decrypted = Buffer.concat([decipher.update(payload.cipher), decipher.final()]);
  return decrypted.toString("utf8");
}

/* ------------------------------------------------------------------ *
 * Tenant scoping helpers (the SAME structural law as the wave-1 EventStore)
 * ------------------------------------------------------------------ */

function tenantColumns(tenant: TenantScope): { tenantId: string; workspaceId: string } {
  return {
    tenantId: tenant.tenantId,
    workspaceId: tenant.workspaceId ?? "",
  };
}

/* ------------------------------------------------------------------ *
 * Row mappers
 * ------------------------------------------------------------------ */

function endpointRowToStored(
  row: SqlRow,
  key: WebhookSecretEncryptionKey,
): StoredWebhookEndpoint {
  const cipher = readBytea(row.secret_cipher);
  const iv = readBytea(row.secret_iv);
  const tag = readBytea(row.secret_tag);
  const secret = decryptSecret(key, { cipher, iv, tag });
  const eventTypes = Array.isArray(row.event_types) ? row.event_types : JSON.parse(String(row.event_types));
  const tenant: TenantScope = {
    tenantId: String(row.tenant_id),
    ...(String(row.workspace_id ?? "") !== "" ? { workspaceId: String(row.workspace_id) } : {}),
  };
  const stored: StoredWebhookEndpoint = {
    endpointId: String(row.endpoint_id),
    object: "webhook_endpoint",
    tenant,
    url: String(row.url),
    ...(row.description === null || row.description === undefined
      ? {}
      : { description: String(row.description) }),
    eventTypes: eventTypes as readonly WebhookEventType[],
    secret,
    status: "enabled",
    createdAt: Number(row.created_at) as TimestampMs,
    seq: Number(row.seq),
  };
  return stored;
}

function deliveryRowToStored(row: SqlRow): StoredWebhookDelivery {
  const tenant: TenantScope = {
    tenantId: String(row.tenant_id),
    ...(String(row.workspace_id ?? "") !== "" ? { workspaceId: String(row.workspace_id) } : {}),
  };
  return {
    id: String(row.delivery_id),
    object: "webhook_delivery",
    eventId: String(row.event_id),
    endpointId: String(row.endpoint_id),
    tenant,
    attempts: Number(row.attempts),
    status: String(row.status) as StoredWebhookDelivery["status"],
    responseCode: row.response_code === null || row.response_code === undefined ? null : Number(row.response_code),
    latencyMs: row.latency_ms === null || row.latency_ms === undefined ? null : Number(row.latency_ms),
    error: row.error === null || row.error === undefined ? null : String(row.error),
    replayed: Boolean(row.replayed),
    createdAt: Number(row.created_at) as TimestampMs,
    updatedAt: Number(row.updated_at),
    nextAttemptAt:
      row.next_attempt_at === null || row.next_attempt_at === undefined ? null : Number(row.next_attempt_at),
    seq: Number(row.seq),
  };
}

function eventRowToReckonEvent(row: SqlRow): ReckonEvent {
  const raw = typeof row.event_json === "string" ? JSON.parse(row.event_json) : row.event_json;
  return raw as ReckonEvent;
}

/** Read a BYTEA column into a Buffer (pg returns Buffer or Uint8Array or hex depending on driver config). */
function readBytea(raw: unknown): Buffer {
  if (raw === null || raw === undefined) {
    throw new Error("webhook-stores: BYTEA column unexpectedly NULL (encrypted secret material is missing)");
  }
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof Uint8Array) return Buffer.from(raw);
  if (typeof raw === "string") return Buffer.from(raw, "hex");
  // pg may return a TypedArray under certain pool configs.
  if (ArrayBuffer.isView(raw)) {
    return Buffer.from(raw.buffer as ArrayBuffer, raw.byteOffset, (raw as Uint8Array).byteLength);
  }
  throw new Error(`webhook-stores: BYTEA column had unexpected type ${typeof raw}`);
}

/* ------------------------------------------------------------------ *
 * PgWebhookEndpointStore
 * ------------------------------------------------------------------ */

/**
 * TL6-002 — production PostgreSQL webhook endpoint store.
 *
 * The RAW signing secret is encrypted at rest with AES-256-GCM before
 * any SQL parameter sees it: the `secret` field on `StoredWebhookEndpoint`
 * is decrypted on read and NEVER persisted as plaintext. The encryption
 * key is supplied at construction (composition-time fail-fast if absent
 * in production mode — see `parseWebhookSecretEncryptionKey`).
 */
export class PgWebhookEndpointStore implements WebhookEndpointStore {
  readonly #executor: SqlExecutor;
  readonly #key: WebhookSecretEncryptionKey;

  constructor(executor: SqlExecutor, key: WebhookSecretEncryptionKey) {
    this.#executor = executor;
    this.#key = key;
  }

  async put(endpoint: StoredWebhookEndpoint): Promise<StoredWebhookEndpoint> {
    const { tenantId, workspaceId } = tenantColumns(endpoint.tenant);
    const encrypted = encryptSecret(this.#key, endpoint.secret);
    // The seq is BIGSERIAL: when the row is new, RETURNING the assigned
    // seq. When the (tenant, endpointId) already exists (re-put in the
    // rare migration / replay path), UPDATE the row in place — preserving
    // the original seq (stable newest-first tie-break — the engine never
    // re-puts in production today, but the law is structural).
    const eventTypesJson = JSON.stringify(endpoint.eventTypes);
    const upserted = await this.#executor.query(
      `INSERT INTO webhook_endpoints (
         endpoint_id, tenant_id, workspace_id, url, description, event_types,
         secret_cipher, secret_iv, secret_tag, status, created_at
       )
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11)
       ON CONFLICT (tenant_id, workspace_id, endpoint_id) DO UPDATE SET
         url = EXCLUDED.url,
         description = EXCLUDED.description,
         event_types = EXCLUDED.event_types,
         secret_cipher = EXCLUDED.secret_cipher,
         secret_iv = EXCLUDED.secret_iv,
         secret_tag = EXCLUDED.secret_tag,
         status = EXCLUDED.status,
         created_at = EXCLUDED.created_at
       RETURNING endpoint_id, tenant_id, workspace_id, url, description,
                 event_types, status, created_at, seq`,
      [
        endpoint.endpointId,
        tenantId,
        workspaceId,
        endpoint.url,
        endpoint.description ?? null,
        eventTypesJson,
        encrypted.cipher,
        encrypted.iv,
        encrypted.tag,
        endpoint.status,
        endpoint.createdAt,
      ],
    );
    if (upserted.length === 0) {
      // Should not happen — INSERT…RETURNING always returns at least one row.
      throw new Error(
        `PgWebhookEndpointStore.put: INSERT…RETURNING returned no rows for endpoint ${endpoint.endpointId}`,
      );
    }
    const row = upserted[0]!;
    // Re-derive the stored row with the assigned seq; the secret is the
    // plaintext we just encrypted (we hold it in memory for the return —
    // the engine expects the same `StoredWebhookEndpoint` it passed).
    const tenant: TenantScope = {
      tenantId: String(row.tenant_id),
      ...(String(row.workspace_id ?? "") !== "" ? { workspaceId: String(row.workspace_id) } : {}),
    };
    const eventTypes = Array.isArray(row.event_types)
      ? row.event_types
      : JSON.parse(String(row.event_types));
    return {
      endpointId: String(row.endpoint_id),
      object: "webhook_endpoint",
      tenant,
      url: String(row.url),
      ...(row.description === null || row.description === undefined
        ? {}
        : { description: String(row.description) }),
      eventTypes: eventTypes as readonly WebhookEventType[],
      secret: endpoint.secret,
      status: "enabled",
      createdAt: Number(row.created_at) as TimestampMs,
      seq: Number(row.seq),
    };
  }

  async get(tenant: TenantScope, endpointId: string): Promise<StoredWebhookEndpoint | null> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const rows = await this.#executor.query(
      `SELECT endpoint_id, tenant_id, workspace_id, url, description, event_types,
              secret_cipher, secret_iv, secret_tag, status, created_at, seq
       FROM webhook_endpoints
       WHERE tenant_id = $1 AND workspace_id = $2 AND endpoint_id = $3`,
      [tenantId, workspaceId, endpointId],
    );
    if (rows.length === 0) return null;
    return endpointRowToStored(rows[0]!, this.#key);
  }

  async list(tenant: TenantScope, limit?: number): Promise<readonly StoredWebhookEndpoint[]> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const rows = await this.#executor.query(
      `SELECT endpoint_id, tenant_id, workspace_id, url, description, event_types,
              secret_cipher, secret_iv, secret_tag, status, created_at, seq
       FROM webhook_endpoints
       WHERE tenant_id = $1 AND workspace_id = $2
       ORDER BY seq DESC, endpoint_id DESC
       ${limit !== undefined ? "LIMIT $3" : ""}`,
      limit !== undefined ? [tenantId, workspaceId, limit] : [tenantId, workspaceId],
    );
    return rows.map((row) => endpointRowToStored(row, this.#key));
  }

  async listMatching(tenant: TenantScope, eventType: WebhookEventType): Promise<readonly StoredWebhookEndpoint[]> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    // event_types is JSONB; an EMPTY array matches every event type
    // (documented). The engine's filter is the single source of truth —
    // but we push it down for efficiency: rows where event_types = '[]'
    // OR event_types @> $3::jsonb (membership).
    const matching = await this.#executor.query(
      `SELECT endpoint_id, tenant_id, workspace_id, url, description, event_types,
              secret_cipher, secret_iv, secret_tag, status, created_at, seq
       FROM webhook_endpoints
       WHERE tenant_id = $1 AND workspace_id = $2
         AND (event_types = '[]'::jsonb OR event_types @> $3::jsonb)
       ORDER BY seq DESC, endpoint_id DESC`,
      [tenantId, workspaceId, JSON.stringify([eventType])],
    );
    return matching.map((row) => endpointRowToStored(row, this.#key));
  }

  async delete(tenant: TenantScope, endpointId: string): Promise<StoredWebhookEndpoint | null> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const removed = await this.#executor.query(
      `DELETE FROM webhook_endpoints
       WHERE tenant_id = $1 AND workspace_id = $2 AND endpoint_id = $3
       RETURNING endpoint_id, tenant_id, workspace_id, url, description, event_types,
                 secret_cipher, secret_iv, secret_tag, status, created_at, seq`,
      [tenantId, workspaceId, endpointId],
    );
    if (removed.length === 0) return null;
    return endpointRowToStored(removed[0]!, this.#key);
  }
}

/* ------------------------------------------------------------------ *
 * PgWebhookEventStore
 * ------------------------------------------------------------------ */

/** TL6-002 — production PostgreSQL thin-event retention store. */
export class PgWebhookEventStore implements WebhookEventStore {
  readonly #executor: SqlExecutor;

  constructor(executor: SqlExecutor) {
    this.#executor = executor;
  }

  async put(event: ReckonEvent): Promise<{ duplicate: boolean }> {
    const { tenantId, workspaceId } = tenantColumns(event.tenant);
    const eventJson = JSON.stringify(event);
    const digest = contentDigest(event);
    // Idempotent per (tenant, event.id): re-publishing the same id is
    // a no-op (duplicate:true) — the engine does NOT fan out again.
    // The (tenant_id, workspace_id, event_id) PRIMARY KEY enforces it;
    // ON CONFLICT DO NOTHING returns zero rows for a duplicate.
    const inserted = await this.#executor.query(
      `INSERT INTO webhook_events (tenant_id, workspace_id, event_id, event_type, created_at, event_json, content_digest)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
       ON CONFLICT (tenant_id, workspace_id, event_id) DO NOTHING
       RETURNING event_id`,
      [tenantId, workspaceId, event.id, event.type, event.created, eventJson, digest],
    );
    return { duplicate: inserted.length === 0 };
  }

  async get(tenant: TenantScope, eventId: string): Promise<ReckonEvent | null> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const rows = await this.#executor.query(
      `SELECT event_json FROM webhook_events
       WHERE tenant_id = $1 AND workspace_id = $2 AND event_id = $3`,
      [tenantId, workspaceId, eventId],
    );
    if (rows.length === 0) return null;
    return eventRowToReckonEvent(rows[0]!);
  }

  async sweep(nowMs: number, retentionMs: number): Promise<number> {
    const cutoff = nowMs - retentionMs;
    const rows = await this.#executor.query(
      `DELETE FROM webhook_events WHERE created_at < $1 RETURNING event_id`,
      [cutoff],
    );
    return rows.length;
  }
}

/* ------------------------------------------------------------------ *
 * PgWebhookDeliveryStore
 * ------------------------------------------------------------------ */

/** TL6-002 — production PostgreSQL delivery-log store. */
export class PgWebhookDeliveryStore implements WebhookDeliveryStore {
  readonly #executor: SqlExecutor;

  constructor(executor: SqlExecutor) {
    this.#executor = executor;
  }

  async put(delivery: StoredWebhookDelivery): Promise<StoredWebhookDelivery> {
    const { tenantId, workspaceId } = tenantColumns(delivery.tenant);
    const inserted = await this.#executor.query(
      `INSERT INTO webhook_deliveries (
         delivery_id, tenant_id, workspace_id, event_id, endpoint_id,
         attempts, status, response_code, latency_ms, error, replayed,
         created_at, updated_at, next_attempt_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (tenant_id, workspace_id, delivery_id) DO UPDATE SET
         attempts = EXCLUDED.attempts,
         status = EXCLUDED.status,
         response_code = EXCLUDED.response_code,
         latency_ms = EXCLUDED.latency_ms,
         error = EXCLUDED.error,
         replayed = EXCLUDED.replayed,
         updated_at = EXCLUDED.updated_at,
         next_attempt_at = EXCLUDED.next_attempt_at
       RETURNING delivery_id, tenant_id, workspace_id, event_id, endpoint_id,
                 attempts, status, response_code, latency_ms, error, replayed,
                 created_at, updated_at, next_attempt_at, seq`,
      [
        delivery.id,
        tenantId,
        workspaceId,
        delivery.eventId,
        delivery.endpointId,
        delivery.attempts,
        delivery.status,
        delivery.responseCode,
        delivery.latencyMs,
        delivery.error,
        delivery.replayed,
        delivery.createdAt,
        delivery.updatedAt,
        delivery.nextAttemptAt,
      ],
    );
    if (inserted.length === 0) {
      throw new Error(
        `PgWebhookDeliveryStore.put: INSERT…RETURNING returned no rows for delivery ${delivery.id}`,
      );
    }
    return deliveryRowToStored(inserted[0]!);
  }

  async get(tenant: TenantScope, deliveryId: string): Promise<StoredWebhookDelivery | null> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const rows = await this.#executor.query(
      `SELECT delivery_id, tenant_id, workspace_id, event_id, endpoint_id,
              attempts, status, response_code, latency_ms, error, replayed,
              created_at, updated_at, next_attempt_at, seq
       FROM webhook_deliveries
       WHERE tenant_id = $1 AND workspace_id = $2 AND delivery_id = $3`,
      [tenantId, workspaceId, deliveryId],
    );
    if (rows.length === 0) return null;
    return deliveryRowToStored(rows[0]!);
  }

  async update(delivery: StoredWebhookDelivery): Promise<void> {
    const { tenantId, workspaceId } = tenantColumns(delivery.tenant);
    // Idempotent: the row is updated to the supplied state. Missing row
    // is a no-op (the engine never updates a delivery that wasn't put —
    // but the law is structural, not temporal).
    await this.#executor.query(
      `UPDATE webhook_deliveries SET
         attempts = $4,
         status = $5,
         response_code = $6,
         latency_ms = $7,
         error = $8,
         replayed = $9,
         updated_at = $10,
         next_attempt_at = $11
       WHERE tenant_id = $1 AND workspace_id = $2 AND delivery_id = $3`,
      [
        tenantId,
        workspaceId,
        delivery.id,
        delivery.attempts,
        delivery.status,
        delivery.responseCode,
        delivery.latencyMs,
        delivery.error,
        delivery.replayed,
        delivery.updatedAt,
        delivery.nextAttemptAt,
      ],
    );
  }

  async list(
    tenant: TenantScope,
    limit?: number,
    filter?: WebhookDeliveryFilter,
  ): Promise<readonly StoredWebhookDelivery[]> {
    const { tenantId, workspaceId } = tenantColumns(tenant);
    const params: unknown[] = [tenantId, workspaceId];
    let where = `WHERE tenant_id = $1 AND workspace_id = $2`;
    if (filter?.endpointId !== undefined) {
      params.push(filter.endpointId);
      where += ` AND endpoint_id = $${params.length}`;
    }
    if (filter?.eventId !== undefined) {
      params.push(filter.eventId);
      where += ` AND event_id = $${params.length}`;
    }
    // ORDER BY precedes LIMIT in standard SQL — keep them in that order.
    let sql = `SELECT delivery_id, tenant_id, workspace_id, event_id, endpoint_id,
                      attempts, status, response_code, latency_ms, error, replayed,
                      created_at, updated_at, next_attempt_at, seq
               FROM webhook_deliveries
               ${where}
               ORDER BY seq DESC, delivery_id DESC`;
    if (limit !== undefined) {
      params.push(limit);
      sql += ` LIMIT $${params.length}`;
    }
    const rows = await this.#executor.query(sql, params);
    return rows.map(deliveryRowToStored);
  }

  /**
   * The retry-worker view: every pending delivery DUE at `nowMs` (its
   * nextAttemptAt is non-null and ≤ nowMs), ordered by seq ASC (FIFO —
   * the oldest delivery first). Records stay tenant-scoped in the row;
   * the engine applies tenant context when emitting the outbound POST.
   */
  async listDue(nowMs: number, limit?: number): Promise<readonly StoredWebhookDelivery[]> {
    const params: unknown[] = [nowMs];
    let sql = `SELECT delivery_id, tenant_id, workspace_id, event_id, endpoint_id,
                      attempts, status, response_code, latency_ms, error, replayed,
                      created_at, updated_at, next_attempt_at, seq
               FROM webhook_deliveries
               WHERE status = 'pending' AND next_attempt_at IS NOT NULL AND next_attempt_at <= $1
               ORDER BY seq ASC`;
    if (limit !== undefined) {
      params.push(limit);
      sql += ` LIMIT $${params.length}`;
    }
    const rows = await this.#executor.query(sql, params);
    return rows.map(deliveryRowToStored);
  }

  async countPending(): Promise<number> {
    const rows = await this.#executor.query(
      `SELECT COUNT(*)::int AS pending FROM webhook_deliveries WHERE status = 'pending'`,
    );
    const value = rows[0]?.pending;
    if (value === undefined || value === null) return 0;
    return typeof value === "number" ? value : Number(value);
  }
}
