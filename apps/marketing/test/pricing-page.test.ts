/**
 * Pricing page (S1-003) — content-shape tests.
 *
 * Laws under test (work item S1-003):
 *  1. every tier card is complete — id/name/priceLine/priceUnit/
 *     descriptor (the price-descriptor law) + exactly one CTA whose href
 *     actually resolves (docs origin, mailto, /pricing, or an in-page
 *     anchor) + 3–6 honestly marked feature bullets;
 *  2. the honesty law: priced tiers carry the illustrative-pricing
 *     footnote, and every surface that shows a figure (hero chip, tier
 *     grid note, calculator footnote, page metadata) states that
 *     billing is not yet enforced;
 *  3. the comparison matrix is structurally sound — unique row ids, a
 *     cell for every tier, dashboard marks backed by REAL apps/web
 *     routes on disk, roadmap marks carrying their roadmapRef;
 *  4. docs deep-links resolve to the docs app's REAL routes (on disk +
 *     in the IA) — the same law as the product pages (S1-002);
 *  5. wiring — headerNav/footer Pricing → /pricing with the placeholder
 *     flags gone, START_NOW_HREF stays /pricing (the home + product
 *     pages' "Start now" target), and the route composes all sections;
 *  6. the calculator copy is CONSISTENT with the pure pricing model in
 *     src/lib/pricing-calculator.ts (bounds, presets, thresholds);
 *  7. the FAQ answers mirror the repo's ACTUAL semantics — claims are
 *     cross-checked against the real sources (sk_test_/sk_live_ key
 *     model, the eleven-scenario vocabulary, 429 + Retry-After),
 *     read from source, not mirrored.
 *
 * Conventions: mirrors apps/web/test/*.test.ts + the S1-002 suite —
 * .js-suffixed relative imports (NodeNext typecheck compatibility),
 * readFileSync for source-of-truth reads, vitest from the repo root.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BASE_RATE_CENTS,
  ENTERPRISE_THRESHOLD,
  SCALE_THRESHOLD,
  VOLUME_BRACKETS,
  estimateMonthlyPrice,
  formatUsdFromCents,
} from "../src/lib/pricing-calculator.js";
import {
  DOCS_BASE_URL,
  ILLUSTRATIVE_NOTE,
  PRICING_TIER_IDS,
  QUICKSTART_HREF,
  SALES_HREF,
  calculatorCopy,
  comparisonRows,
  faqEntries,
  pricingFinalCta,
  pricingHero,
  pricingMetadata,
  pricingTiers,
  tiersFootnote,
  type PricingTier,
  type PricingTierId,
} from "../src/lib/pricing-content.js";
import { START_NOW_HREF, footerSurfaces, headerNav } from "../src/lib/marketing-content.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string): string => readFileSync(join(here, relative), "utf8");

/** Type-safe tier lookup — fails loudly if a tier id ever goes missing. */
function tier(id: PricingTierId): PricingTier {
  const found = pricingTiers.find((t) => t.id === id);
  if (!found) throw new Error(`missing pricing tier: ${id}`);
  return found;
}

/* ------------------------------------------------------------------ */
/* 1. Tier structure — CTA + price descriptor on every card            */
/* ------------------------------------------------------------------ */

describe("tier structure", () => {
  it("ships the four tiers in display order", () => {
    expect(pricingTiers.map((t) => t.id)).toEqual([...PRICING_TIER_IDS]);
  });

  it("every tier has a name, price line, unit line, and audience descriptor", () => {
    for (const t of pricingTiers) {
      expect(t.name.trim().length).toBeGreaterThan(0);
      expect(t.priceLine.trim().length).toBeGreaterThan(0);
      expect(t.priceUnit.trim().length).toBeGreaterThan(0);
      expect(t.descriptor.trim().length).toBeGreaterThan(0);
    }
  });

  it("every tier has exactly one CTA whose href resolves (no dead #)", () => {
    for (const t of pricingTiers) {
      expect(t.cta.label.trim().length).toBeGreaterThan(0);
      const href = t.cta.href;
      expect(href).not.toBe("#");
      const resolvable =
        href.startsWith(`${DOCS_BASE_URL}/`) ||
        href.startsWith("mailto:") ||
        href === "/pricing" ||
        href.startsWith("#"); // in-page anchor (e.g. #calculator)
      expect(resolvable, `unresolvable tier CTA href: ${href}`).toBe(true);
    }
  });

  it("in-page anchor CTAs point at sections the pricing page actually renders", () => {
    // The Scale tier links to #calculator — the calculator section id.
    const pageSource = read("../src/app/pricing/page.tsx");
    for (const t of pricingTiers) {
      if (t.cta.href.startsWith("#") && t.cta.href !== "#") {
        const sectionId = t.cta.href.slice(1);
        const componentSource = read(`../src/components/marketing/volume-calculator.tsx`);
        const anchorRendered =
          pageSource.includes("VolumeCalculator") &&
          componentSource.includes(`id="${sectionId}"`);
        expect(anchorRendered, `anchor ${t.cta.href} must match a rendered section id`).toBe(true);
      }
    }
  });

  it("feature bullets: 3–6 per tier, honest marks only, marked features carry a ref", () => {
    for (const t of pricingTiers) {
      expect(t.features.length).toBeGreaterThanOrEqual(3);
      expect(t.features.length).toBeLessThanOrEqual(6);
      for (const feature of t.features) {
        expect(feature.text.trim().length).toBeGreaterThan(0);
        expect(["included", "dashboard", "roadmap"]).toContain(feature.status);
        if (feature.status !== "included") {
          expect((feature.ref ?? "").length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("the free tier is Developer/test-mode: $0, no card, CTA to the quickstart", () => {
    const developer = tier("developer");
    expect(developer.priceLine).toBe("$0");
    expect(developer.cta.href).toBe(QUICKSTART_HREF);
    expect(developer.features.some((f) => f.text.includes("sk_test_"))).toBe(true);
  });

  it("the Standard price line is the model's list rate ($0.90 per 1k)", () => {
    expect(tier("standard").priceLine).toBe(formatUsdFromCents(BASE_RATE_CENTS));
    expect(BASE_RATE_CENTS).toBe(90);
  });

  it("the Enterprise tier is custom terms with the mailto CTA", () => {
    const enterprise = tier("enterprise");
    expect(enterprise.priceLine).toBe("Custom");
    expect(enterprise.cta.href).toBe(SALES_HREF);
    expect(SALES_HREF.startsWith("mailto:")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Honesty law — no price figure appears unlabeled                  */
/* ------------------------------------------------------------------ */

describe("honesty labels (illustrative pricing law)", () => {
  it("the honesty note states billing is not enforced", () => {
    expect(ILLUSTRATIVE_NOTE).toMatch(/not yet billing-enforced/i);
  });

  it("the hero caveat chip carries the claim where the page opens", () => {
    expect(pricingHero.caveatChip).toMatch(/illustrative pricing/i);
    expect(pricingHero.caveatChip).toMatch(/not yet billing-enforced/i);
  });

  it("priced tiers carry the illustrative footnote (standard + scale)", () => {
    for (const id of ["standard", "scale"] as const) {
      const footnote = tier(id).footnote;
      expect(footnote, `${id} tier must carry a footnote`).toBeDefined();
      expect(footnote ?? "").toMatch(/illustrative/i);
    }
  });

  it("the tier-grid note and the calculator footnote both disclose", () => {
    expect(tiersFootnote).toMatch(/illustrative/i);
    expect(calculatorCopy.footnote).toMatch(/illustrative/i);
    expect(calculatorCopy.footnote).toMatch(/not yet billing-enforced/i);
  });

  it("page metadata discloses the illustrative caveat in the description", () => {
    expect(pricingMetadata.description).toMatch(/illustrative/i);
    expect(pricingMetadata.title).toContain("Reckon");
  });
});

/* ------------------------------------------------------------------ */
/* 3. Comparison matrix — structure + honest marks                     */
/* ------------------------------------------------------------------ */

describe("comparison matrix structure", () => {
  it("row ids are unique and non-empty", () => {
    const ids = comparisonRows.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.trim().length).toBeGreaterThan(0);
  });

  it("every row has a well-formed cell for every tier", () => {
    const kinds = ["included", "dashboard", "roadmap", "custom", "none"];
    for (const row of comparisonRows) {
      for (const tierId of PRICING_TIER_IDS) {
        const cell = row.cells[tierId];
        expect(cell, `${row.id}/${tierId}`).toBeDefined();
        expect(kinds).toContain(cell.kind);
      }
    }
  });

  it("covers the work-order feature vocabulary", () => {
    const ids = comparisonRows.map((row) => row.id);
    for (const required of [
      "test-mode",
      "webhooks",
      "request-logs",
      "events-console",
      "sdks",
      "support",
    ]) {
      expect(ids).toContain(required);
    }
  });

  it("dashboard cells are backed by a dashboardRef that is a REAL apps/web route", () => {
    for (const row of comparisonRows) {
      const hasDashboard = Object.values(row.cells).some((cell) => cell.kind === "dashboard");
      if (!hasDashboard) continue;
      expect(row.dashboardRef?.startsWith("/")).toBe(true);
      const pageSource = read(`../../web/src/app${row.dashboardRef}/page.tsx`);
      expect(pageSource, `apps/web route for ${row.dashboardRef}`).toContain("export default");
    }
  });

  it("roadmap cells carry a roadmapRef saying what is planned", () => {
    for (const row of comparisonRows) {
      const hasRoadmap = Object.values(row.cells).some((cell) => cell.kind === "roadmap");
      if (!hasRoadmap) continue;
      expect((row.roadmapRef ?? "").length).toBeGreaterThan(0);
    }
  });

  it("nothing that exists today is gated: platform basics are included on every tier", () => {
    for (const id of ["test-mode", "api-craft", "typed-errors"]) {
      const row = comparisonRows.find((r) => r.id === id);
      expect(row, `missing row ${id}`).toBeDefined();
      for (const tierId of PRICING_TIER_IDS) {
        expect(row?.cells[tierId].kind).toBe("included");
      }
    }
  });

  it("the analytics row is honestly roadmap, not sold as shipped", () => {
    const analytics = comparisonRows.find((r) => r.id === "analytics-views");
    expect(analytics).toBeDefined();
    expect(analytics?.cells.scale.kind).toBe("roadmap");
    expect(analytics?.roadmapRef ?? "").toMatch(/S3-002/);
    // The dashboard route today is the honest S3-001 shell + S3-002 note.
    expect(read("../../web/src/app/analytics/page.tsx")).toContain("S3-002");
  });
});

/* ------------------------------------------------------------------ */
/* 4. Docs deep-links are honest (real docs app routes)                */
/* ------------------------------------------------------------------ */

describe("docs deep-links resolve to the real docs portal routes", () => {
  it("every docs link targets the docs origin", () => {
    for (const row of comparisonRows) {
      if (row.docsHref) {
        expect(row.docsHref.startsWith(`${DOCS_BASE_URL}/`)).toBe(true);
      }
    }
  });

  it("every docs link path is a real page in apps/docs (on disk + in the IA)", () => {
    const navigationSource = read("../../docs/src/content/navigation.ts");
    for (const row of comparisonRows) {
      if (!row.docsHref) continue;
      const path = row.docsHref.slice(DOCS_BASE_URL.length);
      expect(
        read(`../../docs/src/app${path}/page.tsx`),
        `apps/docs route for ${path}`,
      ).toContain("export default");
      expect(navigationSource).toContain(`path: "${path}"`);
    }
  });

  it("the quickstart CTA target is a real docs route", () => {
    const path = QUICKSTART_HREF.slice(DOCS_BASE_URL.length);
    expect(read(`../../docs/src/app${path}/page.tsx`)).toContain("export default");
  });
});

/* ------------------------------------------------------------------ */
/* 5. Wiring — nav, footer, and the route composition                  */
/* ------------------------------------------------------------------ */

describe("nav and CTA wiring", () => {
  it("headerNav Pricing links to /pricing with the placeholder flag gone", () => {
    const pricingNav = headerNav.find((item) => item.label === "Pricing");
    expect(pricingNav).toBeDefined();
    expect(pricingNav?.href).toBe("/pricing");
    expect(pricingNav?.placeholder).toBeUndefined();
  });

  it("footer Pricing links to /pricing with the placeholder flag gone", () => {
    const pricingFooter = footerSurfaces.find((item) => item.label === "Pricing");
    expect(pricingFooter).toBeDefined();
    expect(pricingFooter?.href).toBe("/pricing");
    expect(pricingFooter?.placeholder).toBeUndefined();
  });

  it("START_NOW_HREF stays /pricing (the home + product pages' CTA target)", () => {
    expect(START_NOW_HREF).toBe("/pricing");
  });

  it("the pricing page route composes all sections between header and footer", () => {
    const source = read("../src/app/pricing/page.tsx");
    for (const section of [
      "PricingHero",
      "PricingTiers",
      "VolumeCalculator",
      "PricingComparison",
      "PricingFaq",
      "PricingCtaBand",
    ]) {
      expect(source).toContain(section);
    }
    expect(source).toContain("SiteHeader");
    expect(source).toContain("SiteFooter");
  });

  it("the pricing page exports per-page metadata", () => {
    const source = read("../src/app/pricing/page.tsx");
    expect(source).toContain("export const metadata");
  });

  it("the final CTA band converts directly: quickstart + mailto", () => {
    expect(pricingFinalCta.primaryCta.href).toBe(QUICKSTART_HREF);
    expect(pricingFinalCta.secondaryCta.href).toBe(SALES_HREF);
    expect(calculatorCopy.handoffCta.href).toBe(SALES_HREF);
  });
});

/* ------------------------------------------------------------------ */
/* 6. Calculator copy ↔ pricing model consistency                      */
/* ------------------------------------------------------------------ */

describe("calculator copy matches the pricing model", () => {
  it("bounds are sane: 0 ≤ default ≤ sliderMax ≤ inputMax", () => {
    const { defaultVolume, sliderMax, inputMax } = calculatorCopy;
    expect(defaultVolume).toBeGreaterThanOrEqual(0);
    expect(defaultVolume).toBeLessThanOrEqual(sliderMax);
    expect(sliderMax).toBeLessThanOrEqual(inputMax);
  });

  it("presets are strictly ascending and inside the slider range", () => {
    const presets = [...calculatorCopy.presets];
    for (let i = 1; i < presets.length; i += 1) {
      expect(presets[i]).toBeGreaterThan(presets[i - 1]);
    }
    expect(presets[0]).toBeGreaterThanOrEqual(0);
    expect(presets[presets.length - 1]).toBeLessThanOrEqual(calculatorCopy.sliderMax);
  });

  it("every preset volume quotes on a real tier (never the handoff)", () => {
    for (const preset of calculatorCopy.presets) {
      const estimate = estimateMonthlyPrice(preset);
      expect(estimate.isEnterpriseHandoff).toBe(false);
      expect(estimate.monthlyEstimateCents).not.toBeNull();
    }
  });

  it("the handoff copy's threshold matches the model's ENTERPRISE_THRESHOLD", () => {
    expect(ENTERPRISE_THRESHOLD).toBe(500_000_000);
    expect(calculatorCopy.handoffBody).toContain("500M");
  });

  it("the Scale tier's advertised discounts match the model's brackets", () => {
    // Copy: "10% at 5M, 20% at 25M, 30% at 100M requests/mo".
    const scaleFeature = tier("scale").features.find((f) =>
      f.text.includes("volume discounts"),
    );
    expect(scaleFeature).toBeDefined();
    expect(scaleFeature?.text).toContain("10% at 5M");
    expect(scaleFeature?.text).toContain("20% at 25M");
    expect(scaleFeature?.text).toContain("30% at 100M");
    // Model: the bracket table agrees, threshold for threshold.
    expect(SCALE_THRESHOLD).toBe(5_000_000);
    expect(VOLUME_BRACKETS.map((b) => b.discountPct)).toEqual([0, 10, 20, 30]);
    expect(VOLUME_BRACKETS[1].minVolume).toBe(5_000_000);
    expect(VOLUME_BRACKETS[2].minVolume).toBe(25_000_000);
    expect(VOLUME_BRACKETS[3].minVolume).toBe(100_000_000);
  });
});

/* ------------------------------------------------------------------ */
/* 7. FAQ — honest answers backed by the repo's real semantics         */
/* ------------------------------------------------------------------ */

describe("FAQ honesty", () => {
  it("ships 4–6 entries, each a real question + answer", () => {
    expect(faqEntries.length).toBeGreaterThanOrEqual(4);
    expect(faqEntries.length).toBeLessThanOrEqual(6);
    for (const entry of faqEntries) {
      expect(entry.question.trim().length).toBeGreaterThan(0);
      expect(entry.answer.trim().length).toBeGreaterThan(40);
    }
  });

  it("answers the work-order questions: requests, modes, limits, price reality", () => {
    const questions = faqEntries.map((e) => e.question.toLowerCase());
    expect(questions.some((q) => q.includes("request"))).toBe(true);
    expect(questions.some((q) => q.includes("test") && q.includes("live"))).toBe(true);
    expect(questions.some((q) => q.includes("limit"))).toBe(true);
    expect(questions.some((q) => q.includes("real"))).toBe(true);
  });

  it("the rate-limit answer matches the REAL semantics (429 + Retry-After, opt-in)", () => {
    const limits = faqEntries.find((e) => e.question.includes("limit"));
    expect(limits).toBeDefined();
    expect(limits?.answer).toContain("429");
    expect(limits?.answer).toContain("Retry-After");
    expect(limits?.answer).toContain("opt-in");
    // The semantics are real — read from the API source, not mirrored.
    const rateLimitSource = read("../../api/src/rate-limit.ts");
    expect(rateLimitSource).toContain("RATE_LIMIT_EXCEEDED");
    expect(rateLimitSource).toContain("Retry-After");
    expect(rateLimitSource).toMatch(/disabled unless configured/i);
  });

  it("the test/live answer mirrors the REAL key model (sk_test_/sk_live_, X-Reckon-Mode)", () => {
    const modes = faqEntries.find(
      (e) => e.question.includes("test") && e.question.includes("live"),
    );
    expect(modes).toBeDefined();
    expect(modes?.answer).toContain("sk_test_");
    expect(modes?.answer).toContain("sk_live_");
    expect(modes?.answer).toContain("X-Reckon-Mode");
    // The key model is real — read from the frozen contracts + API source.
    expect(read("../../../packages/contracts/src/api-platform.ts")).toContain("sk_test_");
    expect(read("../../api/src/test-mode.ts")).toContain("X-Reckon-Mode");
  });

  it("the 'eleven canned scenarios' claim matches the frozen vocabulary", () => {
    // TEST_SCENARIOS, read from the frozen contracts source.
    const contractsSource = read("../../../packages/contracts/src/api-platform.ts");
    const block =
      /export const TEST_SCENARIOS = \[([\s\S]*?)\] as const;/.exec(contractsSource)?.[1] ?? "";
    const scenarios = [...block.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
    expect(scenarios.length).toBe(11);
    // The Developer tier's claim...
    const claim = tier("developer").features.find((f) => f.text.includes("canned scenarios"));
    expect(claim).toBeDefined();
    expect(claim?.text.toLowerCase()).toContain("eleven");
    // ...names only scenarios that exist in the frozen vocabulary.
    for (const named of ["decline", "queue", "switch", "interrupt", "error"]) {
      expect(scenarios).toContain(named);
      expect(claim?.text).toContain(named);
    }
  });
});
