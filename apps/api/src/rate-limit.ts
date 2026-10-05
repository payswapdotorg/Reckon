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
 */
export interface RateLimiterConfig {
  /** Max requests per window per key. */
  readonly limit: number;
  /** Window length in ms (default 60_000). */
  readonly windowMs?: number;
}

interface Bucket {
  readonly windowStart: number;
  count: number;
}

export interface RequestRateLimiter {
  /** Register a request; throws the typed 429 when the key is over limit. */
  check(keyHash: string): void;
  /** The configured max requests per window. */
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
  const buckets = new Map<string, Bucket>();
  return {
    limit: config.limit,
    windowMs,
    check(keyHash: string): void {
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
      if (bucket.count > config.limit) {
        const windowEnd = windowStart + windowMs;
        const retryAfterSeconds = Math.max(1, Math.ceil((windowEnd - now) / 1000));
        throw new ApiError(
          ERROR_CODES.RATE_LIMIT_EXCEEDED,
          429,
          `Rate limit exceeded: max ${config.limit} requests per ${Math.round(windowMs / 1000)}s for this API key`,
          { limit: config.limit, windowMs },
          undefined,
          retryAfterSeconds,
        );
      }
    },
  };
}
