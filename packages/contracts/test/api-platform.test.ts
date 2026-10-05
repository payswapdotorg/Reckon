import { describe, it, expect } from "vitest";
import {
  API_KEY_GENERATED_TOKEN_LENGTH,
  API_KEY_MIN_TOKEN_LENGTH,
  ApiVersionSchema,
  PublishableApiKeySchema,
  SecretApiKeySchema,
  ERROR_CATALOG,
  ERROR_CLASSES,
  ApiErrorEnvelopeSchema,
  PaginationMetaSchema,
  PaginationParamsSchema,
  ExpandPathTokenSchema,
  IDEMPOTENCY_WINDOW_MS,
  IDEMPOTENT_REPLAYED_HEADER,
  IDEMPOTENCY_KEY_HEADER,
  X_RECKON_VERSION_HEADER,
  errorDocUrl,
  generatePublishableKey,
  generateReckonApiKey,
  generateSecretKey,
  parseReckonApiKey,
} from "../src/index.js";

/**
 * S2-001 — the developer-platform API contract surface (api-platform.ts):
 * key model, API versioning, idempotency constants, pagination params,
 * expansion tokens and the typed error catalog. Additive-only extension
 * of the frozen contracts.
 */

describe("api-platform: key model", () => {
  it("all four key families validate", () => {
    for (const key of [
      generateSecretKey("live"),
      generateSecretKey("test"),
      generatePublishableKey("live"),
      generatePublishableKey("test"),
    ]) {
      expect(SecretApiKeySchema.safeParse(key).success || PublishableApiKeySchema.safeParse(key).success).toBe(true);
    }
  });

  it("schema rejects wrong prefixes, separators and too-short tokens", () => {
    expect(SecretApiKeySchema.safeParse("pk_live_" + "a".repeat(40)).success).toBe(false);
    expect(SecretApiKeySchema.safeParse("sk_live-" + "a".repeat(40)).success).toBe(false);
    expect(SecretApiKeySchema.safeParse("sk_live_" + "a".repeat(API_KEY_MIN_TOKEN_LENGTH - 1)).success).toBe(false);
    expect(SecretApiKeySchema.safeParse("sk_live_" + "a".repeat(API_KEY_GENERATED_TOKEN_LENGTH)).success).toBe(true);
    expect(PublishableApiKeySchema.safeParse("sk_test_" + "a".repeat(40)).success).toBe(false);
  });

  it("parseReckonApiKey extracts kind + mode; rejects everything else", () => {
    expect(parseReckonApiKey(generateSecretKey("test"))).toMatchObject({ kind: "secret", mode: "test" });
    expect(parseReckonApiKey(generatePublishableKey("live"))).toMatchObject({
      kind: "publishable",
      mode: "live",
    });
    expect(parseReckonApiKey("sk_live_" + "short")).toBeNull();
    expect(parseReckonApiKey("plain-legacy-key")).toBeNull();
    expect(parseReckonApiKey("SK_LIVE_" + "a".repeat(40))).toBeNull();
  });

  it("generation honors the injected token generator (deterministic provisioning)", () => {
    const token = (length: number) => "z".repeat(length);
    expect(generateReckonApiKey("secret", "live", token)).toBe(`sk_live_${"z".repeat(API_KEY_GENERATED_TOKEN_LENGTH)}`);
    expect(generateReckonApiKey("publishable", "test", token)).toBe(
      `pk_test_${"z".repeat(API_KEY_GENERATED_TOKEN_LENGTH)}`,
    );
  });

  it("generated tokens are base62-only (url-safe, no separators)", () => {
    for (let index = 0; index < 25; index += 1) {
      expect(generateSecretKey("live")).toMatch(/^sk_live_[A-Za-z0-9]{40}$/);
    }
  });
});

describe("api-platform: API versioning", () => {
  it("the header constant is the lowercase wire name", () => {
    expect(X_RECKON_VERSION_HEADER).toBe("x-reckon-version");
  });

  it("ApiVersionSchema accepts semver and dates; rejects anything else", () => {
    for (const good of ["0.1.0", "1.2.3", "2026-10-03"]) {
      expect(ApiVersionSchema.safeParse(good).success).toBe(true);
    }
    for (const bad of ["", "1.2", "v1", "2026-1-1", "banana", "0.1.0-rc1", " 0.1.0"]) {
      expect(ApiVersionSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("api-platform: idempotency constants", () => {
  it("the 24h window and the header wire names are frozen", () => {
    expect(IDEMPOTENCY_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
    expect(IDEMPOTENCY_KEY_HEADER).toBe("idempotency-key");
    expect(IDEMPOTENT_REPLAYED_HEADER).toBe("idempotent-replayed");
  });
});

describe("api-platform: pagination", () => {
  it("PaginationParamsSchema defaults limit to 20", () => {
    expect(PaginationParamsSchema.parse({})).toEqual({ limit: 20 });
    expect(PaginationParamsSchema.parse({ limit: 100 })).toEqual({ limit: 100 });
    expect(PaginationParamsSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(PaginationParamsSchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(PaginationParamsSchema.safeParse({ limit: 1.5 }).success).toBe(false);
  });

  it("PaginationMetaSchema freezes the response metadata shape", () => {
    expect(PaginationMetaSchema.parse({ has_more: true, next_cursor: "plan-1" })).toEqual({
      has_more: true,
      next_cursor: "plan-1",
    });
    expect(PaginationMetaSchema.parse({ has_more: false, next_cursor: null })).toEqual({
      has_more: false,
      next_cursor: null,
    });
    expect(PaginationMetaSchema.safeParse({ has_more: true }).success).toBe(false);
    expect(PaginationMetaSchema.safeParse({ has_more: "yes", next_cursor: "x" }).success).toBe(false);
  });
});

describe("api-platform: expansion tokens", () => {
  it("ExpandPathTokenSchema accepts url-safe segments only", () => {
    for (const good of ["history", "queuedExperiences", "item", "a-b", "c_d", "Field9"]) {
      expect(ExpandPathTokenSchema.safeParse(good).success).toBe(true);
    }
    for (const bad of ["", "with space", "dot.dot", "-leading", "tri.ck", "x".repeat(65)]) {
      expect(ExpandPathTokenSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("api-platform: typed error catalog", () => {
  it("exactly the five stable classes exist", () => {
    expect(ERROR_CLASSES).toEqual([
      "invalid_request_error",
      "authentication_error",
      "permission_error",
      "rate_limit_error",
      "api_error",
    ]);
  });

  it("every catalog entry carries class + HTTP status + doc slug + description", () => {
    for (const [code, entry] of Object.entries(ERROR_CATALOG)) {
      expect((ERROR_CLASSES as readonly string[]).includes(entry.errorClass)).toBe(true);
      expect(Number.isInteger(entry.httpStatus)).toBe(true);
      expect(entry.httpStatus).toBeGreaterThanOrEqual(400);
      expect(entry.httpStatus).toBeLessThanOrEqual(599);
      expect(entry.docSlug).toMatch(/^[a-z0-9-]+$/);
      expect(entry.description.length).toBeGreaterThan(0);
      void code;
    }
  });

  it("each of the five classes is exercised by at least one machine code", () => {
    const used = new Set(Object.values(ERROR_CATALOG).map((entry) => entry.errorClass));
    expect([...used].sort()).toEqual([...ERROR_CLASSES].sort());
  });

  it("errorDocUrl composes the docs URL from a stable base", () => {
    expect(errorDocUrl("UNAUTHENTICATED")).toBe("https://docs.reckon.dev/errors/unauthenticated");
    expect(errorDocUrl("IDEMPOTENCY_CONFLICT")).toBe("https://docs.reckon.dev/errors/idempotency-conflict");
    expect(errorDocUrl("NOPE_NOT_A_CODE")).toBe("https://docs.reckon.dev/errors/nope-not-a-code");
  });

  it("ApiErrorEnvelopeSchema freezes the error body contract", () => {
    const minimal = {
      error: { class: "api_error", code: "INTERNAL", message: "boom" },
    };
    expect(ApiErrorEnvelopeSchema.parse(minimal)).toEqual(minimal);
    const full = {
      error: {
        class: "invalid_request_error",
        code: "VALIDATION_ERROR",
        message: "bad",
        param: "limit",
        doc_url: "https://docs.reckon.dev/errors/validation-error",
        details: { issues: [] },
      },
    };
    expect(ApiErrorEnvelopeSchema.parse(full)).toEqual(full);
    expect(ApiErrorEnvelopeSchema.safeParse({ error: { code: "X", message: "y" } }).success).toBe(false); // class is required
    expect(ApiErrorEnvelopeSchema.safeParse({ error: { class: "bogus", code: "X", message: "y" } }).success).toBe(false);
  });
});
