/**
 * reckon-migrate — the production migrations CLI (P1-004).
 *
 * Applies / reports the forward-only, checksummed schema migrations of
 * @reckon/persistence against a REAL PostgreSQL endpoint selected by
 * DATABASE_URL (ADR-001: Neon in deployment, embedded-postgres in tests).
 *
 * Usage (repo root; tsx resolves the workspace TS sources):
 *   DATABASE_URL=postgres://... pnpm --filter @reckon/persistence migrate apply
 *   DATABASE_URL=postgres://... pnpm --filter @reckon/persistence migrate status
 *   pnpm migrate:apply   /   pnpm migrate:status   (repo-root shortcuts)
 *
 *   reckon-migrate [--database-url <url>] apply|status|help
 *
 * Exit codes (stable contract, consumed by CI + runbook):
 *   0  success — schema current or migrations applied cleanly
 *   1  usage error / missing DATABASE_URL / connection failure / apply failure
 *   2  checksum tamper — an APPLIED migration's recorded checksum no longer
 *      matches the SQL in the running code (edited-after-apply); the CLI
 *      refuses to proceed and says so honestly
 *
 * The CLI itself holds no schema knowledge beyond migrations.ts: `apply`
 * runs applyMigrations then verifies checksums; `status` never mutates
 * anything beyond the idempotent creation of the bookkeeping table.
 */
import { pathToFileURL } from "node:url";
import { PgPoolExecutor } from "./executor.js";
import { MigrationError } from "./errors.js";
import { applyMigrations, migrationStatus, MIGRATIONS } from "./migrations.js";

/** IO ports so tests capture output without touching process stdio. */
export interface MigrateCliIo {
  out(line: string): void;
  err(line: string): void;
}

const USAGE = [
  "reckon-migrate — forward-only PostgreSQL schema migrations for Reckon",
  "",
  "usage: reckon-migrate [--database-url <url>] <command>",
  "commands:",
  "  apply    apply all pending migrations (idempotent; verifies checksums)",
  "  status   print per-migration applied/pending state + checksum verdict",
  "  help     show this help",
  "database URL resolution: --database-url flag, else DATABASE_URL env",
  "exit codes: 0 ok · 1 usage/env/connection/apply failure · 2 checksum tamper",
].join("\n");

interface ParsedArgs {
  readonly command: "apply" | "status" | "help" | "unknown";
  readonly databaseUrl: string | undefined;
  readonly error: string | undefined;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let command: ParsedArgs["command"] = argv.length === 0 ? "help" : "unknown";
  let databaseUrl: string | undefined;
  let error: string | undefined;
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "apply" || arg === "status" || arg === "help") {
      if (command !== "help" && command !== "unknown") {
        error = `multiple commands given ('${command}' and '${arg}')`;
      }
      command = arg;
    } else if (arg === "--database-url") {
      const value = argv[i + 1];
      if (value === undefined || value.length === 0) {
        error = "--database-url requires a value";
      } else {
        databaseUrl = value;
      }
      i += 1;
    } else if (arg.startsWith("--database-url=")) {
      const value = arg.slice("--database-url=".length);
      if (value.length === 0) {
        error = "--database-url requires a value";
      } else {
        databaseUrl = value;
      }
    } else {
      error = `unknown argument '${arg}'`;
    }
    i += 1;
  }
  return { command, databaseUrl, error };
}

function describeStatusEntries(
  entries: ReadonlyArray<{
    id: string;
    name: string;
    applied: boolean;
    checksumOk: boolean | null;
    appliedAt: string | null;
  }>,
): { lines: readonly string[]; tampered: readonly string[] } {
  const lines: string[] = [];
  const tampered: string[] = [];
  for (const entry of entries) {
    if (!entry.applied) {
      lines.push(`[pending] ${entry.id} — ${entry.name}`);
      continue;
    }
    if (entry.checksumOk === false) {
      lines.push(`[TAMPERED] ${entry.id} — recorded checksum does not match current migration SQL`);
      tampered.push(entry.id);
      continue;
    }
    lines.push(`[applied] ${entry.id} — ${entry.name} (at ${entry.appliedAt})`);
  }
  return { lines, tampered };
}

/**
 * Run the CLI. Returns the process exit code WITHOUT calling process.exit
 * so tests drive it directly; the module entry wrapper below exits with it.
 */
export async function runMigrateCli(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  io: MigrateCliIo = {
    out: (line) => process.stdout.write(line + "\n"),
    err: (line) => process.stderr.write(line + "\n"),
  },
): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.error !== undefined) {
    io.err(`reckon-migrate: ${parsed.error}`);
    io.err(USAGE);
    return 1;
  }
  if (parsed.command === "help" || parsed.command === "unknown") {
    io.out(USAGE);
    return parsed.command === "help" ? 0 : 1;
  }

  const databaseUrl = parsed.databaseUrl ?? env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    io.err(
      "reckon-migrate: DATABASE_URL is not set — provide it as an environment variable or --database-url <url>",
    );
    return 1;
  }

  // One connection is all a migration run needs; a tight idle timeout keeps
  // CI drop-offs clean (ADR-001: the SAME pg wire path used in deployment).
  const executor = new PgPoolExecutor({ connectionString: databaseUrl, max: 1, idleTimeoutMillis: 5_000 });
  try {
    if (parsed.command === "apply") {
      let applied: readonly string[];
      try {
        applied = await applyMigrations(executor);
      } catch (error) {
        if (error instanceof MigrationError) {
          io.err(`reckon-migrate: ${error.message}`);
          io.err("reckon-migrate: the failed migration was rolled back; fix the cause and re-run (idempotent)");
          return 1;
        }
        throw error;
      }
      for (const id of applied) {
        io.out(`applied ${id}`);
      }
      if (applied.length === 0) {
        io.out(`schema is current (${MIGRATIONS.length} migrations, 0 applied by this run)`);
      } else {
        io.out(`applied ${applied.length} of ${MIGRATIONS.length} migrations; schema is current`);
      }
    }

    // Both commands finish with the same honest verification pass — an
    // applied-but-tampered migration is never reported as fine.
    const status = await migrationStatus(executor);
    const { lines, tampered } = describeStatusEntries(status);
    for (const line of lines) io.out(line);
    if (tampered.length > 0) {
      io.err(
        `reckon-migrate: checksum tamper detected in: ${tampered.join(", ")} — the recorded checksum no longer matches the migration SQL in this code; refusing to proceed`,
      );
      return 2;
    }
    const pending = status.filter((entry) => !entry.applied).length;
    if (parsed.command === "status" && pending > 0) {
      io.out(`${pending} of ${MIGRATIONS.length} migrations pending (this is a state report, not an error)`);
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.err(`reckon-migrate: database operation failed: ${message}`);
    return 1;
  } finally {
    await executor.close().catch(() => undefined);
  }
}

const isEntry =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  process.exit(await runMigrateCli(process.argv.slice(2), process.env));
}
