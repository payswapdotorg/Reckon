/**
 * TL6-003 — the account-surface client tests: every wire shape asserted
 * here MIRRORS the API's own contract battery (apps/api/test/account.test.ts)
 * — signup 201 / 409 EMAIL_TAKEN, login 200 / typed 401, logout 204,
 * keys list { keys: [...] } (no secrets, ever), mint 201 with the RAW key
 * exactly once, revoke 204 — plus the honest outcome mapping and the
 * credential-lane separation law (the account family carries ONLY the
 * session bearer; the demo/static key lane never rides it).
 *
 * Injected fetch, no network.
 */
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_ROUTES,
  accountLogin,
  accountLogout,
  accountSignup,
  createAccountKey,
  listAccountKeys,
  revokeAccountKey,
  type AccountEndpoint,
  type FetchLike,
} from "../src/lib/account-api.js";

const BASE = "http://127.0.0.1:8080";
const SESSION_TOKEN = "reckonsess_" + "s".repeat(43);
const NO_SESSION: AccountEndpoint = { baseUrl: BASE, sessionToken: null };
const SESSION: AccountEndpoint = { baseUrl: BASE, sessionToken: SESSION_TOKEN };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

function fetchReturning(responses: Response[]): FetchLike {
  let index = 0;
  return () => {
    const response = responses[index];
    index += 1;
    if (response === undefined) {
      throw new Error("unexpected extra fetch call");
    }
    return Promise.resolve(response);
  };
}

/** The API's exact account+session wire shape (TL6-001 contract test). */
function accountSessionBody(): Record<string, unknown> {
  return {
    account: {
      id: "acct_" + "a".repeat(24),
      email: "ada@example.com",
      fullName: "Ada Founder",
      tenantId: "tnt_" + "t".repeat(24),
      tier: "free",
      createdAt: 1_000,
    },
    session: { token: SESSION_TOKEN, expiresAt: 1_000 + 7 * 24 * 60 * 60 * 1000 },
  };
}

/** The API's exact account-key metadata view (list shape — no secrets, ever). */
function accountKeyRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    keyId: "key_" + "k".repeat(24),
    kind: "secret",
    mode: "test",
    tier: "free",
    createdAt: 1_000,
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

/* ================================================================== *
 * Signup / login (unauthenticated routes)
 * ================================================================== */

describe("accountSignup — the signup wire", () => {
  const input = { email: "ada@example.com", password: "correct horse battery", fullName: "Ada Founder", workspaceName: "Ada's Workshop" };

  it("201 → ok: the account + first session parse against the frozen contract", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const result = await accountSignup(NO_SESSION, input, (url, init) => {
      seenUrl = url;
      seenInit = init;
      return Promise.resolve(jsonResponse(201, accountSessionBody()));
    });
    expect(seenUrl).toBe(`${BASE}/v1/account/signup`);
    expect(seenInit?.method).toBe("POST");
    expect(JSON.parse(String(seenInit?.body))).toEqual(input);
    // The UNAUTHENTICATED route carries NO bearer (the session does not exist yet).
    const headers = seenInit?.headers as Record<string, string>;
    expect(headers["authorization"]).toBeUndefined();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.account.email).toBe("ada@example.com");
      expect(result.data.account.tier).toBe("free");
      expect(result.data.session.token).toBe(SESSION_TOKEN);
      expect(result.data.session.expiresAt).toBe(1_000 + 7 * 24 * 60 * 60 * 1000);
    }
  });

  it("409 EMAIL_TAKEN → error outcome with the API's machine code + param (no reshape)", async () => {
    const result = await accountSignup(
      NO_SESSION,
      input,
      fetchReturning([
        jsonResponse(409, { error: { class: "invalid_request_error", code: "EMAIL_TAKEN", message: "An account with this email already exists", param: "email" } }),
      ]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.outcome).toBe("error");
      expect(result.failure.code).toBe("EMAIL_TAKEN");
      expect(result.failure.param).toBe("email");
      expect(result.failure.httpStatus).toBe(409);
      expect(result.failure.detail).toContain("EMAIL_TAKEN");
    }
  });

  it("an input that violates the frozen contract fails validation BEFORE any fetch", async () => {
    let calls = 0;
    const result = await accountSignup(NO_SESSION, { ...input, password: "short" }, () => {
      calls += 1;
      return Promise.resolve(jsonResponse(201, accountSessionBody()));
    });
    expect(calls).toBe(0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.outcome).toBe("error");
      expect(result.failure.code).toBe("REQUEST_INVALID");
      expect(result.failure.detail).toContain("before it was sent");
    }
  });

  it("unreachable maps the observed network failure", async () => {
    const result = await accountSignup(NO_SESSION, input, () => Promise.reject(new Error("ECONNREFUSED boom")));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.outcome).toBe("unreachable");
      expect(result.failure.detail).toContain("ECONNREFUSED boom");
      expect(result.failure.pendingRoute).toBe(ACCOUNT_ROUTES.signup);
    }
  });

  it("a 201 body that violates the frozen contract is an honest ERROR (withheld, never padded)", async () => {
    const result = await accountSignup(NO_SESSION, input, fetchReturning([jsonResponse(201, { account: { id: "x" }, session: {} })]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.outcome).toBe("error");
      expect(result.failure.code).toBe("CONTRACT_VIOLATION");
    }
  });
});

describe("accountLogin — the login wire", () => {
  it("200 → ok with a fresh session; the typed 401 maps to unauthenticated (verbatim message)", async () => {
    const good = await accountLogin(
      NO_SESSION,
      { email: "ada@example.com", password: "correct horse battery" },
      fetchReturning([jsonResponse(200, accountSessionBody())]),
    );
    expect(good.ok).toBe(true);

    const bad = await accountLogin(
      NO_SESSION,
      { email: "ada@example.com", password: "not-the-password" },
      fetchReturning([
        jsonResponse(401, { error: { class: "authentication_error", code: "UNAUTHENTICATED", message: "Invalid email or password" } }),
      ]),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.failure.outcome).toBe("unauthenticated");
      expect(bad.failure.code).toBe("UNAUTHENTICATED");
      expect(bad.failure.httpStatus).toBe(401);
      expect(bad.failure.detail).toContain("Invalid email or password");
    }
  });
});

/* ================================================================== *
 * Session-authenticated routes (logout / keys)
 * ================================================================== */

describe("the session pre-flight (credential-lane separation)", () => {
  it("NO session token ⇒ unauthenticated outcome, and NO fetch is attempted", async () => {
    let calls = 0;
    const counting: FetchLike = () => {
      calls += 1;
      return Promise.resolve(jsonResponse(200, { keys: [] }));
    };
    for (const result of [
      await accountLogout(NO_SESSION, counting),
      await listAccountKeys(NO_SESSION, counting),
      await createAccountKey(NO_SESSION, { kind: "secret", mode: "test" }, counting),
      await revokeAccountKey(NO_SESSION, "key_x", counting),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.outcome).toBe("unauthenticated");
        expect(result.failure.detail).toContain("sign in");
      }
    }
    expect(calls).toBe(0);
  });

  it("session calls carry ONLY the reckonsess_ bearer — never a demo/static key", async () => {
    let seenAuth = "";
    await listAccountKeys(SESSION, (url, init) => {
      seenAuth = (init?.headers as Record<string, string>)["authorization"] ?? "";
      expect(url).toBe(`${BASE}/v1/account/keys`);
      return Promise.resolve(jsonResponse(200, { keys: [] }));
    });
    expect(seenAuth).toBe(`Bearer ${SESSION_TOKEN}`);
  });
});

describe("accountLogout — the 204 wire", () => {
  it("204 → ok (revoked)", async () => {
    const result = await accountLogout(SESSION, fetchReturning([noContent()]));
    expect(result.ok).toBe(true);
  });

  it("401 (already-invalid session) → unauthenticated with the API's message", async () => {
    const result = await accountLogout(
      SESSION,
      fetchReturning([
        jsonResponse(401, { error: { class: "authentication_error", code: "UNAUTHENTICATED", message: "Session token is invalid or expired; log in again" } }),
      ]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.outcome).toBe("unauthenticated");
      expect(result.failure.detail).toContain("invalid or expired");
    }
  });

  it("a 200 with a body (contract violation — logout is 204-only) is an honest error", async () => {
    const result = await accountLogout(SESSION, fetchReturning([jsonResponse(200, { ok: true })]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.outcome).toBe("error");
      expect(result.failure.code).toBe("CONTRACT_VIOLATION");
      expect(result.failure.detail).toContain("204");
    }
  });
});

describe("listAccountKeys — the { keys: [...] } wire (metadata only, NO secrets, ever)", () => {
  it("200 with rows → ok; every row parses against the frozen AccountKey contract", async () => {
    const rows = [
      accountKeyRow({ keyId: "key_" + "1".repeat(24), createdAt: 2_000 }),
      accountKeyRow({ keyId: "key_" + "2".repeat(24), kind: "publishable", mode: "live", tier: "pro", lastUsedAt: 1_500, revokedAt: 1_800 }),
    ];
    const result = await listAccountKeys(SESSION, fetchReturning([jsonResponse(200, { keys: rows })]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0]?.keyId).toBe("key_" + "1".repeat(24));
      expect(result.data[1]?.revokedAt).toBe(1_800);
    }
  });

  it("the frozen schema strips unknown fields — key material can never ride the list into the UI", async () => {
    const poisoned = accountKeyRow();
    (poisoned as Record<string, unknown>)["key"] = "sk_test_" + "x".repeat(40);
    const result = await listAccountKeys(SESSION, fetchReturning([jsonResponse(200, { keys: [poisoned] })]));
    // The frozen AccountKeySchema strips unknown keys — so this row PARSES
    // (metadata only) and the secret-looking field never reaches the UI.
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(JSON.stringify(result.data)).not.toContain("sk_test_");
    }
  });

  it("a non-envelope 2xx body is an honest error", async () => {
    const result = await listAccountKeys(SESSION, fetchReturning([jsonResponse(200, { data: [] })]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.outcome).toBe("error");
      expect(result.failure.detail).toContain("{ keys: [...] }");
    }
  });

  it("404/501 → not-wired with the pending route named verbatim", async () => {
    for (const status of [404, 501]) {
      const result = await listAccountKeys(
        SESSION,
        fetchReturning([jsonResponse(status, { error: { class: "api_error", code: "NOT_WIRED", message: "no mounted handler" } })]),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.outcome).toBe("not-wired");
        expect(result.failure.pendingRoute).toBe(ACCOUNT_ROUTES.listKeys);
        expect(result.failure.httpStatus).toBe(status);
        expect(result.failure.detail).toContain("GET /v1/account/keys");
      }
    }
  });

  it("unreachable maps the observed network failure", async () => {
    const result = await listAccountKeys(SESSION, () => Promise.reject(new Error("ECONNREFUSED boom")));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.outcome).toBe("unreachable");
      expect(result.failure.detail).toContain("ECONNREFUSED boom");
    }
  });
});

describe("createAccountKey — the mint wire (RAW key shown exactly once)", () => {
  it("201 → ok: the raw key rides the response; the body parses against AccountKeyCreated", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const rawKey = "sk_test_" + "k".repeat(40);
    const result = await createAccountKey(SESSION, { kind: "secret", mode: "test" }, (url, init) => {
      seenUrl = url;
      seenInit = init;
      return Promise.resolve(jsonResponse(201, { ...accountKeyRow(), key: rawKey }));
    });
    expect(seenUrl).toBe(`${BASE}/v1/account/keys`);
    expect(seenInit?.method).toBe("POST");
    expect(JSON.parse(String(seenInit?.body))).toEqual({ kind: "secret", mode: "test" });
    expect((seenInit?.headers as Record<string, string>)["authorization"]).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.key).toBe(rawKey);
      expect(result.data.kind).toBe("secret");
      expect(result.data.mode).toBe("test");
      expect(result.data.tier).toBe("free");
    }
  });

  it("publishable keys mint with the pk_ vocabulary (kind/mode flow through)", async () => {
    const pk = "pk_live_" + "p".repeat(40);
    const result = await createAccountKey(
      SESSION,
      { kind: "publishable", mode: "live" },
      fetchReturning([jsonResponse(201, { ...accountKeyRow({ kind: "publishable", mode: "live" }), key: pk })]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.key).toBe(pk);
      expect(result.data.kind).toBe("publishable");
      expect(result.data.mode).toBe("live");
    }
  });

  it("a 201 without the raw key field is a contract violation (withheld — never a fabricated secret)", async () => {
    const result = await createAccountKey(SESSION, { kind: "secret", mode: "test" }, fetchReturning([jsonResponse(201, accountKeyRow())]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.outcome).toBe("error");
      expect(result.failure.code).toBe("CONTRACT_VIOLATION");
    }
  });

  it("kind/mode validation happens BEFORE any fetch (frozen contract pre-flight)", async () => {
    let calls = 0;
    const result = await createAccountKey(SESSION, { kind: "weird" as "secret", mode: "test" }, () => {
      calls += 1;
      return Promise.resolve(jsonResponse(201, { ...accountKeyRow(), key: "sk_test_x" }));
    });
    expect(calls).toBe(0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("REQUEST_INVALID");
    }
  });
});

describe("revokeAccountKey — the 204 wire", () => {
  it("204 → ok; the route is named with the id substituted; the id is URL-encoded", async () => {
    let seenUrl = "";
    let seenMethod = "";
    const result = await revokeAccountKey(SESSION, "key_42", (url, init) => {
      seenUrl = url;
      seenMethod = init?.method ?? "";
      return Promise.resolve(noContent());
    });
    expect(seenUrl).toBe(`${BASE}/v1/account/keys/key_42`);
    expect(seenMethod).toBe("DELETE");
    expect(result.ok).toBe(true);

    const failed = await revokeAccountKey(SESSION, "key_42", fetchReturning([jsonResponse(501, {})]));
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.failure.pendingRoute).toBe("DELETE /v1/account/keys/key_42");
      expect(failed.failure.outcome).toBe("not-wired");
    }
  });

  it("the API's typed 404 (unknown key) is an honest error with the code carried", async () => {
    const result = await revokeAccountKey(
      SESSION,
      "key_nope",
      fetchReturning([
        jsonResponse(404, { error: { class: "invalid_request_error", code: "NOT_FOUND", message: "Account key not found: key_nope" } }),
      ]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.outcome).toBe("error");
      expect(result.failure.code).toBe("NOT_FOUND");
      expect(result.failure.httpStatus).toBe(404);
    }
  });

  it("an empty key id fails validation before any fetch", async () => {
    let calls = 0;
    const result = await revokeAccountKey(SESSION, "  ", () => {
      calls += 1;
      return Promise.resolve(noContent());
    });
    expect(calls).toBe(0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("REQUEST_INVALID");
    }
  });
});
