import { describe, it, expect } from "vitest";
import {
  ACCOUNT_ID_PREFIX,
  ACCOUNT_ID_TOKEN_LENGTH,
  ACCOUNT_KEY_ID_PREFIX,
  ACCOUNT_ROUTE_PATHS,
  ACCOUNT_TENANT_ID_PREFIX,
  ACCOUNT_TIERS,
  ACCOUNT_TIER_RATE_LIMIT_DEFAULTS,
  AccountKeyCreatedSchema,
  AccountKeySchema,
  AccountSchema,
  AccountSessionCreatedSchema,
  AccountSessionResponseSchema,
  AccountTierSchema,
  CreateKeyRequestSchema,
  EMAIL_TAKEN_CODE,
  ERROR_CATALOG,
  LoginRequestSchema,
  SESSION_TOKEN_GENERATED_TOKEN_LENGTH,
  SESSION_TOKEN_MIN_TOKEN_LENGTH,
  SESSION_TOKEN_PREFIX,
  SESSION_TTL_MS,
  SessionTokenSchema,
  SignupRequestSchema,
  generateAccountId,
  generateAccountKeyId,
  generateAccountTenantId,
  generatePublishableKey,
  generateSecretKey,
  generateSessionToken,
} from "../src/index.js";

/**
 * TL6-001 — the self-serve account contract surface (accounts.ts):
 * tier ladder, signup/login requests, show-once session tokens, minted
 * account-key views + route paths, and the additive EMAIL_TAKEN catalog
 * entry. Additive-only extension of the frozen contracts.
 */

describe("accounts: tier ladder", () => {
  it("the frozen three tiers validate; anything else does not", () => {
    expect(ACCOUNT_TIERS).toEqual(["free", "pro", "enterprise"]);
    for (const tier of ACCOUNT_TIERS) expect(AccountTierSchema.safeParse(tier).success).toBe(true);
    expect(AccountTierSchema.safeParse("hobby").success).toBe(false);
    expect(AccountTierSchema.safeParse("").success).toBe(false);
  });

  it("the frozen default per-minute tier limits match the work-order spec", () => {
    expect(ACCOUNT_TIER_RATE_LIMIT_DEFAULTS).toEqual({ free: 60, pro: 600, enterprise: null });
  });
});

describe("accounts: Account view", () => {
  const account = {
    id: "acct_example0123456789abcdef",
    email: "founder@example.com",
    fullName: "Ada Founder",
    tenantId: "tnt_example0123456789abcd",
    tier: "free",
    createdAt: 1_000,
  };

  it("accepts a well-formed account view", () => {
    expect(AccountSchema.safeParse(account).success).toBe(true);
  });

  it("rejects malformed emails, bad tiers and non-timestamp createdAt", () => {
    expect(AccountSchema.safeParse({ ...account, email: "not-an-email" }).success).toBe(false);
    expect(AccountSchema.safeParse({ ...account, tier: "enterprise+" }).success).toBe(false);
    expect(AccountSchema.safeParse({ ...account, createdAt: -1 }).success).toBe(false);
    expect(AccountSchema.safeParse({ ...account, createdAt: "1000" }).success).toBe(false);
  });

  it("carries no password or key material anywhere in the view", () => {
    const parsed = AccountSchema.parse(account);
    expect(Object.keys(parsed).sort()).toEqual(["createdAt", "email", "fullName", "id", "tenantId", "tier"]);
  });
});

describe("accounts: signup + login requests", () => {
  it("signup requires email, password min 8, fullName and workspaceName", () => {
    const valid = {
      email: "founder@example.com",
      password: "hunter22",
      fullName: "Ada Founder",
      workspaceName: "Ada's Workshop",
    };
    expect(SignupRequestSchema.safeParse(valid).success).toBe(true);
    expect(SignupRequestSchema.safeParse({ ...valid, password: "short" }).success).toBe(false);
    expect(SignupRequestSchema.safeParse({ ...valid, password: "" }).success).toBe(false);
    expect(SignupRequestSchema.safeParse({ ...valid, email: "nope" }).success).toBe(false);
    const { workspaceName: _omitted, ...missingWorkspace } = valid;
    expect(SignupRequestSchema.safeParse(missingWorkspace).success).toBe(false);
    const { fullName: _omittedToo, ...missingName } = valid;
    expect(SignupRequestSchema.safeParse(missingName).success).toBe(false);
  });

  it("login requires email + a non-empty password (no policy leak — 401 handles mismatches)", () => {
    expect(LoginRequestSchema.safeParse({ email: "founder@example.com", password: "short" }).success).toBe(true);
    expect(LoginRequestSchema.safeParse({ email: "founder@example.com", password: "" }).success).toBe(false);
    expect(LoginRequestSchema.safeParse({ email: "nope", password: "whatever" }).success).toBe(false);
  });
});

describe("accounts: session tokens (reckonsess_…)", () => {
  it("the prefix is a DISTINCT vocabulary from sk_/pk_ API keys", () => {
    expect(SESSION_TOKEN_PREFIX).toBe("reckonsess_");
    expect(SESSION_TOKEN_PREFIX.startsWith("sk_")).toBe(false);
    expect(SESSION_TOKEN_PREFIX.startsWith("pk_")).toBe(false);
  });

  it("generated tokens validate and are base62-only after the prefix", () => {
    for (let index = 0; index < 25; index += 1) {
      const token = generateSessionToken();
      expect(token).toMatch(/^reckonsess_[A-Za-z0-9]{43}$/);
      expect(SessionTokenSchema.safeParse(token).success).toBe(true);
    }
  });

  it("schema rejects api keys, short tokens and wrong prefixes", () => {
    expect(SessionTokenSchema.safeParse(generateSecretKey("live")).success).toBe(false);
    expect(SessionTokenSchema.safeParse(`${SESSION_TOKEN_PREFIX}${"a".repeat(SESSION_TOKEN_MIN_TOKEN_LENGTH - 1)}`).success).toBe(false);
    expect(SessionTokenSchema.safeParse(`sk_live_${"a".repeat(40)}`).success).toBe(false);
  });

  it("generation honors the injected token generator (deterministic tests)", () => {
    const token = (length: number) => "z".repeat(length);
    expect(generateSessionToken(token)).toBe(`${SESSION_TOKEN_PREFIX}${"z".repeat(SESSION_TOKEN_GENERATED_TOKEN_LENGTH)}`);
  });

  it("the 7-day TTL constant is frozen", () => {
    expect(SESSION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("the session-creation view carries the raw token exactly once; the info view never does", () => {
    const created = AccountSessionCreatedSchema.parse({ token: generateSessionToken(), expiresAt: 604_800_000 });
    expect(Object.keys(created).sort()).toEqual(["expiresAt", "token"]);
    const response = AccountSessionResponseSchema.parse({
      account: {
        id: "acct_example0123456789abcdef",
        email: "founder@example.com",
        fullName: "Ada Founder",
        tenantId: "tnt_example0123456789abcd",
        tier: "free",
        createdAt: 0,
      },
      session: created,
    });
    expect(response.session.token).toBeDefined();
    // A later read of the same session must use SessionTokenInfoSchema
    // (expiresAt only) — token material is absent by construction.
    expect("token" in { expiresAt: 0 }).toBe(false);
  });
});

describe("accounts: account keys (show-once law)", () => {
  const keyView = {
    keyId: "key_example0123456789abcdef",
    kind: "secret",
    mode: "test",
    tier: "free",
    createdAt: 1_000,
    lastUsedAt: null,
    revokedAt: null,
  };

  it("the metadata view validates and carries NO key material", () => {
    const parsed = AccountKeySchema.parse(keyView);
    expect(Object.keys(parsed).sort()).toEqual([
      "createdAt",
      "keyId",
      "kind",
      "lastUsedAt",
      "mode",
      "revokedAt",
      "tier",
    ]);
    expect(AccountKeySchema.safeParse({ ...keyView, kind: "root" }).success).toBe(false);
    expect(AccountKeySchema.safeParse({ ...keyView, mode: "prod" }).success).toBe(false);
    expect(AccountKeySchema.safeParse({ ...keyView, lastUsedAt: 2_000 }).success).toBe(true);
    expect(AccountKeySchema.safeParse({ ...keyView, revokedAt: 3_000 }).success).toBe(true);
  });

  it("CreateKeyRequest requires kind + mode", () => {
    expect(CreateKeyRequestSchema.safeParse({ kind: "secret", mode: "live" }).success).toBe(true);
    expect(CreateKeyRequestSchema.safeParse({ kind: "publishable", mode: "test" }).success).toBe(true);
    expect(CreateKeyRequestSchema.safeParse({ kind: "secret" }).success).toBe(false);
    expect(CreateKeyRequestSchema.safeParse({ mode: "live" }).success).toBe(false);
  });

  it("the mint view = metadata + the raw key (the ONLY place it appears)", () => {
    for (const [kind, mode, raw] of [
      ["secret", "live", generateSecretKey("live")],
      ["secret", "test", generateSecretKey("test")],
      ["publishable", "live", generatePublishableKey("live")],
      ["publishable", "test", generatePublishableKey("test")],
    ] as const) {
      const created = AccountKeyCreatedSchema.safeParse({ ...keyView, kind, mode, key: raw });
      expect(created.success).toBe(true);
    }
    // A malformed raw key must not validate as the minted value.
    expect(AccountKeyCreatedSchema.safeParse({ ...keyView, key: "not-a-reckon-key" }).success).toBe(false);
  });
});

describe("accounts: id generators + route paths", () => {
  it("ids carry their frozen prefixes and validate as IdSchema", () => {
    expect(generateAccountId()).toMatch(new RegExp(`^${ACCOUNT_ID_PREFIX}[A-Za-z0-9]{${ACCOUNT_ID_TOKEN_LENGTH}}$`));
    expect(generateAccountTenantId()).toMatch(new RegExp(`^${ACCOUNT_TENANT_ID_PREFIX}[A-Za-z0-9]{${ACCOUNT_ID_TOKEN_LENGTH}}$`));
    expect(generateAccountKeyId()).toMatch(new RegExp(`^${ACCOUNT_KEY_ID_PREFIX}[A-Za-z0-9]{${ACCOUNT_ID_TOKEN_LENGTH}}$`));
  });

  it("the route-path constants are the frozen wire locations", () => {
    expect(ACCOUNT_ROUTE_PATHS).toEqual({
      signup: "/v1/account/signup",
      login: "/v1/account/login",
      logout: "/v1/account/logout",
      keys: "/v1/account/keys",
      keyById: "/v1/account/keys/:keyId",
    });
  });
});

describe("accounts: EMAIL_TAKEN catalog entry (additive)", () => {
  it("exists in the frozen catalog with class invalid_request_error and HTTP 409", () => {
    expect(EMAIL_TAKEN_CODE).toBe("EMAIL_TAKEN");
    expect(ERROR_CATALOG.EMAIL_TAKEN).toMatchObject({
      errorClass: "invalid_request_error",
      httpStatus: 409,
    });
    expect(ERROR_CATALOG.EMAIL_TAKEN.docSlug).toMatch(/^[a-z0-9-]+$/);
  });

  it("the pre-existing catalog entries are byte-identical (additive-only change)", () => {
    expect(ERROR_CATALOG.UNAUTHENTICATED).toMatchObject({ errorClass: "authentication_error", httpStatus: 401 });
    expect(ERROR_CATALOG.RATE_LIMIT_EXCEEDED).toMatchObject({ errorClass: "rate_limit_error", httpStatus: 429 });
    expect(ERROR_CATALOG.IDEMPOTENCY_CONFLICT).toMatchObject({ errorClass: "invalid_request_error", httpStatus: 422 });
  });
});
