/**
 * Legal page body (S5-001) — the shared renderer for /terms and /privacy.
 *
 * Grammar (the product/pricing hero grammar, legal register): breadcrumb
 * → eyebrow chip → H1 → the honesty status line (the mono route-tag slot
 * carries the template-pending-review disclosure) → intro → prose
 * sections in a narrow reading column → last-updated + contact footer.
 */
import type { LegalDoc } from "@/lib/legal-content";

export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <>
      <section className="rk-product-hero" aria-labelledby="rk-legal-title">
        <div className="rk-container">
          <nav className="rk-product-breadcrumb" aria-label="Breadcrumb">
            <a className="rk-product-breadcrumb-link" href="/">
              Home
            </a>
            <span className="rk-product-breadcrumb-sep" aria-hidden="true">
              /
            </span>
            <span aria-current="page">{doc.title}</span>
          </nav>

          <p className="rk-product-eyebrow-chip">
            <span className="rk-product-eyebrow-dot" aria-hidden="true" />
            {doc.eyebrow}
          </p>
          <h1 id="rk-legal-title" className="rk-h1 rk-product-headline">
            {doc.title}
          </h1>
          <p className="rk-hero-sub rk-product-sub">{doc.intro}</p>
          <p className="rk-product-route-tag">
            <span className="rk-sr-only">Status: </span>
            {doc.statusChip}
          </p>
        </div>
      </section>

      <section className="rk-section rk-legal-body" aria-label={`${doc.title} — sections`}>
        <div className="rk-container rk-legal-column">
          {doc.sections.map((section, index) => (
            <article className="rk-legal-section" key={section.heading} aria-labelledby={`rk-legal-s${index}`}>
              <h2 className="rk-legal-heading" id={`rk-legal-s${index}`}>
                {section.heading}
              </h2>
              {section.paragraphs.map((paragraph, pIndex) => (
                <p className="rk-legal-paragraph" key={pIndex}>
                  {paragraph}
                </p>
              ))}
            </article>
          ))}

          <footer className="rk-legal-meta">
            <p className="rk-legal-updated">
              Last updated <time>{doc.lastUpdated}</time> · {doc.statusChip}
            </p>
            <p className="rk-legal-contact">
              Questions:{" "}
              <a className="rk-legal-contact-link" href={doc.contact.href}>
                {doc.contact.label}
              </a>
            </p>
          </footer>
        </div>
      </section>
    </>
  );
}
