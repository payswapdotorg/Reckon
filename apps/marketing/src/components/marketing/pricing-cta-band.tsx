/**
 * Pricing final CTA band (S1-003) — the pricing page's own dual-CTA
 * moment, in the cta-band grammar. Unlike the site-wide band (whose
 * "Start now" routes to /pricing), the pricing page converts to the
 * self-serve track DIRECTLY: "Start in test mode" deep-links the docs
 * quickstart (which runs on an sk_test_ key), "Contact sales" stays the
 * enterprise mailto.
 */
import { ArrowRight } from "@/components/marketing/icons";
import { pricingFinalCta } from "@/lib/pricing-content";

export function PricingCtaBand() {
  return (
    <section className="rk-section rk-section-cta" id="cta" aria-labelledby="rk-pricing-cta-title">
      <div className="rk-container">
        <div className="rk-cta-band">
          <div className="rk-cta-band-glow" aria-hidden="true" />
          <h2 className="rk-h2 rk-cta-band-title" id="rk-pricing-cta-title">
            {pricingFinalCta.title}
          </h2>
          <p className="rk-cta-band-sub">{pricingFinalCta.sub}</p>
          <div className="rk-cta-row rk-cta-row-center">
            <a className="rk-btn rk-btn-primary rk-btn-lg" href={pricingFinalCta.primaryCta.href}>
              {pricingFinalCta.primaryCta.label}
              <ArrowRight size={18} />
            </a>
            <a className="rk-btn rk-btn-secondary rk-btn-lg" href={pricingFinalCta.secondaryCta.href}>
              {pricingFinalCta.secondaryCta.label}
              <ArrowRight size={18} />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
