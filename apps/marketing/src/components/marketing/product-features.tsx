/**
 * Feature sections (S1-002): 3–5 capability blocks per product, each an
 * outcome-phrased headline + one-line body — never a feature list. Mono
 * index markers (01 · 02 · 03) echo the technical-vibrancy system.
 */
import { SectionHeading } from "@/components/marketing/section-heading";
import type { ProductPageContent } from "@/lib/product-content";

export function ProductFeatures({ page }: { page: ProductPageContent }) {
  return (
    <section className="rk-section rk-section-features" aria-labelledby="rk-features-title">
      <div className="rk-container">
        <div id="rk-features-title" className="rk-sr-only">
          {page.name} capabilities
        </div>
        <SectionHeading
          eyebrow="Capabilities"
          title="Built in, not bolted on."
          sub={`Every ${page.name} call carries these guarantees — the outcome first, the mechanics underneath.`}
        />
        <ul className="rk-feature-grid">
          {page.features.map((feature, index) => (
            <li key={feature.headline}>
              <article className="rk-feature-card">
                <span className="rk-feature-index" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="rk-feature-headline">{feature.headline}</h3>
                <p className="rk-feature-body">{feature.body}</p>
              </article>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
