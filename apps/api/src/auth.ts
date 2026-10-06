import { createHash } from "node:crypto";
import {
  IdSchema,
  PublishableApiKeySchema,
  SecretApiKeySchema,
  generatePublishableKey,
  generateSecretKey,
  parseReckonApiKey,
  type AccountTier,
  type KeyMode,
  type KeyTokenGenerator,
} from "@reckon/contracts";
import { ApiError, ConfigError, ERROR_CODES } from "./errors.js";
import { ROUTE_SCOPES } from "./types.js";
import type { AuthContext, Scope } from "./types.js";

/**
 * Static API key map (AUTH LAW, hardened S2-001 to the Stripe-style key
 * model). Keys are configured, never discovered; identity authority
 * stays with the host (architecture lock #4) — this key store is an
 * explicit boundary seam, not an identity system.
 *
 * Key formats (S2-001, the target model):
 *   sk_live_<token> / sk_test_<token>  — secret keys (server-side API auth)
 *   pk_live_<token> / pk_test_<token>  — publishable keys (client-side
 *   identification only; they NEVER authenticate API calls → 401
 *   authentication_error with a typed body).
 *
 * Transition policy (documented for TL3): legacy opaque keys (anything
 * not matching the sk_/pk_ format) are accepted unchanged during the
 * transition and behave as live-mode secret keys unless their config
 * entry pins an explicit `mode`. New provisioning uses generated keys.
 *
 * Keys are hashed (sha256) at rest in memory. The raw key is never
 * stored, never logged and never echoed in an error message.
 */
export interface StaticKeyConfig {
  apiKey: string;
  tenantId: string;
  workspaceId?: string;
  scopes: readonly Scope[];
  /**
   * Live/test mode the key operates in. For sk_/pk_ formatted keys the
   * mode is carried IN the key and this field must agree (ConfigError
   * otherwise); for legacy keys it defaults to "live".
   */
  mode?: KeyMode;
}

/** What the key store knows about a configured key. */
interface StoredKeyEntry {
  readonly tenantId: string;
  readonly workspaceId?: string;
  readonly scopes: ReadonlySet<Scope>;
  readonly keyHash: string;
  readonly mode: KeyMode;
  readonly kind: "secret" | "publishable";
}

export interface KeyAuthenticator {
  /**
   * TL6-001: the seam may be async — the DB account-key fallback
   * (LayeredKeyAuthenticator) resolves through the SqlExecutor. Sync
   * implementations (the static KeyStore) satisfy the union unchanged;
   * callers await, which is a no-op for sync results.
   */
  authenticate(authorizationHeader: string | undefined): AuthContext | Promise<AuthContext>;
}

function hashKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

const VALID_SCOPES: ReadonlySet<string> = new Set<string>(ROUTE_SCOPES);

function unauthenticated(message: string): ApiError {
  return new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, message);
}

/**
 * TL6-001 (internal): the static map's unknown-key miss. Wire-identical
 * to the plain UNAUTHENTICATED miss (same code, status, message) — the
 * subclass only exists so LayeredKeyAuthenticator can fall through to
 * the DB lookup on EXACTLY this miss and rethrow it verbatim when the
 * DB misses too. Every other static failure (missing header, malformed
 * scheme, publishable-key rejection) propagates untouched.
 */
class UnknownApiKeyError extends ApiError {
  constructor() {
    super(ERROR_CODES.UNAUTHENTICATED, 401, "Unknown or invalid API key");
    this.name = "ApiError";
  }
}

export class KeyStore implements KeyAuthenticator {
  /** sha256(apiKey) → authenticated context. Raw keys never live here. */
  readonly #entries = new Map<string, StoredKeyEntry>();

  constructor(keys: readonly StaticKeyConfig[]) {
    keys.forEach((entry, index) => {
      const label = `API key entry ${index}`;
      if (typeof entry.apiKey !== "string" || entry.apiKey.length === 0) {
        throw new ConfigError(`${label}: apiKey must be a non-empty string`);
      }
      if (!IdSchema.safeParse(entry.tenantId).success) {
        throw new ConfigError(`${label}: tenantId is not a valid Reckon id`);
      }
      if (entry.workspaceId !== undefined && !IdSchema.safeParse(entry.workspaceId).success) {
        throw new ConfigError(`${label}: workspaceId is not a valid Reckon id`);
      }
      if (!Array.isArray(entry.scopes)) {
        throw new ConfigError(`${label}: scopes must be an array`);
      }
      for (const scope of entry.scopes) {
        if (!VALID_SCOPES.has(scope)) {
          throw new ConfigError(`${label}: unknown scope '${String(scope)}'`);
        }
      }
      // S2-001 key format discipline: a key that LOOKS like a Reckon key
      // (sk_/pk_ prefix) must be a well-formed one — misconfiguration
      // fails fast at startup instead of 401-ing forever in production.
      const parsed = parseReckonApiKey(entry.apiKey);
      if (parsed === null && /^(sk|pk)_(live|test)_/.test(entry.apiKey)) {
        throw new ConfigError(
          `${label}: key has a Reckon prefix but is malformed (expected sk_live_|sk_test_|pk_live_|pk_test_ + >=24 base62 chars)`,
        );
      }
      const kind = parsed?.kind ?? "secret";
      const mode = parsed?.mode ?? entry.mode ?? "live";
      if (parsed !== null && entry.mode !== undefined && entry.mode !== parsed.mode) {
        throw new ConfigError(
          `${label}: key '${parsed.kind === "secret" ? "sk" : "pk"}_${parsed.mode}_…' carries mode '${parsed.mode}' but the config entry pins '${entry.mode}'`,
        );
      }
      const keyHash = hashKey(entry.apiKey);
      if (this.#entries.has(keyHash)) {
        throw new ConfigError(`${label}: duplicate apiKey (same key configured twice)`);
      }
      this.#entries.set(keyHash, {
        tenantId: entry.tenantId,
        ...(entry.workspaceId !== undefined ? { workspaceId: entry.workspaceId } : {}),
        scopes: new Set(entry.scopes),
        keyHash,
        mode,
        kind,
      });
    });
  }

  get size(): number {
    return this.#entries.size;
  }

  authenticate(authorizationHeader: string | undefined): AuthContext {
    if (typeof authorizationHeader !== "string" || authorizationHeader.length === 0) {
      throw unauthenticated("Missing Authorization header (expected 'Authorization: Bearer <key>')");
    }
    const match = /^Bearer[ \t]+(\S+)$/i.exec(authorizationHeader);
    if (match === null || match[1] === undefined) {
      throw unauthenticated("Authorization header must use the 'Bearer <key>' scheme");
    }
    const presented = match[1];
    // A publishable key is never a valid API credential — reject it with
    // the dedicated typed message BEFORE the hash lookup so the failure
    // is deterministic even if someone (mis)configures a pk key here.
    if (PublishableApiKeySchema.safeParse(presented).success) {
      throw unauthenticated(
        "Publishable keys (pk_live_/pk_test_) cannot authenticate API requests; use a secret key (sk_live_/sk_test_)",
      );
    }
    const keyHash = hashKey(presented);
    const entry = this.#entries.get(keyHash);
    if (entry === undefined) {
      throw new UnknownApiKeyError();
    }
    if (entry.kind === "publishable") {
      throw unauthenticated(
        "Publishable keys (pk_live_/pk_test_) cannot authenticate API requests; use a secret key (sk_live_/sk_test_)",
      );
    }
    return {
      tenantId: entry.tenantId,
      ...(entry.workspaceId !== undefined ? { workspaceId: entry.workspaceId } : {}),
      scopes: new Set(entry.scopes),
      keyHash,
      mode: entry.mode,
    };
  }
}

/**
 * Provisioning surface (S2-001): mint a new-format key config. Pure
 * plumbing over @reckon/contracts key generation — the host decides who
 * gets which key; nothing is stored or discovered here.
 */
export function mintKeyConfig(
  kind: "secret" | "publishable",
  mode: KeyMode,
  tenantId: string,
  scopes: readonly Scope[],
  generateToken?: KeyTokenGenerator,
): StaticKeyConfig {
  if (kind === "secret") {
    const apiKey = generateSecretKey(mode, generateToken);
    if (!SecretApiKeySchema.safeParse(apiKey).success) {
      throw new ConfigError("mintKeyConfig: generated secret key failed its format schema");
    }
    return { apiKey, tenantId, scopes, mode };
  }
  const apiKey = generatePublishableKey(mode, generateToken);
  if (!PublishableApiKeySchema.safeParse(apiKey).success) {
    throw new ConfigError("mintKeyConfig: generated publishable key failed its format schema");
  }
  return { apiKey, tenantId, scopes, mode };
}

/* ================================================================== *
 * TL6-001 — the DB-backed account-key layer (layered authenticator)
 * ================================================================== */

/**
 * The account-key lookup port the layered seam falls through to
 * (structurally satisfied by @reckon/persistence's PgAccountKeyStore).
 * Key material never appears here — lookups are BY sha256 hash, exactly
 * like the static map.
 */
export interface AccountKeyLookup {
  /** A non-revoked account key by its sha256 hash, or null. */
  findByKeyHash(
    keyHash: string,
  ): Promise<{
    readonly tenantId: string;
    readonly workspaceId: string | null;
    readonly kind: "secret" | "publishable";
    readonly mode: KeyMode;
    readonly tier: AccountTier;
    readonly scopes: readonly string[];
  } | null>;
  /** Auth-success bookkeeping for the minted key. */
  touchLastUsed(keyHash: string): Promise<void>;
}

/**
 * TL6-001 — the layered authenticator: the static env map (RECKON_API_KEYS,
 * the frozen boundary seam) is consulted FIRST and answers byte-identically
 * for env-configured keys; on an unknown-key miss the DB account-key layer
 * resolves the same sha256(presented) hash against self-serve keys minted
 * through POST /v1/account/keys. ConfigError law unchanged. When no
 * persistence is wired (local dev without DATABASE_URL) the miss degrades
 * honestly to the normal typed 401 — never a crash.
 *
 * Precedence law: a hash present in BOTH layers resolves from the static
 * map (the host-configured entry always wins — configuration over data).
 */
export class LayeredKeyAuthenticator implements KeyAuthenticator {
  readonly #staticKeys: KeyStore;
  readonly #accounts: AccountKeyLookup | undefined;

  constructor(keys: readonly StaticKeyConfig[], accounts?: AccountKeyLookup) {
    this.#staticKeys = new KeyStore(keys);
    this.#accounts = accounts;
  }

  /** The static layer's size (wiring diagnostics; the DB layer is unbounded). */
  get staticKeyCount(): number {
    return this.#staticKeys.size;
  }

  async authenticate(authorizationHeader: string | undefined): Promise<AuthContext> {
    let presented: string;
    try {
      // STATIC FIRST — byte-identical behavior for env-configured keys
      // (same context object, same typed errors, ConfigError at boot).
      return this.#staticKeys.authenticate(authorizationHeader);
    } catch (error) {
      if (!(error instanceof UnknownApiKeyError)) throw error;
      // The static map missed on a credential that already passed the
      // bearer-scheme and publishable-key checks — extract it for the
      // DB lookup (defensive: an unparseable header can never reach here).
      const match = /^Bearer[ \t]+(\S+)$/i.exec(authorizationHeader ?? "");
      presented = match?.[1] ?? "";
    }
    if (presented === "") throw new UnknownApiKeyError();
    if (this.#accounts === undefined) {
      // No persistence wired: degrade honestly — normal typed 401.
      throw new UnknownApiKeyError();
    }
    const keyHash = hashKey(presented);
    const stored = await this.#accounts.findByKeyHash(keyHash);
    if (stored === null) {
      // Revoked / unknown minted keys are indistinguishable misses.
      throw new UnknownApiKeyError();
    }
    if (stored.kind === "publishable") {
      throw unauthenticated(
        "Publishable keys (pk_live_/pk_test_) cannot authenticate API requests; use a secret key (sk_live_/sk_test_)",
      );
    }
    await this.#accounts.touchLastUsed(keyHash);
    const scopes = new Set<Scope>();
    for (const scope of stored.scopes) {
      if (VALID_SCOPES.has(scope)) scopes.add(scope as Scope);
    }
    return {
      tenantId: stored.tenantId,
      ...(stored.workspaceId !== null && stored.workspaceId !== undefined
        ? { workspaceId: stored.workspaceId }
        : {}),
      scopes,
      keyHash,
      mode: stored.mode,
      // TL6-001: the tier snapshot the minted key carries — the seam the
      // tier-aware rate limiter branches on (undefined for static keys).
      tier: stored.tier,
    };
  }
}
