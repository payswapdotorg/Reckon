/**
 * Pricing hero (S1-003) — breadcrumb + eyebrow chip + outcome-phrased
 * headline, in the product-hero grammar. The mono chip slot carries the
 * honesty caveat ("Illustrative pricing · not yet billing-enforced")
 * where product pages carry the route tag — the pricing-status line.
 */
import { pricingHero } from "@/lib/pricing-content";

export function PricingHero() {
  return (
    <section className="rk-product-hero" aria-labelledby="rk-pricing-hero-title">
      <div className="rk-container">
        <nav className="rk-product-breadcrumb" aria-label="Breadcrumb">
          <a className="rk-product-breadcrumb-link" href="/">
            Home
          </a>
          <span className="rk-product-breadcrumb-sep" aria-hidden="true">
            /
          </span>
          <span aria-current="page">Pricing</span>
        </nav>

        <p className="rk-product-eyebrow-chip">
          <span className="rk-product-eyebrow-dot" aria-hidden="true" />
          {pricingHero.eyebrow}
        </p>
        <h1 id="rk-pricing-hero-title" className="rk-h1 rk-product-headline">
          {pricingHero.headline.map((line) => (
            <span className="rk-hero-line" key={line}>
              {line}
            </span>
          ))}
        </h1>
        <p className="rk-hero-sub rk-product-sub">{pricingHero.subheadline}</p>
        <p className="rk-product-route-tag">
          <span className="rk-sr-only">Pricing status: </span>
          {pricingHero.caveatChip}
        </p>
        <p className="rk-hero-trust">{pricingHero.microTrust}</p>
      </div>
    </section>
  );
}
