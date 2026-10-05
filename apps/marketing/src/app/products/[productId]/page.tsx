import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CtaBand } from "@/components/marketing/cta-band";
import { CodeShowcase } from "@/components/marketing/code-showcase";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { ProductDocsLinks } from "@/components/marketing/product-docs-links";
import { ProductFeatures } from "@/components/marketing/product-features";
import { ProductHero } from "@/components/marketing/product-hero";
import { ProductHowItWorks } from "@/components/marketing/product-how-it-works";
import { ProductRelated } from "@/components/marketing/product-related";
import {
  PRODUCT_PAGE_IDS,
  productPages,
  type ProductPageId,
} from "@/lib/product-content";
import { routeMetadata } from "@/lib/site-routes";

/**
 * Reckon product pages (S1-002) — /products/<id>, one per product, all
 * prerendered statically from the typed content module.
 *
 * Section grammar (stripe.com product-page analog, work item S1-002):
 * breadcrumb + product hero → code-first artifact (a REAL request/
 * response pair for this product's route) → capability blocks →
 * how-it-works strip → related products band → docs deep-links →
 * final dual-CTA band → footer.
 *
 * (marketing.css is imported once by the root layout — see app/layout.tsx.)
 */

interface ProductPageProps {
  params: Promise<{ productId: string }>;
}

/** Static routes only — the four product ids from the content module. */
export const dynamicParams = false;

export function generateStaticParams(): Array<{ productId: ProductPageId }> {
  return PRODUCT_PAGE_IDS.map((productId) => ({ productId }));
}

function resolvePage(productId: string): ProductPageId | null {
  return (PRODUCT_PAGE_IDS as readonly string[]).includes(productId)
    ? (productId as ProductPageId)
    : null;
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { productId } = await params;
  const id = resolvePage(productId);
  if (id === null) return {};
  const page = productPages[id];
  return routeMetadata({
    ...page.metadata,
    path: `/products/${id}`,
  });
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { productId } = await params;
  const id = resolvePage(productId);
  if (id === null) notFound();
  const page = productPages[id];

  return (
    <div className="rk-root">
      <a className="rk-skip-link" href="#main">
        Skip to content
      </a>

      <SiteHeader />

      <main id="main">
        <ProductHero page={page} />
        <CodeShowcase artifact={page.code} panelId="product" sectionId="code" />
        <ProductFeatures page={page} />
        <ProductHowItWorks page={page} />
        <ProductRelated current={id} />
        <ProductDocsLinks page={page} />
        <CtaBand />
      </main>

      <SiteFooter />
    </div>
  );
}
