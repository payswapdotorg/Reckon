/**
 * TL6-003 — auth view logic (PURE): the login/signup form validation, the
 * progressive-signup step model and the post-login redirect sanitization.
 *
 * Pure by design (no React, no env, no server-only) so every rule is unit
 * tested (test/auth-view.test.ts). The bounds deliberately MIRROR the
 * frozen account contracts (packages/contracts/src/accounts.ts) so the
 * client-side check is a UX pre-flight of the SAME policy the API
 * enforces — the API remains the authority (its zod issues are surfaced
 * verbatim when a request nonetheless fails validation).
 */

/* ================================================================== *
 * Bounds (mirroring the frozen contracts — SignupRequestSchema /
 * LoginRequestSchema in packages/contracts/src/accounts.ts)
 * ================================================================== */

export const SIGNUP_BOUNDS = {
  emailMax: 320,
  passwordMin: 8,
  passwordMax: 1024,
  fullNameMax: 256,
  workspaceNameMax: 256,
} as const;

export const LOGIN_BOUNDS = {
  emailMax: 320,
  passwordMax: 1024,
} as const;

/** Pragmatic display-level email shape (the frozen z.email() stays the authority). */
export function isPlausibleEmail(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > SIGNUP_BOUNDS.emailMax) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

/* ================================================================== *
 * Field-level validation (the UX pre-flight)
 * ================================================================== */

export interface SignupStep1Input {
  readonly fullName: string;
  readonly email: string;
  readonly password: string;
  readonly confirmPassword: string;
}

export interface SignupStep1Errors {
  readonly fullName: string | null;
  readonly email: string | null;
  readonly password: string | null;
  readonly confirmPassword: string | null;
}

export function validateSignupStep1(input: SignupStep1Input): SignupStep1Errors {
  const fullName = input.fullName.trim();
  const email = input.email.trim();

  const fullNameError =
    fullName.length === 0
      ? "Your name is required."
      : fullName.length > SIGNUP_BOUNDS.fullNameMax
        ? `Your name must be at most ${SIGNUP_BOUNDS.fullNameMax} characters.`
        : null;

  const emailError = !isPlausibleEmail(email) ? "Enter a valid email address." : null;

  const passwordError =
    input.password.length < SIGNUP_BOUNDS.passwordMin
      ? `Passwords must be at least ${SIGNUP_BOUNDS.passwordMin} characters.`
      : input.password.length > SIGNUP_BOUNDS.passwordMax
        ? `Passwords must be at most ${SIGNUP_BOUNDS.passwordMax} characters.`
        : null;

  const confirmPasswordError =
    input.confirmPassword !== input.password ? "The passwords do not match." : null;

  return { fullName: fullNameError, email: emailError, password: passwordError, confirmPassword: confirmPasswordError };
}

export function signupStep1Valid(errors: SignupStep1Errors): boolean {
  return errors.fullName === null && errors.email === null && errors.password === null && errors.confirmPassword === null;
}

export function validateWorkspaceName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "A workspace name is required.";
  if (trimmed.length > SIGNUP_BOUNDS.workspaceNameMax) {
    return `The workspace name must be at most ${SIGNUP_BOUNDS.workspaceNameMax} characters.`;
  }
  return null;
}

/** Progressive default: the workspace is named after its founder, editable. */
export function defaultWorkspaceName(fullName: string): string {
  const trimmed = fullName.trim();
  if (trimmed.length === 0) return "";
  return trimmed.endsWith("s") ? `${trimmed}' workspace` : `${trimmed}'s workspace`;
}

export interface LoginInputErrors {
  readonly email: string | null;
  readonly password: string | null;
}

export function validateLogin(input: { readonly email: string; readonly password: string }): LoginInputErrors {
  const email = input.email.trim();
  return {
    email: !isPlausibleEmail(email) ? "Enter a valid email address." : null,
    password: input.password.length === 0 ? "Enter your password." : null,
  };
}

export function loginValid(errors: LoginInputErrors): boolean {
  return errors.email === null && errors.password === null;
}

/* ================================================================== *
 * Progressive signup steps
 * ================================================================== */

/** The two-step progressive signup: account basics → workspace name. */
export type SignupStep = 1 | 2;

export const SIGNUP_STEPS: readonly { readonly step: SignupStep; readonly label: string }[] = [
  { step: 1, label: "Your account" },
  { step: 2, label: "Your workspace" },
];

/* ================================================================== *
 * Post-login redirect sanitization (open-redirect guard)
 * ================================================================== */

/** The default landing after a plain login (no `next` target). */
export const DEFAULT_LOGIN_NEXT_PATH = "/";

/**
 * Sanitize a `next` redirect target: ONLY same-origin absolute paths
 * survive ("/developers/keys"). Everything else — absolute URLs,
 * protocol-relative "//evil.com", API/handler paths, malformed input —
 * collapses to the safe default. Pure + tested.
 */
export function safeNextPath(candidate: string | null | undefined): string {
  if (typeof candidate !== "string") return DEFAULT_LOGIN_NEXT_PATH;
  const trimmed = candidate.trim();
  if (trimmed.length === 0 || trimmed.length > 512) return DEFAULT_LOGIN_NEXT_PATH;
  if (!trimmed.startsWith("/")) return DEFAULT_LOGIN_NEXT_PATH;
  if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) return DEFAULT_LOGIN_NEXT_PATH;
  if (trimmed.startsWith("/api/")) return DEFAULT_LOGIN_NEXT_PATH;
  return trimmed;
}

/* ================================================================== *
 * Session notices (the honest reason a user landed on /login)
 * ================================================================== */

export type LoginNoticeReason = "signin" | "expired" | "signed-out" | "signed-up";

export function isLoginNoticeReason(value: string | undefined | null): value is LoginNoticeReason {
  return value === "signin" || value === "expired" || value === "signed-out" || value === "signed-up";
}

export interface LoginNotice {
  readonly title: string;
  readonly detail: string;
}

export function loginNoticeFor(reason: LoginNoticeReason): LoginNotice {
  switch (reason) {
    case "signin":
      return {
        title: "Sign in to continue",
        detail: "The page you asked for manages this account's API keys — sign in to reach it.",
      };
    case "expired":
      return {
        title: "Your session expired",
        detail: "Sessions last 7 days. Sign in again to continue managing this account's keys.",
      };
    case "signed-out":
      return {
        title: "You are signed out",
        detail: "The session was revoked on the API and cleared from this browser.",
      };
    case "signed-up":
      return {
        title: "Your account is ready",
        detail: "You are signed in with your first session — welcome to Reckon.",
      };
  }
}

/* ================================================================== *
 * Proxy outcome → form-level copy (the honest mapping)
 * ================================================================== */

export interface AuthFailureView {
  readonly title: string;
  readonly detail: string;
  /** True when the email input should carry the error (EMAIL_TAKEN / invalid credentials). */
  readonly focusEmail: boolean;
  /** Offer a login link (a signup hit EMAIL_TAKEN). */
  readonly suggestLogin: boolean;
}

/**
 * Map an account-surface failure to honest form copy. Never a fake
 * success; never a masked reason.
 */
export function authFailureView(failure: {
  readonly outcome: "unauthenticated" | "unreachable" | "not-wired" | "error";
  readonly detail: string;
  readonly code: string | null;
}): AuthFailureView {
  switch (failure.outcome) {
    case "unauthenticated":
      return {
        title: "Those credentials did not match",
        detail: "Invalid email or password. The API does not reveal which part failed.",
        focusEmail: true,
        suggestLogin: false,
      };
    case "unreachable":
      return {
        title: "The Reckon API could not be reached",
        detail: failure.detail,
        focusEmail: false,
        suggestLogin: false,
      };
    case "not-wired":
      return {
        title: "The account surface is not mounted on this API",
        detail: failure.detail,
        focusEmail: false,
        suggestLogin: false,
      };
    case "error":
      if (failure.code === "EMAIL_TAKEN") {
        return {
          title: "An account with this email already exists",
          detail: "Sign in instead, or use a different email address.",
          focusEmail: true,
          suggestLogin: true,
        };
      }
      return {
        title: "The API rejected the request",
        detail: failure.detail,
        focusEmail: false,
        suggestLogin: false,
      };
  }
}

/** Deterministic UTC label for the account contract's epoch-ms timestamps (stable across SSR/hydration). */
export function formatEpochMs(ms: number): string {
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
