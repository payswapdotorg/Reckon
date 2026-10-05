/**
 * Reckon marketing home (S1-001) — a stripe.com-class product surface.
 *
 * Section grammar (docs/surveys/stripe-com-survey.md §2, in order):
 * live-stat ticker → split-field hero + gradient mesh → product grid →
 * code-first marketing artifact → quantified social proof → final dual
 * CTA band → footer with the four-surface IA.
 */
import "./marketing.css";

import { CtaBand } from "@/components/marketing/cta-band";
import { CodeShowcase } from "@/components/marketing/code-showcase";
import { Hero } from "@/components/marketing/hero";
import { ProductGrid } from "@/components/marketing/product-grid";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { SocialProof } from "@/components/marketing/social-proof";
import { StatTicker } from "@/components/marketing/stat-ticker";

export default function MarketingHome() {
  return (
    <div className="rk-root">
      <a className="rk-skip-link" href="#main">
        Skip to content
      </a>

      <StatTicker />
      <SiteHeader />

      <main id="main">
        <Hero />
        <ProductGrid />
        <CodeShowcase />
        <SocialProof />
        <CtaBand />
      </main>

      <SiteFooter />
    </div>
  );
}
