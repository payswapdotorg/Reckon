import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  PublishableApiKeySchema,
  SecretApiKeySchema,
  generatePublishableKey,
  generateSecretKey,
  parseReckonApiKey,
} from "@reckon/contracts";
import { KeyStore, mintKeyConfig } from "../src/auth.js";
import { parseApiKeyList } from "../src/config.js";
import { ConfigError } from "../src/errors.js";
import {
  ALPHA,
  NEW_PK_LIVE,
  NEW_SK_LIVE,
  NEW_SK_TEST,
  TENANT_T,
  authHeaders,
  buildStubServer,
  injectJson,
  validDecisionRequest,
  validPreferenceDelta,
  idemHeader,
  freshIdem,
  expectErrorEnvelope,
} from "./fixtures.js";
import type { StubServer } from "./fixtures.js";

/**
 * S2-001 key model — the full auth matrix:
 *   sk_live_/sk_test_ secret keys authenticate; pk_ publishable keys are
 *   rejected as typed 401 authentication_error; the key-scoped mode
 *   (live/test) propagates to handlers; legacy opaque keys keep working.
 */

describe("keys: format vocabulary (contracts)", () => {
  it("generates well-formed keys for every kind × mode", () => {
    for (const mode of ["live", "test"] as const) {
      const secret = generateSecretKey(mode);
      const publishable = generatePublishableKey(mode);
      expect(SecretApiKeySchema.safeParse(secret).success).toBe(true);
      expect(PublishableApiKeySchema.safeParse(publishable).success).toBe(true);
      expect(parseReckonApiKey(secret)).toEqual({
        kind: "secret",
        mode,
        token: expect.any(String),
      });
      expect(parseReckonApiKey(publishable)).toEqual({
        kind: "publishable",
        mode,
        token: expect.any(String),
      });
    }
  });

  it("generated keys are unique and 40 chars of base62", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 50; index += 1) {
      const key = generateSecretKey("live");
      seen.add(key);
      expect(key).toMatch(/^sk_live_[A-Za-z0-9]{40}$/);
    }
    expect(seen.size).toBe(50);
  });

  it("parseReckonApiKey rejects malformed / legacy keys", () => {
    expect(parseReckonApiKey("sk_live_short")).toBeNull();
    expect(parseReckonApiKey("sk_live_" + "a".repeat(23))).toBeNull();
    expect(parseReckonApiKey("sk_prod_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBeNull();
    expect(parseReckonApiKey("test-key-alpha")).toBeNull();
    expect(parseReckonApiKey("")).toBeNull();
  });

  it("deterministic generation with an injected token generator", () => {
    const key = generateSecretKey("test", (length) => "x".repeat(length));
    expect(key).toBe(`sk_test_${"x".repeat(40)}`);
  });

  it("mintKeyConfig produces validated StaticKeyConfig entries", () => {
    const secret = mintKeyConfig("secret", "live", "tenant-x", ["decisions"]);
    expect(SecretApiKeySchema.safeParse(secret.apiKey).success).toBe(true);
    expect(secret.mode).toBe("live");
    const publishable = mintKeyConfig("publishable", "test", "tenant-x", []);
    expect(PublishableApiKeySchema.safeParse(publishable.apiKey).success).toBe(true);
  });
});

describe("keys: auth matrix (S2-001)", () => {
  let stub: StubServer;

  beforeEach(() => {
    stub = buildStubServer();
  });

  afterEach(async () => {
    await stub.app.close();
  });

  it("sk_live_ secret key authenticates like a legacy key (same tenant, same scopes)", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest({ tenant: { tenantId: "tenant-a" } }),
      headers: authHeaders(NEW_SK_LIVE),
    });
    expect(res.status).toBe(200);
    expect((res.body as { tenant: { tenantId: string } }).tenant.tenantId).toBe("tenant-a");
  });

  it("sk_test_ key authenticates and propagates mode=test to handlers; sk_live propagates mode=live", async () => {
    const testCall = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest({ tenant: { tenantId: TENANT_T } }),
      headers: authHeaders(NEW_SK_TEST),
    });
    expect(testCall.status).toBe(200);
    const liveCall = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest({ tenant: { tenantId: "tenant-a" } }),
      headers: authHeaders(NEW_SK_LIVE),
    });
    expect(liveCall.status).toBe(200);
    expect(stub.state.observedModes).toEqual(["test", "live"]);
  });

  it("legacy keys propagate mode=live by default (documented transition)", async () => {
    await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest(),
      headers: authHeaders(ALPHA),
    });
    expect(stub.state.observedModes).toEqual(["live"]);
  });

  it("legacy key pinned mode: 'test' propagates without the sk_test_ format", async () => {
    const store = new KeyStore([
      { apiKey: "legacy-pinned", tenantId: "tenant-a", scopes: ["decisions"], mode: "test" },
    ]);
    const auth = store.authenticate("Bearer legacy-pinned");
    expect(auth.mode).toBe("test");
  });

  it("a well-formed pk_live_ key is a typed 401 authentication_error — even though it is configured", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest(),
      headers: authHeaders(NEW_PK_LIVE),
    });
    expect(res.status).toBe(401);
    expectErrorEnvelope(res.status, res.body, "UNAUTHENTICATED", "authentication_error");
    const message = (res.body as { error: { message: string } }).error.message;
    expect(message).toContain("Publishable keys");
    // The rejected key material is never echoed.
    expect(JSON.stringify(res.body)).not.toContain(NEW_PK_LIVE);
    expect(stub.state.decisionCalls).toBe(0);
  });

  it("an UNCONFIGURED well-formed pk_test_ key is also a typed 401 (never a generic lookup leak)", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest(),
      headers: authHeaders(generatePublishableKey("test")),
    });
    expect(res.status).toBe(401);
    expectErrorEnvelope(res.status, res.body, "UNAUTHENTICATED", "authentication_error");
  });

  it("a malformed sk_-prefixed key (token too short) is an unknown key → typed 401, never echoed", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/preferences/events", {
      payload: validPreferenceDelta(),
      headers: authHeaders("sk_live_too-short"),
    });
    expect(res.status).toBe(401);
    expectErrorEnvelope(res.status, res.body, "UNAUTHENTICATED", "authentication_error");
    expect(JSON.stringify(res.body)).not.toContain("sk_live_too-short");
  });

  it("every 401 body names class authentication_error and carries doc_url", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest(),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(401);
    const error = (res.body as { error: { class: string; doc_url?: string } }).error;
    expect(error.class).toBe("authentication_error");
    expect(error.doc_url).toContain("/errors/");
  });

  it("sk_test_ key is scoped to its tenant: cross-tenant body → 403 TENANT_MISMATCH", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest({ tenant: { tenantId: "tenant-b" } }),
      headers: authHeaders(NEW_SK_TEST),
    });
    expect(res.status).toBe(403);
    expectErrorEnvelope(res.status, res.body, "TENANT_MISMATCH", "permission_error");
  });
});

describe("keys: KeyStore configuration discipline", () => {
  it("malformed sk_/pk_ prefixed keys fail FAST at config time (ConfigError)", () => {
    expect(
      () => new KeyStore([{ apiKey: "sk_live_short", tenantId: "t-1", scopes: [] }]),
    ).toThrow(ConfigError);
    expect(
      () => new KeyStore([{ apiKey: "pk_live_bad!", tenantId: "t-1", scopes: [] }]),
    ).toThrow(ConfigError);
  });

  it("an entry pinning a mode that contradicts the key's in-band mode is a ConfigError", () => {
    expect(() =>
      new KeyStore([
        { apiKey: generateSecretKey("live"), tenantId: "t-1", scopes: [], mode: "test" },
      ]),
    ).toThrow(/carries mode 'live'/);
  });

  it("an entry pinning the SAME mode as the key is accepted", () => {
    const key = generateSecretKey("test");
    const store = new KeyStore([{ apiKey: key, tenantId: "t-1", scopes: [], mode: "test" }]);
    expect(store.authenticate(`Bearer ${key}`).tenantId).toBe("t-1");
  });

  it("raw key material never appears in serialized KeyStore state", () => {
    const key = generateSecretKey("live");
    const store = new KeyStore([{ apiKey: key, tenantId: "t-1", scopes: [] }]);
    expect(JSON.stringify(store)).not.toContain(key);
  });

  it("parseApiKeyList still parses new-format keys through the env seam (no colons in base62)", () => {
    const key = generateSecretKey("test");
    const parsed = parseApiKeyList(`${key}:tenant-9:decisions,plans`);
    expect(parsed).toEqual([{ apiKey: key, tenantId: "tenant-9", scopes: ["decisions", "plans"] }]);
  });

  it("idempotency + new keys compose: sk_test_ replay works end-to-end", async () => {
    const stub = buildStubServer();
    try {
      const key = "s2-key-replay-1";
      const payload = validPreferenceDelta({ tenant: { tenantId: TENANT_T } });
      const first = await injectJson(stub.app, "POST", "/v1/preferences/events", {
        payload,
        headers: { ...authHeaders(NEW_SK_TEST), "idempotency-key": key },
      });
      expect(first.status).toBe(200);
      const second = await injectJson(stub.app, "POST", "/v1/preferences/events", {
        payload,
        headers: { ...authHeaders(NEW_SK_TEST), "idempotency-key": key },
      });
      expect(second.status).toBe(200);
      expect(second.headers["idempotent-replayed"]).toBe("true");
      expect(stub.state.preferenceCalls).toBe(1);
    } finally {
      await stub.app.close();
    }
  });

  it("scope checks still gate new-format keys (sk key without the route scope → 403)", async () => {
    const { buildServer } = await import("../src/server.js");
    const key = generateSecretKey("live");
    const app = buildServer({
      keys: [{ apiKey: key, tenantId: "tenant-z", scopes: ["catalog"] }],
    });
    try {
      const scoped = await injectJson(app, "POST", "/v1/preferences/events", {
        payload: validPreferenceDelta(),
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
          "idempotency-key": freshIdem(),
        },
      });
      expect(scoped.status).toBe(403);
      expectErrorEnvelope(scoped.status, scoped.body, "INSUFFICIENT_SCOPE", "permission_error");
    } finally {
      await app.close();
    }
  });

});
