import type { Metadata } from "next";
import { CodeBlock } from "@/components/code-block.js";
import { DocsArticle } from "@/components/docs-article.js";
import { PageHeader } from "@/components/page-header.js";
import { Bullets, P, SectionHeading } from "@/components/prose.js";
import {
  EXPAND_HEADINGS,
  EXPAND_REQUEST,
  EXPAND_RESPONSE,
  EXPAND_RULES,
  EXPAND_SDK_EXAMPLE,
} from "@/content/api-reference/expand.js";

export const metadata: Metadata = {
  title: "Expanding responses",
  description:
    "Inline referenced objects on demand with ?expand[] — the decision that references a catalog item can come back carrying the item itself.",
};

export default function ExpandingResponsesPage() {
  return (
    <DocsArticle headings={EXPAND_HEADINGS}>
      <PageHeader
        eyebrow="API reference"
        title="Expanding responses"
        lede="Reckon responses reference related objects by id. When you need the object itself, ask for it inline with ?expand[] — the same request, one round trip richer."
        status={{ variant: "target", label: "Target surface · lands with S2-001" }}
      />

      <SectionHeading id="how-expansion-works" level={2}>
        How expansion works
      </SectionHeading>
      <P text="Default responses stay lean and contract-exact — an `itemId` reference, not the item. Adding `?expand[]=selectedExperience.item` to a request inlines the referenced `reckon.catalog-item` at the path you named. Expanded objects are the real frozen payloads, not summaries." />

      <SectionHeading id="example" level={2}>
        Example: expand the selected experience&apos;s item
      </SectionHeading>
      <CodeBlock sample={EXPAND_REQUEST} />
      <CodeBlock sample={EXPAND_RESPONSE} />

      <SectionHeading id="rules" level={2}>
        Rules &amp; performance
      </SectionHeading>
      <Bullets items={EXPAND_RULES} />
      <CodeBlock sample={EXPAND_SDK_EXAMPLE} />
    </DocsArticle>
  );
}
