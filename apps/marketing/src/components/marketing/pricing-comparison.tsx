/**
 * "Everything included" comparison table (S1-003) — the features × tiers
 * matrix, stripe.com pricing-page grammar. Rows carry docs deep-links
 * into the REAL docs portal routes; cells are honestly marked: a check
 * for what ships, a "dashboard" tag for operator-dashboard surfaces, a
 * "roadmap" tag for what does not exist yet — never a fake checkmark.
 *
 * Responsive: the matrix keeps its table semantics and scrolls
 * horizontally inside a focusable region on narrow viewports (tabIndex 0
 * + role="region" so keyboard users can scroll it too).
 */
import { ArrowUpRight, CheckIcon } from "@/components/marketing/icons";
import { SectionHeading } from "@/components/marketing/section-heading";
import {
  comparisonRows,
  comparisonSection,
  pricingTiers,
  type ComparisonCell,
} from "@/lib/pricing-content";

function ComparisonCellView({ cell }: { cell: ComparisonCell }) {
  switch (cell.kind) {
    case "included":
      return (
        <span className="rk-compare-cell rk-compare-yes">
          <CheckIcon size={16} />
          <span className="rk-sr-only">Included</span>
        </span>
      );
    case "dashboard":
      return (
        <span className="rk-compare-cell rk-compare-yes">
          <CheckIcon size={16} />
          <span className="rk-compare-tag">dashboard</span>
          <span className="rk-sr-only">Included, in the dashboard</span>
        </span>
      );
    case "roadmap":
      return (
        <span className="rk-compare-cell rk-compare-roadmap">
          <span className="rk-compare-tag">roadmap</span>
          <span className="rk-sr-only">Planned, not shipping yet</span>
        </span>
      );
    case "custom":
      return (
        <span className="rk-compare-cell rk-compare-custom">
          Custom
          <span className="rk-sr-only"> terms</span>
        </span>
      );
    case "none":
      return (
        <span className="rk-compare-cell rk-compare-none" aria-hidden="true">
          —
        </span>
      );
  }
}

export function PricingComparison() {
  return (
    <section className="rk-section" id="compare" aria-labelledby="rk-compare-title">
      <div className="rk-container">
        <SectionHeading
          center
          eyebrow={comparisonSection.eyebrow}
          title={comparisonSection.title}
          sub={comparisonSection.sub}
        />

        <div className="rk-compare-wrap" tabIndex={0} role="region" aria-label={comparisonSection.ariaLabel}>
          <table className="rk-compare">
            <caption className="rk-sr-only">{comparisonSection.ariaLabel}</caption>
            <thead>
              <tr>
                <th scope="col" className="rk-compare-head-feature">
                  Feature
                </th>
                {pricingTiers.map((tier) => (
                  <th scope="col" className="rk-compare-head-tier" key={tier.id}>
                    {tier.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((row) => (
                <tr key={row.id}>
                  <th scope="row" className="rk-compare-feature">
                    <span className="rk-compare-feature-label">{row.label}</span>
                    <span className="rk-compare-feature-desc">{row.description}</span>
                    {row.docsHref ? (
                      <a className="rk-compare-docs-link" href={row.docsHref}>
                        Docs
                        <ArrowUpRight size={13} />
                      </a>
                    ) : null}
                  </th>
                  {pricingTiers.map((tier) => (
                    <td className="rk-compare-cell-slot" key={tier.id}>
                      <ComparisonCellView cell={row.cells[tier.id]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="rk-compare-footnote">{comparisonSection.footnote}</p>
      </div>
    </section>
  );
}
