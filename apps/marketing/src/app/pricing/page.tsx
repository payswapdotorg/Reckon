import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing — Reckon",
  description: "Reckon pricing (placeholder — the full pricing page lands with S1-003).",
};

/**
 * S1-003 placeholder — an honest stub, not the delivered pricing page.
 * The real page (per-1k-request tiers, volume calculator, "everything
 * included" comparison table, enterprise track) is work item S1-003.
 */
export default function PricingPlaceholder() {
  return (
    <div className="rk-root" style={{ minHeight: "100vh" }}>
      <main id="main" style={{ maxWidth: 720, margin: "0 auto", padding: "96px 24px" }}>
        <h1 style={{ fontSize: 40, letterSpacing: -1, margin: "0 0 12px" }}>Pricing</h1>
        <p style={{ opacity: 0.75, lineHeight: 1.6 }}>
          The full Reckon pricing page — per-1k-request tiers, a volume calculator,
          an &ldquo;everything included&rdquo; comparison table, and the enterprise track —
          is coming with work item S1-003.
        </p>
        <p style={{ opacity: 0.75, lineHeight: 1.6 }}>
          Until then, the product detail lives on the{" "}
          <a href="/" style={{ textDecoration: "underline" }}>
            marketing home
          </a>
          .
        </p>
      </main>
    </div>
  );
}
