import type { Metadata } from "next";
import { CodeBlock } from "@/components/code-block.js";
import { Callout } from "@/components/callout.js";
import { DocsArticle } from "@/components/docs-article.js";
import { DocsTable } from "@/components/docs-table.js";
import { PageHeader } from "@/components/page-header.js";
import { Bullets, P, SectionHeading } from "@/components/prose.js";
import {
  PAGINATION_FIRST,
  PAGINATION_FIRST_RESPONSE,
  PAGINATION_HEADINGS,
  PAGINATION_NEXT,
  PAGINATION_PARAMS,
  PAGINATION_RULES,
  PAGINATION_SDK_EXAMPLE,
} from "@/content/api-reference/pagination.js";

export const metadata: Metadata = {
  title: "Pagination",
  description:
    "Reckon lists are cursor-paginated: ask with limit, follow next_cursor while has_more is true.",
};

export default function PaginationPage() {
  return (
    <DocsArticle headings={PAGINATION_HEADINGS}>
      <PageHeader
        eyebrow="API reference"
        title="Pagination"
        lede="All list endpoints use cursor pagination: one forward cursor, honest has_more, and pages that stay stable while data grows."
        status={{ variant: "target", label: "Target envelope · lands with S2-001" }}
      />

      <SectionHeading id="cursor-model" level={2}>
        The cursor model
      </SectionHeading>
      <P text="Every list response wraps its records in `data` and tells you whether more exist. There is no offset paging — offsets break under concurrent writes, and Reckon's stores are append-only by design." />
      <DocsTable
        columns={["Parameter", "Meaning"]}
        rows={PAGINATION_PARAMS}
        caption="List parameters"
      />

      <SectionHeading id="example" level={2}>
        Example: walk recent plans
      </SectionHeading>
      <CodeBlock sample={PAGINATION_FIRST} />
      <CodeBlock sample={PAGINATION_FIRST_RESPONSE} />
      <CodeBlock sample={PAGINATION_NEXT} />
      <CodeBlock sample={PAGINATION_SDK_EXAMPLE} />

      <SectionHeading id="rules" level={2}>
        Rules
      </SectionHeading>
      <Bullets items={PAGINATION_RULES} />
      <Callout
        variant="status"
        title="Status — what runs today"
        body={[
          "The list routes already exist in v0.1.0 (`GET /v1/plans?limit=N`, `/v1/agents/bodies?limit=N`, `/v1/research/jobs?limit&state`) with plain-array responses. S2-001 wraps them in the `{ data, has_more, next_cursor }` envelope documented here.",
        ]}
      />
    </DocsArticle>
  );
}
