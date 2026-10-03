#!/usr/bin/env node
/**
 * DEPLOY-001 — esbuild bundler for the Vercel serverless entry.
 *
 * Produces a self-contained ESM bundle (`api/index.js`) so the Vercel
 * function never depends on workspace resolution at runtime:
 *
 *   - Every @reckon/* package except @reckon/contracts ships TypeScript
 *     source with NodeNext `.js`-specifier imports (`main: ./src/index.ts`)
 *     — esbuild resolves and transpiles those directly.
 *   - @reckon/contracts resolves to its BUILT `dist/` (the package.json
 *     `main`/`exports` point there), so `pnpm --filter @reckon/contracts
 *     build` must run first — the package.json `bundle:vercel` script
 *     chains it.
 *   - `pg` probes for the optional native driver at require-time inside a
 *     try/catch; `pg-native` is kept external (not installed) and the
 *     banner `createRequire` shim keeps the probe a caught runtime miss —
 *     the pure-JS driver is used, which is what every test battery runs
 *     against real PostgreSQL with anyway.
 */
import { build } from "esbuild";

await build({
  entryPoints: ["src/vercel.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "api/index.js",
  external: ["pg-native"],
  // ESM output still needs `require` for externals: provide the shim.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: "info",
});

process.stdout.write("bundle-vercel: wrote api/index.js (self-contained ESM, node22)\n");
