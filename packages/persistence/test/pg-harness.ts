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

/**
 * The test port (55433) is DEDICATED to this harness. A previous run
 * killed by a timeout/reaper can leave an orphaned postgres holding it
 * (its data dir may even be deleted). Before booting, evict any stale
 * holder — found by port, not by name (pgrep -f proved unreliable for
 * the spawned postgres cmdline). SIGKILL: postgres smart-shutdown
 * (SIGTERM) can stall behind dead clients from a killed worker.
 */
async function evictStalePortHolder(): Promise<void> {
  const { execFileSync } = await import("node:child_process");
  const readFileSync = (await import("node:fs")).readFileSync;
  const portHolders = (): number[] => {
    try {
      const out = execFileSync("ss", ["-tlnp"], { encoding: "utf8", timeout: 5000 });
      const pids = new Set<number>();
      for (const line of out.split("\n")) {
        if (!line.includes(`:${TEST_PORT} `)) continue;
        for (const match of line.matchAll(/pid=(\d+)/g)) pids.add(Number(match[1]));
      }
      return [...pids];
    } catch {
      return [];
    }
  };
  for (let round = 0; round < 10; round += 1) {
    const holders = portHolders();
    if (holders.length === 0) {
      // No holder: remove any stale socket/lock files a SIGKILLed server
      // could not clean up itself (postgres refuses to start otherwise).
      for (const suffix of ["", ".lock"]) {
        const stale = `/tmp/.s.PGSQL.${TEST_PORT}${suffix}`;
        try {
          (await import("node:fs")).rmSync(stale, { force: true });
        } catch {
          // Ignore.
        }
      }
      return;
    }
    for (const pid of holders) {
      try {
        const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8");
        if (!cmdline.includes("postgres")) continue; // never kill non-postgres
        process.stderr.write(`[pg-harness] evicting stale port holder pid ${pid} (round ${round + 1})\n`);
        process.kill(pid, "SIGKILL");
      } catch {
        // Process vanished or not readable — ignore.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  const stuck = portHolders();
  if (stuck.length > 0) {
    throw new Error(
      `[pg-harness] port ${TEST_PORT} still held by ${stuck.join(",")} after eviction — refusing to boot into a dead bind`,
    );
  }
}

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
  await evictStalePortHolder();
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
