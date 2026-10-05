/**
 * Final CTA band — the last dual-CTA moment before the footer, with a
 * soft accent radial glow behind near-black glass.
 */
import { ArrowRight } from "@/components/marketing/icons";
import { finalCta } from "@/lib/marketing-content";

export function CtaBand() {
  return (
    <section className="rk-section rk-section-cta" id="cta" aria-labelledby="rk-cta-title">
      <div className="rk-container">
        <div className="rk-cta-band">
          <div className="rk-cta-band-glow" aria-hidden="true" />
          <h2 className="rk-h2 rk-cta-band-title" id="rk-cta-title">
            {finalCta.title}
          </h2>
          <p className="rk-cta-band-sub">{finalCta.sub}</p>
          <div className="rk-cta-row rk-cta-row-center">
            <a className="rk-btn rk-btn-primary rk-btn-lg" href={finalCta.primaryCta.href}>
              {finalCta.primaryCta.label}
              <ArrowRight size={18} />
            </a>
            <a className="rk-btn rk-btn-secondary rk-btn-lg" href={finalCta.secondaryCta.href}>
              {finalCta.secondaryCta.label}
              <ArrowRight size={18} />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
