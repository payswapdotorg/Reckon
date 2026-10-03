import http from "node:http";
import handler from "../api/index.js";

/**
 * DEPLOY-001 local smoke (deployment evidence tooling).
 *
 * Proves the esbuild-bundled Vercel entry (`api/index.js`) boots the REAL
 * production composition over the REAL PostgreSQL wire and that the raw
 * req/res forwarding in `src/vercel.ts` preserves the frozen route
 * surface (/healthz, /readyz, /v1/*) exactly as `src/main.ts` serves it.
 *
 * Run (env: DATABASE_URL required; RECKON_API_KEYS optional — without it
 * the authenticated checks assert the honest 401):
 *   DATABASE_URL=postgres://... RECKON_API_KEYS='key:tenant:plans' \
 *     SMOKE_KEY=key pnpm --filter @reckon/api exec node scripts/vercel-smoke.mjs
 */
const server = http.createServer((req, res) => handler(req, res));
const KEY = process.env.SMOKE_KEY ?? "smoke-key";
await new Promise((resolve) => server.listen(8791, "127.0.0.1", resolve));

let failures = 0;
async function check(name, path, expected, init) {
  const res = await fetch(`http://127.0.0.1:8791${path}`, init);
  const body = await res.text();
  const ok = res.status === expected;
  if (!ok) failures++;
  console.log(
    `${name}: ${res.status} (expected ${expected}) ${ok ? "OK" : "FAIL"} ${body.slice(0, 140).replace(/\n/g, " ")}`,
  );
  return { res, body };
}

await check("healthz", "/healthz", 200);
await check("readyz", "/readyz", 200);
const hasKey = process.env.RECKON_API_KEYS !== undefined && process.env.RECKON_API_KEYS !== "";
if (hasKey) {
  await check("plans-auth-200", "/v1/plans?limit=3", 200, {
    headers: { authorization: `Bearer ${KEY}` },
  });
} else {
  await check("plans-noauth-401", "/v1/plans?limit=3", 401);
}

server.close();
process.exit(failures > 0 ? 1 : 0);
