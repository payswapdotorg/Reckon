import type { Metadata } from "next";
import { CodeBlock } from "@/components/code-block.js";
import { DocsArticle } from "@/components/docs-article.js";
import { DocsPager } from "@/components/docs-pager.js";
import { DocsTable } from "@/components/docs-table.js";
import { PageHeader } from "@/components/page-header.js";
import { P, SectionHeading } from "@/components/prose.js";
import {
  CHANGELOG_ROWS,
  VERSIONING_EXAMPLE,
  VERSIONING_HEADINGS,
  VERSIONING_ROWS,
  VERSIONING_SDK_EXAMPLE,
} from "@/content/api-reference/versioning.js";
import { routeMetaFor } from "@/content/route-meta.js";
import { routeMetadata } from "@/lib/site-routes.js";

export const metadata: Metadata = routeMetadata(routeMetaFor("/api-reference/versioning"));

export default function VersioningPage() {
  return (
    <DocsArticle headings={VERSIONING_HEADINGS}>
      <PageHeader
        eyebrow="API reference"
        title="Versioning"
        lede="Reckon versions the API surface explicitly. You pin a version per request (or per account), and new versions never apply silently."
        status={{ variant: "target", label: "Target surface · lands with S2-001" }}
      />

      <SectionHeading id="pinning-a-version" level={2}>
        Pinning a version
      </SectionHeading>
      <P text="API versions are date-shaped. Send `Reckon-Version` with any request to evaluate it against a specific version; omit it and your account's pinned default applies. This makes upgrades a one-line change you can test on a single request before rolling out." />
      <CodeBlock sample={VERSIONING_EXAMPLE} />
      <CodeBlock sample={VERSIONING_SDK_EXAMPLE} />

      <SectionHeading id="what-a-version-covers" level={2}>
        What a version covers
      </SectionHeading>
      <DocsTable
        columns={["Guarantee", "Meaning"]}
        rows={VERSIONING_ROWS}
        caption="Versioning guarantees"
      />

      <SectionHeading id="example" level={2}>
        Example
      </SectionHeading>
      <P text="A request pinned to a version behaves identically no matter when it is sent — the same combination of routing, envelope shape and error taxonomy, for the life of the version." />

      <SectionHeading id="changelog" level={2}>
        Changelog
      </SectionHeading>
      <DocsTable
        columns={["Version", "Change"]}
        rows={CHANGELOG_ROWS}
        caption="API version changelog"
      />
      <DocsPager currentPath="/api-reference/versioning" />
    </DocsArticle>
  );
}
