/**
 * Product grid (survey §2.3): four products, each card carrying a name,
 * ONE outcome-phrased line (never a feature list), a route tag grounded
 * in the real API, and a learn-more link. Dual CTA closes the section.
 */
import { CtaRow } from "@/components/marketing/cta-row";
import { ArrowRight, productIcons } from "@/components/marketing/icons";
import { SectionHeading } from "@/components/marketing/section-heading";
import { productSection, products } from "@/lib/marketing-content";

export function ProductGrid() {
  return (
    <section className="rk-section rk-section-products" id="product" aria-labelledby="rk-products-title">
      <div className="rk-container">
        <div id="rk-products-title" className="rk-sr-only">
          Products
        </div>
        <SectionHeading
          eyebrow={productSection.eyebrow}
          title={productSection.title}
          sub={productSection.sub}
        />

        <ul className="rk-product-grid">
          {products.map((product) => {
            const Icon = productIcons[product.icon];
            return (
              <li key={product.id}>
                <article className="rk-product-card">
                  <span className="rk-product-icon">
                    <Icon size={22} />
                  </span>
                  <h3 className="rk-product-name">{product.name}</h3>
                  <p className="rk-product-outcome">{product.outcome}</p>
                  <span className="rk-product-route">{product.routeTag}</span>
                  <a
                    className="rk-product-link"
                    href={product.href}
                    aria-label={`${product.name} product page`}
                  >
                    Learn more
                    <ArrowRight size={15} />
                  </a>
                </article>
              </li>
            );
          })}
        </ul>

        <CtaRow compact />
      </div>
    </section>
  );
}
