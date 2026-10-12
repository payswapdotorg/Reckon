/**
 * Auth-view tests (TL6-003) — the pure auth logic: signup/login bounds
 * (mirroring the frozen account contracts), the progressive workspace
 * default, the open-redirect guard, the session notices and the honest
 * failure→copy mapping.
 */
import { describe, expect, it } from "vitest";
import {
  SIGNUP_BOUNDS,
  authFailureView,
  defaultWorkspaceName,
  isPlausibleEmail,
  loginNoticeFor,
  loginValid,
  safeNextPath,
  signupStep1Valid,
  validateLogin,
  validateSignupStep1,
  validateWorkspaceName,
  type LoginNoticeReason,
} from "../src/lib/auth-view.js";

/* ---------------- email + bounds ---------------- */

describe("the display-level email pre-flight", () => {
  it("accepts plausible addresses and rejects malformed ones", () => {
    expect(isPlausibleEmail("ada@example.com")).toBe(true);
    expect(isPlausibleEmail("  ada@example.com  ")).toBe(true);
    expect(isPlausibleEmail("no-at-sign")).toBe(false);
    expect(isPlausibleEmail("a@b")).toBe(false);
    expect(isPlausibleEmail("a b@example.com")).toBe(false);
    expect(isPlausibleEmail(`a@${"x".repeat(400)}.com`)).toBe(false);
  });
});

describe("signup step 1 validation (bounds mirror the frozen contracts)", () => {
  const valid = { fullName: "Ada Founder", email: "ada@example.com", password: "correct horse battery", confirmPassword: "correct horse battery" };

  it("accepts the valid input", () => {
    expect(signupStep1Valid(validateSignupStep1(valid))).toBe(true);
  });

  it("rejects an empty/fullName-too-long name (contract bound 256)", () => {
    expect(validateSignupStep1({ ...valid, fullName: "   " }).fullName).toMatch(/required/i);
    expect(validateSignupStep1({ ...valid, fullName: "x".repeat(SIGNUP_BOUNDS.fullNameMax + 1) }).fullName).toMatch(/at most 256/i);
  });

  it("rejects a malformed email (contract bound 320)", () => {
    expect(validateSignupStep1({ ...valid, email: "not-an-email" }).email).toMatch(/valid email/i);
  });

  it("rejects a too-short password (contract bound: min 8)", () => {
    expect(validateSignupStep1({ ...valid, password: "short", confirmPassword: "short" }).password).toMatch(/at least 8/i);
  });

  it("rejects mismatched confirmations (the fields must agree)", () => {
    expect(validateSignupStep1({ ...valid, confirmPassword: "different" }).confirmPassword).toMatch(/do not match/i);
  });
});

describe("workspace step (progressive prefill + validation)", () => {
  it("the workspace default derives from the founder's name (possessive-aware)", () => {
    expect(defaultWorkspaceName("Ada Founder")).toBe("Ada Founder's workspace");
    expect(defaultWorkspaceName("Jones")).toBe("Jones' workspace");
    expect(defaultWorkspaceName("  Ada Founder  ")).toBe("Ada Founder's workspace");
    expect(defaultWorkspaceName("")).toBe("");
  });

  it("workspace names are required and bounded (contract bound 256)", () => {
    expect(validateWorkspaceName("  ")).toMatch(/required/i);
    expect(validateWorkspaceName("x".repeat(SIGNUP_BOUNDS.workspaceNameMax + 1))).toMatch(/at most 256/i);
    expect(validateWorkspaceName("Ada's Workshop")).toBeNull();
  });
});

describe("login validation", () => {
  it("requires a plausible email and a non-empty password", () => {
    expect(loginValid(validateLogin({ email: "ada@example.com", password: "x" }))).toBe(true);
    expect(validateLogin({ email: "nope", password: "x" }).email).toMatch(/valid email/i);
    expect(validateLogin({ email: "ada@example.com", password: "" }).password).toMatch(/password/i);
  });
});

/* ---------------- open-redirect guard ---------------- */

describe("safeNextPath — only same-origin absolute paths survive", () => {
  it("accepts plain internal paths", () => {
    expect(safeNextPath("/developers/keys")).toBe("/developers/keys");
    expect(safeNextPath("/")).toBe("/");
    expect(safeNextPath(" /developers/keys ")).toBe("/developers/keys");
  });

  it("rejects absolute URLs, protocol-relative targets and backslashes", () => {
    expect(safeNextPath("https://evil.example.com/login")).toBe("/");
    expect(safeNextPath("//evil.example.com")).toBe("/");
    expect(safeNextPath("/\\evil.example.com")).toBe("/");
    expect(safeNextPath("http://reckon.dev")).toBe("/");
  });

  it("rejects relative paths, api paths and oversized targets", () => {
    expect(safeNextPath("developers/keys")).toBe("/");
    expect(safeNextPath("/api/dashboard/keys")).toBe("/");
    expect(safeNextPath(`/${"a".repeat(600)}`)).toBe("/");
  });

  it("rejects non-strings entirely", () => {
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath("")).toBe("/");
  });
});

/* ---------------- session notices ---------------- */

describe("login notices (the honest reason a user landed on /login)", () => {
  it("each reason carries a title and a detail", () => {
    for (const reason of ["signin", "expired", "signed-out", "signed-up"] as const) {
      const notice = loginNoticeFor(reason as LoginNoticeReason);
      expect(notice.title.length).toBeGreaterThan(3);
      expect(notice.detail.length).toBeGreaterThan(10);
    }
    expect(loginNoticeFor("expired").title).toMatch(/expired/i);
    expect(loginNoticeFor("signin").detail).toMatch(/keys/i);
  });
});

/* ---------------- failure → copy mapping ---------------- */

describe("authFailureView — honest copy for every outcome", () => {
  it("unauthenticated (login) never reveals which part failed", () => {
    const view = authFailureView({ outcome: "unauthenticated", detail: "POST /v1/account/login answered 401", code: "UNAUTHENTICATED" });
    expect(view.title).toMatch(/did not match/i);
    expect(view.detail).toMatch(/does not reveal/i);
    expect(view.focusEmail).toBe(true);
  });

  it("EMAIL_TAKEN (signup) suggests signing in instead", () => {
    const view = authFailureView({ outcome: "error", detail: "HTTP 409 — EMAIL_TAKEN", code: "EMAIL_TAKEN" });
    expect(view.title).toMatch(/already exists/i);
    expect(view.suggestLogin).toBe(true);
    expect(view.focusEmail).toBe(true);
  });

  it("unreachable / not-wired / generic errors carry the observed detail verbatim", () => {
    expect(authFailureView({ outcome: "unreachable", detail: "ECONNREFUSED", code: null }).detail).toBe("ECONNREFUSED");
    expect(authFailureView({ outcome: "not-wired", detail: "404 from old deployment", code: null }).title).toMatch(/not mounted/i);
    expect(authFailureView({ outcome: "error", detail: "HTTP 400 — VALIDATION_FAILED", code: "VALIDATION_FAILED" }).detail).toBe(
      "HTTP 400 — VALIDATION_FAILED",
    );
  });
});
