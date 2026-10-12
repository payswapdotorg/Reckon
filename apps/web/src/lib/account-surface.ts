/**
 * TL6-003 — the account/session seam (server-only): composes the pure
 * account client (`account-api.ts`) with the studio's server
 * environment and the browser session cookie.
 *
 * LAWS (same as lib/reckon-client.ts + lib/developers-surface.ts):
 *  - `import "server-only"`: the reckonsess_ token resolves exclusively
 *    in server components / route handlers. It lives in an httpOnly
 *    cookie (never readable by client JS) and is NEVER passed as a prop
 *    — only the display-safe account metadata (email, fullName, tier)
 *    crosses the server→client boundary.
 *  - The functions attempt the REAL /v1/account routes and return
 *    exactly what was observed — honest degradation (Gate Q): failures
 *    name the route and the observed reason; nothing is fabricated.
 *
 * SESSION MODEL (TL6-001 contracts): signup/login mint a reckonsess_
 * token (shown once on the wire — the studio immediately moves it into
 * the httpOnly cookie, so the browser NEVER renders it at all). The
 * cookie's maxAge mirrors the contract's SESSION_TTL_MS (7 days); the
 * API validates the session server-side on every authenticated call —
 * the cookie is a transport, never an authority.
 *
 * API_GAP (recorded in docs/ux/tl6-003-dashboard-auth.md): the frozen
 * account family has no session-introspection route (no GET
 * /v1/account/me), so the studio caches the display-safe account
 * metadata in a second cookie at signup/login. That cache is
 * NON-authoritative: it renders only while a session cookie exists, and
 * any observed 401 clears both cookies (expired-session handling).
 *
 * Env (documented in apps/web/README.md — unchanged by TL6-003):
 *   RECKON_API_BASE_URL — API origin (default http://127.0.0.1:8080)
 */
import "server-only";

import { cookies } from "next/headers";
import { SESSION_TTL_MS } from "@reckon/contracts";
import {
  accountLogin,
  accountLogout,
  accountSignup,
  createAccountKey,
  listAccountKeys,
  revokeAccountKey,
  type AccountEndpoint,
  type AccountSurfaceResult,
  type CreateAccountKeyInput,
  type LoginInput,
  type SignupInput,
} from "./account-api.js";
import { DEFAULT_RECKON_API_BASE_URL } from "./reckon-client.js";
import type { AccountKey, AccountKeyCreated, AccountSessionResponse } from "@reckon/contracts";

/* ================================================================== *
 * Cookies (the session transport)
 * ================================================================== */

/** The httpOnly session cookie (holds the raw reckonsess_ token; JS can never read it). */
export const SESSION_COOKIE_NAME = "reckon_studio_session";
/** The display-safe account metadata cache (email, fullName, tier — no secret material). */
export const ACCOUNT_DISPLAY_COOKIE_NAME = "reckon_studio_account";

/** Mirrors the frozen contract's SESSION_TTL_MS (7 days). */
export const SESSION_COOKIE_MAX_AGE_SECONDS = Math.floor(SESSION_TTL_MS / 1000);

export interface StudioAccountDisplay {
  readonly email: string;
  readonly fullName: string;
  readonly tier: "free" | "pro" | "enterprise";
}

function sessionCookieOptions(): {
  readonly httpOnly: true;
  readonly sameSite: "lax";
  readonly secure: boolean;
  readonly path: "/";
  readonly maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    // Mark secure only in production: local dev rides http://127.0.0.1.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  };
}

/** The raw session token from the cookie, or null (read-only; safe in server components). */
export async function getStudioSessionToken(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value?.trim();
  return token && token.length > 0 ? token : null;
}

/**
 * The display-safe account metadata, or null. Strictly parsed — a
 * malformed/foreign cookie renders as signed-out (honest), never as a
 * half-parsed account.
 */
export async function getStudioAccountDisplay(): Promise<StudioAccountDisplay | null> {
  const store = await cookies();
  const raw = store.get(ACCOUNT_DISPLAY_COOKIE_NAME)?.value;
  if (raw === undefined || raw.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const email = typeof record["email"] === "string" ? record["email"] : null;
    const fullName = typeof record["fullName"] === "string" ? record["fullName"] : null;
    const tier = record["tier"];
    if (email === null || email.length === 0 || email.length > 320) return null;
    if (fullName === null || fullName.length === 0 || fullName.length > 256) return null;
    if (tier !== "free" && tier !== "pro" && tier !== "enterprise") return null;
    return { email, fullName, tier };
  } catch {
    return null;
  }
}

/**
 * Persist a fresh session: the raw token into the httpOnly cookie and
 * the display-safe metadata into its cache cookie. Route-handler only
 * (cookie writes); the token itself is never returned to the caller.
 */
export async function setStudioSessionCookies(session: AccountSessionResponse): Promise<StudioAccountDisplay> {
  const store = await cookies();
  const display: StudioAccountDisplay = {
    email: session.account.email,
    fullName: session.account.fullName,
    tier: session.account.tier,
  };
  store.set(SESSION_COOKIE_NAME, session.session.token, sessionCookieOptions());
  store.set(ACCOUNT_DISPLAY_COOKIE_NAME, JSON.stringify(display), sessionCookieOptions());
  return display;
}

/** Clear both session cookies. Route-handler only (cookie writes). */
export async function clearStudioSessionCookies(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
  store.delete(ACCOUNT_DISPLAY_COOKIE_NAME);
}

/* ================================================================== *
 * Account-surface attempts (server-side, real routes)
 * ================================================================== */

function endpoint(sessionToken: string | null): AccountEndpoint {
  const baseUrl = process.env.RECKON_API_BASE_URL?.trim() || DEFAULT_RECKON_API_BASE_URL;
  return { baseUrl, sessionToken };
}

function sessionEndpoint(): Promise<AccountEndpoint> {
  return getStudioSessionToken().then((token) => endpoint(token));
}

/** POST /v1/account/signup — 201 account + first session (unauthenticated route). */
export function attemptSignup(input: SignupInput): Promise<AccountSurfaceResult<AccountSessionResponse>> {
  return accountSignup(endpoint(null), input, fetch);
}

/** POST /v1/account/login — 200 account + fresh session (unauthenticated route). */
export function attemptLogin(input: LoginInput): Promise<AccountSurfaceResult<AccountSessionResponse>> {
  return accountLogin(endpoint(null), input, fetch);
}

/** POST /v1/account/logout — 204 (revokes the session server-side). Uses the cookie's token. */
export async function attemptLogout(): Promise<AccountSurfaceResult<{ revoked: true }>> {
  return accountLogout(await sessionEndpoint(), fetch);
}

/** GET /v1/account/keys — the account's keys, metadata only. Uses the cookie's token. */
export async function attemptListKeys(): Promise<AccountSurfaceResult<readonly AccountKey[]>> {
  return listAccountKeys(await sessionEndpoint(), fetch);
}

/** POST /v1/account/keys — mint a key (RAW value shown exactly once). Uses the cookie's token. */
export async function attemptCreateKey(input: CreateAccountKeyInput): Promise<AccountSurfaceResult<AccountKeyCreated>> {
  return createAccountKey(await sessionEndpoint(), input, fetch);
}

/** DELETE /v1/account/keys/{keyId} — revoke. Uses the cookie's token. */
export async function attemptRevokeKey(keyId: string): Promise<AccountSurfaceResult<{ revoked: true }>> {
  return revokeAccountKey(await sessionEndpoint(), keyId, fetch);
}
