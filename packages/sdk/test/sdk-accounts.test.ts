/**
 * TL6-001 — the SDK account surface against the REAL apps/api application
 * (buildServer + registerAccountRoutes) adapted through the inject fetch
 * seam: signup/login/logout, key mint (raw key once), list (metadata
 * only), revoke, typed error mapping (EMAIL_TAKEN 409, UNAUTHENTICATED
 * 401) and the layered authenticator resolving the MINTED key end-to-end.
 *
 * The account stores here are in-process TEST INFRASTRUCTURE (the same
 * posture as every other SDK harness stub); the durable PostgreSQL
 * stores are proven in @reckon/persistence and the production
 * composition test (apps/api test/account.test.ts). Evidence class:
 * controlled-local.
 */
import { describe, expect, it } from "vitest";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { generatePublishableKey, generateSecretKey } from "@reckon/contracts";
import { createReckonClient } from "../src/index.js";
import { ReckonConfigError, ReckonSdkError } from "../src/index.js";
import { createInjectFetch } from "../src/testing.js";
import { buildServer, LayeredKeyAuthenticator, registerAccountRoutes } from "../../../apps/api/src/index.js";
import { AccountEmailTakenError } from "../../../packages/persistence/src/index.js";
import type {
  AccountKeyView,
  AccountRecord,
  MintedAccountKey,
  StoredAccountKeyAuth,
} from "../../../packages/persistence/src/index.js";
import type { FastifyInstance } from "fastify";

/* ---------------- in-memory account stores (test infrastructure) ---------------- */

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 64).toString("hex")}`;
}

function verifyPasswordHash(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1]!, "hex");
  const expected = Buffer.from(parts[2]!, "hex");
  return timingSafeEqual(scryptSync(password, salt, expected.length), expected);
}

let clockNow = 10_000;
const now = () => (clockNow += 1);

function newAccountRecord(email: string, fullName: string): AccountRecord {
  return {
    id: `acct_${randomBytes(12).toString("hex")}`,
    email,
    fullName,
    tenantId: `tnt_${randomBytes(12).toString("hex")}`,
    tier: "free",
    createdAt: now(),
  };
}

const accountsById = new Map<string, AccountRecord>();
const accountsByEmail = new Map<string, AccountRecord>();
const passwordById = new Map<string, string>();

const fakeAccounts = {
  async create(input: { email: string; password: string; fullName: string }): Promise<AccountRecord> {
    const existing = accountsByEmail.get(input.email);
    if (existing !== undefined) throw new AccountEmailTakenError(input.email);
    const record = newAccountRecord(input.email, input.fullName);
    accountsById.set(record.id, record);
    accountsByEmail.set(record.email, record);
    passwordById.set(record.id, hashPassword(input.password));
    return record;
  },
  async findByEmail(email: string): Promise<AccountRecord | null> {
    return accountsByEmail.get(email) ?? null;
  },
  async findById(id: string): Promise<AccountRecord | null> {
    return accountsById.get(id) ?? null;
  },
  async verifyPassword(email: string, password: string): Promise<AccountRecord | null> {
    const record = accountsByEmail.get(email);
    if (record === undefined) return null;
    const stored = passwordById.get(record.id);
    if (stored === undefined || !verifyPasswordHash(password, stored)) return null;
    return record;
  },
};

interface FakeKeyRow {
  view: AccountKeyView;
  keyHash: string;
  rawKey: string;
  accountId: string;
  tenantId: string;
  scopes: readonly string[];
  revoked: boolean;
}

// (row.view is replaced wholesale on revoke/touch — the views stay readonly.)

const keyRows = new Map<string, FakeKeyRow>();

const fakeKeys = {
  async mint(
    account: Pick<AccountRecord, "id" | "tenantId" | "tier">,
    request: { kind: "secret" | "publishable"; mode: "live" | "test" },
    scopes: readonly string[] = [],
  ): Promise<MintedAccountKey> {
    const rawKey =
      request.kind === "secret" ? generateSecretKey(request.mode) : generatePublishableKey(request.mode);
    const view: AccountKeyView = {
      keyId: `key_${randomBytes(12).toString("hex")}`,
      kind: request.kind,
      mode: request.mode,
      tier: account.tier,
      createdAt: now(),
      lastUsedAt: null,
      revokedAt: null,
    };
    keyRows.set(view.keyId, {
      view,
      keyHash: sha256Hex(rawKey),
      rawKey,
      accountId: account.id,
      tenantId: account.tenantId,
      scopes,
      revoked: false,
    });
    return { key: rawKey, view };
  },
  async list(accountId: string): Promise<readonly AccountKeyView[]> {
    return [...keyRows.values()]
      .filter((row) => row.accountId === accountId)
      .sort((a, b) => b.view.createdAt - a.view.createdAt)
      .map((row) => row.view);
  },
  async revoke(accountId: string, keyId: string): Promise<AccountKeyView | null> {
    const row = keyRows.get(keyId);
    if (row === undefined || row.accountId !== accountId) return null;
    if (!row.revoked) {
      row.revoked = true;
      row.view = { ...row.view, revokedAt: now() };
    }
    return row.view;
  },
  async findByKeyHash(keyHash: string): Promise<StoredAccountKeyAuth | null> {
    for (const row of keyRows.values()) {
      if (row.keyHash === keyHash && !row.revoked) {
        return {
          keyId: row.view.keyId,
          accountId: row.accountId,
          tenantId: row.tenantId,
          workspaceId: null,
          kind: row.view.kind,
          mode: row.view.mode,
          tier: row.view.tier,
          scopes: row.scopes,
        };
      }
    }
    return null;
  },
  async touchLastUsed(keyHash: string): Promise<void> {
    for (const [keyId, row] of keyRows.entries()) {
      if (row.keyHash === keyHash) {
        keyRows.set(keyId, { ...row, view: { ...row.view, lastUsedAt: now() } });
      }
    }
  },
};

const sessionByHash = new Map<string, { accountId: string; expiresAt: number }>();

const fakeSessions = {
  async create(accountId: string): Promise<{ token: string; expiresAt: number }> {
    // base62 after the prefix (hex is a subset) — matches SessionTokenSchema.
    const token = `reckonsess_${randomBytes(24).toString("hex")}`;
    const expiresAt = now() + 7 * 24 * 60 * 60 * 1000;
    sessionByHash.set(sha256Hex(token), { accountId, expiresAt });
    return { token, expiresAt };
  },
  async validate(token: string): Promise<{ accountId: string; expiresAt: number } | null> {
    const session = sessionByHash.get(sha256Hex(token));
    if (session === undefined || session.expiresAt <= now()) return null;
    return session;
  },
  async revoke(token: string): Promise<boolean> {
    return sessionByHash.delete(sha256Hex(token));
  },
};

/* ---------------- the real app, the real pipeline ---------------- */

const STATIC_KEY = "sdk-account-static";
const app: FastifyInstance = buildServer({
  apiVersion: "tl6-sdk",
  keys: [{ apiKey: STATIC_KEY, tenantId: "sdk-static-tenant", scopes: ["decisions", "plans", "catalog"] }],
  // The layered seam so the MINTED key authenticates the normal /v1 routes.
  keyStore: new LayeredKeyAuthenticator(
    [{ apiKey: STATIC_KEY, tenantId: "sdk-static-tenant", scopes: ["decisions", "plans", "catalog"] }],
    fakeKeys,
  ),
  // A minimal plan handler so the minted-key proof rides a REAL 2xx path
  // (the full production data path is proven in apps/api test/account.test.ts).
  handlers: {
    planHandler: {
      create: async (plan) => plan,
      get: async () => null,
      history: async () => [],
      listRecent: async () => [],
      replan: async (_planId, request) => request as never,
    },
  },
  clock: () => now(),
});
registerAccountRoutes(app, {
  accounts: fakeAccounts,
  keys: fakeKeys,
  sessions: fakeSessions,
});

const fetchImpl = createInjectFetch(app);
const reckon = createReckonClient({
  baseUrl: "http://reckon.test",
  apiKey: STATIC_KEY,
  fetchImpl,
  idGenerator: (() => {
    let n = 0;
    return () => `sdk-account-${(n += 1)}`;
  })(),
});

const SIGNUP = {
  email: "sdk-founder@example.com",
  password: "hunter22",
  fullName: "SDK Founder",
  workspaceName: "SDK Workshop",
};

describe("TL6-001 SDK account surface (real API, session-token auth)", () => {
  it("signup returns the zod-parsed account + session (token shown once)", async () => {
    const result = await reckon.account.signup(SIGNUP);
    expect(result.account).toMatchObject({ email: SIGNUP.email, fullName: SIGNUP.fullName, tier: "free" });
    expect(result.account.id).toMatch(/^acct_/);
    expect(result.session.token).toMatch(/^reckonsess_[A-Za-z0-9]{32,}$/);
  });

  it("duplicate signup maps to the typed EMAIL_TAKEN server error (409)", async () => {
    await expect(reckon.account.signup(SIGNUP)).rejects.toMatchObject({
      code: "EMAIL_TAKEN",
      statusCode: 409,
    });
  });

  it("signup input is validated BEFORE it is sent (SDK_REQUEST_INVALID)", async () => {
    await expect(
      reckon.account.signup({ ...SIGNUP, email: "not-an-email", password: "short" }),
    ).rejects.toMatchObject({ code: "SDK_REQUEST_INVALID" });
  });

  it("login: fresh session; bad credentials map to the typed 401", async () => {
    const session = await reckon.account.login({ email: SIGNUP.email, password: SIGNUP.password });
    expect(session.session.token).toMatch(/^reckonsess_[A-Za-z0-9]{32,}$/);

    await expect(
      reckon.account.login({ email: SIGNUP.email, password: "wrong" }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED", statusCode: 401 });
  });

  it("mint returns the raw key exactly once; the list NEVER re-shows it; revoke is 204", async () => {
    const session = await reckon.account.login({ email: SIGNUP.email, password: SIGNUP.password });
    const token = session.session.token;

    const minted = await reckon.account.createAccountKey(token, { kind: "secret", mode: "test" });
    expect(minted.key).toMatch(/^sk_test_[A-Za-z0-9]{40}$/);
    expect(minted.kind).toBe("secret");
    expect(minted.mode).toBe("test");
    expect(minted.tier).toBe("free");
    expect(minted.revokedAt).toBeNull();

    const keys = await reckon.account.listAccountKeys(token);
    expect(keys).toHaveLength(1);
    expect(keys[0]?.keyId).toBe(minted.keyId);
    expect(JSON.stringify(keys)).not.toContain(minted.key);

    // The MINTED key authenticates the normal API through the layered
    // seam — a real tenant-scoped call with the account's own key.
    const mintedClient = createReckonClient({
      baseUrl: "http://reckon.test",
      apiKey: minted.key,
      fetchImpl,
      idGenerator: () => "sdk-minted-1",
    });
    const plans = await mintedClient.plans.listRecent();
    expect(Array.isArray(plans)).toBe(true);

    // Revoke through the SDK → the minted key is dead (typed 401).
    await reckon.account.revokeAccountKey(token, minted.keyId);
    await expect(mintedClient.plans.listRecent()).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      statusCode: 401,
    });
  });

  it("logout revokes the session; later session calls are the typed 401", async () => {
    const session = await reckon.account.login({ email: SIGNUP.email, password: SIGNUP.password });
    const token = session.session.token;
    await reckon.account.createAccountKey(token, { kind: "publishable", mode: "live" });
    await reckon.account.logout(token);
    await expect(reckon.account.listAccountKeys(token)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      statusCode: 401,
    });
  });

  it("a malformed session token is a client-side config error (never sent)", async () => {
    await expect(reckon.account.listAccountKeys("not-a-session-token")).rejects.toBeInstanceOf(ReckonConfigError);
    await expect(reckon.account.logout("sk_live_" + "a".repeat(40))).rejects.toBeInstanceOf(ReckonConfigError);
  });

  it("every failure surfaces as a typed ReckonSdkError (no raw escapes)", async () => {
    const attempts = await Promise.allSettled([
      reckon.account.listAccountKeys("reckonsess_" + "z".repeat(43)),
      reckon.account.login({ email: "ghost@example.com", password: "whatever" }),
    ]);
    for (const attempt of attempts) {
      if (attempt.status === "rejected") {
        expect(attempt.reason).toBeInstanceOf(ReckonSdkError);
      }
    }
  });
});
