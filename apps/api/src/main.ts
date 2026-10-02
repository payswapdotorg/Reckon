/**
 * The app file (P1-002): wires REAL config (environment) and the PRODUCTION
 * composition — real W2 kernel handlers over real PostgreSQL persistence —
 * when DATABASE_URL is present. Without DATABASE_URL the server refuses to
 * boot as "production" (ADR-001: no hidden in-memory production authority);
 * tests and local embedding use buildServer directly with their own wiring.
 *
 * Run (requires tsx or any TS runner; Node type-stripping does not resolve
 * .js specifiers to .ts sources):
 *   DATABASE_URL=postgres://... RECKON_API_KEYS='key:tenant:decisions,outcomes,...' pnpm --filter @reckon/api start
 */
import { pathToFileURL } from "node:url";
import { loadConfigFromEnv } from "./config.js";
import { buildProductionServer } from "./composition.js";

async function main(): Promise<void> {
  const config = loadConfigFromEnv(process.env);
  if (config.keys === undefined || config.keys.length === 0) {
    process.stderr.write(
      "reckon-api: RECKON_API_KEYS is not set — no API keys configured; every authenticated route will return 401\n",
    );
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") {
    process.stderr.write(
      "reckon-api: DATABASE_URL is not set — the production composition requires real PostgreSQL persistence (ADR-001: no hidden in-memory production authority)\n",
    );
    process.exit(1);
  }

  const composition = await buildProductionServer({
    connectionString: databaseUrl,
    keys: config.keys,
    apiVersion: config.apiVersion,
    logger: config.logger,
  });
  const port = Number(process.env.RECKON_PORT ?? 8080);
  const host = process.env.RECKON_HOST ?? "127.0.0.1";
  await composition.app.listen({ port, host });
  process.stderr.write(
    `reckon-api: production composition live on ${host}:${port} (PostgreSQL persistence, real W2 kernels)\n`,
  );

  const shutdown = async (signal: string): Promise<void> => {
    process.stderr.write(`reckon-api: received ${signal}, closing\n`);
    await composition.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

const isEntry =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  await main();
}
