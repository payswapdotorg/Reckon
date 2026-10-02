/**
 * P1-004 — reckon-migrate CLI over a REAL PostgreSQL server.
 * Evidence class: controlled-local (real engine + wire protocol + pg driver;
 * the deployed Neon endpoint is exercised with a real DATABASE_URL — Gate L).
 *
 * The suite boots the shared harness server, then creates a PRISTINE
 * `reckon_cli` database for the CLI (the harness auto-migrates its own
 * `reckon_test` database — not usable for pending-state assertions).
 *
 * Exit-code contract under test: 0 ok · 1 usage/env/connection/apply ·
 * 2 checksum tamper. Honest failures only — no fake asserts.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS, PgPoolExecutor } from "../src/index.js";
import { runMigrateCli } from "../src/migrate-cli.js";
import { startTestPostgres, TEST_PORT, type TestPostgres } from "./pg-harness.js";

const CLI_URI = `postgres://postgres:postgres@127.0.0.1:${TEST_PORT}/reckon_cli`;

interface Captured {
  out: string[];
  err: string[];
}

function captureIo(): { io: { out(line: string): void; err(line: string): void }; lines: Captured } {
  const lines: Captured = { out: [], err: [] };
  return { io: { out: (l) => lines.out.push(l), err: (l) => lines.err.push(l) }, lines };
}

/** The true checksum of a migration, re-derived from the code's own SQL
 * (same derivation as migrations.ts — the source of truth is the code). */
function trueChecksum(id: string): string {
  const migration = MIGRATIONS.find((m) => m.id === id);
  if (migration === undefined) throw new Error(`unknown migration ${id}`);
  return createHash("sha256").update(migration.sql.join("\n;\n")).digest("hex");
}

async function setChecksum(id: string, checksum: string): Promise<void> {
  const executor = new PgPoolExecutor({ connectionString: CLI_URI, max: 1 });
  try {
    await executor.query(`UPDATE reckon_schema_migrations SET checksum = $1 WHERE id = $2`, [checksum, id]);
  } finally {
    await executor.close();
  }
}

let pg: TestPostgres;

beforeAll(async () => {
  pg = await startTestPostgres();
  // Fresh, migration-free database for CLI runs (autocommit — CREATE
  // DATABASE cannot run inside a transaction; the server is per-suite so
  // no cross-file state can exist).
  await pg.executor.query(`DROP DATABASE IF EXISTS reckon_cli`);
  await pg.executor.query(`CREATE DATABASE reckon_cli`);
});

afterAll(async () => {
  await pg.stop();
});

describe("reckon-migrate CLI (real PostgreSQL)", () => {
  it("status on a fresh database → exit 0, every migration pending", async () => {
    const { io, lines } = captureIo();
    const code = await runMigrateCli(["status"], { DATABASE_URL: CLI_URI }, io);
    expect(code).toBe(0);
    expect(lines.out.filter((l) => l.startsWith("[pending]")).length).toBe(3);
    expect(lines.out.some((l) => l.includes("3 of 3 migrations pending"))).toBe(true);
    expect(lines.err).toEqual([]);
  });

  it("apply → exit 0, applies all migrations in order, then reports current", async () => {
    const { io, lines } = captureIo();
    const code = await runMigrateCli(["apply"], { DATABASE_URL: CLI_URI }, io);
    expect(code).toBe(0);
    const applied = lines.out.filter((l) => /^applied [a-z0-9_]+$/.test(l));
    expect(applied.map((l) => l.slice(8))).toEqual(["m001_events", "m002_outbox", "m003_api_state"]);
    expect(lines.out.some((l) => l.includes("applied 3 of 3 migrations; schema is current"))).toBe(true);
    expect(lines.err).toEqual([]);
  });

  it("apply is idempotent — a second run applies nothing and exits 0", async () => {
    const { io, lines } = captureIo();
    const code = await runMigrateCli(["apply"], { DATABASE_URL: CLI_URI }, io);
    expect(code).toBe(0);
    expect(lines.out.some((l) => l.includes("schema is current (3 migrations, 0 applied by this run)"))).toBe(
      true,
    );
    expect(lines.out.filter((l) => l.startsWith("[applied]")).length).toBe(3);
  });

  it("status after apply → exit 0, all applied, no pending note", async () => {
    const { io, lines } = captureIo();
    const code = await runMigrateCli(["status"], { DATABASE_URL: CLI_URI }, io);
    expect(code).toBe(0);
    expect(lines.out.filter((l) => l.startsWith("[applied]")).length).toBe(3);
    expect(lines.out.some((l) => l.includes("pending"))).toBe(false);
  });

  it("checksum tamper → status exits 2; restoring the true checksum self-heals to 0", async () => {
    await setChecksum("m002_outbox", "deadbeef");
    const { io, lines } = captureIo();
    const code = await runMigrateCli(["status"], { DATABASE_URL: CLI_URI }, io);
    expect(code).toBe(2);
    expect(lines.out.some((l) => l.startsWith("[TAMPERED] m002_outbox"))).toBe(true);
    expect(lines.err.some((l) => l.includes("checksum tamper detected") && l.includes("m002_outbox"))).toBe(true);

    // Tamper detection is stateless (recorded-vs-current); restoring the
    // recorded checksum to the true one clears the verdict.
    await setChecksum("m002_outbox", trueChecksum("m002_outbox"));
    const healed = captureIo();
    expect(await runMigrateCli(["status"], { DATABASE_URL: CLI_URI }, healed.io)).toBe(0);
    expect(healed.lines.out.some((l) => l.startsWith("[TAMPERED]"))).toBe(false);
  });

  it("apply refuses tampered state too → exit 2 (post-apply verification)", async () => {
    await setChecksum("m001_events", "deadbeef");
    const { io, lines } = captureIo();
    const code = await runMigrateCli(["apply"], { DATABASE_URL: CLI_URI }, io);
    expect(code).toBe(2);
    expect(lines.out.some((l) => l.startsWith("[TAMPERED] m001_events"))).toBe(true);
    await setChecksum("m001_events", trueChecksum("m001_events"));
  });

  it("missing DATABASE_URL → exit 1 with an actionable message", async () => {
    const { io, lines } = captureIo();
    const code = await runMigrateCli(["apply"], {}, io);
    expect(code).toBe(1);
    expect(lines.err.some((l) => l.includes("DATABASE_URL is not set"))).toBe(true);
    expect(lines.out).toEqual([]);
  });

  it("unreachable database → exit 1 with a connection-failure message", async () => {
    const { io, lines } = captureIo();
    const code = await runMigrateCli(
      ["apply"],
      { DATABASE_URL: "postgres://reckon:reckon@127.0.0.1:1/reckon_test" },
      io,
    );
    expect(code).toBe(1);
    expect(lines.err.some((l) => l.includes("database operation failed"))).toBe(true);
  });

  it("unknown argument → exit 1 with usage; --database-url flag overrides env", async () => {
    const bad = captureIo();
    expect(await runMigrateCli(["migrate"], { DATABASE_URL: CLI_URI }, bad.io)).toBe(1);
    expect(bad.lines.err.some((l) => l.includes("unknown argument 'migrate'"))).toBe(true);

    // env points at an unreachable endpoint; the flag must win and reach
    // the healthy pristine-migrated reckon_cli database.
    const flagged = captureIo();
    const code = await runMigrateCli(
      ["--database-url", CLI_URI, "status"],
      { DATABASE_URL: "postgres://reckon:reckon@127.0.0.1:1/reckon_test" },
      flagged.io,
    );
    expect(code).toBe(0);
    expect(flagged.lines.out.filter((l) => l.startsWith("[applied]")).length).toBe(3);
  });

  it("help → exit 0 with usage text; no arguments → help", async () => {
    const { io, lines } = captureIo();
    expect(await runMigrateCli(["help"], {}, io)).toBe(0);
    expect(lines.out.some((l) => l.includes("reckon-migrate"))).toBe(true);
    const empty = captureIo();
    expect(await runMigrateCli([], {}, empty.io)).toBe(0);
    expect(empty.lines.out.length).toBeGreaterThan(0);
  });
});
