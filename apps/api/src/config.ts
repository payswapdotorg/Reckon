import { readFileSync } from "node:fs";
import type { KeyAuthenticator, StaticKeyConfig } from "./auth.js";
import { KeyStore } from "./auth.js";
import { ConfigError } from "./errors.js";
import type { IdempotencyStore } from "./idempotency.js";
import { InMemoryIdempotencyStore } from "./idempotency.js";
import type { PartialHandlerPorts } from "./ports.js";
import { ROUTE_SCOPES } from "./types.js";
import type { Scope } from "./types.js";

const VALID_SCOPES: ReadonlySet<string> = new Set<string>(ROUTE_SCOPES);

export const DEFAULT_API_VERSION = "0.1.0";

/**
 * Composition input for buildServer. Everything is injectable — handler
 * ports, key store, idempotency map — so tests and later waves wire their
 * own implementations. No global mutable singletons anywhere.
 */
export interface ApiConfig {
  /** API surface version (reported by /healthz and /readyz). */
  readonly apiVersion?: string;
  /** Raw static keys; hashed at rest by the KeyStore. */
  readonly keys?: readonly StaticKeyConfig[];
  /** Inject an existing KeyAuthenticator instead of raw keys. */
  readonly keyStore?: KeyAuthenticator;
  /** Handler ports to mount; missing ports get NotWired (501) defaults. */
  readonly handlers?: PartialHandlerPorts;
  /** Store-and-replay map; defaults to the in-memory implementation. */
  readonly idempotencyStore?: IdempotencyStore;
  /** Fastify logger; off by default (keys are never logged either way). */
  readonly logger?: boolean;
}

/**
 * RECKON_API_KEYS format (env var or file, one entry per ';' or newline):
 *   key1:tenant1:scope1,scope2;key2:tenant2:plans,catalog
 * Keys must not contain ':'. Workspace-scoped keys are expressed only
 * programmatically (tests / future host integration), not in the env
 * string. RECKON_API_KEYS_FILE wins over RECKON_API_KEYS.
 */
export function parseApiKeyList(raw: string): StaticKeyConfig[] {
  return raw
    .split(/[\n;]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry, index) => {
      const parts = entry.split(":");
      if (parts.length !== 3) {
        throw new ConfigError(
          `RECKON_API_KEYS entry ${index}: expected "apiKey:tenantId:scope1,scope2", got ${parts.length} part(s)`,
        );
      }
      const apiKey = parts[0] ?? "";
      const tenantId = parts[1] ?? "";
      const scopesRaw = parts[2] ?? "";
      if (apiKey.length === 0) throw new ConfigError(`RECKON_API_KEYS entry ${index}: empty apiKey`);
      const scopeNames =
        scopesRaw.trim().length === 0
          ? []
          : scopesRaw
              .split(",")
              .map((scope) => scope.trim())
              .filter((scope) => scope.length > 0);
      for (const scope of scopeNames) {
        if (!VALID_SCOPES.has(scope)) {
          throw new ConfigError(`RECKON_API_KEYS entry ${index}: unknown scope '${scope}'`);
        }
      }
      const scopes = scopeNames as Scope[];
      return { apiKey, tenantId, scopes };
    });
}

export function loadConfigFromEnv(env: Record<string, string | undefined>): ApiConfig {
  const file = env.RECKON_API_KEYS_FILE;
  const raw = file !== undefined && file !== "" ? readFileSync(file, "utf8") : env.RECKON_API_KEYS;
  const keys = raw !== undefined && raw !== "" ? parseApiKeyList(raw) : [];
  return {
    apiVersion: env.RECKON_API_VERSION ?? DEFAULT_API_VERSION,
    keys,
    logger: env.RECKON_LOG === "1",
  };
}

/** Convenience for embedding tests: a KeyStore straight from a config list. */
export function keyStoreFrom(keys: readonly StaticKeyConfig[]): KeyStore {
  return new KeyStore(keys);
}
