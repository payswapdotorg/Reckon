/**
 * Test harness: a REAL PostgreSQL server (PG 18 binaries via
 * embedded-postgres) on 127.0.0.1:55433, driven through the production
 * PgPoolExecutor (pg wire driver — the same code path used against Neon).
 *
 * Evidence class for everything produced through this harness:
 * controlled-local (real engine + real wire protocol + real driver; the
 * deployed-infrastructure endpoint is exercised with a real DATABASE_URL —
 * Gate L).
 *
 * If embedded-postgres cannot start in the current environment, tests
 * FAIL LOUDLY — never silently skipped (honesty law).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { PgPoolExecutor } from "../src/index.js";
import { applyMigrations } from "../src/index.js";

export const TEST_PORT = 55433;
export const TEST_URI = `postgres://postgres:postgres@127.0.0.1:${TEST_PORT}/reckon_test`;

export interface TestPostgres {
  readonly executor: PgPoolExecutor;
  readonly uri: string;
  readonly dataDir: string;
  stop(): Promise<void>;
  /** Stop WITHOUT wiping the data dir, then restart on the same dir (restart-durability proof). */
  restart(): Promise<PgPoolExecutor>;
}

interface RunningServer {
  readonly pg: InstanceType<typeof EmbeddedPostgres>;
  readonly dataDir: string;
}

let running: RunningServer | undefined;

async function bootServer(dataDir: string, fresh: boolean): Promise<InstanceType<typeof EmbeddedPostgres>> {
  const pg = new EmbeddedPostgres({
    databaseDir: join(dataDir, "db"),
    user: "postgres",
    password: "postgres",
    port: TEST_PORT,
    persistent: true,
  });
  if (fresh) {
    await pg.initialise(); // initdb — requires an EMPTY directory
  }
  // On restart the cluster already exists: initialise() would fail
  // ("directory exists but is not empty") — start() alone resumes it.
  await pg.start();
  try {
    await pg.createDatabase("reckon_test");
  } catch {
    // Already exists from a previous run on this data dir — fine.
  }
  return pg;
}

export async function startTestPostgres(): Promise<TestPostgres> {
  if (running !== undefined) {
    throw new Error("pg-harness: a test server is already running (one per suite)");
  }
  const dataDir = mkdtempSync(join(tmpdir(), "reckon-pg-"));
  const pg = await bootServer(dataDir, true);
  running = { pg, dataDir };
  const executor = new PgPoolExecutor({ connectionString: TEST_URI, max: 8 });
  await applyMigrations(executor);
  return {
    executor,
    uri: TEST_URI,
    dataDir,
    async stop() {
      await executor.close();
      await pg.stop();
      running = undefined;
      rmSync(dataDir, { recursive: true, force: true });
    },
    async restart() {
      await executor.close();
      await pg.stop();
      // Reboot on the SAME data dir — durability across a full server
      // restart is exactly what restart-durability.test.ts proves. The
      // cluster exists, so initialise() (initdb) is skipped.
      const pg2 = await bootServer(dataDir, false);
      running = { pg: pg2, dataDir };
      const executor2 = new PgPoolExecutor({ connectionString: TEST_URI, max: 8 });
      return executor2;
    },
  };
}

/** Convenience wrapper for a suite-scoped server (beforeAll/afterAll). */
export async function withTestPostgres(fn: (pgc: TestPostgres) => Promise<void>): Promise<void> {
  const server = await startTestPostgres();
  try {
    await fn(server);
  } finally {
    await server.stop();
  }
}
