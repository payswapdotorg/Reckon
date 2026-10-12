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
import {
  loadConfigFromEnv,
  parseListenConfig,
  parseWebhookEncryptionKeyFromEnv,
} from "./config.js";
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
  // TL6-002: WEBHOOK_SECRET_ENCRYPTION_KEY — required to mount the
  // production webhook system (signing secrets are AES-256-GCM
  // encrypted at rest). The parser fails FAST with a typed ConfigError
  // on a malformed value; an absent value fails the production
  // composition loudly (honesty law: never fall back to plaintext).
  let webhookEncryptionKey;
  try {
    webhookEncryptionKey = parseWebhookEncryptionKeyFromEnv(process.env);
  } catch (error) {
    process.stderr.write(`reckon-api: ${(error as Error).message}\n`);
    process.exit(1);
  }
  if (webhookEncryptionKey === undefined) {
    process.stderr.write(
      "reckon-api: WEBHOOK_SECRET_ENCRYPTION_KEY is not set — the production webhook system requires a 32-byte AES-256 key (hex or base64) to encrypt signing secrets at rest (honesty law: never fall back to plaintext silently)\n",
    );
    process.exit(1);
  }

  let listen: { host: string; port: number };
  try {
    listen = parseListenConfig(process.env);
  } catch (error) {
    process.stderr.write(`reckon-api: ${(error as Error).message}\n`);
    process.exit(1);
  }

  const composition = await buildProductionServer({
    connectionString: databaseUrl,
    keys: config.keys,
    // TL6-001: tier-aware rate limiting (RECKON_RATE_LIMIT_MAX enables the
    // limiter; RECKON_TIER_RATE_LIMITS sets the per-tier ladder).
    ...(config.rateLimit !== undefined ? { rateLimit: config.rateLimit } : {}),
    // TL6-002: the production webhook mount (PG stores + encrypted secrets).
    webhookEncryptionKey,
    apiVersion: config.apiVersion,
    logger: config.logger,
  });
  await composition.app.listen({ port: listen.port, host: listen.host });
  process.stderr.write(
    `reckon-api: production composition live on ${listen.host}:${listen.port} (PostgreSQL persistence, real W2 kernels, webhook system mounted)\n`,
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
