/**
 * SEO / social / crawl completeness (S5-002) — contract tests.
 *
 * Laws under test (work item S5-002, task packet b + c + d):
 *  b. the sitemap generator emits EXACTLY the twelve public docs routes
 *     (/, the ten sidebar-IA content pages, /changelog) against the
 *     canonical base, with the base env-overridable through
 *     NEXT_PUBLIC_SITE_URL (trailing slashes trimmed, blank values
 *     falling back to the production default);
 *  c. the robots generator allows everything, disallows nothing, and
 *     references the sitemap on the same env-overridable base;
 *  d. every page module exports a metadata object with non-empty
 *     og:title / og:description and a resolvable og image — built by
 *     the shared routeMetadata() from the typed route-meta content
 *     module (the page modules themselves cannot be imported here: they
 *     use the app's "@/" alias, which the root NodeNext program cannot
 *     resolve — so their wiring is asserted against source, the
 *     S1-002..S5-001 convention), with the og image resolved by the
 *     app/opengraph-image.tsx file convention (1200×630) that the root
 *     layout's metadataBase turns absolute.
 *
 * Conventions: .js-suffixed relative imports (NodeNext typecheck
 * compatibility), readFileSync source contracts, vitest from the repo
 * root, no network.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { DOCS_SECTIONS } from "../src/content/navigation.js";
import { DOCS_ROUTE_META, routeMetaFor } from "../src/content/route-meta.js";
import {
  DEFAULT_SITE_URL,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_PATH,
  OG_IMAGE_WIDTH,
  PUBLIC_ROUTE_PATHS,
  SITE_URL_ENV_VAR,
  buildRobots,
  buildSitemap,
  resolveSiteUrl,
  routeMetadata,
} from "../src/lib/site-routes.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string): string => readFileSync(join(here, relative), "utf8");
const exists = (relative: string): boolean => existsSync(join(here, relative));

/** The page-module path for a route ("/" is the app root). */
function pageFileFor(path: string): string {
  return path === "/" ? "../src/app/page.tsx" : `../src/app${path}/page.tsx`;
}

/** Env hygiene — every override test restores the variable afterwards. */
const originalSiteUrl = process.env[SITE_URL_ENV_VAR];

afterEach(() => {
  if (originalSiteUrl === undefined) {
    delete process.env[SITE_URL_ENV_VAR];
  } else {
    process.env[SITE_URL_ENV_VAR] = originalSiteUrl;
  }
});

/* ------------------------------------------------------------------ */
/* Site URL resolution — the env-overridable canonical base            */
/* ------------------------------------------------------------------ */

describe("site url resolution", () => {
  it("defaults to the live docs deployment when the env var is unset", () => {
    delete process.env[SITE_URL_ENV_VAR];
    expect(resolveSiteUrl()).toBe(DEFAULT_SITE_URL);
    expect(DEFAULT_SITE_URL).toBe("https://reckon-docs.vercel.app");
  });

  it("falls back to the default on blank values, trims trailing slashes otherwise", () => {
    process.env[SITE_URL_ENV_VAR] = "   ";
    expect(resolveSiteUrl()).toBe(DEFAULT_SITE_URL);
    process.env[SITE_URL_ENV_VAR] = "";
    expect(resolveSiteUrl()).toBe(DEFAULT_SITE_URL);
    process.env[SITE_URL_ENV_VAR] = "https://docs-preview.example.com///";
    expect(resolveSiteUrl()).toBe("https://docs-preview.example.com");
  });
});

/* ------------------------------------------------------------------ */
/* The route set — sitemap ⇄ route-meta ⇄ sidebar IA agreement         */
/* ------------------------------------------------------------------ */

describe("public route set (sitemap ⇄ route-meta ⇄ sidebar IA)", () => {
  it("exposes exactly the twelve public routes", () => {
    expect([...PUBLIC_ROUTE_PATHS]).toEqual([
      "/",
      "/get-started/quickstart",
      "/get-started/core-concepts",
      "/api-reference/authentication",
      "/api-reference/errors",
      "/api-reference/idempotent-requests",
      "/api-reference/expanding-responses",
      "/api-reference/pagination",
      "/api-reference/versioning",
      "/webhooks",
      "/sdks",
      "/changelog",
    ]);
    expect(new Set(PUBLIC_ROUTE_PATHS).size).toBe(PUBLIC_ROUTE_PATHS.length);
  });

  it("route-meta covers exactly the same set (no gaps, no extras)", () => {
    expect(DOCS_ROUTE_META.map((entry) => entry.path)).toEqual([...PUBLIC_ROUTE_PATHS]);
  });

  it("the set is the sidebar IA pages plus the home and the changelog", () => {
    const iaPaths = DOCS_SECTIONS.flatMap((section) => section.pages.map((page) => page.path));
    expect(["/", ...iaPaths, "/changelog"]).toEqual([...PUBLIC_ROUTE_PATHS]);
  });

  it("every route resolves through routeMetaFor, and unknown paths throw", () => {
    for (const path of PUBLIC_ROUTE_PATHS) {
      const entry = routeMetaFor(path);
      expect(entry.title.trim().length).toBeGreaterThan(0);
      expect(entry.description.trim().length).toBeGreaterThan(0);
    }
    expect(() => routeMetaFor("/nope")).toThrow(/DOCS_ROUTE_META/);
  });

  it("every route maps to an existing app-router page file", () => {
    for (const path of PUBLIC_ROUTE_PATHS) {
      expect(exists(pageFileFor(path)), `missing page file for ${path}`).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/* (b) Sitemap — exactly the full route set, env-overridable base      */
/* ------------------------------------------------------------------ */

describe("sitemap generator", () => {
  it("emits exactly the twelve public routes on the default base", () => {
    delete process.env[SITE_URL_ENV_VAR];
    const entries = buildSitemap();
    expect(entries).toHaveLength(PUBLIC_ROUTE_PATHS.length);
    expect(entries.map((entry) => entry.url)).toEqual(
      [...PUBLIC_ROUTE_PATHS].map((path) => `${DEFAULT_SITE_URL}${path}`),
    );
  });

  it("stamps every entry with a build-time lastModified and crawl hints", () => {
    const entries = buildSitemap();
    for (const [index, entry] of entries.entries()) {
      expect(entry.lastModified instanceof Date).toBe(true);
      expect(
        Number.isNaN(entry.lastModified.getTime()),
        `entry ${index} has no lastModified`,
      ).toBe(false);
      expect(["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"]).toContain(
        entry.changeFrequency,
      );
      expect(entry.priority).toBeGreaterThan(0);
      expect(entry.priority).toBeLessThanOrEqual(1);
    }
  });

  it("follows the NEXT_PUBLIC_SITE_URL override when set", () => {
    process.env[SITE_URL_ENV_VAR] = "https://docs-preview.example.com";
    const entries = buildSitemap();
    expect(entries.map((entry) => entry.url)).toEqual(
      [...PUBLIC_ROUTE_PATHS].map((path) => `https://docs-preview.example.com${path}`),
    );
  });

  it("the app/sitemap.ts convention file generates from buildSitemap", () => {
    const source = read("../src/app/sitemap.ts");
    expect(source).toContain("buildSitemap()");
    expect(source).toMatch(/MetadataRoute\.Sitemap/);
  });
});

/* ------------------------------------------------------------------ */
/* (c) Robots — allow everything, reference the sitemap                */
/* ------------------------------------------------------------------ */

describe("robots generator", () => {
  it("allows every crawler everything and references the sitemap", () => {
    delete process.env[SITE_URL_ENV_VAR];
    const robots = buildRobots();
    expect(robots.rules).toEqual([{ userAgent: "*", allow: "/" }]);
    expect(robots.sitemap).toBe(`${DEFAULT_SITE_URL}/sitemap.xml`);
  });

  it("references the sitemap on the env-overridable base", () => {
    process.env[SITE_URL_ENV_VAR] = "https://docs-preview.example.com";
    expect(buildRobots().sitemap).toBe("https://docs-preview.example.com/sitemap.xml");
  });

  it("the app/robots.ts convention file generates from buildRobots", () => {
    const source = read("../src/app/robots.ts");
    expect(source).toContain("buildRobots()");
    expect(source).toMatch(/MetadataRoute\.Robots/);
  });
});

/* ------------------------------------------------------------------ */
/* (d) Per-route social cards — og:title / og:description / og image   */
/* ------------------------------------------------------------------ */

describe("per-route Open Graph + Twitter cards", () => {
  it("routeMetadata builds a full card for every public route", () => {
    for (const entry of DOCS_ROUTE_META) {
      const metadata = routeMetadata(entry, DEFAULT_SITE_URL);
      expect(metadata.openGraph.title, `${entry.path} og:title`).toBe(entry.title);
      expect(
        metadata.openGraph.description.trim().length,
        `${entry.path} og:description`,
      ).toBeGreaterThan(0);
      expect(metadata.openGraph.url).toBe(`${DEFAULT_SITE_URL}${entry.path}`);
      expect(metadata.openGraph.siteName).toBe("Reckon Docs");
      expect(metadata.openGraph.type).toBe("website");
      expect(metadata.twitter.card).toBe("summary_large_image");
      expect(metadata.twitter.title).toBe(entry.title);
      expect(metadata.twitter.description).toBe(entry.description);
      expect(metadata.alternates.canonical).toBe(entry.path);
    }
  });

  it("every card points at the resolvable og image with declared dimensions", () => {
    expect(OG_IMAGE_PATH).toBe("/opengraph-image");
    for (const entry of DOCS_ROUTE_META) {
      const metadata = routeMetadata(entry, DEFAULT_SITE_URL);
      expect(metadata.openGraph.images).toEqual([
        {
          url: OG_IMAGE_PATH,
          width: OG_IMAGE_WIDTH,
          height: OG_IMAGE_HEIGHT,
          type: "image/png",
        },
      ]);
    }
    expect([OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT]).toEqual([1200, 630]);
  });

  it("the og image file convention exists and serves the declared size", () => {
    const source = read("../src/app/opengraph-image.tsx");
    expect(source).toContain("next/og");
    expect(source).toContain(
      `export const size = { width: ${OG_IMAGE_WIDTH}, height: ${OG_IMAGE_HEIGHT} };`,
    );
    expect(source).toMatch(/export const alt =/);
    expect(source).toMatch(/export const contentType = "image\/png";/);
  });

  it("every page module exports its metadata through routeMetadata(routeMetaFor(path))", () => {
    for (const path of PUBLIC_ROUTE_PATHS) {
      // Whitespace-stripped + regex so prettier line-wrapping and trailing
      // commas cannot break the contract: the page's metadata export must
      // call the shared builder with the route-meta lookup of its own path.
      const stripped = read(pageFileFor(path)).replace(/\s+/g, "");
      const wiring = new RegExp(
        `metadata:Metadata=routeMetadata\\(routeMetaFor\\("${path}"\\)`,
      );
      expect(
        wiring.test(stripped),
        `${path} does not export routeMetadata(routeMetaFor("${path}"))`,
      ).toBe(true);
    }
  });

  it("no page module ships a hand-rolled openGraph/twitter object", () => {
    for (const path of PUBLIC_ROUTE_PATHS) {
      const source = read(pageFileFor(path));
      expect(source.includes("openGraph:"), `${path} hand-rolls openGraph`).toBe(false);
      expect(source.includes("twitter:"), `${path} hand-rolls twitter`).toBe(false);
    }
  });

  it("the root layout sets the metadataBase every card resolves against", () => {
    const source = read("../src/app/layout.tsx");
    expect(source).toContain("metadataBase: new URL(resolveSiteUrl())");
  });
});

/* ------------------------------------------------------------------ */
/* Discoverability — the changelog is linked from the chrome           */
/* ------------------------------------------------------------------ */

describe("changelog discoverability", () => {
  it("the sidebar links the changelog below the IA groups", () => {
    const source = read("../src/components/sidebar.tsx");
    expect(source).toContain('href="/changelog"');
  });

  it("the footer links the changelog", () => {
    const source = read("../src/components/docs-footer.tsx");
    expect(source).toContain('href="/changelog"');
  });

  it("the pager + changelog styles ship in the design system", () => {
    const css = read("../src/app/globals.css");
    for (const klass of [
      ".changelog-list",
      ".changelog-entry",
      ".changelog-chips",
      ".changelog-chip",
      ".changelog-title",
      ".docs-pager",
      ".pager-card",
      ".sidebar-extras",
    ]) {
      expect(css.includes(`${klass} {`), `missing ${klass} in globals.css`).toBe(true);
    }
  });
});
