import type { Metadata } from "next";

import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { PricingCtaBand } from "@/components/marketing/pricing-cta-band";
import { PricingComparison } from "@/components/marketing/pricing-comparison";
import { PricingFaq } from "@/components/marketing/pricing-faq";
import { PricingHero } from "@/components/marketing/pricing-hero";
import { PricingTiers } from "@/components/marketing/pricing-tiers";
import { VolumeCalculator } from "@/components/marketing/volume-calculator";
import { pricingMetadata } from "@/lib/pricing-content";

/**
 * Reckon pricing page (S1-003) — the per-1k-request pricing surface in
 * the stripe.com pricing grammar (docs/surveys/stripe-com-survey.md §2):
 *
 *   pricing hero (with the illustrative-pricing caveat chip) →
 *   per-1k-request tier cards → interactive volume calculator →
 *   "everything included" comparison table → honest FAQ → dual CTA
 *   (docs quickstart / test mode + contact sales) → footer.
 *
 * Laws: every figure is labeled illustrative (billing does not exist);
 * every feature in the matrix maps to a real repo surface, marked
 * dashboard/roadmap where honest; static prerender from typed content —
 * no backend calls, no env vars (marketing.css is imported once by the
 * root layout — see app/layout.tsx).
 */

export const metadata: Metadata = {
  title: pricingMetadata.title,
  description: pricingMetadata.description,
  openGraph: {
    title: pricingMetadata.title,
    description: pricingMetadata.description,
    siteName: "Reckon",
    type: "website",
  },
};

export default function PricingPage() {
  return (
    <div className="rk-root">
      <a className="rk-skip-link" href="#main">
        Skip to content
      </a>

      <SiteHeader />

      <main id="main">
        <PricingHero />
        <PricingTiers />
        <VolumeCalculator />
        <PricingComparison />
        <PricingFaq />
        <PricingCtaBand />
      </main>

      <SiteFooter />
    </div>
  );
}
