import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./marketing.css";

export const metadata: Metadata = {
  title: "Reckon — Recommendation infrastructure for every product",
  description:
    "Reckon decides what to show, say, and send next — one API call, every surface, measured end-to-end. The decision layer for feeds, digests, queues, and notifications.",
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
    title: "Reckon — Recommendation infrastructure for every product",
    description:
      "One API call decides what to show, say, and send next — every surface, measured end-to-end.",
    siteName: "Reckon",
    type: "website",
  },
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
