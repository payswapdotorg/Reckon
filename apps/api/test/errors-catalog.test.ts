import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ApiErrorEnvelopeSchema,
  ERROR_CATALOG,
  ERROR_CLASSES,
  errorCatalogEntry,
  errorDocUrl,
} from "@reckon/contracts";
import { ERROR_CODES, errorEnvelope } from "../src/errors.js";
import { createRateLimiter } from "../src/rate-limit.js";
import { ApiError } from "../src/errors.js";
import {
  ALPHA,
  BETA,
  authHeaders,
  buildStubServer,
  idemHeader,
  injectJson,
  validDecisionRequest,
  validPlan,
  freshIdem,
  expectErrorEnvelope,
} from "./fixtures.js";
import type { StubServer } from "./fixtures.js";

/**
 * S2-001 typed error catalog — every failure is
 *   { error: { class, code, message, param?, doc_url?, details? } }
 * with stable classes + machine codes; rate_limit_error answers 429 with
 * Retry-After. This suite proves the catalog invariants AND the live
 * shapes the API actually emits.
 */

describe("error catalog: invariants (contracts)", () => {
  it("every machine code maps to a stable class, HTTP status and doc slug", () => {
    for (const [code, entry] of Object.entries(ERROR_CATALOG)) {
      expect(ERROR_CLASSES).toContain(entry.errorClass);
      expect(Number.isInteger(entry.httpStatus)).toBe(true);
      expect(entry.httpStatus).toBeGreaterThanOrEqual(400);
      expect(entry.docSlug).toMatch(/^[a-z0-9-]+$/);
      expect(entry.description.length).toBeGreaterThan(0);
      void code;
    }
  });

  it("the class/status mapping follows the frozen docs table", () => {
    expect(ERROR_CATALOG.VALIDATION_ERROR).toMatchObject({ errorClass: "invalid_request_error", httpStatus: 400 });
    expect(ERROR_CATALOG.UNAUTHENTICATED).toMatchObject({ errorClass: "authentication_error", httpStatus: 401 });
    expect(ERROR_CATALOG.TENANT_MISMATCH).toMatchObject({ errorClass: "permission_error", httpStatus: 403 });
    expect(ERROR_CATALOG.INSUFFICIENT_SCOPE).toMatchObject({ errorClass: "permission_error", httpStatus: 403 });
    expect(ERROR_CATALOG.NOT_FOUND).toMatchObject({ errorClass: "invalid_request_error", httpStatus: 404 });
    expect(ERROR_CATALOG.IDEMPOTENCY_CONFLICT).toMatchObject({ errorClass: "invalid_request_error", httpStatus: 422 });
    expect(ERROR_CATALOG.RATE_LIMIT_EXCEEDED).toMatchObject({ errorClass: "rate_limit_error", httpStatus: 429 });
    expect(ERROR_CATALOG.NOT_WIRED).toMatchObject({ errorClass: "api_error", httpStatus: 501 });
    expect(ERROR_CATALOG.INTERNAL).toMatchObject({ errorClass: "api_error", httpStatus: 500 });
  });

  it("apps/api ERROR_CODES stay in lockstep with the catalog (no orphan codes)", () => {
    expect(Object.keys(ERROR_CODES).sort()).toEqual(Object.keys(ERROR_CATALOG).sort());
  });

  it("the five stable classes exist exactly once each across the catalog", () => {
    const classes = new Set(Object.values(ERROR_CATALOG).map((entry) => entry.errorClass));
    expect([...classes].sort()).toEqual([...ERROR_CLASSES].sort());
  });

  it("errorDocUrl composes <base>/errors/<slug>; unknown codes degrade to kebab + api_error", () => {
    expect(errorDocUrl("VALIDATION_ERROR")).toBe("https://docs.reckon.dev/errors/validation-error");
    expect(errorDocUrl("RATE_LIMIT_EXCEEDED")).toBe("https://docs.reckon.dev/errors/rate-limit-exceeded");
    expect(errorDocUrl("SOMETHING_NEW")).toBe("https://docs.reckon.dev/errors/something-new");
    expect(errorCatalogEntry("SOMETHING_NEW").errorClass).toBe("api_error");
  });

  it("errorEnvelope output validates against the frozen ApiErrorEnvelopeSchema", () => {
    const envelope = errorEnvelope("VALIDATION_ERROR", "boom", { schema: "x" }, "items[0].kind");
    expect(ApiErrorEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(envelope.error).toMatchObject({
      class: "invalid_request_error",
      code: "VALIDATION_ERROR",
      message: "boom",
      param: "items[0].kind",
    });
  });

  it("errorEnvelope omits doc_url for uncatalogued codes (honest degradation)", () => {
    const envelope = errorEnvelope("TOTALLY_UNKNOWN", "boom");
    expect(envelope.error.doc_url).toBeUndefined();
    expect(envelope.error.class).toBe("api_error");
  });
});

describe("error catalog: live shapes over the wire", () => {
  let stub: StubServer;

  beforeEach(() => {
    stub = buildStubServer();
  });

  afterEach(async () => {
    await stub.app.close();
  });

  it("400 validation error: class invalid_request_error, param = first issue path, doc_url present", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest({ idempotencyKey: undefined }),
      headers: authHeaders(ALPHA),
    });
    expect(res.status).toBe(400);
    expectErrorEnvelope(res.status, res.body, "VALIDATION_ERROR", "invalid_request_error");
    const envelope = ApiErrorEnvelopeSchema.parse(res.body);
    expect(envelope.error.doc_url).toBe("https://docs.reckon.dev/errors/validation-error");
    expect(envelope.error.param).toBe("idempotencyKey");
  });

  it("401: class authentication_error with doc_url", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest(),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(401);
    expectErrorEnvelope(res.status, res.body, "UNAUTHENTICATED", "authentication_error");
    expect(ApiErrorEnvelopeSchema.parse(res.body).error.doc_url).toBe(
      "https://docs.reckon.dev/errors/unauthenticated",
    );
  });

  it("403 permission family: TENANT_MISMATCH and INSUFFICIENT_SCOPE both map to permission_error", async () => {
    const tenantMismatch = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest({ tenant: { tenantId: "tenant-b" } }),
      headers: authHeaders(ALPHA),
    });
    expect(tenantMismatch.status).toBe(403);
    expectErrorEnvelope(tenantMismatch.status, tenantMismatch.body, "TENANT_MISMATCH", "permission_error");

    const insufficientScope = await injectJson(stub.app, "POST", "/v1/plans", {
      payload: validPlan(),
      headers: idemHeader(freshIdem(), { authorization: `Bearer ${BETA}` }),
    });
    expect(insufficientScope.status).toBe(403);
    expectErrorEnvelope(insufficientScope.status, insufficientScope.body, "INSUFFICIENT_SCOPE", "permission_error");
  });

  it("404: class invalid_request_error (Stripe resource_missing semantics)", async () => {
    const res = await injectJson(stub.app, "GET", "/v1/decisions/dec-missing", {
      headers: authHeaders(ALPHA),
    });
    expect(res.status).toBe(404);
    expectErrorEnvelope(res.status, res.body, "NOT_FOUND", "invalid_request_error");
  });

  it("unknown route → typed 404 envelope (not fastify's default HTML)", async () => {
    const res = await injectJson(stub.app, "GET", "/v1/definitely-not-a-route", {
      headers: authHeaders(ALPHA),
    });
    expect(res.status).toBe(404);
    expectErrorEnvelope(res.status, res.body, "NOT_FOUND", "invalid_request_error");
  });

  it("malformed JSON body → typed 400 invalid_request_error envelope", async () => {
    const res = await stub.app.inject({
      method: "POST",
      url: "/v1/plans",
      headers: idemHeader(freshIdem()),
      payload: "{not-json",
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as unknown;
    expectErrorEnvelope(res.statusCode, body, "VALIDATION_ERROR", "invalid_request_error");
  });

  it("422 idempotency conflict: invalid_request_error + param Idempotency-Key", async () => {
    const key = "catalog-conflict-1";
    const first = await injectJson(stub.app, "POST", "/v1/catalog/items", {
      payload: { itemId: "item-c", kind: "media" },
      headers: idemHeader(key),
    });
    expect(first.status).toBe(200);
    const second = await injectJson(stub.app, "POST", "/v1/catalog/items", {
      payload: { itemId: "item-d", kind: "media" },
      headers: idemHeader(key),
    });
    expect(second.status).toBe(422);
    expectErrorEnvelope(second.status, second.body, "IDEMPOTENCY_CONFLICT", "invalid_request_error");
    expect((second.body as { error: { param?: string } }).error.param).toBe("idempotency-key");
  });
});

describe("error catalog: rate_limit_error (429 + Retry-After)", () => {
  it("the limiter throws a typed 429 with Retry-After seconds after the window budget is spent", () => {
    let now = 10_000;
    const limiter = createRateLimiter({ limit: 2, windowMs: 1_000 }, () => now);
    expect(() => limiter.check("keyhash-1")).not.toThrow();
    expect(() => limiter.check("keyhash-1")).not.toThrow();
    try {
      limiter.check("keyhash-1");
      throw new Error("third request in the window must throw a typed 429");
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      expect(error.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(error.statusCode).toBe(429);
      expect(error.errorClass).toBe("rate_limit_error");
      expect(error.retryAfterSeconds).toBe(1);
    }
    // A DIFFERENT key is unaffected (per-key windows).
    expect(() => limiter.check("keyhash-2")).not.toThrow();
    // After the window rolls over the same key is admitted again.
    now += 1_000;
    expect(() => limiter.check("keyhash-1")).not.toThrow();
  });

  it("rate limiting is OFF unless configured (existing behavior preserved)", async () => {
    const stub = buildStubServer();
    try {
      for (let index = 0; index < 30; index += 1) {
        const res = await injectJson(stub.app, "POST", "/v1/decisions", {
          payload: validDecisionRequest(),
          headers: authHeaders(ALPHA),
        });
        expect(res.status).toBe(200);
      }
      expect(stub.state.decisionCalls).toBe(30);
    } finally {
      await stub.app.close();
    }
  });

  it("configured limiter: 429 envelope with class rate_limit_error and a Retry-After header", async () => {
    const stub = buildStubServer({ rateLimit: { limit: 3, windowMs: 60_000 } });
    try {
      let lastOk = 0;
      for (let index = 0; index < 3; index += 1) {
        const res = await injectJson(stub.app, "GET", "/v1/plans", {
          headers: authHeaders(ALPHA),
        });
        expect(res.status).toBe(200);
        lastOk = index;
      }
      expect(lastOk).toBe(2);
      const blocked = await injectJson(stub.app, "GET", "/v1/plans", {
        headers: authHeaders(ALPHA),
      });
      expect(blocked.status).toBe(429);
      expectErrorEnvelope(blocked.status, blocked.body, "RATE_LIMIT_EXCEEDED", "rate_limit_error");
      const retryAfter = blocked.headers["retry-after"];
      expect(typeof retryAfter).toBe("string");
      expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);
      expect(ApiErrorEnvelopeSchema.parse(blocked.body).error.doc_url).toBe(
        "https://docs.reckon.dev/errors/rate-limit-exceeded",
      );
      // Other keys are not collateral-damaged.
      const otherKey = await injectJson(stub.app, "GET", "/v1/plans", {
        headers: authHeaders("test-key-ws"),
      });
      expect(otherKey.status).toBe(200);
    } finally {
      await stub.app.close();
    }
  });

  it("RECKON_RATE_LIMIT_MAX env knob parses into the config (opt-in)", async () => {
    const { loadConfigFromEnv } = await import("../src/config.js");
    const config = loadConfigFromEnv({ RECKON_RATE_LIMIT_MAX: "5", RECKON_RATE_LIMIT_WINDOW_MS: "120000" });
    expect(config.rateLimit).toEqual({ limit: 5, windowMs: 120_000 });
    const disabled = loadConfigFromEnv({});
    expect(disabled.rateLimit).toBeUndefined();
    expect(() => loadConfigFromEnv({ RECKON_RATE_LIMIT_MAX: "nope" })).toThrow(/RECKON_RATE_LIMIT_MAX/);
  });
});
