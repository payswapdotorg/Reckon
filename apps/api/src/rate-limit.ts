import { ACCOUNT_TIER_RATE_LIMIT_DEFAULTS, type AccountTier } from "@reckon/contracts";
import { ApiError, ERROR_CODES } from "./errors.js";

/**
 * Per-key fixed-window rate limiter (S2-001 — the rate_limit_error class
 * needs a real, testable 429 path). Buckets are keyed by the
 * authenticated key's sha256 hash (never the raw key).
 *
 * When the limit is exceeded the request fails with 429
 * RATE_LIMIT_EXCEEDED and a `Retry-After` header (seconds until the
 * window resets). Disabled unless configured — existing deployments
 * keep their exact behavior.
 *
 * TL6-001 — TIER-AWARE LIMITS: `tierLimits` overrides the flat default
 * per account tier (the paid ladder): a DB-minted key carrying a tier
 * is limited by ITS tier's value; a `null` tier limit is UNLIMITED
 * (the frozen `enterprise:` semantics). Keys without a tier (static
 * env-configured keys) keep the flat default limit — byte-identical to
 * the pre-TL6-001 behavior. The typed 429 + Retry-After response shape
 * is unchanged; the message names the effective limit that applied.
 */
export interface RateLimiterConfig {
  /** Max requests per window per key (the flat default — applies to tierless/static keys and any tier without an override). */
  readonly limit: number;
  /** Window length in ms (default 60_000). */
  readonly windowMs?: number;
  /**
   * TL6-001: per-tier per-window limits. `null` = unlimited. A tier
   * absent from the map falls back to the flat `limit`.
   */
  readonly tierLimits?: Readonly<Partial<Record<AccountTier, number | null>>>;
}

interface Bucket {
  readonly windowStart: number;
  count: number;
}

export interface RequestRateLimiter {
  /**
   * Register a request; throws the typed 429 when the key is over limit.
   * TL6-001: the optional tier (carried by DB-minted account keys)
   * selects the tier's limit; absent = the flat default.
   */
  check(keyHash: string, tier?: AccountTier): void;
  /** The configured max requests per window (flat default). */
  readonly limit: number;
  /** The configured window length in ms. */
  readonly windowMs: number;
}

export function createRateLimiter(
  config: RateLimiterConfig,
  clock: () => number = () => Date.now(),
): RequestRateLimiter {
  const windowMs = config.windowMs ?? 60_000;
  if (!Number.isInteger(config.limit) || config.limit < 1) {
    throw new RangeError("rate limit must be an integer >= 1");
  }
  if (!Number.isFinite(windowMs) || windowMs < 1) {
    throw new RangeError("rate limit windowMs must be a positive number");
  }
  // TL6-001: an unspecified ladder means the FROZEN defaults (free 60,
  // pro 600, enterprise unlimited) — the paid ladder is the product's
  // promise, not an opt-in.
  const tierLimits = config.tierLimits ?? ACCOUNT_TIER_RATE_LIMIT_DEFAULTS;
  for (const [tier, tierLimit] of Object.entries(tierLimits)) {
    if (tierLimit === null) continue; // null = unlimited (frozen `enterprise:` semantics)
    if (!Number.isInteger(tierLimit) || tierLimit < 1) {
      throw new RangeError(`rate limit for tier '${tier}' must be an integer >= 1 or null (unlimited)`);
    }
  }
  const buckets = new Map<string, Bucket>();
  return {
    limit: config.limit,
    windowMs,
    check(keyHash: string, tier?: AccountTier): void {
      // TL6-001: the effective limit — tier override when the key carries
      // one, the flat default otherwise. null = unlimited (never 429s).
      const tierLimit = tier === undefined ? undefined : tierLimits[tier];
      const effectiveLimit = tierLimit === undefined ? config.limit : tierLimit;
      if (effectiveLimit === null) return; // unlimited tier — no bucket needed
      const now = clock();
      const windowStart = Math.floor(now / windowMs) * windowMs;
      const bucket = buckets.get(keyHash);
      if (bucket === undefined || bucket.windowStart !== windowStart) {
        // Opportunistic pruning keeps the map bounded under key churn.
        if (buckets.size > 10_000) buckets.clear();
        buckets.set(keyHash, { windowStart, count: 1 });
        return;
      }
      bucket.count += 1;
      if (bucket.count > effectiveLimit) {
        const windowEnd = windowStart + windowMs;
        const retryAfterSeconds = Math.max(1, Math.ceil((windowEnd - now) / 1000));
        throw new ApiError(
          ERROR_CODES.RATE_LIMIT_EXCEEDED,
          429,
          `Rate limit exceeded: max ${effectiveLimit} requests per ${Math.round(windowMs / 1000)}s for this API key`,
          { limit: effectiveLimit, windowMs },
          undefined,
          retryAfterSeconds,
        );
      }
    },
  };
}
