import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./marketing.css";

import { homeMetadata } from "@/lib/marketing-content";
import { resolveSiteUrl } from "@/lib/site-routes";

/**
 * Root layout (S1-001) — site-wide metadata: the canonical metadataBase
 * (NEXT_PUBLIC_SITE_URL-overridable, S5-001) every og:image/og:url and
 * canonical resolves against, the default title/description (from the
 * home content model), and the Twitter large-image card default. The
 * og:image itself comes from the app/opengraph-image.tsx file convention,
 * which covers every route in this root segment.
 */
export const metadata: Metadata = {
  metadataBase: new URL(resolveSiteUrl()),
  title: homeMetadata.title,
  description: homeMetadata.description,
  keywords: [
    "Reckon",
    "recommendation API",
    "personalization",
    "scheduling",
    "decision engine",
    "analytics",
  ],
  authors: [{ name: "Reckon" }],
  openGraph: {
    title: homeMetadata.title,
    description: homeMetadata.description,
    siteName: "Reckon",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
