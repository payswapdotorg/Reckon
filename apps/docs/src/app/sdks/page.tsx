import type { Metadata } from "next";
import { CodeBlock } from "@/components/code-block.js";
import { Callout } from "@/components/callout.js";
import { DocsArticle } from "@/components/docs-article.js";
import { DocsTable } from "@/components/docs-table.js";
import { PageHeader } from "@/components/page-header.js";
import { Bullets, P, SectionHeading } from "@/components/prose.js";
import {
  SDKS_HEADINGS,
  SDKS_PHILOSOPHY,
  SDK_FEATURE_ROWS,
  SDK_PY_TARGET,
  SDK_TS_TARGET,
  SDK_TS_TODAY,
} from "@/content/sdks.js";
import { routeMetaFor } from "@/content/route-meta.js";
import { routeMetadata } from "@/lib/site-routes.js";

export const metadata: Metadata = routeMetadata(routeMetaFor("/sdks"));

export default function SdksPage() {
  return (
    <DocsArticle headings={SDKS_HEADINGS}>
      <PageHeader
        eyebrow="SDKs"
        title="TypeScript & Python"
        lede="Two reference SDKs over the frozen Reckon contracts. The TypeScript client is live today; the hardened shape aligned with the API reference pages and the Python client land with S2-004."
        status={{ variant: "target", label: "TS live today · hardening + Python land with S2-004" }}
      />

      <SectionHeading id="philosophy" level={2}>
        Philosophy
      </SectionHeading>
      <Bullets items={SDKS_PHILOSOPHY} />

      <SectionHeading id="typescript" level={2}>
        TypeScript
      </SectionHeading>
      <P text="`@reckon/sdk` (Node 20+, ESM) is the typed host-integration client — the same client the quickstart uses. It exposes the resource groups you saw across these docs: `decisions`, `outcomes`, `plans`, `catalog`, `candidates`, `experiences`, `preferences`, `research`, `agents`, `integrations`." />
      <CodeBlock sample={SDK_TS_TODAY} />
      <P text="The S2-004 target shape adds the hardened-API conveniences documented in the reference pages:" />
      <CodeBlock sample={SDK_TS_TARGET} />

      <SectionHeading id="python" level={2}>
        Python
      </SectionHeading>
      <P text="The Python reference SDK targets the same surface with Pythonic naming (snake_case payloads mapping onto the frozen camelCase contracts)." />
      <CodeBlock sample={SDK_PY_TARGET} />

      <SectionHeading id="feature-matrix" level={2}>
        Feature matrix
      </SectionHeading>
      <DocsTable
        columns={["Capability", "TypeScript", "Python"]}
        rows={SDK_FEATURE_ROWS}
        caption="SDK capability matrix"
      />
      <Callout
        variant="status"
        title="Status — what runs today"
        body={[
          "`@reckon/sdk` ships in this monorepo (`packages/sdk`, W3-002) with the typed client, both-ways contract validation and typed errors. `apiVersion` pinning, `expand`, auto-pagination and `verifyWebhook` follow the S2-001/S2-002 hardening; the Python SDK is new work in S2-004. The samples above document the target shape per those work items.",
        ]}
      />
    </DocsArticle>
  );
}
