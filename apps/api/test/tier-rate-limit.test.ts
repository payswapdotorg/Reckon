/**
 * TL6-001 — tier-aware rate limiting, unit level:
 * - createRateLimiter with tierLimits (per-tier windows, unlimited tier,
 *   flat default for tierless keys, typed 429 + Retry-After shape);
 * - parseTierRateLimits (frozen defaults, full/partial specs, unlimited,
 *   fail-fast ConfigError on every malformed shape);
 * - loadConfigFromEnv wiring (the tier ladder rides the enabled limiter).
 */
import { describe, expect, it } from "vitest";
import { createRateLimiter, parseTierRateLimits, loadConfigFromEnv } from "../src/index.js";
import { ApiError, ConfigError } from "../src/index.js";

describe("TL6-001 createRateLimiter — tier-aware limits", () => {
  it("tiered keys use their tier's limit; tierless keys keep the flat default (byte-identical law)", () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 100, tierLimits: { free: 3 } }, () => now);

    // The tiered (free) key: 3 pass, the 4th is the typed 429.
    for (let index = 0; index < 3; index += 1) limiter.check("tiered-key", "free");
    let caught: ApiError | undefined;
    try {
      limiter.check("tiered-key", "free");
    } catch (error) {
      caught = error as ApiError;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught?.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(caught?.statusCode).toBe(429);
    expect(caught?.errorClass).toBe("rate_limit_error");
    expect(caught?.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(caught?.details).toMatchObject({ limit: 3 });
    expect(caught?.message).toBe("Rate limit exceeded: max 3 requests per 60s for this API key");

    // The tierless key in the SAME window sails far past 3 — the flat
    // default limit (100) applies, exactly as before TL6-001.
    for (let index = 0; index < 50; index += 1) limiter.check("tierless-key");
    expect(limiter.limit).toBe(100);
  });

  it("buckets are per key — a tiered key and a tierless key never interfere", () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 2, tierLimits: { free: 2 } }, () => now);
    limiter.check("key-a", "free");
    limiter.check("key-b", "free");
    limiter.check("key-a", "free");
    // key-a is now at its limit; key-b still has headroom.
    limiter.check("key-b", "free");
    expect(() => limiter.check("key-a", "free")).toThrow(ApiError);
  });

  it("an UNLIMITED tier (null) never 429s, at any volume", () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 5, tierLimits: { enterprise: null } }, () => now);
    for (let index = 0; index < 10_000; index += 1) limiter.check("ent-key", "enterprise");
    // The tierless flat limit still applies in the same window.
    for (let index = 0; index < 5; index += 1) limiter.check("flat-key");
    expect(() => limiter.check("flat-key")).toThrow(ApiError);
  });

  it("a tier WITHOUT an override falls back to the flat default", () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 2, tierLimits: { free: 10 } }, () => now);
    for (let index = 0; index < 10; index += 1) limiter.check("free-key", "free");
    // pro has no override → flat 2.
    limiter.check("pro-key", "pro");
    limiter.check("pro-key", "pro");
    expect(() => limiter.check("pro-key", "pro")).toThrow(ApiError);
  });

  it("window reset: the 429 clears when the fixed window rolls over", () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, tierLimits: { free: 1 }, windowMs: 1_000 }, () => now);
    limiter.check("k", "free");
    expect(() => limiter.check("k", "free")).toThrow(ApiError);
    now = 1_000; // next window
    limiter.check("k", "free");
  });

  it("malformed tier limits fail fast at construction (RangeError)", () => {
    expect(() => createRateLimiter({ limit: 5, tierLimits: { free: 0 } })).toThrow(RangeError);
    expect(() => createRateLimiter({ limit: 5, tierLimits: { free: 1.5 } })).toThrow(RangeError);
    // null (unlimited) is legal.
    expect(() => createRateLimiter({ limit: 5, tierLimits: { free: null } })).not.toThrow();
  });

  it("the pre-TL6-001 call shape is unchanged: check(keyHash) with no tier", () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 1 }, () => now);
    limiter.check("hash-only");
    expect(() => limiter.check("hash-only")).toThrow(ApiError);
  });
});

describe("TL6-001 parseTierRateLimits — frozen defaults + fail-fast parsing", () => {
  it("unset/empty → the FROZEN defaults (free 60, pro 600, enterprise unlimited)", () => {
    expect(parseTierRateLimits(undefined)).toEqual({ free: 60, pro: 600, enterprise: null });
    expect(parseTierRateLimits("")).toEqual({ free: 60, pro: 600, enterprise: null });
    expect(parseTierRateLimits("   ")).toEqual({ free: 60, pro: 600, enterprise: null });
  });

  it("the documented full spec parses exactly", () => {
    expect(parseTierRateLimits("free:60,pro:600,enterprise:")).toEqual({
      free: 60,
      pro: 600,
      enterprise: null,
    });
    expect(parseTierRateLimits("free:10,pro:20,enterprise:1000000")).toEqual({
      free: 10,
      pro: 20,
      enterprise: 1_000_000,
    });
    // Whitespace tolerance.
    expect(parseTierRateLimits(" free:15 , pro:25 , enterprise: ")).toEqual({
      free: 15,
      pro: 25,
      enterprise: null,
    });
  });

  it("a partial spec keeps the frozen default for unmentioned tiers", () => {
    expect(parseTierRateLimits("pro:1000")).toEqual({ free: 60, pro: 1000, enterprise: null });
  });

  it("malformed specs fail FAST (ConfigError), each with an actionable message", () => {
    expect(() => parseTierRateLimits("free")).toThrow(ConfigError); // no colon
    expect(() => parseTierRateLimits(":60")).toThrow(ConfigError); // empty tier
    expect(() => parseTierRateLimits("hobby:60")).toThrow(ConfigError); // unknown tier
    expect(() => parseTierRateLimits("free:abc")).toThrow(ConfigError); // non-integer
    expect(() => parseTierRateLimits("free:0")).toThrow(ConfigError); // zero limit
    expect(() => parseTierRateLimits("free:-5")).toThrow(ConfigError); // negative
    expect(() => parseTierRateLimits("free:60,free:600")).toThrow(ConfigError); // duplicate tier
    expect(() => parseTierRateLimits("free:60.5")).toThrow(ConfigError); // fractional
  });
});

describe("TL6-001 loadConfigFromEnv — the tier ladder rides the enabled limiter", () => {
  it("RECKON_RATE_LIMIT_MAX + RECKON_TIER_RATE_LIMITS → tierLimits on the rateLimit config", () => {
    const config = loadConfigFromEnv({
      RECKON_RATE_LIMIT_MAX: "5000",
      RECKON_TIER_RATE_LIMITS: "free:120,pro:1200,enterprise:",
    });
    expect(config.rateLimit).toMatchObject({ limit: 5000 });
    expect(config.rateLimit?.tierLimits).toEqual({ free: 120, pro: 1200, enterprise: null });
  });

  it("RECKON_TIER_RATE_LIMITS unset → the config shape stays byte-identical (pre-TL6-001); the LIMITER applies the frozen defaults", () => {
    const config = loadConfigFromEnv({ RECKON_RATE_LIMIT_MAX: "999" });
    expect(config.rateLimit).toEqual({ limit: 999 });

    // The frozen default ladder inside the limiter: free 60/min.
    let now = 0;
    const limiter = createRateLimiter(config.rateLimit!, () => now);
    for (let index = 0; index < 60; index += 1) limiter.check("free-key", "free");
    expect(() => limiter.check("free-key", "free")).toThrow(ApiError);
    // …enterprise is unlimited; tierless keys keep the flat limit.
    for (let index = 0; index < 500; index += 1) limiter.check("ent-key", "enterprise");
    for (let index = 0; index < 999; index += 1) limiter.check("flat-key");
    expect(() => limiter.check("flat-key")).toThrow(ApiError);
  });

  it("no RECKON_RATE_LIMIT_MAX → rate limiting stays DISABLED (existing deployments unchanged)", () => {
    const config = loadConfigFromEnv({ RECKON_TIER_RATE_LIMITS: "free:120" });
    expect(config.rateLimit).toBeUndefined();
  });

  it("a malformed tier spec fails FAST even when limiting is disabled (honest config law)", () => {
    expect(() => loadConfigFromEnv({ RECKON_TIER_RATE_LIMITS: "free:zero" })).toThrow(ConfigError);
  });
});
