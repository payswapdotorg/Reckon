/**
 * Split-field hero (survey §2.2): outcome-phrased headline left (~42%),
 * gradient-mesh visual right, 1.5–2× breathing whitespace. One idea per
 * headline line.
 */
import { CtaRow } from "@/components/marketing/cta-row";
import { ArrowRight } from "@/components/marketing/icons";
import { MeshVisual } from "@/components/marketing/mesh-visual";
import { hero } from "@/lib/marketing-content";

export function Hero() {
  return (
    <section className="rk-hero" aria-labelledby="rk-hero-title">
      <div className="rk-container rk-hero-grid">
        <div className="rk-hero-copy">
          <h1 id="rk-hero-title" className="rk-h1">
            {hero.headline.map((line) => (
              <span className="rk-hero-line" key={line}>
                {line}
              </span>
            ))}
          </h1>
          <p className="rk-hero-sub">{hero.subheadline}</p>
          <CtaRow />
          <p className="rk-hero-trust">
            {hero.microTrust}
            <ArrowRight size={15} className="rk-hero-trust-arrow" />
          </p>
        </div>
        <div className="rk-hero-visual">
          <MeshVisual />
        </div>
      </div>
    </section>
  );
}
