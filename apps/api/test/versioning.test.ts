import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ApiVersionSchema } from "@reckon/contracts";
import { DEFAULT_API_VERSION_REGISTRY, assertRegistryCoherent, resolveRequestVersion } from "../src/versioning.js";
import { ApiError } from "../src/errors.js";
import { ERROR_CODES } from "../src/errors.js";
import { buildServer } from "../src/server.js";
import {
  ALPHA,
  authHeaders,
  buildStubServer,
  injectJson,
  validDecisionRequest,
  expectErrorEnvelope,
} from "./fixtures.js";
import type { StubServer } from "./fixtures.js";

/**
 * S2-001 API versioning — the matrix:
 *   no header → pinned default (echoed); registered version → honored;
 *   unknown/malformed/retired version → typed 400 invalid_request_error
 *   with param X-Reckon-Version.
 */

describe("versioning: registry + resolution (unit)", () => {
  it("the default registry pins 0.1.0 as active", () => {
    expect(DEFAULT_API_VERSION_REGISTRY).toEqual([
      { version: "0.1.0", status: "active", notes: expect.any(String) },
    ]);
  });

  it("absent header resolves to the pinned default (fromHeader false)", () => {
    const resolved = resolveRequestVersion(DEFAULT_API_VERSION_REGISTRY, "0.1.0", undefined);
    expect(resolved).toEqual({ version: "0.1.0", fromHeader: false });
  });

  it("a registered active version is honored", () => {
    const resolved = resolveRequestVersion(DEFAULT_API_VERSION_REGISTRY, "0.1.0", "0.1.0");
    expect(resolved).toEqual({ version: "0.1.0", fromHeader: true });
  });

  it("a registered deprecated version still serves; a retired version is a typed 400", () => {
    const registry = [
      { version: "0.1.0", status: "active" as const },
      { version: "0.0.9", status: "deprecated" as const },
      { version: "0.0.8", status: "retired" as const },
    ];
    expect(resolveRequestVersion(registry, "0.1.0", "0.0.9").version).toBe("0.0.9");
    expect(() => resolveRequestVersion(registry, "0.1.0", "0.0.8")).toThrow(ApiError);
    try {
      resolveRequestVersion(registry, "0.1.0", "0.0.8");
    } catch (error) {
      const apiError = error as ApiError;
      expect(apiError.statusCode).toBe(400);
      expect(apiError.code).toBe(ERROR_CODES.VALIDATION_ERROR);
      expect(apiError.param).toBe("X-Reckon-Version");
      expect(apiError.message).toContain("retired");
    }
  });

  it("unknown version → typed 400 naming the supported versions", () => {
    expect(() => resolveRequestVersion(DEFAULT_API_VERSION_REGISTRY, "0.1.0", "9.9.9")).toThrow(ApiError);
    try {
      resolveRequestVersion(DEFAULT_API_VERSION_REGISTRY, "0.1.0", "9.9.9");
    } catch (error) {
      const apiError = error as ApiError;
      expect(apiError.statusCode).toBe(400);
      expect(apiError.code).toBe(ERROR_CODES.VALIDATION_ERROR);
      expect(apiError.param).toBe("X-Reckon-Version");
      expect(apiError.message).toContain("9.9.9");
    }
  });

  it("malformed version strings (not semver, not a date) → typed 400", () => {
    for (const bad of ["v1", "1.2", "2026-13-01", "latest", "0.1.0-beta"]) {
      expect(() => resolveRequestVersion(DEFAULT_API_VERSION_REGISTRY, "0.1.0", bad)).toThrow(ApiError);
    }
  });

  it("ApiVersionSchema accepts semver and calendar-date strings only", () => {
    expect(ApiVersionSchema.safeParse("0.1.0").success).toBe(true);
    expect(ApiVersionSchema.safeParse("2026-10-03").success).toBe(true);
    expect(ApiVersionSchema.safeParse("1.2").success).toBe(false);
    expect(ApiVersionSchema.safeParse("banana").success).toBe(false);
  });

  it("assertRegistryCoherent rejects a registry whose pinned default is missing or retired", () => {
    expect(() => assertRegistryCoherent([{ version: "1.0.0", status: "active" }], "0.1.0")).toThrow(ApiError);
    expect(() =>
      assertRegistryCoherent([{ version: "0.1.0", status: "retired" }], "0.1.0"),
    ).toThrow(ApiError);
    expect(() =>
      assertRegistryCoherent([{ version: "0.1.0", status: "active" }], "0.1.0"),
    ).not.toThrow();
  });
});

describe("versioning: request matrix (integration)", () => {
  let stub: StubServer;

  beforeEach(() => {
    stub = buildStubServer();
  });

  afterEach(async () => {
    await stub.app.close();
  });

  it("no X-Reckon-Version → pinned default served and echoed on the response", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest(),
      headers: authHeaders(ALPHA),
    });
    expect(res.status).toBe(200);
    expect(res.headers["x-reckon-version"]).toBe("0.1.0");
  });

  it("X-Reckon-Version: 0.1.0 (the registered version) is honored + echoed", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest(),
      headers: authHeaders(ALPHA, { "x-reckon-version": "0.1.0" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers["x-reckon-version"]).toBe("0.1.0");
  });

  it("unknown X-Reckon-Version → 400 invalid_request_error with param + supported list", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest(),
      headers: authHeaders(ALPHA, { "x-reckon-version": "2020-01-01" }),
    });
    expect(res.status).toBe(400);
    expectErrorEnvelope(res.status, res.body, "VALIDATION_ERROR", "invalid_request_error");
    const error = (res.body as { error: { param?: string; details?: { supportedVersions?: string[] } } }).error;
    expect(error.param).toBe("X-Reckon-Version");
    expect(error.details?.supportedVersions).toEqual(["0.1.0"]);
    // The handler never ran.
    expect(stub.state.decisionCalls).toBe(0);
  });

  it("version rejection happens for GET routes too (before scope checks)", async () => {
    const res = await injectJson(stub.app, "GET", "/v1/plans/plan-1", {
      headers: authHeaders(ALPHA, { "x-reckon-version": "0.0.0" }),
    });
    expect(res.status).toBe(400);
    expectErrorEnvelope(res.status, res.body, "VALIDATION_ERROR", "invalid_request_error");
  });

  it("a custom registry accepts additional registered versions (config seam)", async () => {
    const stub2 = buildStubServer({
      apiVersions: [
        { version: "0.1.0", status: "active" },
        { version: "2026-10-03", status: "deprecated" },
      ],
    });
    try {
      const res = await injectJson(stub2.app, "POST", "/v1/decisions", {
        payload: validDecisionRequest(),
        headers: authHeaders(ALPHA, { "x-reckon-version": "2026-10-03" }),
      });
      expect(res.status).toBe(200);
      expect(res.headers["x-reckon-version"]).toBe("2026-10-03");
    } finally {
      await stub2.app.close();
    }
  });

  it("an incoherent registry (pinned default not registered) fails fast at boot", () => {
    expect(() =>
      buildServer({ keys: [], apiVersions: [{ version: "1.0.0", status: "active" }] }),
    ).toThrow(/not registered/);
  });

  it("a free-form apiVersion label (e.g. 'test') boots unchanged and negotiates the shipped default", async () => {
    // Pre-S2-001 callers passed arbitrary build labels (health reporting
    // only); version negotiation must not break them.
    const app = buildServer({ apiVersion: "test", keys: [] });
    try {
      const health = await injectJson(app, "GET", "/healthz", {});
      expect(health.status).toBe(200);
      expect((health.body as { version?: string }).version).toBe("test");
      const authed = await buildStubServer({ apiVersion: "test" });
      try {
        const res = await injectJson(authed.app, "POST", "/v1/decisions", {
          payload: validDecisionRequest(),
          headers: authHeaders(ALPHA),
        });
        expect(res.status).toBe(200);
        expect(res.headers["x-reckon-version"]).toBe("0.1.0");
      } finally {
        await authed.app.close();
      }
    } finally {
      await app.close();
    }
  });

  it("an env-pinned semver label (apiVersion '0.2.0') auto-registers and serves as the negotiation default", async () => {
    const stub = buildStubServer({ apiVersion: "0.2.0" });
    try {
      const res = await injectJson(stub.app, "POST", "/v1/decisions", {
        payload: validDecisionRequest(),
        headers: authHeaders(ALPHA),
      });
      expect(res.status).toBe(200);
      expect(res.headers["x-reckon-version"]).toBe("0.2.0");
      const pinned = await injectJson(stub.app, "POST", "/v1/decisions", {
        payload: validDecisionRequest(),
        headers: authHeaders(ALPHA, { "x-reckon-version": "0.1.0" }),
      });
      expect(pinned.status).toBe(200);
      expect(pinned.headers["x-reckon-version"]).toBe("0.1.0");
    } finally {
      await stub.app.close();
    }
  });

  it("401 beats version errors: no auth + bad version → 401 first (documented order)", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest(),
      headers: { "content-type": "application/json", "x-reckon-version": "bogus" },
    });
    expect(res.status).toBe(401);
    expectErrorEnvelope(res.status, res.body, "UNAUTHENTICATED", "authentication_error");
  });

  it("health routes are version-free (no X-Reckon-Version echo, open access)", async () => {
    const res = await injectJson(stub.app, "GET", "/healthz", {
      headers: { "x-reckon-version": "bogus" },
    });
    expect(res.status).toBe(200);
    expect((res.body as { ok?: boolean }).ok).toBe(true);
    expect(res.headers["x-reckon-version"]).toBeUndefined();
  });
});
