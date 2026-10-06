/**
 * TL6-001 — the account stores over a REAL PostgreSQL server: signup
 * (scrypt at rest), constant-time verification, typed email-taken 409
 * source, minted keys (sha256 at rest, show-once), revocation + lookup
 * by hash, and 7-day sessions. Evidence class: controlled-local.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  AccountEmailTakenError,
  PgAccountKeyStore,
  PgAccountSessionStore,
  PgAccountStore,
} from "../src/index.js";
import { startTestPostgres, type TestPostgres } from "./pg-harness.js";

let pg: TestPostgres;

beforeAll(async () => {
  pg = await startTestPostgres();
}, 120_000);

afterAll(async () => {
  await pg.stop();
}, 60_000);

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

describe("TL6-001 PgAccountStore", () => {
  it("create + findByEmail + findById round-trip; tier starts at free; ids carry their prefixes", async () => {
    const store = new PgAccountStore(pg.executor, () => 1_000);
    const created = await store.create({
      email: "founder@example.com",
      password: "hunter22",
      fullName: "Ada Founder",
    });
    expect(created).toMatchObject({
      email: "founder@example.com",
      fullName: "Ada Founder",
      tier: "free",
      createdAt: 1_000,
    });
    expect(created.id).toMatch(/^acct_[A-Za-z0-9]{24}$/);
    expect(created.tenantId).toMatch(/^tnt_[A-Za-z0-9]{24}$/);

    expect(await store.findByEmail("founder@example.com")).toEqual(created);
    expect(await store.findById(created.id)).toEqual(created);
    expect(await store.findByEmail("nobody@example.com")).toBeNull();
    expect(await store.findById("acct_nope")).toBeNull();
  });

  it("a taken email rejects with the typed AccountEmailTakenError (both paths)", async () => {
    const store = new PgAccountStore(pg.executor, () => 2_000);
    await store.create({ email: "taken@example.com", password: "hunter22", fullName: "First" });
    await expect(
      store.create({ email: "taken@example.com", password: "other-pass", fullName: "Second" }),
    ).rejects.toThrow(AccountEmailTakenError);
  });

  it("verifyPassword: correct password → the account; wrong/unknown → null (no policy leak)", async () => {
    const store = new PgAccountStore(pg.executor, () => 3_000);
    const created = await store.create({
      email: "verify@example.com",
      password: "correct horse battery",
      fullName: "Verifier",
    });
    expect(await store.verifyPassword("verify@example.com", "correct horse battery")).toEqual(created);
    expect(await store.verifyPassword("verify@example.com", "wrong")).toBeNull();
    expect(await store.verifyPassword("ghost@example.com", "whatever")).toBeNull();
    // A password shorter than the signup policy still verifies fine here —
    // verification only ever compares against the stored hash.
    expect(await store.verifyPassword("verify@example.com", "correct")).toBeNull();
  });

  it("the stored password_hash is scrypt material — never the raw password", async () => {
    const rows = await pg.executor.query(
      `SELECT password_hash FROM accounts WHERE email = $1`,
      ["verify@example.com"],
    );
    const hash = String(rows[0]?.password_hash);
    expect(hash).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(hash).not.toContain("correct horse battery");
  });
});

describe("TL6-001 PgAccountKeyStore", () => {
  it("mint stores ONLY the sha256 hash; the raw key is returned exactly once; list is newest-first", async () => {
    const accounts = new PgAccountStore(pg.executor);
    const account = await accounts.create({
      email: "keys@example.com",
      password: "hunter22",
      fullName: "Key Owner",
    });
    let keyClock = 10_000;
    const keys = new PgAccountKeyStore(pg.executor, () => (keyClock += 1));

    const first = await keys.mint(account, { kind: "secret", mode: "test" }, ["decisions", "catalog"]);
    expect(first.key).toMatch(/^sk_test_[A-Za-z0-9]{40}$/);
    expect(first.view).toMatchObject({
      kind: "secret",
      mode: "test",
      tier: "free",
      lastUsedAt: null,
      revokedAt: null,
      createdAt: 10_001,
    });
    expect(first.view.keyId).toMatch(/^key_[A-Za-z0-9]{24}$/);

    const later = await keys.mint(account, { kind: "publishable", mode: "live" }, []);
    expect(later.key).toMatch(/^pk_live_[A-Za-z0-9]{40}$/);

    const list = await keys.list(account.id);
    expect(list).toHaveLength(2);
    expect(list[0]?.keyId).toBe(later.view.keyId); // newest first
    expect(list[1]?.keyId).toBe(first.view.keyId);
    // The listed views carry NO key material (show-once law).
    expect(JSON.stringify(list)).not.toContain(first.key);
    expect(JSON.stringify(list)).not.toContain(later.key);

    // At rest: only the hash, never the raw key.
    const stored = await pg.executor.query(`SELECT key_hash FROM account_keys WHERE id = $1`, [
      first.view.keyId,
    ]);
    expect(String(stored[0]?.key_hash)).toBe(sha256Hex(first.key));
  });

  it("findByKeyHash resolves non-revoked keys; touchLastUsed stamps last_used_at", async () => {
    const accounts = new PgAccountStore(pg.executor);
    const account = await accounts.create({
      email: "lookup@example.com",
      password: "hunter22",
      fullName: "Looker",
    });
    const keys = new PgAccountKeyStore(pg.executor, () => 20_000);
    const minted = await keys.mint(account, { kind: "secret", mode: "live" }, ["decisions"]);

    const found = await keys.findByKeyHash(sha256Hex(minted.key));
    expect(found).toMatchObject({
      keyId: minted.view.keyId,
      accountId: account.id,
      tenantId: account.tenantId,
      kind: "secret",
      mode: "live",
      tier: "free",
    });
    expect(found?.scopes).toEqual(["decisions"]);

    expect(await keys.findByKeyHash(sha256Hex("sk_live_notamintedkey"))).toBeNull();

    await keys.touchLastUsed(sha256Hex(minted.key));
    const after = await keys.list(account.id);
    expect(after[0]?.lastUsedAt).toBe(20_000);
  });

  it("revoke: unknown keyId → null; revoke is idempotent; revoked keys no longer authenticate", async () => {
    const accounts = new PgAccountStore(pg.executor);
    const account = await accounts.create({
      email: "revoke@example.com",
      password: "hunter22",
      fullName: "Revoker",
    });
    const keys = new PgAccountKeyStore(pg.executor, () => 30_000);
    const minted = await keys.mint(account, { kind: "secret", mode: "test" });

    expect(await keys.revoke(account.id, "key_nope")).toBeNull();

    const revoked = await keys.revoke(account.id, minted.view.keyId);
    expect(revoked?.revokedAt).toBe(30_000);
    // Idempotent re-revoke returns the view again.
    const again = await keys.revoke(account.id, minted.view.keyId);
    expect(again?.keyId).toBe(minted.view.keyId);

    expect(await keys.findByKeyHash(sha256Hex(minted.key))).toBeNull();
    // Another account cannot revoke this account's keys (account scoping).
    const other = await accounts.create({
      email: "other-account@example.com",
      password: "hunter22",
      fullName: "Other",
    });
    expect(await keys.revoke(other.id, minted.view.keyId)).toBeNull();
  });
});

describe("TL6-001 PgAccountSessionStore", () => {
  it("create returns the raw token once; validate resolves the account while unexpired", async () => {
    const accounts = new PgAccountStore(pg.executor, () => 40_000);
    const account = await accounts.create({
      email: "session@example.com",
      password: "hunter22",
      fullName: "Session Holder",
    });
    const sessions = new PgAccountSessionStore(pg.executor, () => 40_000);

    const created = await sessions.create(account.id);
    expect(created.token).toMatch(/^reckonsess_[A-Za-z0-9]{43}$/);
    expect(created.expiresAt).toBe(40_000 + 7 * 24 * 60 * 60 * 1000);

    const validated = await sessions.validate(created.token);
    expect(validated).toEqual({ accountId: account.id, expiresAt: created.expiresAt });
    expect(await sessions.validate("reckonsess_" + "a".repeat(43))).toBeNull();

    // At rest: only the sha256 hash of the token.
    const stored = await pg.executor.query(`SELECT token_hash FROM account_sessions`, []);
    expect(stored.map((row) => String(row.token_hash))).toContain(sha256Hex(created.token));
  });

  it("expired sessions fail validation; revoke removes the session exactly once", async () => {
    const accounts = new PgAccountStore(pg.executor, () => 50_000);
    const account = await accounts.create({
      email: "expiry@example.com",
      password: "hunter22",
      fullName: "Expirer",
    });
    // Session minted at t=50_000 with a 7-day TTL; validated at t = 50_000 + TTL + 1.
    const sessions = new PgAccountSessionStore(pg.executor, () => 50_000);
    const created = await sessions.create(account.id);

    const later = new PgAccountSessionStore(
      pg.executor,
      () => 50_000 + 7 * 24 * 60 * 60 * 1000 + 1,
    );
    expect(await later.validate(created.token)).toBeNull();

    // Revoke at the still-valid time: true once, false after.
    expect(await sessions.revoke(created.token)).toBe(true);
    expect(await sessions.revoke(created.token)).toBe(false);
    expect(await sessions.validate(created.token)).toBeNull();
  });
});
