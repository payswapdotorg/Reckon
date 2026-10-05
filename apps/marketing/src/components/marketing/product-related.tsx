/**
 * Related-products band (S1-002): the other three products, reusing the
 * home's product-card pattern (rk-product-grid / rk-product-card) — same
 * design system, no fork. Cross-links between product pages and back to
 * the home's grid.
 */
import { ArrowRight, productIcons } from "@/components/marketing/icons";
import { SectionHeading } from "@/components/marketing/section-heading";
import { products } from "@/lib/marketing-content";
import { relatedProducts, type ProductPageId } from "@/lib/product-content";

export function ProductRelated({ current }: { current: ProductPageId }) {
  const related = relatedProducts(current)
    .map((id) => products.find((product) => product.id === id))
    .filter((product): product is (typeof products)[number] => product !== undefined);

  return (
    <section className="rk-section rk-section-related" aria-labelledby="rk-related-title">
      <div className="rk-container">
        <div id="rk-related-title" className="rk-sr-only">
          Related products
        </div>
        <SectionHeading
          eyebrow="The platform"
          title="Three more primitives, one engine."
          sub="Feeds, digests, queues, and notifications all ask Reckon what comes next."
        />
        <ul className="rk-product-grid">
          {related.map((product) => {
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
        <p className="rk-related-back">
          <a className="rk-related-back-link" href="/#product">
            Compare all four products
            <ArrowRight size={15} />
          </a>
        </p>
      </div>
    </section>
  );
}
