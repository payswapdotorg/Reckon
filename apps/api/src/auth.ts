import { createHash } from "node:crypto";
import { IdSchema } from "@reckon/contracts";
import { ApiError, ConfigError, ERROR_CODES } from "./errors.js";
import { ROUTE_SCOPES } from "./types.js";
import type { AuthContext, Scope } from "./types.js";

/**
 * Static API key map (AUTH LAW). Keys are configured, never discovered;
 * identity authority stays with the host (architecture lock #4) — this key
 * store is an explicit boundary seam, not an identity system.
 *
 * Keys are hashed (sha256) at rest in memory. The raw key is never stored,
 * never logged and never echoed in an error message.
 */
export interface StaticKeyConfig {
  apiKey: string;
  tenantId: string;
  workspaceId?: string;
  scopes: readonly Scope[];
}

export interface KeyAuthenticator {
  authenticate(authorizationHeader: string | undefined): AuthContext;
}

function hashKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

const VALID_SCOPES: ReadonlySet<string> = new Set<string>(ROUTE_SCOPES);

export class KeyStore implements KeyAuthenticator {
  /** sha256(apiKey) → authenticated context. Raw keys never live here. */
  readonly #entries = new Map<string, AuthContext>();

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
      const keyHash = hashKey(entry.apiKey);
      if (this.#entries.has(keyHash)) {
        throw new ConfigError(`${label}: duplicate apiKey (same key configured twice)`);
      }
      this.#entries.set(keyHash, {
        tenantId: entry.tenantId,
        workspaceId: entry.workspaceId,
        scopes: new Set(entry.scopes),
        keyHash,
      });
    });
  }

  get size(): number {
    return this.#entries.size;
  }

  authenticate(authorizationHeader: string | undefined): AuthContext {
    if (typeof authorizationHeader !== "string" || authorizationHeader.length === 0) {
      throw new ApiError(
        ERROR_CODES.UNAUTHENTICATED,
        401,
        "Missing Authorization header (expected 'Authorization: Bearer <key>')",
      );
    }
    const match = /^Bearer[ \t]+(\S+)$/i.exec(authorizationHeader);
    if (match === null || match[1] === undefined) {
      throw new ApiError(
        ERROR_CODES.UNAUTHENTICATED,
        401,
        "Authorization header must use the 'Bearer <key>' scheme",
      );
    }
    const keyHash = hashKey(match[1]);
    const entry = this.#entries.get(keyHash);
    if (entry === undefined) {
      throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 401, "Unknown or invalid API key");
    }
    return {
      tenantId: entry.tenantId,
      workspaceId: entry.workspaceId,
      scopes: new Set(entry.scopes),
      keyHash,
    };
  }
}
