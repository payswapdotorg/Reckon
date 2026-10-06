/**
 * Reckon docs portal — site routes + social-metadata model (S5-002).
 *
 * The single source of truth for the docs portal's crawlable surface: the
 * twelve public routes, the env-overridable canonical base URL, the
 * sitemap/robots generators (wired by app/sitemap.ts + app/robots.ts), and
 * the per-route Open Graph/Twitter metadata builder used by every page's
 * `metadata` export (fed by src/content/route-meta.ts).
 *
 * Laws (work item S5-002 — the S5-001 marketing precedent, applied to
 * docs):
 *  - exactly the twelve public routes are exposed — the home, the ten
 *    content pages of the sidebar IA (src/content/navigation.ts) and
 *    /changelog; the agreement is cross-checked by test/docs-seo.test.ts
 *    (not by an import, so this module stays dependency-free);
 *  - the canonical base is https://reckon-docs.vercel.app (the live
 *    production deployment) and is overridable through
 *    NEXT_PUBLIC_SITE_URL — the ONE sanctioned env read on this otherwise
 *    zero-env surface (preview deployments and future domain moves need
 *    it; everything else stays static, no env var is required);
 *  - sitemap lastModified is the build timestamp (the sitemap route is
 *    statically prerendered, so the generator runs at build time);
 *  - robots allows everything and references the sitemap (public site);
 *  - this module is deliberately SELF-CONTAINED (zero imports): it is
 *    shared by the Next.js convention files, the page modules and the
 *    colocated vitest suite, which typechecks under the root NodeNext
 *    program.
 */

/** The env var that overrides the canonical base URL (S5-002's one env read). */
export const SITE_URL_ENV_VAR = "NEXT_PUBLIC_SITE_URL";

/** The production canonical base — the live docs deployment. */
export const DEFAULT_SITE_URL = "https://reckon-docs.vercel.app";

/** Environment-reading shape (ProcessEnv is structurally compatible). */
type EnvLike = Record<string, string | undefined>;

/**
 * Resolve the canonical site URL: NEXT_PUBLIC_SITE_URL when set to a
 * non-blank value (trailing slashes trimmed), else the production default.
 */
export function resolveSiteUrl(env: EnvLike = process.env): string {
  const raw = env[SITE_URL_ENV_VAR];
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim().replace(/\/+$/, "");
  }
  return DEFAULT_SITE_URL;
}

/* ------------------------------------------------------------------ */
/* The twelve public routes                                            */
/* ------------------------------------------------------------------ */

/** The home route. */
export const HOME_PATH = "/";

/** The get-started track (quickstart + core concepts). */
export const GET_STARTED_PATHS = ["/get-started/quickstart", "/get-started/core-concepts"] as const;

/** The six API-reference pages, in sidebar/reading order. */
export const API_REFERENCE_PATHS = [
  "/api-reference/authentication",
  "/api-reference/errors",
  "/api-reference/idempotent-requests",
  "/api-reference/expanding-responses",
  "/api-reference/pagination",
  "/api-reference/versioning",
] as const;

/** The webhooks + SDKs reference pages. */
export const REFERENCE_PATHS = ["/webhooks", "/sdks"] as const;

/** The changelog route (S5-002). */
export const CHANGELOG_PATH = "/changelog";

/** Every public route the docs portal exposes — the sitemap set. */
export const PUBLIC_ROUTE_PATHS = [
  HOME_PATH,
  ...GET_STARTED_PATHS,
  ...API_REFERENCE_PATHS,
  ...REFERENCE_PATHS,
  CHANGELOG_PATH,
] as const;

export type PublicRoutePath = (typeof PUBLIC_ROUTE_PATHS)[number];

/* ------------------------------------------------------------------ */
/* Sitemap + robots (app/sitemap.ts / app/robots.ts)                   */
/* ------------------------------------------------------------------ */

/** changeFrequency values accepted by the Next sitemap route convention. */
export type SitemapChangeFrequency =
  | "always"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "never";

export interface SitemapEntry {
  url: string;
  lastModified: Date;
  changeFrequency: SitemapChangeFrequency;
  priority: number;
}

/**
 * Per-route crawl hints: the home and the get-started track change with
 * the product, reference pages are stable, the changelog moves with each
 * release.
 */
function routeCrawlHints(path: string): { changeFrequency: SitemapChangeFrequency; priority: number } {
  if (path === HOME_PATH) return { changeFrequency: "weekly", priority: 1 };
  if (GET_STARTED_PATHS.includes(path as (typeof GET_STARTED_PATHS)[number])) {
    return { changeFrequency: "weekly", priority: 0.9 };
  }
  if (path === CHANGELOG_PATH) return { changeFrequency: "weekly", priority: 0.7 };
  return { changeFrequency: "monthly", priority: 0.8 };
}

/**
 * Build the sitemap entries for all twelve public routes. `lastModified`
 * is the moment the generator runs — build time for the statically
 * prerendered sitemap.xml route.
 */
export function buildSitemap(baseUrl: string = resolveSiteUrl()): SitemapEntry[] {
  const lastModified = new Date();
  return PUBLIC_ROUTE_PATHS.map((path) => ({
    url: `${baseUrl}${path}`,
    lastModified,
    ...routeCrawlHints(path),
  }));
}

export interface RobotsFile {
  rules: Array<{ userAgent: string; allow: string }>;
  sitemap: string;
}

/**
 * Build the robots.txt payload — a public site: every crawler may fetch
 * everything, nothing is disallowed, and the sitemap is referenced.
 */
export function buildRobots(baseUrl: string = resolveSiteUrl()): RobotsFile {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}

/* ------------------------------------------------------------------ */
/* Per-route Open Graph + Twitter metadata                             */
/* ------------------------------------------------------------------ */

/**
 * The social card image route — served by app/opengraph-image.tsx
 * (Next's file convention, a next/og ImageResponse — the approach proven
 * green under `next build --webpack` by the S5-001 marketing app on the
 * same workspace-pinned Next 16.3.8; no static PNG fallback needed).
 * Every route's routeMetadata() references this path explicitly: a nested
 * page's own `openGraph` replaces the root segment's wholesale, which
 * would otherwise DROP the file-convention image on every route below the
 * root — so the image is declared per-route (deterministic, and testable
 * from the pure lib).
 */
export const OG_IMAGE_PATH = "/opengraph-image";

/** The social card image dimensions (app/opengraph-image.tsx `size`). */
export const OG_IMAGE_WIDTH = 1200;

export const OG_IMAGE_HEIGHT = 630;

/** The social card image MIME type (app/opengraph-image.tsx). */
export const OG_IMAGE_TYPE = "image/png";

/**
 * The social card image's alt text (og:image:alt) — one shared card, so
 * one shared description. Single-sourced here and consumed both by the
 * app/opengraph-image.tsx file convention (its `alt` export) and by
 * routeMetadata()'s per-route images entry — a nested page's `openGraph`
 * replaces the root segment's wholesale, so the per-route images (not
 * the file convention) are what actually ship on every route below the
 * root; the alt must ride along with them (S5-002 re-issue hardening:
 * og:image:alt on every card, not just the root).
 */
export const OG_IMAGE_ALT =
  "Reckon Docs — provider-neutral recommendation infrastructure. Serve your first recommendation in about five minutes.";

export const SITE_NAME = "Reckon Docs";

export const SITE_LOCALE = "en_US";

/** Input for the per-route metadata builder — title/description/path. */
export interface RouteMetadataInput {
  title: string;
  description: string;
  path: string;
}

/**
 * The per-route metadata shape produced by routeMetadata() — structurally
 * assignable to Next's `Metadata` without importing it (this module stays
 * zero-import; the literal types satisfy Next's unions).
 */
export interface RouteMetadataResult {
  title: string;
  description: string;
  alternates: { canonical: string };
  openGraph: {
    title: string;
    description: string;
    url: string;
    siteName: string;
    type: "website";
    locale: string;
    images: Array<{ url: string; width: number; height: number; type: string; alt: string }>;
  };
  twitter: {
    card: "summary_large_image";
    title: string;
    description: string;
  };
}

/**
 * Build one route's `metadata` export: canonical alternates, an Open
 * Graph card (title, description, absolute url, siteName, and the social
 * card image at OG_IMAGE_PATH — the route app/opengraph-image.tsx
 * serves, with its og:image:alt) and a Twitter summary_large_image card
 * (twitter:image auto-fills from the og images). The root layout's
 * "%s · Reckon Docs" title template applies to the returned plain title
 * on nested routes; the home route's "Reckon Docs" title is already the
 * default.
 */
export function routeMetadata(
  input: RouteMetadataInput,
  baseUrl: string = resolveSiteUrl(),
): RouteMetadataResult {
  return {
    title: input.title,
    description: input.description,
    alternates: { canonical: input.path },
    openGraph: {
      title: input.title,
      description: input.description,
      url: `${baseUrl}${input.path}`,
      siteName: SITE_NAME,
      type: "website",
      locale: SITE_LOCALE,
      images: [
        {
          url: OG_IMAGE_PATH,
          width: OG_IMAGE_WIDTH,
          height: OG_IMAGE_HEIGHT,
          type: OG_IMAGE_TYPE,
          alt: OG_IMAGE_ALT,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: input.title,
      description: input.description,
    },
  };
}
