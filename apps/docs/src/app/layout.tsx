import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { SiteHeader } from "@/components/site-header.js";
import { Sidebar } from "@/components/sidebar.js";
import { DocsFooter } from "@/components/docs-footer.js";
import { resolveSiteUrl } from "@/lib/site-routes.js";

/**
 * Root layout (S1-004) — site-wide metadata: the "%s · Reckon Docs" title
 * template nested routes compose under, and (S5-002) the canonical
 * metadataBase every og:url / og:image and file-convention social card
 * resolves against — NEXT_PUBLIC_SITE_URL-overridable, the one sanctioned
 * env read on this otherwise zero-env surface (see src/lib/site-routes.ts).
 */
export const metadata: Metadata = {
  metadataBase: new URL(resolveSiteUrl()),
  title: {
    default: "Reckon Docs",
    template: "%s · Reckon Docs",
  },
  description:
    "Reckon developer documentation — serve your first recommendation in five minutes, then go deeper on the API reference, webhooks and SDKs.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <div className="docs-root">
          <SiteHeader />
          <div className="docs-body">
            <div className="docs-frame">
              <Sidebar />
              <main id="main" className="docs-main">
                {children}
              </main>
            </div>
          </div>
          <DocsFooter />
        </div>
      </body>
    </html>
  );
}
