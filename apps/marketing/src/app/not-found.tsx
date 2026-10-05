import type { Metadata } from "next";

import { ArrowRight } from "@/components/marketing/icons";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";

/**
 * 404 (S5-001) — the not-found surface in the site's grammar: an honest
 * apology (outcome-phrased, no cutesy blame), the "take me home" primary
 * CTA, and pricing as the secondary way out. Renders inside the root
 * layout, so it inherits the site-wide metadata + the /opengraph-image
 * card; only the title is overridden here.
 */

export const metadata: Metadata = {
  title: "Page not found — Reckon",
};

export default function NotFound() {
  return (
    <div className="rk-root">
      <a className="rk-skip-link" href="#main">
        Skip to content
      </a>

      <SiteHeader />

      <main id="main">
        <section className="rk-product-hero rk-notfound" aria-labelledby="rk-notfound-title">
          <div className="rk-container">
            <p className="rk-product-eyebrow-chip">
              <span className="rk-product-eyebrow-dot" aria-hidden="true" />
              404
            </p>
            <h1 id="rk-notfound-title" className="rk-h1 rk-product-headline">
              <span className="rk-hero-line">This page isn't part</span>
              <span className="rk-hero-line">of the plan.</span>
            </h1>
            <p className="rk-hero-sub rk-product-sub">
              Sorry — the address you asked for doesn't exist on this site. It may have moved, or it
              may never have shipped. Nothing you did wrong; let's get you back to something real.
            </p>
            <p className="rk-product-route-tag">
              <span className="rk-sr-only">Status: </span>
              Not found · no decision was made about this route
            </p>

            <div className="rk-cta-row rk-notfound-ctas">
              <a className="rk-btn rk-btn-primary rk-btn-lg" href="/">
                Take me home
                <ArrowRight size={18} />
              </a>
              <a className="rk-btn rk-btn-secondary rk-btn-lg" href="/pricing">
                See pricing
                <ArrowRight size={18} />
              </a>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
