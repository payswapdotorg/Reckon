import { randomBytes } from "node:crypto";
import { z } from "zod/v4";
import { IdSchema, TimestampMsSchema } from "./primitives.js";
import {
  API_KEY_KINDS,
  API_KEY_TOKEN_ALPHABET,
  KEY_MODES,
  PublishableApiKeySchema,
  SecretApiKeySchema,
} from "./api-platform.js";
import type { KeyTokenGenerator } from "./api-platform.js";

/**
 * TL6-001 — self-serve API account contracts.
 *
 * This module EXTENDS the frozen contract surface additively: every type
 * here is new; no existing exported shape changes. It is the single
 * source of truth for the "sign up → get a key → get paid-tiered" hops of
 * the documented end-to-end promise (docs/surveys/stripe-com-survey.md):
 *
 *   POST   /v1/account/signup        create an account (+ first session)
 *   POST   /v1/account/login         exchange credentials for a session
 *   POST   /v1/account/logout        revoke the session
 *   GET    /v1/account/keys          list the account's keys (no secrets)
 *   POST   /v1/account/keys           mint a key (raw value shown ONCE)
 *   DELETE /v1/account/keys/:keyId   revoke a key
 *
 * Architecture lock #4 (identity authority stays with the host): these
 * contracts model Reckon API ACCESS identity only — an account owns API
 * keys and a billing tier. Subject/end-user identity remains the host's.
 *
 * SHOW-ONCE LAW (shared with the S2-002 webhook secrets and the S2-001
 * key model): raw session tokens and raw API keys appear in EXACTLY ONE
 * response — the one that mints them. They are never stored raw (sha256
 * at rest), never logged and never echoed again; later reads return only
 * the metadata views below.
 */

/* ================================================================== *
 * 1. Tiers (the paid ladder)
 * ================================================================== */

/** The account tier ladder. `free` is the signup default; higher tiers raise the per-key rate limits (RECKON_TIER_RATE_LIMITS). */
export const ACCOUNT_TIERS = ["free", "pro", "enterprise"] as const;
export type AccountTier = (typeof ACCOUNT_TIERS)[number];
export const AccountTierSchema = z.enum(ACCOUNT_TIERS);

/**
 * The FROZEN default per-minute rate limits per tier (TL6-001):
 * free 60/min, pro 600/min, enterprise UNLIMITED (`null`). A deployment
 * overrides these through RECKON_TIER_RATE_LIMITS (format
 * `free:60,pro:600,enterprise:` — an empty value = unlimited); this
 * constant is the documented default the env var replaces.
 */
export const ACCOUNT_TIER_RATE_LIMIT_DEFAULTS: Readonly<Record<AccountTier, number | null>> =
  Object.freeze({ free: 60, pro: 600, enterprise: null });

/* ================================================================== *
 * 2. Account resource + auth requests
 * ================================================================== */

/** An API account. No password material ever appears here — only its metadata view. */
export const AccountSchema = z.object({
  id: IdSchema,
  email: z.email().max(320),
  fullName: z.string().min(1).max(256),
  /** The tenant this account owns; every key minted for the account derives it. */
  tenantId: IdSchema,
  tier: AccountTierSchema,
  createdAt: TimestampMsSchema,
});
export type Account = z.infer<typeof AccountSchema>;

/** POST /v1/account/signup — passwords are min 8 (enforced at the edge; scrypt-hashed at rest, never logged). */
export const SignupRequestSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(8).max(1024),
  fullName: z.string().min(1).max(256),
  /**
   * Display name for the account's workspace. Validated at signup for
   * forward compatibility; TL6-001 has no workspace sub-resource yet, so
   * it is not persisted (the accounts table is exactly the frozen
   * migration schema) — documented honestly, not silently dropped.
   */
  workspaceName: z.string().min(1).max(256),
});
export type SignupRequest = z.infer<typeof SignupRequestSchema>;

/**
 * POST /v1/account/login. The password keeps a loose min(1) here (NOT
 * the signup policy) so a wrong credential is answered by the typed 401
 * UNAUTHENTICATED instead of leaking the password policy through a 400.
 */
export const LoginRequestSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(1024),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/* ================================================================== *
 * 3. Session tokens (reckonsess_…)
 * ================================================================== */

/** Session-token prefix — a DISTINCT vocabulary from API keys (sk_/pk_) so the two auth seams can never be confused. */
export const SESSION_TOKEN_PREFIX = "reckonsess_" as const;
/** Minimum base62 token length after the prefix. */
export const SESSION_TOKEN_MIN_TOKEN_LENGTH = 32;
/** Generated token length: 43 base62 chars ≈ 256 bits (32 bytes) of entropy. */
export const SESSION_TOKEN_GENERATED_TOKEN_LENGTH = 43;
/** Session lifetime: 7 days (the expiry is stored per session and enforced at validation). */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** A well-formed session token (reckonsess_ + base62 token). */
export const SessionTokenSchema = z
  .string()
  .min(SESSION_TOKEN_PREFIX.length + SESSION_TOKEN_MIN_TOKEN_LENGTH)
  .max(SESSION_TOKEN_PREFIX.length + 512)
  .regex(
    new RegExp(`^${SESSION_TOKEN_PREFIX}[A-Za-z0-9]{${SESSION_TOKEN_MIN_TOKEN_LENGTH},}$`),
    `session token must be ${SESSION_TOKEN_PREFIX} followed by at least ${SESSION_TOKEN_MIN_TOKEN_LENGTH} base62 characters`,
  );
export type SessionToken = z.infer<typeof SessionTokenSchema>;

function defaultSessionTokenGenerator(length: number): string {
  const bytes = randomBytes(length);
  let token = "";
  for (let index = 0; index < length; index += 1) {
    token += API_KEY_TOKEN_ALPHABET[(bytes[index] ?? 0) % API_KEY_TOKEN_ALPHABET.length];
  }
  return token;
}

/**
 * Generate a new session token. Tokens are MINTED, never discovered:
 * the session store hashes them (sha256) at rest and returns the raw
 * value exactly once, at creation.
 */
export function generateSessionToken(generateToken: KeyTokenGenerator = defaultSessionTokenGenerator): string {
  return `${SESSION_TOKEN_PREFIX}${generateToken(SESSION_TOKEN_GENERATED_TOKEN_LENGTH)}`;
}

/** Session metadata (no token material — the raw token appears only in the creation response). */
export const SessionTokenInfoSchema = z.object({
  expiresAt: TimestampMsSchema,
});
export type SessionTokenInfo = z.infer<typeof SessionTokenInfoSchema>;

/** The creation-time session view: metadata + the raw token, shown EXACTLY ONCE. */
export const AccountSessionCreatedSchema = SessionTokenInfoSchema.extend({
  token: SessionTokenSchema,
});
export type AccountSessionCreated = z.infer<typeof AccountSessionCreatedSchema>;

/** Signup (201) / login (200) response: the account plus its freshly minted session. */
export const AccountSessionResponseSchema = z.object({
  account: AccountSchema,
  session: AccountSessionCreatedSchema,
});
export type AccountSessionResponse = z.infer<typeof AccountSessionResponseSchema>;

/* ================================================================== *
 * 4. Account keys (self-serve minted sk_/pk_ keys)
 * ================================================================== */

/**
 * A minted API key's metadata view. The raw key is shown exactly once
 * (in the mint response) and only its sha256 hash is stored; this view —
 * and every later read — NEVER carries key material.
 */
export const AccountKeySchema = z.object({
  keyId: IdSchema,
  kind: z.enum(API_KEY_KINDS),
  mode: z.enum(KEY_MODES),
  /** The tier snapshot the key carries (rate limits branch on it). */
  tier: AccountTierSchema,
  createdAt: TimestampMsSchema,
  lastUsedAt: TimestampMsSchema.nullable(),
  revokedAt: TimestampMsSchema.nullable(),
});
export type AccountKey = z.infer<typeof AccountKeySchema>;

/** POST /v1/account/keys — what kind of key to mint. Secret keys authenticate; publishable keys identify (client-side) only. */
export const CreateKeyRequestSchema = z.object({
  kind: z.enum(API_KEY_KINDS),
  mode: z.enum(KEY_MODES),
});
export type CreateKeyRequest = z.infer<typeof CreateKeyRequestSchema>;

/**
 * The mint response: the key metadata view plus the RAW key value — the
 * one and only time it is ever returned (same provisioning posture as
 * the S2-001/S2-002 show-once secrets).
 */
export const AccountKeyCreatedSchema = AccountKeySchema.extend({
  key: z.union([SecretApiKeySchema, PublishableApiKeySchema]),
});
export type AccountKeyCreated = z.infer<typeof AccountKeyCreatedSchema>;

/* ================================================================== *
 * 5. Id prefixes + generators (acct_ / tnt_ / key_)
 * ================================================================== */

export const ACCOUNT_ID_PREFIX = "acct_" as const;
export const ACCOUNT_TENANT_ID_PREFIX = "tnt_" as const;
export const ACCOUNT_KEY_ID_PREFIX = "key_" as const;
/** Generated id token length (base62, IdSchema-compatible — mirrors the webhook ids). */
export const ACCOUNT_ID_TOKEN_LENGTH = 24;

function accountPrefixedId(
  prefix: string,
  generateToken: KeyTokenGenerator | undefined,
): string {
  const token = (generateToken ?? defaultSessionTokenGenerator)(ACCOUNT_ID_TOKEN_LENGTH);
  return `${prefix}${token}`;
}

/** A new account id (`acct_…`). */
export function generateAccountId(generateToken?: KeyTokenGenerator): string {
  return accountPrefixedId(ACCOUNT_ID_PREFIX, generateToken);
}

/** A new account tenant id (`tnt_…`) — the tenant an account owns at signup. */
export function generateAccountTenantId(generateToken?: KeyTokenGenerator): string {
  return accountPrefixedId(ACCOUNT_TENANT_ID_PREFIX, generateToken);
}

/** A new account-key id (`key_…`). */
export function generateAccountKeyId(generateToken?: KeyTokenGenerator): string {
  return accountPrefixedId(ACCOUNT_KEY_ID_PREFIX, generateToken);
}

/* ================================================================== *
 * 6. Route paths (the account surface's frozen wire locations)
 * ================================================================== */

/**
 * Route-path constants for the /v1/account family. The SDK composes its
 * request paths from these so the client and the API can never drift
 * apart on the wire.
 */
export const ACCOUNT_ROUTE_PATHS = {
  signup: "/v1/account/signup",
  login: "/v1/account/login",
  logout: "/v1/account/logout",
  keys: "/v1/account/keys",
  /** `:keyId` is the path parameter segment. */
  keyById: "/v1/account/keys/:keyId",
} as const;

/* ================================================================== *
 * 7. Typed error addition: EMAIL_TAKEN (409)
 * ================================================================== */

/**
 * The typed 409 for a signup whose email already belongs to an account.
 * Machine codes are STABLE public identifiers and ADDING one is the
 * documented additive change to the frozen catalog (see ERROR_CATALOG
 * in api-platform.ts — this constant is the code's spelling, kept next
 * to the account contracts that produce it).
 */
export const EMAIL_TAKEN_CODE = "EMAIL_TAKEN" as const;
