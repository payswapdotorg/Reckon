import { pathToFileURL } from "node:url";
import { loadConfigFromEnv } from "./config.js";
import { buildServer } from "./server.js";

/**
 * The app file: wires REAL config (environment) and the NotWired defaults.
 * This is the only place a server instance is created for deployment; the
 * key map comes from RECKON_API_KEYS (or RECKON_API_KEYS_FILE) in the
 * format `key1:tenant1:scope1,scope2;key2:tenant2:...`.
 *
 * Run (requires tsx or any TS runner; Node type-stripping does not resolve
 * .js specifiers to .ts sources):
 *   pnpm --filter @reckon/api start
 */
async function main(): Promise<void> {
  const config = loadConfigFromEnv(process.env);
  if (config.keys === undefined || config.keys.length === 0) {
    process.stderr.write(
      "reckon-api: RECKON_API_KEYS is not set — no API keys configured; every authenticated route will return 401\n",
    );
  }
  const app = buildServer(config);
  const port = Number(process.env.RECKON_PORT ?? 8080);
  const host = process.env.RECKON_HOST ?? "127.0.0.1";
  await app.listen({ port, host });

  const shutdown = async (signal: string): Promise<void> => {
    process.stderr.write(`reckon-api: received ${signal}, closing\n`);
    await app.close();
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
