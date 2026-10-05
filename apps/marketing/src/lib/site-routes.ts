/**
 * Reckon marketing — site routes + social-metadata model (S5-001).
 *
 * The single source of truth for the marketing site's crawlable surface:
 * the six public routes, the env-overridable canonical base URL, the
 * sitemap/robots generators (wired by app/sitemap.ts + app/robots.ts),
 * and the per-route Open Graph/Twitter metadata builder used by every
 * page's `metadata` export.
 *
 * Laws (work item S5-001):
 *  - exactly the six public routes are exposed — the home, the pricing
 *    page, and the four product pages (the same ids as
 *    src/lib/product-content.ts PRODUCT_PAGE_IDS — cross-checked by the
 *    colocated vitest suite, not by an import, so this module stays
 *    dependency-free);
 *  - the canonical base is https://reckon-marketing.vercel.app and is
 *    overridable through NEXT_PUBLIC_SITE_URL — the ONE sanctioned env
 *    read on this otherwise env-free surface (preview deployments and
 *    future domain moves need it; everything else stays static);
 *  - sitemap lastModified is the build timestamp (the sitemap route is
 *    statically prerendered, so the generator runs at build time);
 *  - robots allows everything and references the sitemap (public site);
 *  - this module is deliberately SELF-CONTAINED (zero imports): it is
 *    shared by the Next.js convention files and the colocated vitest
 *    suite, which typechecks under the root NodeNext program.
 */

/** The env var that overrides the canonical base URL (S5-001's one env read). */
export const SITE_URL_ENV_VAR = "NEXT_PUBLIC_SITE_URL";

/** The production canonical base — the live marketing deployment. */
export const DEFAULT_SITE_URL = "https://reckon-marketing.vercel.app";

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
/* The six public routes                                               */
/* ------------------------------------------------------------------ */

/** The home route. */
export const HOME_PATH = "/";

/** The pricing route (S1-003). */
export const PRICING_PATH = "/pricing";

/** The four product routes (S1-002 — one per PRODUCT_PAGE_IDS entry). */
export const PRODUCT_PATHS = [
  "/products/recommendation-api",
  "/products/personalization",
  "/products/scheduling",
  "/products/analytics",
] as const;

/** Every public route the marketing site exposes — the sitemap set. */
export const PUBLIC_ROUTE_PATHS = [
  HOME_PATH,
  PRICING_PATH,
  ...PRODUCT_PATHS,
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
 * Build the sitemap entries for all six public routes. `lastModified` is
 * the moment the generator runs — build time for the statically
 * prerendered sitemap.xml route.
 */
export function buildSitemap(baseUrl: string = resolveSiteUrl()): SitemapEntry[] {
  const lastModified = new Date();
  return PUBLIC_ROUTE_PATHS.map((path) => ({
    url: `${baseUrl}${path}`,
    lastModified,
    changeFrequency: path === HOME_PATH ? "weekly" : "monthly",
    priority: path === HOME_PATH ? 1 : path === PRICING_PATH ? 0.9 : 0.8,
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
 * (Next's file convention). Every route's routeMetadata() references
 * this path explicitly: a nested page's own `openGraph` replaces the
 * root segment's wholesale, which would otherwise DROP the
 * file-convention image on /pricing, /terms, /privacy, and the product
 * pages — so the image is declared per-route (deterministic, and
 * testable from the pure lib). Declaring images also suppresses the
 * same-segment file merge on "/", keeping exactly one og:image site-wide.
 */
export const OG_IMAGE_PATH = "/opengraph-image";

/** The social card image dimensions (app/opengraph-image.tsx `size`). */
export const OG_IMAGE_WIDTH = 1200;

export const OG_IMAGE_HEIGHT = 630;

/** The social card image MIME type (app/opengraph-image.tsx). */
export const OG_IMAGE_TYPE = "image/png";

export const SITE_NAME = "Reckon";

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
    images: Array<{ url: string; width: number; height: number; type: string }>;
  };
  twitter: {
    card: "summary_large_image";
    title: string;
    description: string;
  };
}

/**
 * Build one route's `metadata` export: canonical alternates, an Open
 * Graph card (title, description, absolute url, siteName, and the
 * social card image at OG_IMAGE_PATH — the route app/opengraph-image.tsx
 * serves) and a Twitter summary_large_image card (twitter:image
 * auto-fills from the og images).
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
