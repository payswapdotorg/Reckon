/**
 * API-keys view + flow tests (TL6-003, account lane) — the key-manager
 * states: row view models (list), the mint flow (incl. the ONCE-ONLY
 * raw-key display), and the revoke flow's honest outcome views.
 *
 * The wire shape is the frozen account contract: { keyId, kind, mode,
 * tier, createdAt (ms), lastUsedAt, revokedAt } — no name, no prefix,
 * no secrets on read.
 */
import { describe, expect, it } from "vitest";
import type { AccountKey, AccountKeyCreated } from "@reckon/contracts";
import {
  accountKeyRowView,
  accountKeyRowsView,
  nextMintKeyFlowState,
  revokeActionFor,
  revokeOutcomeView,
  tokenVocabulary,
  visibleMintedSecret,
  type MintKeyFlowState,
} from "../src/lib/api-keys-view.js";
import type { AccountSurfaceFailure } from "../src/lib/account-api.js";

const baseRecord: AccountKey = {
  keyId: "key_" + "a".repeat(24),
  kind: "secret",
  mode: "test",
  tier: "free",
  createdAt: 1_000,
  lastUsedAt: null,
  revokedAt: null,
};

const mintedKey: AccountKeyCreated = {
  keyId: "key_" + "b".repeat(24),
  kind: "secret",
  mode: "test",
  tier: "free",
  createdAt: 1_000,
  lastUsedAt: null,
  revokedAt: null,
  key: "sk_test_" + "k".repeat(40),
};

function failure(outcome: AccountSurfaceFailure["outcome"]): AccountSurfaceFailure {
  return {
    outcome,
    detail: `observed ${outcome} detail`,
    code: null,
    param: null,
    pendingRoute: "POST /v1/account/keys",
    httpStatus: 501,
  };
}

describe("key row view models (the account wire shape)", () => {
  it("maps a record with an explicit 'not used yet' label and the kind/mode vocabulary", () => {
    const row = accountKeyRowView(baseRecord, "test", () => "FORMAT");
    expect(row.lastUsedLabel).toBe("Not used yet");
    expect(row.createdLabel).toBe("FORMAT");
    expect(row.matchesMode).toBe(true);
    expect(row.token).toBe("sk_test");
    expect(row.kindLabel).toBe("Secret key");
    expect(row.revoked).toBe(false);
    expect(row.revokedLabel).toBeNull();
  });

  it("formats last-used + revoked when the API reports them", () => {
    const row = accountKeyRowView(
      { ...baseRecord, lastUsedAt: 1_500, revokedAt: 1_800 },
      "test",
      (ms) => `T${ms}`,
    );
    expect(row.lastUsedLabel).toBe("T1500");
    expect(row.revoked).toBe(true);
    expect(row.revokedLabel).toBe("Revoked T1800");
  });

  it("the token vocabulary composes kind × mode (all four spellings)", () => {
    expect(tokenVocabulary("secret", "test")).toBe("sk_test");
    expect(tokenVocabulary("secret", "live")).toBe("sk_live");
    expect(tokenVocabulary("publishable", "test")).toBe("pk_test");
    expect(tokenVocabulary("publishable", "live")).toBe("pk_live");
  });

  it("rows are ordered current-mode-first, active before revoked, newest first; other-mode keys stay visible", () => {
    const rows = accountKeyRowsView(
      [
        { ...baseRecord, keyId: "key_live", mode: "live", createdAt: 5_000 },
        { ...baseRecord, keyId: "key_test_old", createdAt: 1_000 },
        { ...baseRecord, keyId: "key_test_new", createdAt: 9_000 },
        { ...baseRecord, keyId: "key_test_revoked", createdAt: 7_000, revokedAt: 8_000 },
      ],
      "test",
      () => "",
    );
    expect(rows.map((row) => row.id)).toEqual(["key_test_new", "key_test_old", "key_test_revoked", "key_live"]);
    expect(rows.map((row) => row.matchesMode)).toEqual([true, true, true, false]);
  });
});

describe("mint-key flow — the once-only raw-key machine", () => {
  it("opens from closed, failed and stored; not from mid-flow states", () => {
    expect(nextMintKeyFlowState({ phase: "closed" }, { type: "OPEN" })).toEqual({ phase: "choosing" });
    const failed: MintKeyFlowState = { phase: "failed", failure: failure("not-wired"), kind: "secret", mode: "test" };
    expect(nextMintKeyFlowState(failed, { type: "OPEN" })).toEqual({ phase: "choosing" });
    const stored: MintKeyFlowState = {
      phase: "stored",
      summary: { keyId: mintedKey.keyId, kind: "secret", mode: "test", tier: "free", token: "sk_test" },
    };
    expect(nextMintKeyFlowState(stored, { type: "OPEN" })).toEqual({ phase: "choosing" });
    const choosing: MintKeyFlowState = { phase: "choosing" };
    expect(nextMintKeyFlowState(choosing, { type: "OPEN" })).toBe(choosing);
  });

  it("submit validates kind and mode and moves to submitting", () => {
    const next = nextMintKeyFlowState({ phase: "choosing" }, { type: "SUBMIT", kind: "publishable", mode: "live" });
    expect(next).toEqual({ phase: "submitting", kind: "publishable", mode: "live" });

    // Invalid kind/mode never start a submission.
    expect(nextMintKeyFlowState({ phase: "choosing" }, { type: "SUBMIT", kind: "weird" as "secret", mode: "test" })).toEqual({ phase: "choosing" });
    expect(nextMintKeyFlowState({ phase: "choosing" }, { type: "SUBMIT", kind: "secret", mode: "prod" as "live" })).toEqual({ phase: "choosing" });
    // SUBMIT is only legal from choosing.
    expect(nextMintKeyFlowState({ phase: "closed" }, { type: "SUBMIT", kind: "secret", mode: "test" })).toEqual({ phase: "closed" });
  });

  it("created is reachable ONLY from submitting via RESULT ok — and holds the raw key", () => {
    const submitting: MintKeyFlowState = { phase: "submitting", kind: "secret", mode: "test" };
    const created = nextMintKeyFlowState(submitting, { type: "RESULT", result: { ok: true, key: mintedKey } });
    expect(created).toEqual({ phase: "created", key: mintedKey });
    expect(visibleMintedSecret(created)).toBe(mintedKey.key);

    // RESULT on any other phase is ignored.
    expect(nextMintKeyFlowState({ phase: "choosing" }, { type: "RESULT", result: { ok: true, key: mintedKey } })).toEqual({ phase: "choosing" });
    expect(nextMintKeyFlowState({ phase: "closed" }, { type: "RESULT", result: { ok: true, key: mintedKey } })).toEqual({ phase: "closed" });
  });

  it("ONCE-ONLY: acknowledging stores the metadata summary and DISCARDS the raw key — no fragment survives", () => {
    const submitting: MintKeyFlowState = { phase: "submitting", kind: "secret", mode: "test" };
    const created = nextMintKeyFlowState(submitting, { type: "RESULT", result: { ok: true, key: mintedKey } });
    const stored = nextMintKeyFlowState(created, { type: "SECRET_STORED" });
    expect(stored.phase).toBe("stored");
    if (stored.phase === "stored") {
      expect("key" in stored.summary).toBe(false);
      expect(JSON.stringify(stored)).not.toContain(mintedKey.key);
      expect(stored.summary.keyId).toBe(mintedKey.keyId);
      expect(stored.summary.token).toBe("sk_test");
      expect(stored.summary.tier).toBe("free");
    }
    expect(visibleMintedSecret(stored)).toBeNull();
  });

  it("ONCE-ONLY: closing from created discards the raw key; no path re-enters created", () => {
    const submitting: MintKeyFlowState = { phase: "submitting", kind: "secret", mode: "test" };
    const created = nextMintKeyFlowState(submitting, { type: "RESULT", result: { ok: true, key: mintedKey } });
    expect(visibleMintedSecret(created)).not.toBeNull();

    const closed = nextMintKeyFlowState(created, { type: "CLOSE" });
    expect(closed).toEqual({ phase: "closed" });

    // From stored/closed/failed there is NO event that produces a state
    // holding the raw key again.
    const stored = nextMintKeyFlowState(created, { type: "SECRET_STORED" });
    for (const event of [
      { type: "SECRET_STORED" },
      { type: "RETRY" },
      { type: "OPEN" },
    ] as const) {
      const next = nextMintKeyFlowState(stored, event);
      expect(visibleMintedSecret(next)).toBeNull();
      expect(JSON.stringify(next)).not.toContain(mintedKey.key);
    }
  });

  it("failure results render the honest observed outcome (never a key)", () => {
    const submitting: MintKeyFlowState = { phase: "submitting", kind: "secret", mode: "test" };
    const failed = nextMintKeyFlowState(submitting, {
      type: "RESULT",
      result: { ok: false, failure: failure("not-wired") },
    });
    expect(failed.phase).toBe("failed");
    if (failed.phase === "failed") {
      expect(failed.failure.outcome).toBe("not-wired");
      expect(failed.failure.pendingRoute).toBe("POST /v1/account/keys");
    }
    expect(visibleMintedSecret(failed)).toBeNull();

    // RETRY resubmits the same kind/mode without re-choosing.
    const retry = nextMintKeyFlowState(failed, { type: "RETRY" });
    expect(retry).toEqual({ phase: "submitting", kind: "secret", mode: "test" });
  });
});

describe("revoke flow views", () => {
  it("the revoke action names the vocabulary + key id with its stable label", () => {
    const record: AccountKey = { ...baseRecord, mode: "live" };
    const action = revokeActionFor(record);
    expect(action.id).toBe("revoke-api-key");
    expect(action.label).toBe("Revoke API key");
    expect(action.context).toBe(`sk_live ${record.keyId}`);
  });

  it("every failure kind maps to an honest, non-fabricating outcome view", () => {
    expect(revokeOutcomeView(failure("unauthenticated")).title).toMatch(/no longer valid/i);
    expect(revokeOutcomeView(failure("unreachable")).title).toMatch(/unreachable/i);
    expect(revokeOutcomeView(failure("not-wired")).title).toMatch(/not wired/i);
    expect(revokeOutcomeView(failure("error")).title).toMatch(/rejected/i);
    for (const outcome of ["unauthenticated", "unreachable", "not-wired", "error"] as const) {
      expect(revokeOutcomeView(failure(outcome)).title).toMatch(/^Not revoked/);
    }
  });
});
