import type { Metadata } from "next";
import { CodeBlock } from "@/components/code-block.js";
import { Callout } from "@/components/callout.js";
import { DocsArticle } from "@/components/docs-article.js";
import { DocsPager } from "@/components/docs-pager.js";
import { PageHeader } from "@/components/page-header.js";
import { Bullets, P, SectionHeading } from "@/components/prose.js";
import {
  IDEMPOTENCY_BRIDGE,
  IDEMPOTENCY_CONFLICT,
  IDEMPOTENCY_FIRST_CALL,
  IDEMPOTENCY_HEADINGS,
  IDEMPOTENCY_REPLAY_CALL,
  IDEMPOTENCY_SDK_EXAMPLE,
  IDEMPOTENCY_RULES,
} from "@/content/api-reference/idempotency.js";
import { routeMetaFor } from "@/content/route-meta.js";
import { routeMetadata } from "@/lib/site-routes.js";

export const metadata: Metadata = routeMetadata(
  routeMetaFor("/api-reference/idempotent-requests"),
);

export default function IdempotencyPage() {
  return (
    <DocsArticle headings={IDEMPOTENCY_HEADINGS}>
      <PageHeader
        eyebrow="API reference"
        title="Idempotent requests"
        lede="Networks retry. Idempotency keys make retries harmless: the same key plus the same body replays the original response — never a second execution."
        status={{ variant: "target", label: "Target surface · lands with S2-001" }}
      />

      <SectionHeading id="how-it-works" level={2}>
        How it works
      </SectionHeading>
      <P text="Attach an `Idempotency-Key` header to any POST that changes state. Reckon stores the first successful response keyed by `(tenant, route, key)` together with a digest of the request body. Replays look up the key and return the stored response; different bodies under the same key are rejected loudly." />

      <SectionHeading id="rules" level={2}>
        Rules
      </SectionHeading>
      <Bullets items={IDEMPOTENCY_RULES} />

      <SectionHeading id="example" level={2}>
        Example: first call vs replay
      </SectionHeading>
      <CodeBlock sample={IDEMPOTENCY_FIRST_CALL} />
      <CodeBlock sample={IDEMPOTENCY_REPLAY_CALL} />
      <P text="Reuse a key with a **different** body and Reckon refuses — this is a bug in your retry logic, not a recoverable condition:" />
      <CodeBlock sample={IDEMPOTENCY_CONFLICT} />
      <CodeBlock sample={IDEMPOTENCY_SDK_EXAMPLE} />
      <Callout variant="status" title="Status — what runs today" body={IDEMPOTENCY_BRIDGE} />
      <DocsPager currentPath="/api-reference/idempotent-requests" />
    </DocsArticle>
  );
}
