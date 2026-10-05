/**
 * Product hero (S1-002, survey §2.2 product-page grammar): breadcrumb back
 * to the home's product grid, eyebrow chip (product name + platform tag),
 * ONE outcome-phrased idea per headline line, sub copy, the mono route tag
 * from products[].routeTag, and the dual CTA. Same breathing room as the
 * home hero, without the mesh — the code artifact below is the visual.
 */
import { CtaRow } from "@/components/marketing/cta-row";
import { ArrowRight } from "@/components/marketing/icons";
import type { ProductPageContent } from "@/lib/product-content";

export function ProductHero({ page }: { page: ProductPageContent }) {
  return (
    <section className="rk-product-hero" aria-labelledby="rk-product-hero-title">
      <div className="rk-container">
        <nav className="rk-product-breadcrumb" aria-label="Breadcrumb">
          <a className="rk-product-breadcrumb-link" href="/#product">
            Products
          </a>
          <span className="rk-product-breadcrumb-sep" aria-hidden="true">
            /
          </span>
          <span aria-current="page">{page.name}</span>
        </nav>

        <p className="rk-product-eyebrow-chip">
          <span className="rk-product-eyebrow-dot" aria-hidden="true" />
          {page.eyebrow}
        </p>
        <h1 id="rk-product-hero-title" className="rk-h1 rk-product-headline">
          {page.headline.map((line) => (
            <span className="rk-hero-line" key={line}>
              {line}
            </span>
          ))}
        </h1>
        <p className="rk-hero-sub rk-product-sub">{page.subheadline}</p>
        <p className="rk-product-route-tag">
          <span className="rk-sr-only">API route: </span>
          {page.routeTag}
        </p>
        <CtaRow />
        <p className="rk-hero-trust">
          {page.microTrust}
          <ArrowRight size={15} className="rk-hero-trust-arrow" />
        </p>
      </div>
    </section>
  );
}
