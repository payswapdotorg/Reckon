import type { Metadata } from "next";
import { CodeBlock } from "@/components/code-block.js";
import { Callout } from "@/components/callout.js";
import { DocsArticle } from "@/components/docs-article.js";
import { DocsTable } from "@/components/docs-table.js";
import { PageHeader } from "@/components/page-header.js";
import { Bullets, P, SectionHeading } from "@/components/prose.js";
import {
  AUTH_CURL,
  AUTH_ERROR_EXAMPLE,
  AUTH_HEADINGS,
  AUTH_STATUS,
  KEY_MODEL_ROWS,
  KEY_SAFETY_BULLETS,
  SCOPES_ROWS,
} from "@/content/api-reference/authentication.js";

export const metadata: Metadata = {
  title: "Authentication",
  description:
    "Reckon API keys: secret sk_ keys for the full API, publishable pk_ keys for browser-safe streaming, route scopes, and key safety.",
};

export default function AuthenticationPage() {
  return (
    <DocsArticle headings={AUTH_HEADINGS}>
      <PageHeader
        eyebrow="API reference"
        title="Authentication"
        lede="Every API call is authenticated with a Bearer API key. Keys are scoped to one tenant and a set of routes — a key can never read another tenant's data."
        status={AUTH_STATUS}
      />

      <SectionHeading id="key-model" level={2}>
        Key model
      </SectionHeading>
      <P text="Reckon uses a two-family key model. Secret keys belong on your server; publishable keys are safe to embed where the world can read them because they cannot write and cannot cross tenants." />
      <DocsTable
        columns={["Key", "Family", "Powers"]}
        rows={KEY_MODEL_ROWS}
        caption="API key families"
      />
      <Callout
        variant="note"
        title="Test mode"
        body={[
          "`sk_test_` / `pk_test_` keys operate against test mode: canned scenarios, no live learning, no billing. Live and test keys are never interchangeable — a test key against the live endpoint is an `authentication_error` (`wrong_key_mode`).",
        ]}
      />

      <SectionHeading id="using-a-key" level={2}>
        Using a key
      </SectionHeading>
      <P text="Send the key as a bearer token on every request. Tenant identity comes from the key — the body's `tenant` must agree with it, which is what makes cross-tenant access structurally impossible." />
      <CodeBlock sample={AUTH_CURL} />
      <P text="When authentication fails you get the typed envelope, not a bare 401:" />
      <CodeBlock sample={AUTH_ERROR_EXAMPLE} />

      <SectionHeading id="scopes" level={2}>
        Scopes
      </SectionHeading>
      <P text="Each key carries the route scopes it may touch. Provision narrow keys per service — the component that reports outcomes does not need decision-writing scope." />
      <DocsTable
        columns={["Scope", "Routes"]}
        rows={SCOPES_ROWS}
        caption="Route scopes"
      />

      <SectionHeading id="key-safety" level={2}>
        Key safety &amp; rotation
      </SectionHeading>
      <Bullets items={KEY_SAFETY_BULLETS} />
    </DocsArticle>
  );
}
