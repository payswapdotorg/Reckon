import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { SiteHeader } from "@/components/site-header.js";
import { Sidebar } from "@/components/sidebar.js";
import { DocsFooter } from "@/components/docs-footer.js";

export const metadata: Metadata = {
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
