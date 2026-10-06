/**
 * TL6-001 — the account surface end-to-end over a REAL PostgreSQL server,
 * through the PRODUCTION composition (buildProductionServer: layered
 * authenticator + session-auth account routes + tier-aware rate limiting).
 *
 * Golden path (the work-order battery):
 *   signup → 409 duplicate → login (bad + good) → list keys → mint →
 *   authenticate WITH the minted key → tier-limit 429 → static-key flat
 *   limit (never 429) → static-over-DB precedence → revoke → 401 →
 *   logout → 401.
 *
 * Plus the seam law: LayeredKeyAuthenticator vs plain KeyStore —
 * byte-identical behavior for env-configured keys (same contexts, same
 * typed errors), and the honest no-persistence degrade (401, no crash).
 * Evidence class: controlled-local (real PG engine + production executor
 * + production composition).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  ApiError,
  ConfigError,
  KeyStore,
  LayeredKeyAuthenticator,
  buildProductionServer,
  type AccountKeyLookup,
  type ProductionComposition,
  type StaticKeyConfig,
} from "../src/index.js";
import { startTestPostgres, type TestPostgres } from "../../../packages/persistence/test/pg-harness.js";
import { expectErrorEnvelope } from "./fixtures.js";

let server: TestPostgres;
let composition: ProductionComposition;

const STATIC_KEY = "tl6-static-key";
const STATIC_TENANT = "tl6-static-tenant";
const STATIC_KEYS: readonly StaticKeyConfig[] = [
  {
    apiKey: STATIC_KEY,
    tenantId: STATIC_TENANT,
    scopes: ["decisions", "outcomes", "plans", "catalog"],
  },
];

/** All authenticated reads ride a light route: GET /v1/decisions/:id. */
const AUTH_PROBE = "/v1/decisions/dec-nonexistent";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function inject(
  method: string,
  url: string,
  options: { payload?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: unknown; headers: Record<string, unknown> }> {
  const res = await composition.app.inject({
    method: method as "GET" | "POST" | "DELETE",
    url,
    payload: options.payload as Record<string, unknown> | undefined,
    headers: options.headers,
  });
  let body: unknown;
  try {
    body = res.json();
  } catch {
    body = res.body;
  }
  return { status: res.statusCode, body, headers: res.headers as Record<string, unknown> };
}

function jsonHeaders(
  bearer: string | undefined,
  extra: Record<string, string> = {},
  hasPayload = true,
): Record<string, string> {
  // content-type rides ONLY requests that carry a JSON body — a bodyless
  // request must not claim one (fastify's parser rejects an empty body
  // declared as application/json).
  const headers: Record<string, string> = { ...(hasPayload ? { "content-type": "application/json" } : {}), ...extra };
  if (bearer !== undefined) headers.authorization = `Bearer ${bearer}`;
  return headers;
}

const SIGNUP = {
  email: "ada@example.com",
  password: "correct horse battery",
  fullName: "Ada Founder",
  workspaceName: "Ada's Workshop",
};

beforeAll(async () => {
  server = await startTestPostgres();
  composition = await buildProductionServer({
    executor: server.executor,
    keys: STATIC_KEYS,
    // Flat limit 100 for tierless/static keys; the FREE tier is pinned to 3
    // so the tier-limit proof is deterministic under the fixed clock.
    rateLimit: { limit: 100, tierLimits: { free: 3 } },
    apiVersion: "tl6-001",
    clock: { now: () => 1_000 },
  });
}, 120_000);

afterAll(async () => {
  await composition.close();
  await server.stop();
}, 60_000);

describe("TL6-001 golden path — signup → login → mint → tier-limit → revoke → logout", () => {
  let sessionToken = "";
  let loginToken = "";
  let rawKey = "";
  let keyId = "";

  it("signup: 201 with the account + session token shown once", async () => {
    const response = await inject("POST", "/v1/account/signup", {
      payload: SIGNUP,
      headers: jsonHeaders(undefined),
    });
    expect(response.status).toBe(201);
    const body = response.body as {
      account: { id: string; email: string; tier: string; tenantId: string };
      session: { token: string; expiresAt: number };
    };
    expect(body.account).toMatchObject({ email: "ada@example.com", tier: "free", fullName: "Ada Founder" });
    expect(body.account.id).toMatch(/^acct_[A-Za-z0-9]{24}$/);
    expect(body.account.tenantId).toMatch(/^tnt_[A-Za-z0-9]{24}$/);
    expect(body.session.token).toMatch(/^reckonsess_[A-Za-z0-9]{43}$/);
    expect(body.session.expiresAt).toBe(1_000 + 7 * 24 * 60 * 60 * 1000);
    sessionToken = body.session.token;
  });

  it("signup: duplicate email → typed 409 EMAIL_TAKEN (param: email)", async () => {
    const response = await inject("POST", "/v1/account/signup", {
      payload: SIGNUP,
      headers: jsonHeaders(undefined),
    });
    expect(response.status).toBe(409);
    expectErrorEnvelope(409, response.body, "EMAIL_TAKEN", "invalid_request_error");
    const envelope = response.body as { error: { param?: string } };
    expect(envelope.error.param).toBe("email");
  });

  it("login: wrong credentials → typed 401; right credentials → 200 + fresh session", async () => {
    const wrong = await inject("POST", "/v1/account/login", {
      payload: { email: SIGNUP.email, password: "not-the-password" },
      headers: jsonHeaders(undefined),
    });
    expect(wrong.status).toBe(401);
    expectErrorEnvelope(401, wrong.body, "UNAUTHENTICATED", "authentication_error");

    const good = await inject("POST", "/v1/account/login", {
      payload: { email: SIGNUP.email, password: SIGNUP.password },
      headers: jsonHeaders(undefined),
    });
    expect(good.status).toBe(200);
    const body = good.body as { account: { id: string; email: string }; session: { token: string } };
    expect(body.account.email).toBe(SIGNUP.email);
    expect(body.session.token).toMatch(/^reckonsess_[A-Za-z0-9]{43}$/);
    expect(body.session.token).not.toBe(sessionToken);
    loginToken = body.session.token;
  });

  it("keys list: empty at first; session-required (401 without a session token)", async () => {
    const noAuth = await inject("GET", "/v1/account/keys", { headers: jsonHeaders(undefined, {}, false) });
    expect(noAuth.status).toBe(401);
    expectErrorEnvelope(401, noAuth.body, "UNAUTHENTICATED", "authentication_error");

    // An API key presented to the session family is also a typed 401.
    const wrongKind = await inject("GET", "/v1/account/keys", { headers: jsonHeaders(STATIC_KEY, {}, false) });
    expect(wrongKind.status).toBe(401);

    const list = await inject("GET", "/v1/account/keys", { headers: jsonHeaders(sessionToken, {}, false) });
    expect(list.status).toBe(200);
    expect(list.body).toEqual({ keys: [] });
  });

  it("mint: 201 with the RAW key exactly once (show_once semantics)", async () => {
    const minted = await inject("POST", "/v1/account/keys", {
      payload: { kind: "secret", mode: "test" },
      headers: jsonHeaders(sessionToken),
    });
    expect(minted.status).toBe(201);
    const body = minted.body as {
      keyId: string;
      kind: string;
      mode: string;
      tier: string;
      key: string;
      lastUsedAt: unknown;
      revokedAt: unknown;
    };
    expect(body.kind).toBe("secret");
    expect(body.mode).toBe("test");
    expect(body.tier).toBe("free");
    expect(body.lastUsedAt).toBeNull();
    expect(body.revokedAt).toBeNull();
    expect(body.key).toMatch(/^sk_test_[A-Za-z0-9]{40}$/);
    rawKey = body.key;
    keyId = body.keyId;
    expect(keyId).toMatch(/^key_[A-Za-z0-9]{24}$/);

    // The list NEVER re-shows the raw key (metadata only).
    const list = await inject("GET", "/v1/account/keys", { headers: jsonHeaders(sessionToken, {}, false) });
    const keys = (list.body as { keys: unknown[] }).keys;
    expect(keys).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(rawKey);
  });

  it("authenticate WITH the minted key: the layered seam resolves it from the DB (mode + tier carried)", async () => {
    const response = await inject("GET", AUTH_PROBE, { headers: jsonHeaders(rawKey, {}, false) });
    // Auth PASSED — the 404 is the unknown decision id, not a 401.
    expect(response.status).toBe(404);
    expectErrorEnvelope(404, response.body, "NOT_FOUND", "invalid_request_error");
    // The mode marker rides the minted test key (S2-003 law preserved).
    expect(response.headers["x-reckon-mode"]).toBe("test");

    // lastUsedAt was touched by the auth seam.
    const list = await inject("GET", "/v1/account/keys", { headers: jsonHeaders(sessionToken, {}, false) });
    const key = (list.body as { keys: { lastUsedAt: number | null }[] }).keys[0]!;
    expect(key.lastUsedAt).toBe(1_000);
  });

  it("tier-limit: the FREE-tier key 429s past its tier limit with Retry-After (typed, byte-identical shape)", async () => {
    // One request already counted (the auth probe above) — two more pass,
    // then the 4th of the window exceeds free:3.
    const second = await inject("GET", AUTH_PROBE, { headers: jsonHeaders(rawKey, {}, false) });
    const third = await inject("GET", AUTH_PROBE, { headers: jsonHeaders(rawKey, {}, false) });
    expect(second.status).toBe(404);
    expect(third.status).toBe(404);

    const fourth = await inject("GET", AUTH_PROBE, { headers: jsonHeaders(rawKey, {}, false) });
    expect(fourth.status).toBe(429);
    expectErrorEnvelope(429, fourth.body, "RATE_LIMIT_EXCEEDED", "rate_limit_error");
    expect(fourth.headers["retry-after"]).toBeDefined();
    expect(String(fourth.headers["retry-after"]).length).toBeGreaterThan(0);
    const details = (fourth.body as { error: { details?: { limit?: unknown } } }).error.details;
    expect(details).toMatchObject({ limit: 3 });
  });

  it("static keys keep the flat default limit — the same hammer NEVER 429s (flat 100)", async () => {
    for (let index = 0; index < 6; index += 1) {
      const response = await inject("POST", "/v1/candidates", {
        payload: {
          setId: `cs-static-${index}`,
          candidates: [{ itemId: "item-1", realizationIds: ["real-1"], source: "host-retrieval" }],
        },
        headers: jsonHeaders(STATIC_KEY, { "idempotency-key": `idem-static-${index}` }),
      });
      expect(response.status).toBe(200);
    }
  });

  it("static precedence: a DB row carrying the STATIC key's hash LOSES to the env-configured entry", async () => {
    // Seed a shadow DB key whose key_hash IS the static key's hash but
    // belongs to the account's (different) tenant.
    const account = await composition.stores.accounts.findByEmail(SIGNUP.email);
    expect(account).not.toBeNull();
    await server.executor.query(
      `INSERT INTO account_keys (id, account_id, key_hash, tenant_id, workspace_id, kind, mode, tier, scopes, created_at)
       VALUES ($1,$2,$3,$4,NULL,'secret','live','pro',$5::jsonb,$6)`,
      [
        "key_shadow_static",
        account!.id,
        sha256Hex(STATIC_KEY),
        account!.tenantId,
        JSON.stringify(["decisions"]),
        0,
      ],
    );

    // The X-Reckon-Tenant probe: with the STATIC tenant it matches the
    // static context → 200. Had the DB row won, the tenant would differ
    // → 403 TENANT_MISMATCH.
    const response = await inject("POST", "/v1/candidates", {
      payload: {
        setId: "cs-precedence",
        candidates: [{ itemId: "item-1", realizationIds: ["real-1"], source: "host-retrieval" }],
      },
      headers: jsonHeaders(STATIC_KEY, {
        "x-reckon-tenant": STATIC_TENANT,
        "idempotency-key": "idem-precedence",
      }),
    });
    expect(response.status).toBe(200);
  });

  it("revoke: 204; the revoked key stops authenticating (401); re-revoke is idempotent; unknown id is 404", async () => {
    const revoke = await inject("DELETE", `/v1/account/keys/${keyId}`, {
      headers: jsonHeaders(sessionToken, {}, false),
    });
    expect(revoke.status).toBe(204);

    const after = await inject("GET", AUTH_PROBE, { headers: jsonHeaders(rawKey, {}, false) });
    expect(after.status).toBe(401);
    expectErrorEnvelope(401, after.body, "UNAUTHENTICATED", "authentication_error");

    const again = await inject("DELETE", `/v1/account/keys/${keyId}`, {
      headers: jsonHeaders(sessionToken, {}, false),
    });
    expect(again.status).toBe(204);

    const unknown = await inject("DELETE", "/v1/account/keys/key_nope", {
      headers: jsonHeaders(sessionToken, {}, false),
    });
    expect(unknown.status).toBe(404);
    expectErrorEnvelope(404, unknown.body, "NOT_FOUND", "invalid_request_error");

    // The list shows the revoked key with revokedAt set — still no raw key.
    const list = await inject("GET", "/v1/account/keys", { headers: jsonHeaders(sessionToken, {}, false) });
    const keys = (list.body as { keys: { revokedAt: number | null }[] }).keys;
    expect(keys.some((key) => key.revokedAt === 1_000)).toBe(true);
    expect(JSON.stringify(list.body)).not.toContain(rawKey);
  });

  it("minted publishable keys NEVER authenticate (the typed pk message)", async () => {
    const minted = await inject("POST", "/v1/account/keys", {
      payload: { kind: "publishable", mode: "live" },
      headers: jsonHeaders(sessionToken),
    });
    expect(minted.status).toBe(201);
    const pk = (minted.body as { key: string }).key;
    expect(pk).toMatch(/^pk_live_[A-Za-z0-9]{40}$/);

    const response = await inject("GET", AUTH_PROBE, { headers: jsonHeaders(pk) });
    expect(response.status).toBe(401);
    expectErrorEnvelope(401, response.body, "UNAUTHENTICATED", "authentication_error");
    const envelope = response.body as { error: { message: string } };
    expect(envelope.error.message).toContain("Publishable keys");
  });

  it("logout: 204 revokes the session; the token is dead afterwards (401)", async () => {
    const logout = await inject("POST", "/v1/account/logout", { headers: jsonHeaders(loginToken, {}, false) });
    expect(logout.status).toBe(204);

    const after = await inject("GET", "/v1/account/keys", { headers: jsonHeaders(loginToken, {}, false) });
    expect(after.status).toBe(401);
    expectErrorEnvelope(401, after.body, "UNAUTHENTICATED", "authentication_error");
  });
});

describe("TL6-001 auth seam — LayeredKeyAuthenticator vs plain KeyStore (byte-identical static behavior)", () => {
  const MATRIX: readonly (string | undefined)[] = [
    STATIC_KEY, // known static key
    "unknown-key", // unknown key (hash miss)
    undefined, // missing header
    "NotBearer " + STATIC_KEY, // malformed scheme
    "sk_live_" + "a".repeat(40), // well-formed but unconfigured sk key
  ];

  interface Captured {
    context?: { tenantId: string; scopes: string[]; keyHash: string; mode: string; tier?: string };
    error?: { code: string; statusCode: number; message: string };
  }

  async function captureAuthenticated(authenticate: () => unknown): Promise<Captured> {
    try {
      const context = (await authenticate()) as unknown as {
        tenantId: string;
        scopes: ReadonlySet<string>;
        keyHash: string;
        mode: string;
        tier?: string;
      };
      return {
        context: {
          tenantId: context.tenantId,
          scopes: [...context.scopes].sort(),
          keyHash: context.keyHash,
          mode: context.mode,
          ...(context.tier !== undefined ? { tier: context.tier } : {}),
        },
      };
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      return { error: { code: error.code, statusCode: error.statusCode, message: error.message } };
    }
  }

  it("identical results across the header matrix (contexts AND typed errors)", async () => {
    const layered = new LayeredKeyAuthenticator(STATIC_KEYS);
    for (const header of MATRIX) {
      const plain = new KeyStore(STATIC_KEYS);
      const plainResult = await captureAuthenticated(() => plain.authenticate(header));
      const layeredResult = await captureAuthenticated(() => layered.authenticate(header));
      expect(layeredResult).toEqual(plainResult);
    }
  });

  it("a pk key in the static map is rejected identically (both layers, same typed error)", async () => {
    const pk = "pk_live_" + "b".repeat(40);
    const keys: readonly StaticKeyConfig[] = [{ apiKey: pk, tenantId: "t", scopes: ["decisions"] }];
    const plain = new KeyStore(keys);
    const layered = new LayeredKeyAuthenticator(keys);
    const header = `Bearer ${pk}`;
    const plainResult = await captureAuthenticated(() => plain.authenticate(header));
    const layeredResult = await captureAuthenticated(() => layered.authenticate(header));
    expect(plainResult.error).toBeDefined();
    expect(layeredResult.error).toEqual(plainResult.error);
    expect(layeredResult.error?.message).toContain("Publishable keys");
  });

  it("honest degrade: with NO account lookup wired, an unknown key is the normal typed 401 (never a crash)", async () => {
    const layered = new LayeredKeyAuthenticator(STATIC_KEYS);
    const result = await captureAuthenticated(() => layered.authenticate("Bearer some-random-key"));
    expect(result.error).toMatchObject({ code: "UNAUTHENTICATED", statusCode: 401 });
    expect(result.error?.message).toBe("Unknown or invalid API key");
  });

  it("a ConfigError at boot is unchanged (the static layer still validates)", () => {
    expect(() => new LayeredKeyAuthenticator([{ apiKey: "", tenantId: "t", scopes: [] }])).toThrow(ConfigError);
    expect(
      () =>
        new LayeredKeyAuthenticator([
          { apiKey: "k", tenantId: "bad tenant!", scopes: [] },
        ]),
    ).toThrow(ConfigError);
  });

  it("DB-minted keys resolve through the lookup with tier + scopes; revoked keys are 401 misses", async () => {
    const layered = new LayeredKeyAuthenticator(STATIC_KEYS, composition.stores.accountKeys);
    // Mint through the composition's own store (real persistence path).
    const account = await composition.stores.accounts.findByEmail(SIGNUP.email);
    expect(account).not.toBeNull();
    const minted = await composition.stores.accountKeys.mint(account!, { kind: "secret", mode: "live" }, [
      "decisions",
      "catalog",
    ]);

    const context = (await layered.authenticate(`Bearer ${minted.key}`)) as {
      tenantId: string;
      mode: string;
      keyHash: string;
      scopes: ReadonlySet<string>;
      tier?: string;
    };
    expect(context.tenantId).toBe(account!.tenantId);
    expect(context.mode).toBe("live");
    expect(context.keyHash).toBe(sha256Hex(minted.key));
    expect([...context.scopes].sort()).toEqual(["catalog", "decisions"]);
    expect(context.tier).toBe("free");

    await composition.stores.accountKeys.revoke(account!.id, minted.view.keyId);
    const revoked = await captureAuthenticated(() => layered.authenticate(`Bearer ${minted.key}`));
    expect(revoked.error).toMatchObject({ code: "UNAUTHENTICATED", statusCode: 401 });
    expect(revoked.error?.message).toBe("Unknown or invalid API key");
  });

  it("PgAccountKeyStore structurally satisfies the AccountKeyLookup seam", async () => {
    const lookup: AccountKeyLookup = composition.stores.accountKeys;
    expect(typeof lookup.findByKeyHash).toBe("function");
    expect(typeof lookup.touchLastUsed).toBe("function");
  });
});
