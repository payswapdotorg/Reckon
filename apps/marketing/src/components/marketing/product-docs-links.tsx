/**
 * Docs deep-links band (S1-002): "Read the docs" links INTO the real docs
 * portal routes (apps/docs — docs.reckon.dev): quickstart, core concepts,
 * the API reference family, the webhooks guide. External links open in a
 * new tab and disclose the destination in their accessible name.
 */
import { ArrowUpRight } from "@/components/marketing/icons";
import { SectionHeading } from "@/components/marketing/section-heading";
import { DOCS_BASE_URL, type ProductPageContent } from "@/lib/product-content";

/** Display origin for link labels — kept honest and short. */
const DOCS_ORIGIN_LABEL = "docs.reckon.dev";

export function ProductDocsLinks({ page }: { page: ProductPageContent }) {
  return (
    <section className="rk-section rk-section-docs" aria-labelledby="rk-docs-title">
      <div className="rk-container">
        <div id="rk-docs-title" className="rk-sr-only">
          {page.name} documentation
        </div>
        <SectionHeading
          eyebrow="Developers"
          title="Read the docs. They run."
          sub="Every claim on this page has a reference page in the docs portal — the same contracts, runnable."
        />
        <ul className="rk-docs-links">
          {page.docsLinks.map((link) => (
            <li key={link.href}>
              <a
                className="rk-docs-link"
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${link.label} — opens the ${DOCS_ORIGIN_LABEL} docs portal in a new tab`}
              >
                <span className="rk-docs-link-copy">
                  <span className="rk-docs-link-label">{link.label}</span>
                  <span className="rk-docs-link-description">{link.description}</span>
                </span>
                <span className="rk-docs-link-arrow" aria-hidden="true">
                  <ArrowUpRight size={17} />
                </span>
              </a>
            </li>
          ))}
        </ul>
        <p className="rk-docs-portal-line">
          <a
            className="rk-docs-portal-link"
            href={DOCS_BASE_URL + "/"}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open the full documentation portal
            <ArrowUpRight size={15} />
          </a>
        </p>
      </div>
    </section>
  );
}
