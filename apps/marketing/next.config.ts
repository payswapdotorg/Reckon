import type { NextConfig } from "next";

/**
 * Reckon marketing home (S1-001) — Next.js App Router configuration.
 *
 * Laws (work item S1-001):
 * - Marketing is a pure static surface: no env vars, no backend, no data
 *   fetching — every section renders from typed content modules.
 * - Zero runtime dependencies beyond next/react/react-dom, pinned to
 *   apps/web's exact versions (single Next family across the workspace).
 * - Builds on the webpack path (`next build --webpack`), mirroring
 *   apps/web and apps/docs.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
