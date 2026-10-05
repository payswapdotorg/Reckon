import type { Metadata } from "next";

import { LegalPage } from "@/components/marketing/legal-page";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { privacyDoc } from "@/lib/legal-content";
import { routeMetadata } from "@/lib/site-routes";

/**
 * /privacy (S5-001) — the Privacy Policy surface, rendered from the typed
 * legal content model (src/lib/legal-content.ts) through the shared
 * LegalPage renderer. Template text, pending legal review — stated on the
 * page itself. Linked from the site footer (Company column).
 */

export const metadata: Metadata = routeMetadata({
  ...privacyDoc.metadata,
  path: privacyDoc.path,
});

export default function PrivacyPage() {
  return (
    <div className="rk-root">
      <a className="rk-skip-link" href="#main">
        Skip to content
      </a>

      <SiteHeader />

      <main id="main">
        <LegalPage doc={privacyDoc} />
      </main>

      <SiteFooter />
    </div>
  );
}
