import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KeyStore } from "../src/auth.js";
import { ConfigError } from "../src/errors.js";
import { loadConfigFromEnv, parseApiKeyList } from "../src/config.js";
import {
  ALPHA,
  BETA,
  RESEARCH_KEY,
  TEST_KEYS,
  authHeaders,
  buildDefaultServer,
  buildStubServer,
  idemHeader,
  injectJson,
  validDecisionRequest,
  validPreferenceDelta,
  expectErrorEnvelope,
  freshIdem,
} from "./fixtures.js";

describe("auth: static bearer keys (401 family)", () => {
  it("missing Authorization header → 401 UNAUTHENTICATED", async () => {
    const { app } = buildStubServer();
    try {
      const res = await injectJson(app, "POST", "/v1/decisions", {
        payload: validDecisionRequest(),
        headers: { "content-type": "application/json" },
      });
      expect(res.status).toBe(401);
      expectErrorEnvelope(res.status, res.body, "UNAUTHENTICATED");
    } finally {
      await app.close();
    }
  });

  it("non-Bearer scheme → 401", async () => {
    const { app } = buildStubServer();
    try {
      const res = await injectJson(app, "POST", "/v1/decisions", {
        payload: validDecisionRequest(),
        headers: { authorization: "Basic dXNlcjpwYXNz", "content-type": "application/json" },
      });
      expect(res.status).toBe(401);
      expectErrorEnvelope(res.status, res.body, "UNAUTHENTICATED");
    } finally {
      await app.close();
    }
  });

  it("'Bearer' with no key → 401", async () => {
    const { app } = buildStubServer();
    try {
      const res = await injectJson(app, "POST", "/v1/decisions", {
        payload: validDecisionRequest(),
        headers: { authorization: "Bearer ", "content-type": "application/json" },
      });
      expect(res.status).toBe(401);
      expectErrorEnvelope(res.status, res.body, "UNAUTHENTICATED");
    } finally {
      await app.close();
    }
  });

  it("well-formed but unknown key → 401 (and the key is never echoed)", async () => {
    const { app } = buildStubServer();
    try {
      const res = await injectJson(app, "POST", "/v1/decisions", {
        payload: validDecisionRequest(),
        headers: authHeaders("definitely-not-a-configured-key"),
      });
      expect(res.status).toBe(401);
      expectErrorEnvelope(res.status, res.body, "UNAUTHENTICATED");
      expect(JSON.stringify(res.body)).not.toContain("definitely-not-a-configured-key");
    } finally {
      await app.close();
    }
  });

  it("no keys configured at all → every authenticated request 401", async () => {
    const app = buildDefaultServer({ keys: [] });
    try {
      const res = await injectJson(app, "POST", "/v1/decisions", {
        payload: validDecisionRequest(),
        headers: authHeaders("any-key"),
      });
      expect(res.status).toBe(401);
      expectErrorEnvelope(res.status, res.body, "UNAUTHENTICATED");
    } finally {
      await app.close();
    }
  });

  it("scheme matching is case-insensitive (RFC 7235)", async () => {
    const store = new KeyStore(TEST_KEYS);
    const auth = store.authenticate("bearer test-key-alpha");
    expect(auth.tenantId).toBe("tenant-a");
  });

  it("authenticate returns the key's tenant, workspace and scopes", async () => {
    const store = new KeyStore(TEST_KEYS);
    const auth = store.authenticate("Bearer test-key-ws");
    expect(auth.tenantId).toBe("tenant-a");
    expect(auth.workspaceId).toBe("ws-1");
    expect(auth.scopes.has("decisions")).toBe(true);
    expect(auth.scopes.has("research")).toBe(false);
  });
});

describe("auth: keys hashed at rest, never logged", () => {
  it("KeyStore retains no raw key material (JSON.stringify contains no key)", () => {
    const store = new KeyStore(TEST_KEYS);
    const serialized = JSON.stringify(store);
    for (const key of [ALPHA, BETA, RESEARCH_KEY, "test-key-ws"]) {
      expect(serialized).not.toContain(key);
    }
    expect(store.size).toBe(TEST_KEYS.length);
  });

  it("duplicate keys in config are rejected (ConfigError)", () => {
    expect(
      () => new KeyStore([{ apiKey: "k", tenantId: "t-1", scopes: ["decisions"] }, { apiKey: "k", tenantId: "t-2", scopes: [] }]),
    ).toThrow(ConfigError);
  });

  it("invalid tenantId / unknown scope / empty key are rejected (ConfigError)", () => {
    expect(() => new KeyStore([{ apiKey: "k", tenantId: "", scopes: [] }])).toThrow(ConfigError);
    expect(() => new KeyStore([{ apiKey: "k", tenantId: "t-1", scopes: ["nope" as never] }])).toThrow(ConfigError);
    expect(() => new KeyStore([{ apiKey: "", tenantId: "t-1", scopes: [] }])).toThrow(ConfigError);
  });
});

describe("auth: RECKON_API_KEYS parsing", () => {
  it("parses a multi-entry env string", () => {
    const keys = parseApiKeyList("key1:tenant1:decisions,outcomes;key2:tenant2:plans;key3:tenant3:");
    expect(keys).toHaveLength(3);
    expect(keys[0]).toEqual({ apiKey: "key1", tenantId: "tenant1", scopes: ["decisions", "outcomes"] });
    expect(keys[2]?.scopes).toEqual([]);
  });

  it("splits on newlines and ignores blank entries", () => {
    const keys = parseApiKeyList("\n key1:tenant1:catalog \n;\n;key2:tenant2:decisions\n");
    expect(keys).toHaveLength(2);
  });

  it("rejects malformed entries (wrong part count) with entry index", () => {
    expect(() => parseApiKeyList("key1:tenant1")).toThrow(/entry 0/);
    expect(() => parseApiKeyList("good:tenant1:decisions;bad:tenant2")).toThrow(/entry 1/);
  });

  it("rejects unknown scope names", () => {
    expect(() => parseApiKeyList("key1:tenant1:decisions,bogus")).toThrow(/unknown scope 'bogus'/);
  });

  it("RECKON_API_KEYS_FILE wins and is read from disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "reckon-keys-"));
    const file = join(dir, "keys.env");
    try {
      writeFileSync(file, "file-key:tenant-f:catalog\n", "utf8");
      const config = loadConfigFromEnv({
        RECKON_API_KEYS: "env-key:tenant-e:decisions",
        RECKON_API_KEYS_FILE: file,
      });
      expect(config.keys).toEqual([{ apiKey: "file-key", tenantId: "tenant-f", scopes: ["catalog"] }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no env keys → empty key list (server starts, all auth 401)", () => {
    const config = loadConfigFromEnv({});
    expect(config.keys).toEqual([]);
    expect(config.apiVersion).toBe("0.1.0");
  });
});

describe("auth: scopes gate route families", () => {
  it("research-only key cannot touch runtime routes", async () => {
    const { app } = buildStubServer();
    try {
      const res = await injectJson(app, "POST", "/v1/preferences/events", {
        payload: validPreferenceDelta(),
        headers: idemHeader(freshIdem("x"), { authorization: `Bearer ${RESEARCH_KEY}` }),
      });
      expect(res.status).toBe(403);
      expectErrorEnvelope(res.status, res.body, "INSUFFICIENT_SCOPE");
      const details = (res.body as { error: { details?: { grantedScopes?: string[] } } }).error.details;
      expect(details?.grantedScopes).toEqual(["research"]);
    } finally {
      await app.close();
    }
  });

  it("insufficient-scope error never leaks the key", async () => {
    const { app } = buildStubServer();
    try {
      const res = await injectJson(app, "POST", "/v1/outcomes", {
        payload: { foo: "bar" },
        headers: authHeaders(BETA),
      });
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain(BETA);
    } finally {
      await app.close();
    }
  });
});
