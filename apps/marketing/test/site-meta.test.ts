/**
 * SEO / social / legal completeness (S5-001) — contract tests.
 *
 * Laws under test (work item S5-001):
 *  1. the sitemap generator emits EXACTLY the six public routes —
 *     / , /pricing, and the four /products/<id> pages (the same ids as
 *     PRODUCT_PAGE_IDS) — against the canonical base, with the base
 *     env-overridable through NEXT_PUBLIC_SITE_URL (trailing slashes
 *     trimmed, blank values falling back to the production default);
 *  2. the robots generator allows everything, disallows nothing, and
 *     references the sitemap on the same env-overridable base;
 *  3. every public route ships a full social card: non-empty
 *     og:title / og:description, an absolute og:url, siteName, a
 *     summary_large_image twitter card, and a canonical alternates entry
 *     — built by the shared routeMetadata() helper from the same typed
 *     content modules the route modules export metadata from (the page
 *     modules themselves cannot be imported here: they use the app's
 *     "@/" alias, which the root NodeNext program cannot resolve — so
 *     their wiring is asserted against source, the S1-002/S1-003
 *     convention), plus a resolvable og image: the app/opengraph-image
 *     file convention (1200×630) that covers every route in the root
 *     segment, with the layout's metadataBase resolving it absolutely;
 *  4. /terms and /privacy exist: typed legal docs with honest template
 *     disclosure (the pending-legal-review chip, stated on the page),
 *     non-empty headings/sections, and footer links pointing at the two
 *     routes (placeholder flags gone);
 *  5. the 404 renders the take-me-home CTA plus the /pricing exit;
 *  6. the favicon set ships: app/icon.svg (the vector brand mark) and
 *     the apple touch icon (app/apple-icon.tsx rendering a 180×180 PNG —
 *     Next 16.3.8 does not recognize apple-icon.svg, see that file's
 *     deviation note).
 *
 * Conventions: mirrors the S1-002/S1-003 suites — .js-suffixed relative
 * imports (NodeNext typecheck compatibility), readFileSync for
 * source-of-truth reads, vitest from the repo root, no network.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { legalDocs, LEGAL_STATUS_CHIP } from "../src/lib/legal-content.js";
import { footerColumns, homeMetadata } from "../src/lib/marketing-content.js";
import { pricingMetadata } from "../src/lib/pricing-content.js";
import { PRODUCT_PAGE_IDS, productPages } from "../src/lib/product-content.js";
import {
  DEFAULT_SITE_URL,
  OG_IMAGE_PATH,
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
/* 1. Site URL resolution — the env-overridable canonical base         */
/* ------------------------------------------------------------------ */

describe("site url resolution", () => {
  it("defaults to the production deployment when the env var is unset", () => {
    delete process.env[SITE_URL_ENV_VAR];
    expect(resolveSiteUrl()).toBe(DEFAULT_SITE_URL);
    expect(DEFAULT_SITE_URL).toBe("https://reckon-marketing.vercel.app");
  });

  it("falls back to the default on blank values, trims trailing slashes otherwise", () => {
    process.env[SITE_URL_ENV_VAR] = "   ";
    expect(resolveSiteUrl()).toBe(DEFAULT_SITE_URL);
    process.env[SITE_URL_ENV_VAR] = "";
    expect(resolveSiteUrl()).toBe(DEFAULT_SITE_URL);
    process.env[SITE_URL_ENV_VAR] = "https://preview.example.com///";
    expect(resolveSiteUrl()).toBe("https://preview.example.com");
  });
});

/* ------------------------------------------------------------------ */
/* 2. Sitemap — exactly the six public routes, env-overridable base    */
/* ------------------------------------------------------------------ */

describe("sitemap generator", () => {
  it("emits exactly the six public routes on the default base", () => {
    const entries = buildSitemap();
    expect(entries).toHaveLength(6);
    expect(entries.map((entry) => entry.url)).toEqual([
      `${DEFAULT_SITE_URL}/`,
      `${DEFAULT_SITE_URL}/pricing`,
      `${DEFAULT_SITE_URL}/products/recommendation-api`,
      `${DEFAULT_SITE_URL}/products/personalization`,
      `${DEFAULT_SITE_URL}/products/scheduling`,
      `${DEFAULT_SITE_URL}/products/analytics`,
    ]);
  });

  it("the route set is exactly PUBLIC_ROUTE_PATHS (home, pricing, the four product pages)", () => {
    expect([...PUBLIC_ROUTE_PATHS]).toEqual([
      "/",
      "/pricing",
      "/products/recommendation-api",
      "/products/personalization",
      "/products/scheduling",
      "/products/analytics",
    ]);
  });

  it("the product paths match the real product page ids (PRODUCT_PAGE_IDS cross-check)", () => {
    const expectedProductPaths = PRODUCT_PAGE_IDS.map((id) => `/products/${id}`);
    const sitemapProducts = [...PUBLIC_ROUTE_PATHS].filter((path) => path.startsWith("/products/"));
    expect(sitemapProducts).toEqual(expectedProductPaths);
    // And the content module really has a page per id.
    for (const id of PRODUCT_PAGE_IDS) {
      expect(productPages[id].metadata.title.trim().length).toBeGreaterThan(0);
    }
  });

  it("every entry carries a build-time lastModified, a changeFrequency, and a priority", () => {
    const before = Date.now();
    const entries = buildSitemap();
    const after = Date.now();
    for (const entry of entries) {
      expect(entry.lastModified instanceof Date).toBe(true);
      expect(entry.lastModified.getTime()).toBeGreaterThanOrEqual(before);
      expect(entry.lastModified.getTime()).toBeLessThanOrEqual(after);
      expect(["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"]).toContain(
        entry.changeFrequency,
      );
      expect(entry.priority).toBeGreaterThan(0);
      expect(entry.priority).toBeLessThanOrEqual(1);
    }
  });

  it("honors the NEXT_PUBLIC_SITE_URL override for every url", () => {
    process.env[SITE_URL_ENV_VAR] = "https://staging.reckon.example/";
    const urls = buildSitemap().map((entry) => entry.url);
    expect(urls).toHaveLength(6);
    for (const url of urls) {
      expect(url.startsWith("https://staging.reckon.example/")).toBe(true);
    }
    expect(urls[0]).toBe("https://staging.reckon.example/");
  });

  it("app/sitemap.ts wires the generator as the Next metadata-route default export", () => {
    const source = read("../src/app/sitemap.ts");
    expect(source).toContain("buildSitemap");
    expect(source).toContain("export default function sitemap()");
  });
});

/* ------------------------------------------------------------------ */
/* 3. Robots — allow everything, reference the sitemap                 */
/* ------------------------------------------------------------------ */

describe("robots generator", () => {
  it("allows all crawlers everything and disallows nothing", () => {
    const robots = buildRobots();
    expect(robots.rules).toEqual([{ userAgent: "*", allow: "/" }]);
    expect(robots).not.toHaveProperty("disallow");
  });

  it("references the sitemap on the same canonical base", () => {
    expect(buildRobots().sitemap).toBe(`${DEFAULT_SITE_URL}/sitemap.xml`);
  });

  it("the sitemap reference follows the env override", () => {
    process.env[SITE_URL_ENV_VAR] = "https://alt.example.com";
    expect(buildRobots().sitemap).toBe("https://alt.example.com/sitemap.xml");
  });

  it("app/robots.ts wires the generator as the Next metadata-route default export", () => {
    const source = read("../src/app/robots.ts");
    expect(source).toContain("buildRobots");
    expect(source).toContain("export default function robots()");
  });
});

/* ------------------------------------------------------------------ */
/* 4. Per-route social cards — og/twitter metadata on every route      */
/* ------------------------------------------------------------------ */

/** The six routes' metadata inputs, from the same content modules the
 *  page modules build their `metadata` exports from. */
function routeMetadataTable(): Array<{ path: string; title: string; description: string }> {
  return [
    { path: "/", ...pickTitleDescription(homeMetadata) },
    { path: "/pricing", ...pickTitleDescription(pricingMetadata) },
    ...PRODUCT_PAGE_IDS.map((id) => ({
      path: `/products/${id}`,
      ...pickTitleDescription(productPages[id].metadata),
    })),
  ];
}

function pickTitleDescription(source: { title: string; description: string }): {
  title: string;
  description: string;
} {
  return { title: source.title, description: source.description };
}

describe("per-route social metadata", () => {
  it("covers exactly the six public routes", () => {
    expect(routeMetadataTable().map((route) => route.path)).toEqual([...PUBLIC_ROUTE_PATHS]);
  });

  it("every route exports non-empty og:title, og:description, absolute og:url, and siteName", () => {
    for (const route of routeMetadataTable()) {
      const meta = routeMetadata(route);
      expect(meta.openGraph.title.trim().length, `og:title for ${route.path}`).toBeGreaterThan(0);
      expect(
        meta.openGraph.description.trim().length,
        `og:description for ${route.path}`,
      ).toBeGreaterThan(0);
      expect(meta.openGraph.url).toBe(`${DEFAULT_SITE_URL}${route.path}`);
      expect(meta.openGraph.siteName).toBe("Reckon");
      expect(meta.openGraph.type).toBe("website");
    }
  });

  it("every route references the resolvable og image path exactly once (1200×630 PNG)", () => {
    for (const route of routeMetadataTable()) {
      const meta = routeMetadata(route);
      expect(meta.openGraph.images, `og:image for ${route.path}`).toHaveLength(1);
      const image = meta.openGraph.images[0];
      expect(image?.url).toBe(OG_IMAGE_PATH);
      expect(image?.width).toBe(1200);
      expect(image?.height).toBe(630);
      expect(image?.type).toBe("image/png");
    }
  });

  it("every route ships a summary_large_image twitter card with title and description", () => {
    for (const route of routeMetadataTable()) {
      const meta = routeMetadata(route);
      expect(meta.twitter.card).toBe("summary_large_image");
      expect(meta.twitter.title).toBe(route.title);
      expect(meta.twitter.description).toBe(route.description);
    }
  });

  it("every route declares a canonical alternates entry", () => {
    for (const route of routeMetadataTable()) {
      expect(routeMetadata(route).alternates.canonical).toBe(route.path);
    }
  });

  it("routeMetadata follows the env-overridable base", () => {
    process.env[SITE_URL_ENV_VAR] = "https://meta.example.com";
    const meta = routeMetadata({ title: "t", description: "d", path: "/pricing" });
    expect(meta.openGraph.url).toBe("https://meta.example.com/pricing");
  });

  it("the home page module wires routeMetadata from homeMetadata", () => {
    const source = read("../src/app/page.tsx");
    expect(source).toContain("routeMetadata(homeMetadata)");
    expect(source).toContain('import type { Metadata } from "next"');
    expect(source).toContain("export const metadata: Metadata");
  });

  it("the pricing page module wires routeMetadata with the /pricing path", () => {
    const source = read("../src/app/pricing/page.tsx");
    expect(source).toContain("routeMetadata({");
    expect(source).toContain('path: "/pricing"');
  });

  it("the product page module wires routeMetadata with the /products/<id> path", () => {
    const source = read("../src/app/products/[productId]/page.tsx");
    expect(source).toContain("routeMetadata({");
    expect(source).toContain("path: `/products/${id}`");
  });
});

/* ------------------------------------------------------------------ */
/* 5. OG image — the file convention every route resolves              */
/* ------------------------------------------------------------------ */

describe("og image", () => {
  it("ships the app/opengraph-image.tsx file convention (the resolvable path)", () => {
    expect(exists("../src/app/opengraph-image.tsx")).toBe(true);
    expect(OG_IMAGE_PATH).toBe("/opengraph-image");
  });

  it("is 1200×630 PNG with non-empty alt text, on the dark brand ground with the accent", () => {
    const source = read("../src/app/opengraph-image.tsx");
    expect(source).toContain("width: 1200");
    expect(source).toContain("height: 630");
    expect(source).toContain('export const contentType = "image/png"');
    expect(source).toMatch(/export const alt =/);
    expect(source).toContain('"#050607"');
    expect(source).toContain('"#10cf8f"');
    expect(source).toContain("reckon");
  });

  it("the root layout sets the metadataBase every og:image/og:url resolves against", () => {
    const source = read("../src/app/layout.tsx");
    expect(source).toContain("metadataBase: new URL(resolveSiteUrl())");
    expect(source).toContain('card: "summary_large_image"');
  });
});

/* ------------------------------------------------------------------ */
/* 6. Legal pages — /terms and /privacy                                */
/* ------------------------------------------------------------------ */

describe("legal pages", () => {
  it("ships both docs with non-empty page headings and metadata", () => {
    expect(legalDocs.terms.title.trim().length).toBeGreaterThan(0);
    expect(legalDocs.privacy.title.trim().length).toBeGreaterThan(0);
    expect(legalDocs.terms.title).toBe("Terms of Service");
    expect(legalDocs.privacy.title).toBe("Privacy Policy");
    for (const doc of [legalDocs.terms, legalDocs.privacy]) {
      expect(doc.metadata.title.trim().length).toBeGreaterThan(0);
      expect(doc.metadata.description.trim().length).toBeGreaterThan(0);
      expect(doc.metadata.title.endsWith("— Reckon")).toBe(true);
    }
  });

  it("both docs disclose the template-pending-review status honestly", () => {
    for (const doc of [legalDocs.terms, legalDocs.privacy]) {
      expect(doc.statusChip).toBe(LEGAL_STATUS_CHIP);
      expect(doc.statusChip.toLowerCase()).toContain("template");
      expect(doc.statusChip.toLowerCase()).toContain("pending legal review");
      expect(doc.intro.toLowerCase()).toContain("template");
    }
  });

  it("both docs carry real sections with non-empty headings and paragraphs", () => {
    for (const doc of [legalDocs.terms, legalDocs.privacy]) {
      expect(doc.sections.length).toBeGreaterThanOrEqual(5);
      for (const section of doc.sections) {
        expect(section.heading.trim().length).toBeGreaterThan(0);
        expect(section.paragraphs.length).toBeGreaterThanOrEqual(1);
        for (const paragraph of section.paragraphs) {
          expect(paragraph.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("the /terms and /privacy route modules render their doc's heading text", () => {
    const termsSource = read("../src/app/terms/page.tsx");
    const privacySource = read("../src/app/privacy/page.tsx");
    expect(termsSource).toContain("doc={termsDoc}");
    expect(privacySource).toContain("doc={privacyDoc}");
    // The shared renderer puts the doc's title in the H1.
    const renderer = read("../src/components/marketing/legal-page.tsx");
    expect(renderer).toContain('id="rk-legal-title"');
    expect(renderer).toContain("{doc.title}");
    // Route metadata comes from the same doc.
    expect(termsSource).toContain("path: termsDoc.path");
    expect(privacySource).toContain("path: privacyDoc.path");
  });

  it("the footer links to /terms and /privacy with the placeholder flags gone", () => {
    const company = footerColumns.find((column) => column.heading === "Company");
    expect(company).toBeDefined();
    const terms = company?.links.find((link) => link.label === "Terms");
    const privacy = company?.links.find((link) => link.label === "Privacy");
    expect(terms?.href).toBe("/terms");
    expect(terms?.placeholder).toBeUndefined();
    expect(privacy?.href).toBe("/privacy");
    expect(privacy?.placeholder).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* 7. Custom 404 + favicon set                                         */
/* ------------------------------------------------------------------ */

describe("not-found page", () => {
  it("renders the take-me-home CTA and the /pricing exit", () => {
    const source = read("../src/app/not-found.tsx");
    expect(source).toContain("Take me home");
    expect(source).toMatch(/href="\/"/);
    expect(source).toMatch(/href="\/pricing"/);
    expect(source).toContain("Page not found — Reckon");
  });
});

describe("favicon set", () => {
  it("ships the vector brand mark as app/icon.svg", () => {
    const source = read("../src/app/icon.svg");
    expect(source).toContain("#050607");
    expect(source).toContain("#10cf8f");
    expect(source.toLowerCase()).toContain("<svg");
  });

  it("ships the apple touch icon as a 180×180 build-generated PNG (svg unsupported)", () => {
    const source = read("../src/app/apple-icon.tsx");
    expect(source).toContain("width: 180");
    expect(source).toContain("height: 180");
    expect(source).toContain('export const contentType = "image/png"');
  });
});
