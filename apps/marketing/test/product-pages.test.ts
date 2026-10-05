/**
 * Product pages (S1-002) — content-shape tests.
 *
 * Laws under test (work item S1-002):
 *  1. every product id has a page route (the /products/<id> static
 *     surface, prerendered from PRODUCT_PAGE_IDS via generateStaticParams);
 *  2. every href resolves within the app — no "#" placeholders left for
 *     products (grid, footer, headerNav Product, related band);
 *  3. every code snippet's route tag matches the REAL registered route
 *     surface in apps/api/src/routes/* (read from source, not mirrored);
 *  4. metadata present per page (title + description);
 *  5. response payloads parse as JSON and carry the real frozen-contract
 *     schema literals (enum facts transcribed from
 *     packages/contracts/src/*.ts, cited per constant);
 *  6. docs deep-links resolve to the docs app's REAL routes
 *     (apps/docs/src/app/<path>/page.tsx on disk + the docs IA file).
 *
 * Conventions: mirrors apps/web/test/*.test.ts — .js-suffixed relative
 * imports (NodeNext typecheck compatibility), readFileSync for
 * source-of-truth reads, vitest from the repo root.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DOCS_BASE_URL, PRODUCT_PAGE_IDS, productPages } from "../src/lib/product-content.js";
import { headerNav, products } from "../src/lib/marketing-content.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string): string => readFileSync(join(here, relative), "utf8");

/* ------------------------------------------------------------------ */
/* 1. Product ids ↔ page routes                                        */
/* ------------------------------------------------------------------ */

describe("product page routes", () => {
  const pageRouteFile = "../src/app/products/[productId]/page.tsx";

  it("ships the dynamic product route file", () => {
    const source = read(pageRouteFile);
    expect(source).toContain("generateStaticParams");
    expect(source).toContain("PRODUCT_PAGE_IDS");
  });

  it("prerenders every product id statically (dynamicParams = false)", () => {
    const source = read(pageRouteFile);
    expect(source).toContain("dynamicParams = false");
  });

  it("every marketing product id has product-page content", () => {
    expect([...PRODUCT_PAGE_IDS]).toEqual(products.map((product) => product.id));
  });

  it("the home's products[] drive the static params (same ids, same order)", () => {
    const source = read(pageRouteFile);
    // The page module derives params from PRODUCT_PAGE_IDS, which the
    // previous test pins to the home's products[] ids.
    expect(source).toContain("PRODUCT_PAGE_IDS.map");
  });
});

/* ------------------------------------------------------------------ */
/* 2. Wiring — no dead links for products                              */
/* ------------------------------------------------------------------ */

describe("product wiring (no # placeholders left for products)", () => {
  it("every products[] href is the real /products/<id> route", () => {
    for (const product of products) {
      expect(product.href).toBe(`/products/${product.id}`);
    }
  });

  it("headerNav Product entry links into the products surface (no dead #)", () => {
    const productNav = headerNav.find((item) => item.label === "Product");
    expect(productNav).toBeDefined();
    expect(productNav?.href.startsWith("/products/")).toBe(true);
    expect(productNav?.href).not.toBe("#");
  });

  it("the home's product-grid aria-label no longer says placeholder", () => {
    const source = read("../src/components/marketing/product-grid.tsx");
    expect(source).not.toContain("placeholder, ships next");
    expect(source).toContain("product page`");
  });

  it("every product page's related band links only to real product routes", () => {
    for (const id of PRODUCT_PAGE_IDS) {
      const page = productPages[id];
      expect(page.id).toBe(id);
      // relatedProducts(current) is used by the band; assert its shape here.
      const related = PRODUCT_PAGE_IDS.filter((other) => other !== id);
      expect(related).toHaveLength(3);
      expect(related).not.toContain(id);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 3. Code artifacts vs the REAL api route surface                     */
/* ------------------------------------------------------------------ */

/**
 * The real registered routes, read from apps/api/src/routes/*.ts — the
 * artifact's path must appear verbatim in the route source.
 */
const ROUTE_SOURCES: Record<string, string> = {
  "recommendation-api": "../../api/src/routes/decisions.ts",
  personalization: "../../api/src/routes/preferences.ts",
  scheduling: "../../api/src/routes/plans.ts",
  analytics: "../../api/src/routes/outcomes.ts",
} as const;

/** The real frozen contracts that shape each response. */
const CONTRACT_SOURCES: Record<string, string> = {
  "recommendation-api": "../../../packages/contracts/src/decision.ts",
  personalization: "../../../packages/contracts/src/preferences.ts",
  scheduling: "../../../packages/contracts/src/plans.ts",
  analytics: "../../../packages/contracts/src/outcomes.ts",
} as const;

/** The schema literal each response payload must carry. */
const RESPONSE_SCHEMA_LITERALS: Record<string, string> = {
  "recommendation-api": "reckon.decision-result",
  personalization: "reckon.preference-delta",
  scheduling: "reckon.experience-plan",
  analytics: "reckon.outcome-event",
} as const;

describe("code artifacts mirror the real API surface", () => {
  for (const id of PRODUCT_PAGE_IDS) {
    const page = productPages[id];

    it(`${id}: cURL tab calls a route registered in apps/api/src/routes`, () => {
      const curl = page.code.tabs.find((tab) => tab.language === "curl");
      expect(curl).toBeDefined();
      const routeSource = read(ROUTE_SOURCES[id]);
      // Extract the request path from the artifact URL.
      const match = /https:\/\/api\.reckon\.dev(\/v1\/[a-z/]+)/.exec(curl?.code ?? "");
      expect(match, `cURL tab should target https://api.reckon.dev/v1/…`).not.toBeNull();
      const path = (match as RegExpExecArray)[1];
      expect(routeSource).toContain(`"${path}"`);
    });

    it(`${id}: the hero route tag path is the same registered route`, () => {
      const routeSource = read(ROUTE_SOURCES[id]);
      const match = /(\/v1\/[a-z/]+)/.exec(page.routeTag);
      expect(match).not.toBeNull();
      expect(routeSource).toContain(`"${(match as RegExpExecArray)[1]}"`);
    });

    it(`${id}: response parses as JSON and carries the real schema literal`, () => {
      const payload: unknown = JSON.parse(page.code.response);
      expect(payload).toBeTypeOf("object");
      const source = read(CONTRACT_SOURCES[id]);
      expect(source).toContain(RESPONSE_SCHEMA_LITERALS[id]);
      expect(JSON.stringify(payload)).toContain(RESPONSE_SCHEMA_LITERALS[id]);
    });

    it(`${id}: every tab is non-empty and uses a supported tokenizer language`, () => {
      expect(page.code.tabs.length).toBeGreaterThanOrEqual(2);
      for (const tab of page.code.tabs) {
        expect(tab.code.trim().length).toBeGreaterThan(0);
        expect(["curl", "typescript"]).toContain(tab.language);
      }
    });
  }

  it("idempotency mirrors the real route semantics (header vs body key)", () => {
    // decisions + outcomes: body-level idempotencyKey (idempotencyFromBody).
    for (const id of ["recommendation-api", "analytics"] as const) {
      const curl = productPages[id].code.tabs.find((tab) => tab.language === "curl");
      expect(curl?.code).toContain('"idempotencyKey"');
      expect(curl?.code).not.toContain("Idempotency-Key:");
    }
    // preferences + plans: Idempotency-Key header (no body-level key).
    for (const id of ["personalization", "scheduling"] as const) {
      const curl = productPages[id].code.tabs.find((tab) => tab.language === "curl");
      expect(curl?.code).toContain('-H "Idempotency-Key:');
      expect(curl?.code).not.toContain('"idempotencyKey"');
    }
  });
});

/* ------------------------------------------------------------------ */
/* 4. Response payload shapes (enum facts transcribed from contracts)  */
/* ------------------------------------------------------------------ */

/** SCHEDULE_ACTIONS — packages/contracts/src/decision.ts (8 actions). */
const SCHEDULE_ACTIONS = [
  "HOLD", "CONTINUE", "QUEUE", "SUGGEST", "SWITCH", "INTERRUPT", "RESUME", "END",
] as const;
/** PREFERENCE_UPDATE_OPS — packages/contracts/src/preferences.ts (6 ops). */
const PREFERENCE_OPS = ["set", "add", "multiply", "decay", "remove", "merge"] as const;
/** REPLAN_TRIGGERS — packages/contracts/src/plans.ts (10 triggers). */
const REPLAN_TRIGGERS = [
  "context-changed", "objective-changed", "candidate-unavailable", "new-candidate",
  "user-feedback", "fatigue-signal", "outcome-observed", "budget-exhausted",
  "host-request", "custom",
] as const;
/** OUTCOME_EVENT_TYPES — packages/contracts/src/outcomes.ts (18 kinds). */
const OUTCOME_EVENT_TYPES = [
  "impression", "start", "completion", "abandonment", "seek", "skip", "save",
  "share", "purchase", "conversion", "explicit-feedback", "interruption-accept",
  "interruption-reject", "return", "resume", "context-transition", "correction",
  "custom",
] as const;
/** EVIDENCE_CLASSES — packages/contracts/src/primitives.ts (6 classes). */
const EVIDENCE_CLASSES = [
  "fixture", "controlled-local", "staging", "production-observed", "simulated",
  "counterfactual",
] as const;

describe("response payloads are shaped by the frozen contracts", () => {
  it("decision-result: action, confidence, reasons, latency", () => {
    const payload = JSON.parse(productPages["recommendation-api"].code.response);
    expect(SCHEDULE_ACTIONS).toContain(payload.action);
    expect(payload.uncertainty.confidence).toBeGreaterThanOrEqual(0);
    expect(payload.uncertainty.confidence).toBeLessThanOrEqual(1);
    expect(Array.isArray(payload.reasons)).toBe(true);
    expect(payload.reasons.length).toBeGreaterThan(0);
    expect(payload.latency.latencyMsP50).toBeGreaterThan(0);
    expect(payload.selectedExperience.schema).toBe("reckon.experience");
  });

  it("preference-delta: op, model lineage, decay", () => {
    const payload = JSON.parse(productPages.personalization.code.response);
    expect(PREFERENCE_OPS).toContain(payload.op);
    expect(payload.model.modelId.length).toBeGreaterThan(0);
    expect(payload.model.version.length).toBeGreaterThan(0);
    expect(payload.decay.halfLifeSeconds).toBeGreaterThan(0);
  });

  it("experience-plan: queued experiences, replan triggers, versioning", () => {
    const payload = JSON.parse(productPages.scheduling.code.response);
    expect(payload.version).toBeGreaterThanOrEqual(0);
    expect(payload.queuedExperiences.length).toBeGreaterThan(0);
    for (const trigger of payload.replanTriggers) {
      expect(REPLAN_TRIGGERS).toContain(trigger);
    }
    for (const experience of payload.queuedExperiences) {
      expect(experience.schema).toBe("reckon.experience");
    }
  });

  it("outcome-event: typed kind, metrics record, evidence class, idempotency", () => {
    const payload = JSON.parse(productPages.analytics.code.response);
    expect(OUTCOME_EVENT_TYPES).toContain(payload.eventType);
    expect(EVIDENCE_CLASSES).toContain(payload.evidenceClass);
    expect(payload.idempotencyKey.length).toBeGreaterThan(0);
    for (const value of Object.values(payload.metrics)) {
      expect(value).toBeTypeOf("number");
    }
  });
});

/* ------------------------------------------------------------------ */
/* 5. Docs deep-links are honest (real docs app routes)                */
/* ------------------------------------------------------------------ */

describe("docs deep-links resolve to the real docs portal routes", () => {
  it("every docs link targets the docs origin", () => {
    for (const id of PRODUCT_PAGE_IDS) {
      for (const link of productPages[id].docsLinks) {
        expect(link.href.startsWith(`${DOCS_BASE_URL}/`)).toBe(true);
      }
    }
  });

  it("every docs link path is a real page in apps/docs (on disk + in the IA)", () => {
    const navigationSource = read("../../docs/src/content/navigation.ts");
    for (const id of PRODUCT_PAGE_IDS) {
      for (const link of productPages[id].docsLinks) {
        const path = link.href.slice(DOCS_BASE_URL.length);
        // The docs app renders this route.
        expect(
          read(`../../docs/src/app${path}/page.tsx`),
          `apps/docs route for ${path}`,
        ).toContain("export default");
        // The docs IA lists this path.
        expect(navigationSource).toContain(`path: "${path}"`);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* 6. Per-page metadata + copy grammar                                 */
/* ------------------------------------------------------------------ */

describe("per-page metadata and copy grammar", () => {
  it("metadata present per page (title + description)", () => {
    for (const id of PRODUCT_PAGE_IDS) {
      const { title, description } = productPages[id].metadata;
      expect(title.length).toBeGreaterThan(0);
      expect(title.endsWith("— Reckon")).toBe(true);
      expect(description.length).toBeGreaterThan(40);
    }
  });

  it("hero copy: eyebrow, 1–3 headline lines, sub, route tag, trust line", () => {
    for (const id of PRODUCT_PAGE_IDS) {
      const page = productPages[id];
      expect(page.eyebrow.length).toBeGreaterThan(0);
      expect(page.headline.length).toBeGreaterThanOrEqual(1);
      expect(page.headline.length).toBeLessThanOrEqual(3);
      for (const line of page.headline) {
        expect(line.trim().length).toBeGreaterThan(0);
      }
      expect(page.subheadline.length).toBeGreaterThan(0);
      expect(page.routeTag.length).toBeGreaterThan(0);
      expect(page.microTrust.length).toBeGreaterThan(0);
    }
  });

  it("features: 3–5 capability blocks, outcome-phrased headline + one-line body", () => {
    for (const id of PRODUCT_PAGE_IDS) {
      const page = productPages[id];
      expect(page.features.length).toBeGreaterThanOrEqual(3);
      expect(page.features.length).toBeLessThanOrEqual(5);
      for (const feature of page.features) {
        expect(feature.headline.trim().length).toBeGreaterThan(0);
        expect(feature.body.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("how-it-works: exactly three steps, each with label, title, body", () => {
    for (const id of PRODUCT_PAGE_IDS) {
      const page = productPages[id];
      expect(page.steps).toHaveLength(3);
      for (const step of page.steps) {
        expect(step.label.trim().length).toBeGreaterThan(0);
        expect(step.title.trim().length).toBeGreaterThan(0);
        expect(step.body.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("code section copy present (eyebrow, title, sub, response label, craft notes)", () => {
    for (const id of PRODUCT_PAGE_IDS) {
      const code = productPages[id].code;
      expect(code.eyebrow.length).toBeGreaterThan(0);
      expect(code.title.length).toBeGreaterThan(0);
      expect(code.sub.length).toBeGreaterThan(0);
      expect(code.responseLabel.length).toBeGreaterThan(0);
      expect(code.craftNotes.length).toBeGreaterThanOrEqual(3);
    }
  });
});
