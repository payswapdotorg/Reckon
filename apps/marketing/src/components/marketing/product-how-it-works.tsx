/**
 * How-it-works strip (S1-002): exactly three steps — integrate → decide →
 * observe — mapped to the product's actual flow. Mono step labels, a
 * connecting rule, and the same generous rhythm as the rest of the page.
 */
import { SectionHeading } from "@/components/marketing/section-heading";
import type { ProductPageContent } from "@/lib/product-content";

export function ProductHowItWorks({ page }: { page: ProductPageContent }) {
  return (
    <section className="rk-section rk-section-steps" aria-labelledby="rk-steps-title">
      <div className="rk-container">
        <div id="rk-steps-title" className="rk-sr-only">
          How {page.name} works
        </div>
        <SectionHeading
          eyebrow="How it works"
          title={`From first call to closed loop.`}
          sub={`Three steps — integrate, decide, observe — mapped to ${page.name}'s actual flow.`}
        />
        <ol className="rk-steps">
          {page.steps.map((step, index) => (
            <li className="rk-step" key={step.label}>
              <span className="rk-step-index" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="rk-step-label">{step.label}</span>
              <h3 className="rk-step-title">{step.title}</h3>
              <p className="rk-step-body">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
