import type { NextConfig } from "next";

/**
 * Reckon Studio (apps/web) — Next.js App Router configuration.
 *
 * Laws (FINAL TL HANDOFF §29): this app consumes @reckon/sdk +
 * @reckon/contracts only; it never imports persistence internals or any
 * package's internal modules, and it contains no domain logic.
 *
 * BUNDLER NOTE — the app builds with the webpack path (`next build
 * --webpack`, see package.json scripts). @reckon/sdk ships NodeNext
 * TypeScript source (`main: ./src/index.ts`, `.js`-suffixed relative
 * imports — the W3-002 internal-packages pattern). Turbopack 16.3 does
 * not apply the `.js` → `.ts` extension substitution to transpiled
 * workspace packages, so those imports fail to resolve; webpack +
 * `resolveExtensionAlias` handles them correctly. @reckon/contracts
 * resolves to its built dist/ (compiled first by the build script) and
 * needs no transpilation.
 */
const nextConfig: NextConfig = {
  transpilePackages: ["@reckon/sdk"],
  webpack: (config) => {
    // NodeNext TS packages import siblings as "./x.js" while shipping
    // "x.ts" — teach the resolver the substitution (try .ts/.tsx, then
    // the literal .js for real JavaScript packages like zod).
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
