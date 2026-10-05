/**
 * API-keys view + flow tests (S3-001) — the key-manager states: row view
 * models (list), the create flow (incl. the ONCE-ONLY secret display),
 * and the revoke flow's honest outcome views.
 */
import { describe, expect, it } from "vitest";
import {
  KEY_NAME_MAX_LENGTH,
  apiKeyRowView,
  apiKeyRowsView,
  isValidKeyName,
  nextCreateKeyFlowState,
  revokeActionFor,
  revokeOutcomeView,
  visibleSecret,
  type CreateKeyFlowState,
} from "../src/lib/api-keys-view.js";
import type { ApiKeyRecord, CreatedApiKey, SurfaceFailure } from "../src/lib/developers-api.js";

const baseRecord: ApiKeyRecord = {
  id: "key-1",
  name: "production server",
  prefix: "sk_test_…9f2K",
  mode: "test",
  kind: "secret",
  created_at: "2026-10-03T10:00:00.000Z",
  last_used_at: null,
};

const createdKey: CreatedApiKey = {
  ...baseRecord,
  id: "key-2",
  name: "mobile app",
  prefix: "sk_test_…aa11",
  secret: "sk_test_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
};

function failure(outcome: SurfaceFailure["outcome"]): SurfaceFailure {
  return { outcome, detail: `observed ${outcome} detail`, pendingRoute: "POST /v1/api-keys", httpStatus: 501 };
}

describe("key row view models", () => {
  it("maps a record with an explicit 'not used yet' label", () => {
    const row = apiKeyRowView(baseRecord, "test", () => "FORMAT");
    expect(row.lastUsedLabel).toBe("Not used yet");
    expect(row.createdLabel).toBe("FORMAT");
    expect(row.matchesMode).toBe(true);
  });

  it("formats last-used when the API reports it", () => {
    const row = apiKeyRowView(
      { ...baseRecord, last_used_at: "2026-10-03T11:30:00.000Z" },
      "test",
      (iso) => iso.slice(0, 10),
    );
    expect(row.lastUsedLabel).toBe("2026-10-03");
  });

  it("rows are ordered current-mode-first, then by name; other-mode keys stay visible", () => {
    const rows = apiKeyRowsView(
      [
        { ...baseRecord, id: "a", name: "zz live key", mode: "live" },
        { ...baseRecord, id: "b", name: "aa test key", mode: "test" },
        { ...baseRecord, id: "c", name: "mm test key", mode: "test" },
      ],
      "test",
      () => "",
    );
    expect(rows.map((row) => row.id)).toEqual(["b", "c", "a"]);
    expect(rows.map((row) => row.matchesMode)).toEqual([true, true, false]);
  });
});

describe("create-key flow — the once-only secret machine", () => {
  it("opens from closed and failed, not from mid-flow states", () => {
    expect(nextCreateKeyFlowState({ phase: "closed" }, { type: "OPEN" })).toEqual({ phase: "naming" });
    const failed: CreateKeyFlowState = { phase: "failed", failure: failure("not-wired"), name: "n", kind: "secret" };
    expect(nextCreateKeyFlowState(failed, { type: "OPEN" })).toEqual({ phase: "naming" });
    const naming: CreateKeyFlowState = { phase: "naming" };
    expect(nextCreateKeyFlowState(naming, { type: "OPEN" })).toBe(naming);
  });

  it("submit validates the name and moves to submitting", () => {
    const next = nextCreateKeyFlowState({ phase: "naming" }, { type: "SUBMIT", name: "  mobile app  ", kind: "publishable" });
    expect(next).toEqual({ phase: "submitting", name: "mobile app", kind: "publishable" });

    // Invalid names never start a submission.
    expect(nextCreateKeyFlowState({ phase: "naming" }, { type: "SUBMIT", name: "", kind: "secret" })).toEqual({ phase: "naming" });
    expect(nextCreateKeyFlowState({ phase: "naming" }, { type: "SUBMIT", name: "   ", kind: "secret" })).toEqual({ phase: "naming" });
    expect(
      nextCreateKeyFlowState({ phase: "naming" }, { type: "SUBMIT", name: "x".repeat(KEY_NAME_MAX_LENGTH + 1), kind: "secret" }),
    ).toEqual({ phase: "naming" });
  });

  it("isValidKeyName: trimmed, 1..64 characters", () => {
    expect(isValidKeyName("a")).toBe(true);
    expect(isValidKeyName("  padded  ")).toBe(true);
    expect(isValidKeyName("")).toBe(false);
    expect(isValidKeyName("   ")).toBe(false);
    expect(isValidKeyName("x".repeat(KEY_NAME_MAX_LENGTH))).toBe(true);
    expect(isValidKeyName("x".repeat(KEY_NAME_MAX_LENGTH + 1))).toBe(false);
  });

  it("created is reachable ONLY from submitting via RESULT ok — and holds the secret", () => {
    const submitting: CreateKeyFlowState = { phase: "submitting", name: "mobile app", kind: "secret" };
    const created = nextCreateKeyFlowState(submitting, { type: "RESULT", result: { ok: true, key: createdKey } });
    expect(created).toEqual({ phase: "created", key: createdKey });
    expect(visibleSecret(created)).toBe(createdKey.secret);

    // RESULT on any other phase is ignored.
    expect(nextCreateKeyFlowState({ phase: "naming" }, { type: "RESULT", result: { ok: true, key: createdKey } })).toEqual({ phase: "naming" });
    expect(nextCreateKeyFlowState({ phase: "closed" }, { type: "RESULT", result: { ok: true, key: createdKey } })).toEqual({ phase: "closed" });
  });

  it("ONCE-ONLY: acknowledging stores the summary and DISCARDS the secret", () => {
    const submitting: CreateKeyFlowState = { phase: "submitting", name: "mobile app", kind: "secret" };
    const created = nextCreateKeyFlowState(submitting, { type: "RESULT", result: { ok: true, key: createdKey } });
    const stored = nextCreateKeyFlowState(created, { type: "SECRET_STORED" });
    expect(stored.phase).toBe("stored");
    if (stored.phase === "stored") {
      expect("secret" in stored.key).toBe(false);
      expect(stored.key.prefix).toBe(createdKey.prefix);
      expect(stored.key.name).toBe(createdKey.name);
    }
    expect(visibleSecret(stored)).toBeNull();
  });

  it("ONCE-ONLY: closing from created discards the secret; no path re-enters created", () => {
    const submitting: CreateKeyFlowState = { phase: "submitting", name: "mobile app", kind: "secret" };
    const created = nextCreateKeyFlowState(submitting, { type: "RESULT", result: { ok: true, key: createdKey } });
    expect(visibleSecret(created)).not.toBeNull();

    const closed = nextCreateKeyFlowState(created, { type: "CLOSE" });
    expect(closed).toEqual({ phase: "closed" });

    // From stored/closed/failed there is NO event that produces a state
    // holding a secret again.
    const stored = nextCreateKeyFlowState(created, { type: "SECRET_STORED" });
    for (const event of [
      { type: "SECRET_STORED" },
      { type: "RETRY" },
      { type: "OPEN" },
    ] as const) {
      const next = nextCreateKeyFlowState(stored, event);
      expect(visibleSecret(next)).toBeNull();
    }
  });

  it("failure results render the honest observed outcome (never a key)", () => {
    const submitting: CreateKeyFlowState = { phase: "submitting", name: "mobile app", kind: "secret" };
    const failed = nextCreateKeyFlowState(submitting, {
      type: "RESULT",
      result: { ok: false, failure: failure("not-wired") },
    });
    expect(failed.phase).toBe("failed");
    if (failed.phase === "failed") {
      expect(failed.failure.outcome).toBe("not-wired");
      expect(failed.failure.pendingRoute).toBe("POST /v1/api-keys");
    }
    expect(visibleSecret(failed)).toBeNull();

    // RETRY resubmits the same name/kind without retyping.
    const retry = nextCreateKeyFlowState(failed, { type: "RETRY" });
    expect(retry).toEqual({ phase: "submitting", name: "mobile app", kind: "secret" });
  });
});

describe("revoke flow views", () => {
  it("the revoke action names the key prefix and its label (stable id)", () => {
    const record: ApiKeyRecord = { ...baseRecord, mode: "live", prefix: "sk_live_…9f2K", name: "production server" };
    const action = revokeActionFor(record);
    expect(action.id).toBe("revoke-api-key");
    expect(action.label).toBe("Revoke API key");
    expect(action.context).toBe("sk_live_…9f2K (production server)");
  });

  it("every failure kind maps to an honest, non-fabricating outcome view", () => {
    expect(revokeOutcomeView(failure("unconfigured")).title).toMatch(/not configured/i);
    expect(revokeOutcomeView(failure("unreachable")).title).toMatch(/unreachable/i);
    expect(revokeOutcomeView(failure("not-wired")).title).toMatch(/not wired/i);
    expect(revokeOutcomeView(failure("error")).title).toMatch(/rejected/i);
    for (const outcome of ["unconfigured", "unreachable", "not-wired", "error"] as const) {
      expect(revokeOutcomeView(failure(outcome)).title).toMatch(/^Not revoked/);
    }
  });
});
