/**
 * TL6-001 — PgAccountStore / PgAccountKeyStore / PgAccountSessionStore:
 * the durable self-serve account surface (ADR-001: real PostgreSQL, no
 * in-memory production authority).
 *
 * SHOW-ONCE / NO-SECRETS-AT-REST LAW (matches the S2-001/S2-002 posture):
 * - passwords are stored ONLY as scrypt hashes (per-account random salt,
 *   constant-time verification); the raw password never leaves the
 *   creating/verifying call;
 * - account keys are stored ONLY as sha256 hashes; the raw key value is
 *   returned EXACTLY ONCE (from mint) and never persisted or logged;
 * - session tokens are stored ONLY as sha256 hashes; the raw token is
 *   returned EXACTLY ONCE (from create) and never persisted or logged.
 *
 * All SQL goes through the SqlExecutor port (parameters only). `now` is
 * infra wall-clock bookkeeping (account/key/session lifecycle time),
 * never a decision-contract timestamp. Tenant ids derive from the
 * ACCOUNT (the account owns its tenant); account-scoped queries key on
 * account_id — the owning account is the tenant authority by
 * construction (architecture lock #4 stays intact: Reckon authenticates
 * API access; the host remains the subject identity authority).
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import {
  SESSION_TTL_MS,
  generateAccountId,
  generateAccountKeyId,
  generateAccountTenantId,
  generatePublishableKey,
  generateSecretKey,
  generateSessionToken,
  type AccountTier,
  type ApiKeyKind,
  type KeyMode,
} from "@reckon/contracts";
import type { SqlExecutor, SqlRow } from "./executor.js";
import { AccountEmailTakenError } from "./errors.js";

/* ------------------------------------------------------------------ *
 * Password hashing (scrypt, per-account salt)
 * ------------------------------------------------------------------ */

const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_SALT_LENGTH = 16;
const SCRYPT_PARAMETERS = { N: 16_384, r: 8, p: 1 };
/** Stored format: `scrypt$<saltHex>$<hashHex>` (version-tagged for future cost upgrades). */
const SCRYPT_FORMAT = "scrypt";

function hashPassword(password: string): string {
  const salt = randomBytes(SCRYPT_SALT_LENGTH);
  const hash = scryptSync(password, salt, SCRYPT_KEY_LENGTH, SCRYPT_PARAMETERS);
  return `${SCRYPT_FORMAT}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** Constant-time verification against a stored `scrypt$…$…` hash. */
function verifyPasswordHash(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== SCRYPT_FORMAT) return false;
  const salt = Buffer.from(parts[1] ?? "", "hex");
  const expected = Buffer.from(parts[2] ?? "", "hex");
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = scryptSync(password, salt, expected.length, SCRYPT_PARAMETERS);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** pg unique-violation code (email race between SELECT and INSERT). */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

/* ------------------------------------------------------------------ *
 * PgAccountStore
 * ------------------------------------------------------------------ */

/** The account record exactly as the frozen Account contract models it (no password material). */
export interface AccountRecord {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly tenantId: string;
  readonly tier: AccountTier;
  readonly createdAt: number;
}

/** Signup input; the raw password is hashed at rest and never stored or logged. */
export interface CreateAccountInput {
  readonly email: string;
  readonly password: string;
  readonly fullName: string;
}

function toAccountRecord(row: SqlRow): AccountRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    fullName: String(row.full_name),
    tenantId: String(row.tenant_id),
    tier: AccountTierOf(String(row.tier)),
    createdAt: Number(row.created_at),
  };
}

function AccountTierOf(raw: string): AccountTier {
  if (raw === "free" || raw === "pro" || raw === "enterprise") return raw;
  throw new Error(`stored account tier '${raw}' is not a known tier`);
}

export class PgAccountStore {
  readonly #executor: SqlExecutor;
  readonly #now: () => number;

  constructor(executor: SqlExecutor, now: () => number = () => Date.now()) {
    this.#executor = executor;
    this.#now = now;
  }

  /**
   * Create an account (email UNIQUE). Generates the account id and the
   * tenant it owns. A taken email (including the SELECT→INSERT race)
   * rejects with the typed AccountEmailTakenError — the 409 source.
   */
  async create(input: CreateAccountInput): Promise<AccountRecord> {
    const existing = await this.#executor.query(`SELECT id FROM accounts WHERE email = $1`, [input.email]);
    if (existing.length > 0) throw new AccountEmailTakenError(input.email);
    const record: AccountRecord = {
      id: generateAccountId(),
      email: input.email,
      fullName: input.fullName,
      tenantId: generateAccountTenantId(),
      tier: "free",
      createdAt: this.#now(),
    };
    try {
      await this.#executor.query(
        `INSERT INTO accounts (id, email, password_hash, full_name, tenant_id, tier, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          record.id,
          record.email,
          hashPassword(input.password),
          record.fullName,
          record.tenantId,
          record.tier,
          record.createdAt,
        ],
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw new AccountEmailTakenError(input.email);
      throw error;
    }
    return record;
  }

  /** The account for an email, or null. */
  async findByEmail(email: string): Promise<AccountRecord | null> {
    const rows = await this.#executor.query(
      `SELECT id, email, full_name, tenant_id, tier, created_at FROM accounts WHERE email = $1`,
      [email],
    );
    return rows.length === 0 ? null : toAccountRecord(rows[0]!);
  }

  /** The account for an id, or null (session-auth resolution). */
  async findById(id: string): Promise<AccountRecord | null> {
    const rows = await this.#executor.query(
      `SELECT id, email, full_name, tenant_id, tier, created_at FROM accounts WHERE id = $1`,
      [id],
    );
    return rows.length === 0 ? null : toAccountRecord(rows[0]!);
  }

  /**
   * Verify credentials (constant-time). Returns the account on success,
   * null on unknown email or wrong password — indistinguishable inputs,
   * one typed outcome (the route answers the typed 401).
   */
  async verifyPassword(email: string, password: string): Promise<AccountRecord | null> {
    const rows = await this.#executor.query(
      `SELECT id, email, full_name, tenant_id, tier, created_at, password_hash FROM accounts WHERE email = $1`,
      [email],
    );
    if (rows.length === 0) return null;
    const row = rows[0]!;
    if (!verifyPasswordHash(password, String(row.password_hash))) return null;
    return toAccountRecord(row);
  }
}

/* ------------------------------------------------------------------ *
 * PgAccountKeyStore
 * ------------------------------------------------------------------ */

/** The key metadata view (the frozen AccountKey contract shape; NO key material). */
export interface AccountKeyView {
  readonly keyId: string;
  readonly kind: ApiKeyKind;
  readonly mode: KeyMode;
  readonly tier: AccountTier;
  readonly createdAt: number;
  readonly lastUsedAt: number | null;
  readonly revokedAt: number | null;
}

/** The mint result: the RAW key (shown exactly once) + its metadata view. */
export interface MintedAccountKey {
  readonly key: string;
  readonly view: AccountKeyView;
}

/** What the API authenticator needs from a stored key (auth seam input). */
export interface StoredAccountKeyAuth {
  readonly keyId: string;
  readonly accountId: string;
  readonly tenantId: string;
  readonly workspaceId: string | null;
  readonly kind: ApiKeyKind;
  readonly mode: KeyMode;
  readonly tier: AccountTier;
  readonly scopes: readonly string[];
}

function nullableNumber(raw: unknown): number | null {
  return raw === null || raw === undefined ? null : Number(raw);
}

function keyViewOf(row: SqlRow): AccountKeyView {
  return {
    keyId: String(row.id),
    kind: ApiKeyKindOf(String(row.kind)),
    mode: KeyModeOf(String(row.mode)),
    tier: AccountTierOf(String(row.tier)),
    createdAt: Number(row.created_at),
    lastUsedAt: nullableNumber(row.last_used_at),
    revokedAt: nullableNumber(row.revoked_at),
  };
}

function authViewOf(row: SqlRow): StoredAccountKeyAuth {
  const scopes = Array.isArray(row.scopes) ? row.scopes.map(String) : [];
  return {
    keyId: String(row.id),
    accountId: String(row.account_id),
    tenantId: String(row.tenant_id),
    workspaceId: row.workspace_id === null || row.workspace_id === undefined ? null : String(row.workspace_id),
    kind: ApiKeyKindOf(String(row.kind)),
    mode: KeyModeOf(String(row.mode)),
    tier: AccountTierOf(String(row.tier)),
    scopes,
  };
}

function ApiKeyKindOf(raw: string): ApiKeyKind {
  if (raw === "secret" || raw === "publishable") return raw;
  throw new Error(`stored account key kind '${raw}' is not a known kind`);
}

function KeyModeOf(raw: string): KeyMode {
  if (raw === "live" || raw === "test") return raw;
  throw new Error(`stored account key mode '${raw}' is not a known mode`);
}

export interface MintAccountKeyRequest {
  readonly kind: ApiKeyKind;
  readonly mode: KeyMode;
}

export class PgAccountKeyStore {
  readonly #executor: SqlExecutor;
  readonly #now: () => number;

  constructor(executor: SqlExecutor, now: () => number = () => Date.now()) {
    this.#executor = executor;
    this.#now = now;
  }

  /**
   * Mint a key for an account. The raw key is generated with the frozen
   * contracts generators (sk_/pk_ + mode in-band) and ONLY its sha256
   * hash is stored; the raw value is returned to the caller EXACTLY
   * ONCE (the mint response) and never again. tenantId derives from the
   * account; the tier snapshot rides the key (rate limits branch on it).
   * Scopes are the caller's (the API passes its route-scope vocabulary).
   */
  async mint(
    account: Pick<AccountRecord, "id" | "tenantId" | "tier">,
    request: MintAccountKeyRequest,
    scopes: readonly string[] = [],
  ): Promise<MintedAccountKey> {
    const rawKey =
      request.kind === "secret" ? generateSecretKey(request.mode) : generatePublishableKey(request.mode);
    const view: AccountKeyView = {
      keyId: generateAccountKeyId(),
      kind: request.kind,
      mode: request.mode,
      tier: account.tier,
      createdAt: this.#now(),
      lastUsedAt: null,
      revokedAt: null,
    };
    await this.#executor.query(
      `INSERT INTO account_keys (id, account_id, key_hash, tenant_id, workspace_id, kind, mode, tier, scopes, created_at, last_used_at, revoked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,NULL,NULL)`,
      [
        view.keyId,
        account.id,
        sha256Hex(rawKey),
        account.tenantId,
        null,
        view.kind,
        view.mode,
        view.tier,
        JSON.stringify(scopes),
        view.createdAt,
      ],
    );
    return { key: rawKey, view };
  }

  /** All keys of an account, newest first (revoked keys included, their revokedAt set). */
  async list(accountId: string): Promise<readonly AccountKeyView[]> {
    const rows = await this.#executor.query(
      `SELECT id, account_id, tenant_id, workspace_id, kind, mode, tier, scopes, created_at, last_used_at, revoked_at
       FROM account_keys WHERE account_id = $1
       ORDER BY created_at DESC, id DESC`,
      [accountId],
    );
    return rows.map(keyViewOf);
  }

  /**
   * Revoke a key (account-scoped). Unknown keyId → null (the route's
   * 404); re-revoking an already-revoked key returns its view again —
   * idempotent delete semantics.
   */
  async revoke(accountId: string, keyId: string): Promise<AccountKeyView | null> {
    const updated = await this.#executor.query(
      `UPDATE account_keys SET revoked_at = $3
       WHERE account_id = $1 AND id = $2 AND revoked_at IS NULL
       RETURNING id, account_id, tenant_id, workspace_id, kind, mode, tier, scopes, created_at, last_used_at, revoked_at`,
      [accountId, keyId, this.#now()],
    );
    if (updated.length > 0) return keyViewOf(updated[0]!);
    const existing = await this.#executor.query(
      `SELECT id, account_id, tenant_id, workspace_id, kind, mode, tier, scopes, created_at, last_used_at, revoked_at
       FROM account_keys WHERE account_id = $1 AND id = $2`,
      [accountId, keyId],
    );
    return existing.length === 0 ? null : keyViewOf(existing[0]!);
  }

  /**
   * The authenticator's lookup: a NON-revoked key by its sha256 hash, or
   * null. Revoked/unknown hashes are indistinguishable misses.
   */
  async findByKeyHash(keyHash: string): Promise<StoredAccountKeyAuth | null> {
    const rows = await this.#executor.query(
      `SELECT id, account_id, tenant_id, workspace_id, kind, mode, tier, scopes, created_at, last_used_at, revoked_at
       FROM account_keys WHERE key_hash = $1 AND revoked_at IS NULL`,
      [keyHash],
    );
    return rows.length === 0 ? null : authViewOf(rows[0]!);
  }

  /** Touch last_used_at for a non-revoked key (auth-success bookkeeping). */
  async touchLastUsed(keyHash: string): Promise<void> {
    await this.#executor.query(
      `UPDATE account_keys SET last_used_at = $2 WHERE key_hash = $1 AND revoked_at IS NULL`,
      [keyHash, this.#now()],
    );
  }
}

/* ------------------------------------------------------------------ *
 * PgAccountSessionStore
 * ------------------------------------------------------------------ */

/** The validated session (account + expiry; no token material). */
export interface ValidatedAccountSession {
  readonly accountId: string;
  readonly expiresAt: number;
}

export class PgAccountSessionStore {
  readonly #executor: SqlExecutor;
  readonly #now: () => number;

  constructor(executor: SqlExecutor, now: () => number = () => Date.now()) {
    this.#executor = executor;
    this.#now = now;
  }

  /**
   * Create a session: a random reckonsess_… token whose sha256 hash is
   * stored with a 7-day expiry. The RAW token is returned EXACTLY ONCE
   * (the signup/login response) and never persisted or logged.
   */
  async create(accountId: string): Promise<{ token: string; expiresAt: number }> {
    const token = generateSessionToken();
    const expiresAt = this.#now() + SESSION_TTL_MS;
    await this.#executor.query(
      `INSERT INTO account_sessions (token_hash, account_id, expires_at, created_at)
       VALUES ($1,$2,$3,$4)`,
      [sha256Hex(token), accountId, expiresAt, this.#now()],
    );
    return { token, expiresAt };
  }

  /** Validate a raw token: unexpired session → its account + expiry, else null. */
  async validate(token: string): Promise<ValidatedAccountSession | null> {
    const rows = await this.#executor.query(
      `SELECT account_id, expires_at FROM account_sessions WHERE token_hash = $1 AND expires_at > $2`,
      [sha256Hex(token), this.#now()],
    );
    if (rows.length === 0) return null;
    const row = rows[0]!;
    return { accountId: String(row.account_id), expiresAt: Number(row.expires_at) };
  }

  /** Revoke (logout): true when a session was removed. Idempotent — an unknown/expired token is a no-op miss. */
  async revoke(token: string): Promise<boolean> {
    const removed = await this.#executor.query(
      `DELETE FROM account_sessions WHERE token_hash = $1 RETURNING account_id`,
      [sha256Hex(token)],
    );
    return removed.length > 0;
  }
}
