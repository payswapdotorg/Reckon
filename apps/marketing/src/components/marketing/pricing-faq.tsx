/**
 * Pricing FAQ (S1-003) — 4–6 honest questions in native <details>
 * accordions (dependency-free, keyboard-accessible, JS-optional). The
 * answers follow the repo's ACTUAL semantics: what a request is, test vs
 * live mode per the S2-003 key model, typed 429s with Retry-After at
 * limits, and the plain statement that billing does not exist yet.
 */
import { SectionHeading } from "@/components/marketing/section-heading";
import { faqEntries, faqSection } from "@/lib/pricing-content";

export function PricingFaq() {
  return (
    <section className="rk-section" id="faq" aria-labelledby="rk-faq-title">
      <div className="rk-container rk-faq-container">
        <SectionHeading
          center
          eyebrow={faqSection.eyebrow}
          title={faqSection.title}
          sub={faqSection.sub}
        />

        <div className="rk-faq-list">
          {faqEntries.map((entry, index) => (
            <details className="rk-faq-item" key={entry.question} open={index === 0}>
              <summary className="rk-faq-q">
                <span>{entry.question}</span>
                <span className="rk-faq-q-marker" aria-hidden="true" />
              </summary>
              <p className="rk-faq-a">{entry.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
