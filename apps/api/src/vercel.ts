/**
 * DEPLOY-001 — Vercel serverless entry for the production API.
 *
 * The composition law is unchanged from src/main.ts: the production server
 * exists ONLY over real PostgreSQL persistence (ADR-001: no hidden
 * in-memory production authority) and real W2 kernel handlers. This entry
 * adapts the SAME Fastify composition to a Vercel Node.js function instead
 * of a long-lived listener:
 *
 *   - `vercel.json` sets buildCommand to `pnpm run bundle:vercel`, which
 *     esbuild-bundles THIS file together with the whole workspace
 *     dependency graph (every @reckon/* package except @reckon/contracts
 *     ships TypeScript source — Vercel's runtime cannot execute them
 *     unbundled) into a self-contained `api/index.js`.
 *   - `vercel.json` rewrites `/v1/*`, `/healthz` and `/readyz` onto that
 *     function. Vercel preserves the original request URL for rewritten
 *     functions, so the frozen routes (W3-001) route exactly as they do
 *     in `main.ts` — no route duplication, no prefix stripping.
 *   - The handler forwards the raw Node req/res pair to Fastify's
 *     underlying HTTP server instance — the framework itself handles the
 *     request; nothing about the route contracts is re-implemented here.
 *
 * Boot happens at module scope and fails fast: a function booted without
 * DATABASE_URL refuses to load (the error is visible in Vercel logs — an
 * honest dead deployment instead of a half-alive one). Missing
 * RECKON_API_KEYS degrades exactly like `main.ts`: 401 on every
 * authenticated route.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfigFromEnv } from "./config.js";
import { buildProductionServer, type ProductionComposition } from "./composition.js";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl === "") {
  throw new Error(
    "reckon-api: DATABASE_URL is not set — the production composition requires real PostgreSQL persistence (ADR-001: no hidden in-memory production authority)",
  );
}

const config = loadConfigFromEnv(process.env);
if (config.keys === undefined || config.keys.length === 0) {
  process.stderr.write(
    "reckon-api: RECKON_API_KEYS is not set — no API keys configured; every authenticated route will return 401\n",
  );
}

const composition: ProductionComposition = await buildProductionServer({
  connectionString: databaseUrl,
  keys: config.keys,
  apiVersion: config.apiVersion,
  logger: config.logger,
});
await composition.app.ready();

/** Vercel Node.js function shape (raw req/res, no framework wrapping). */
export type VercelHandler = (req: IncomingMessage, res: ServerResponse) => void;

const handler: VercelHandler = (req, res) => {
  composition.app.server.emit("request", req, res);
};

export default handler;
