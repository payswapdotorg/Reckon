/**
 * Pricing tiers (S1-003) — the four per-1k-request tier cards
 * (Developer / Standard / Scale / Enterprise), stripe.com pricing-page
 * grammar: big price figure, unit line, audience descriptor, honestly
 * marked feature bullets, one CTA per card. The Standard card carries
 * the accent treatment; every priced card repeats the illustrative
 * caveat so no figure ever appears unlabeled.
 */
import { ArrowRight, CheckIcon } from "@/components/marketing/icons";
import { SectionHeading } from "@/components/marketing/section-heading";
import { pricingTiers, tiersFootnote, tiersSection } from "@/lib/pricing-content";

export function PricingTiers() {
  return (
    <section className="rk-section" id="tiers" aria-labelledby="rk-tiers-title">
      <div className="rk-container">
        <SectionHeading
          center
          eyebrow={tiersSection.eyebrow}
          title={tiersSection.title}
          sub={tiersSection.sub}
        />

        <div className="rk-tier-grid">
          {pricingTiers.map((tier) => {
            const accent = tier.id === "standard";
            return (
              <article
                key={tier.id}
                className={accent ? "rk-tier-card rk-tier-card-accent" : "rk-tier-card"}
                aria-labelledby={`rk-tier-${tier.id}`}
              >
                {tier.badge ? <p className="rk-tier-chip">{tier.badge}</p> : null}

                <h3 className="rk-tier-name" id={`rk-tier-${tier.id}`}>
                  {tier.name}
                </h3>
                <p className="rk-tier-price">{tier.priceLine}</p>
                <p className="rk-tier-unit">{tier.priceUnit}</p>
                <p className="rk-tier-desc">{tier.descriptor}</p>

                <ul className="rk-tier-features">
                  {tier.features.map((feature) => (
                    <li className="rk-tier-feature" key={feature.text}>
                      <CheckIcon size={15} className="rk-tier-feature-check" />
                      <span>
                        {feature.text}
                        {feature.status === "dashboard" ? (
                          <span className="rk-tier-mark rk-tier-mark-dashboard">dashboard</span>
                        ) : null}
                        {feature.status === "roadmap" ? (
                          <span className="rk-tier-mark rk-tier-mark-roadmap">roadmap</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="rk-tier-cta">
                  <a
                    className={accent ? "rk-btn rk-btn-primary" : "rk-btn rk-btn-secondary"}
                    href={tier.cta.href}
                  >
                    {tier.cta.label}
                    <ArrowRight size={16} />
                  </a>
                </div>

                {tier.footnote ? <p className="rk-tier-note">{tier.footnote}</p> : null}
              </article>
            );
          })}
        </div>

        <p className="rk-tier-grid-note">{tiersFootnote}</p>
      </div>
    </section>
  );
}
