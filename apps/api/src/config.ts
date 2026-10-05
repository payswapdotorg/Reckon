import { readFileSync } from "node:fs";
import type { ApiVersionEntry, EvidenceClass, Id } from "@reckon/contracts";
import type { ObservabilitySink } from "@reckon/observability";
import type { ObservabilityClock } from "@reckon/observability";
import type { KeyAuthenticator, StaticKeyConfig } from "./auth.js";
import { KeyStore } from "./auth.js";
import { ConfigError } from "./errors.js";
import type { IdempotencyStore } from "./idempotency.js";
import { InMemoryIdempotencyStore } from "./idempotency.js";
import type { RateLimiterConfig } from "./rate-limit.js";
import type { PartialHandlerPorts } from "./ports.js";
import { ROUTE_SCOPES } from "./types.js";
import type { Scope } from "./types.js";

const VALID_SCOPES: ReadonlySet<string> = new Set<string>(ROUTE_SCOPES);

export const DEFAULT_API_VERSION = "0.1.0";

/** Observability composition (W3-004): records through the sink port. */
export interface ObservabilityConfig {
  /** The append-only sink (in-memory / JSONL are TEST INFRASTRUCTURE). */
  readonly sink: ObservabilitySink;
  /** Injected clock — deterministic latency + record timestamps. */
  readonly clock?: ObservabilityClock;
  /** Record-id generator (default: crypto.randomUUID). */
  readonly idGenerator?: () => Id;
  /** Honest evidence-class label (default "controlled-local"). */
  readonly evidenceClass?: EvidenceClass;
}

/**
 * Composition input for buildServer. Everything is injectable — handler
 * ports, key store, idempotency map, observability sink — so tests and
 * later waves wire their own implementations. No global mutable
 * singletons anywhere.
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
  /** W3-004: emit decision/outcome/scheduler/error records to a sink. */
  readonly observability?: ObservabilityConfig;
  /** S2-001: registered API versions (default: the shipped registry with the pinned default). */
  readonly apiVersions?: readonly ApiVersionEntry[];
  /** S2-001: pinned default API version for requests without X-Reckon-Version. */
  readonly defaultApiVersion?: string;
  /** S2-001: per-key rate limit (absent = rate limiting disabled). */
  readonly rateLimit?: RateLimiterConfig;
  /** S2-001: injected clock (idempotency window, rate-limit windows; default Date.now). */
  readonly clock?: () => number;
  /** S2-001: docs URL base for error doc_url values (default: the pinned contracts base). */
  readonly docsBaseUrl?: string;
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
  const rateLimitMax = parseOptionalInteger(env.RECKON_RATE_LIMIT_MAX, "RECKON_RATE_LIMIT_MAX");
  const rateLimitWindowMs = parseOptionalInteger(env.RECKON_RATE_LIMIT_WINDOW_MS, "RECKON_RATE_LIMIT_WINDOW_MS");
  return {
    apiVersion: env.RECKON_API_VERSION ?? DEFAULT_API_VERSION,
    keys,
    logger: env.RECKON_LOG === "1",
    ...(rateLimitMax !== undefined
      ? { rateLimit: { limit: rateLimitMax, ...(rateLimitWindowMs !== undefined ? { windowMs: rateLimitWindowMs } : {}) } }
      : {}),
  };
}

function parseOptionalInteger(raw: string | undefined, name: string): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (!/^[0-9]+$/.test(raw)) {
    throw new ConfigError(`${name} must be an integer, got '${raw}'`);
  }
  return Number(raw);
}

/**
 * Listen configuration for the production entrypoint (P1-004 env
 * separation). RECKON_PORT must be an integer 1..65535 when present —
 * a malformed value fails FAST with a ConfigError instead of surfacing
 * later as a mysterious `NaN` listen failure inside fastify. RECKON_HOST
 * defaults to loopback; a public deployment sets 0.0.0.0 (or the
 * platform's expected bind host) explicitly — never silently.
 */
export interface ListenConfig {
  readonly host: string;
  readonly port: number;
}

export function parseListenConfig(env: Record<string, string | undefined>): ListenConfig {
  const host = env.RECKON_HOST !== undefined && env.RECKON_HOST !== "" ? env.RECKON_HOST : "127.0.0.1";
  const rawPort = env.RECKON_PORT;
  if (rawPort === undefined || rawPort === "") {
    return { host, port: 8080 };
  }
  if (!/^[0-9]+$/.test(rawPort)) {
    throw new ConfigError(`RECKON_PORT must be an integer, got '${rawPort}'`);
  }
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`RECKON_PORT must be within 1..65535, got '${rawPort}'`);
  }
  return { host, port };
}

/** Convenience for embedding tests: a KeyStore straight from a config list. */
export function keyStoreFrom(keys: readonly StaticKeyConfig[]): KeyStore {
  return new KeyStore(keys);
}
