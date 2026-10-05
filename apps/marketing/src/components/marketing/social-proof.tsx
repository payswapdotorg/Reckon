/**
 * Quantified social proof (survey §2.5): a muted wordmark row plus three
 * case cards in the "<Company> lifted X% with Reckon" pattern. Fictional
 * but plausible B2B names — no real trademarks. Dual CTA tail.
 */
import { CtaRow } from "@/components/marketing/cta-row";
import { SectionHeading } from "@/components/marketing/section-heading";
import { caseStudies, proofLogos, proofSection } from "@/lib/marketing-content";

export function SocialProof() {
  return (
    <section className="rk-section rk-section-proof" id="proof" aria-labelledby="rk-proof-title">
      <div className="rk-container">
        <div id="rk-proof-title" className="rk-sr-only">
          Customer proof
        </div>
        <SectionHeading
          eyebrow={proofSection.eyebrow}
          title={proofSection.title}
          sub={proofSection.sub}
        />

        <ul className="rk-logo-row" aria-label="Companies building with Reckon (illustrative)">
          {proofLogos.map((name) => (
            <li className="rk-logo-word" key={name}>
              {name}
            </li>
          ))}
        </ul>

        <ul className="rk-case-grid">
          {caseStudies.map((study) => (
            <li key={study.company}>
              <article className="rk-case-card" aria-labelledby={`rk-case-${study.company.replace(/\s+/g, "-").toLowerCase()}`}>
                <div className="rk-case-metric">
                  <span className="rk-case-metric-value">{study.metric}</span>
                  <span className="rk-case-metric-label">{study.metricLabel}</span>
                </div>
                <h3 className="rk-case-headline" id={`rk-case-${study.company.replace(/\s+/g, "-").toLowerCase()}`}>
                  {study.headline}
                </h3>
                <blockquote className="rk-case-quote">
                  <p>“{study.quote}”</p>
                  <footer>
                    <span className="rk-case-person">{study.person}</span>
                    <span className="rk-case-role">{study.role}</span>
                  </footer>
                </blockquote>
              </article>
            </li>
          ))}
        </ul>

        <CtaRow compact />
      </div>
    </section>
  );
}
