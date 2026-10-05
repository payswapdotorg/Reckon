import type { NextConfig } from "next";

/**
 * Reckon docs portal (S1-004) — Next.js App Router configuration.
 *
 * Laws (work item S1-004):
 * - This app imports @reckon/contracts TYPES ONLY (`import type`) so the
 *   docs content stays provably in sync with the frozen contracts; no
 *   runtime dependency on any workspace package ships in the client bundle.
 * - No env vars, no backend, no data fetching: every page is static.
 *
 * BUNDLER NOTE — the app builds on the webpack path (`next build
 * --webpack`, see package.json), mirroring apps/web. Workspace convention
 * (NodeNext typecheck compatibility for test→src chains) requires
 * `.js`-suffixed relative imports in TypeScript sources; Turbopack 16.3
 * does not apply the `.js` → `.ts/.tsx` substitution, webpack +
 * `resolveExtensionAlias` handles it correctly.
 */
const nextConfig: NextConfig = {
  webpack: (config) => {
    // NodeNext TS files import siblings as "./x.js" while the sources are
    // "x.ts"/"x.tsx" — teach the resolver the substitution.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    return config;
  },
  reactStrictMode: true,
};

export default nextConfig;
