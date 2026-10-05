import type { Metadata } from "next";
import { CodeBlock } from "@/components/code-block.js";
import { Callout } from "@/components/callout.js";
import { DocsArticle } from "@/components/docs-article.js";
import { DocsPager } from "@/components/docs-pager.js";
import { DocsTable } from "@/components/docs-table.js";
import { PageHeader } from "@/components/page-header.js";
import { Bullets, P, SectionHeading } from "@/components/prose.js";
import {
  ERROR_CLASSES,
  ERROR_ENVELOPE_EXAMPLE,
  ERRORS_HEADINGS,
  ERROR_HANDLING_BULLETS,
  SDK_CATCH_EXAMPLE,
} from "@/content/api-reference/errors.js";
import { routeMetaFor } from "@/content/route-meta.js";
import { routeMetadata } from "@/lib/site-routes.js";

export const metadata: Metadata = routeMetadata(routeMetaFor("/api-reference/errors"));

export default function ErrorsPage() {
  return (
    <DocsArticle headings={ERRORS_HEADINGS}>
      <PageHeader
        eyebrow="API reference"
        title="Errors"
        lede="Every failure returns one typed envelope. You branch on the class, persist the stable code, and never depend on the message."
        status={{ variant: "target", label: "Target taxonomy · lands with S2-001" }}
      />

      <SectionHeading id="the-error-envelope" level={2}>
        The error envelope
      </SectionHeading>
      <CodeBlock sample={ERROR_ENVELOPE_EXAMPLE} />

      <SectionHeading id="error-classes" level={2}>
        Error classes
      </SectionHeading>
      <P text="Four classes cover every failure. Their retry semantics differ, which is the whole point of the taxonomy:" />
      {ERROR_CLASSES.map((errorClass) => (
        <section key={errorClass.id} className="concept" id={errorClass.id}>
          <div className="concept-head">
            <h3 className="concept-term">{errorClass.name}</h3>
            <span className="concept-tagline">HTTP {errorClass.http}</span>
            <span className={`status-badge ${errorClass.retryable ? "status-live" : "status-target"}`}>
              {errorClass.retryable ? "retryable" : "do not retry"}
            </span>
          </div>
          <P text={errorClass.description} />
        </section>
      ))}

      <SectionHeading id="stable-codes" level={2}>
        Stable code catalog
      </SectionHeading>
      <P text="Codes are stable machine identifiers — alert on them, persist them, write tests against them. HTTP mapping is part of the contract:" />
      {ERROR_CLASSES.map((errorClass) => (
        <DocsTable
          key={errorClass.id}
          columns={["Code", "HTTP", "Meaning"]}
          rows={errorClass.codes.map((code) => [
            `\`${code.code}\``,
            String(code.http),
            code.meaning,
          ])}
          caption={`${errorClass.name} codes`}
        />
      ))}

      <SectionHeading id="handling-errors" level={2}>
        Handling errors
      </SectionHeading>
      <Bullets items={ERROR_HANDLING_BULLETS} />
      <CodeBlock sample={SDK_CATCH_EXAMPLE} />
      <Callout
        variant="status"
        title="Status — what runs today"
        body={[
          "v0.1.0 already returns a typed envelope `{ error: { code, message, details } }` with the codes `VALIDATION_ERROR`, `UNAUTHENTICATED`, `TENANT_MISMATCH`, `INSUFFICIENT_SCOPE`, `NOT_FOUND`, `IDEMPOTENCY_CONFLICT`, `NOT_WIRED` (the SDK mirrors them as typed error classes). S2-001 adds the `type` class field, rate limiting, and the snake_case code spellings shown above.",
        ]}
      />
      <DocsPager currentPath="/api-reference/errors" />
    </DocsArticle>
  );
}
