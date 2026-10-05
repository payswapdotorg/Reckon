import type { Metadata } from "next";
import { CodeBlock } from "@/components/code-block.js";
import { CodeTabs } from "@/components/code-tabs.js";
import { Callout } from "@/components/callout.js";
import { DocsArticle } from "@/components/docs-article.js";
import { DocsTable } from "@/components/docs-table.js";
import { PageHeader } from "@/components/page-header.js";
import { Bullets, P } from "@/components/prose.js";
import {
  DECISION_FIELDS,
  QUICKSTART_HEADINGS,
  QUICKSTART_STEPS,
} from "@/content/quickstart.js";

export const metadata: Metadata = {
  title: "Quickstart — serve your first recommendation",
  description:
    "Serve your first Reckon recommendation in about five minutes: get a key, call the decision endpoint, read the result, close the loop with an outcome.",
};

export default function QuickstartPage() {
  return (
    <DocsArticle headings={QUICKSTART_HEADINGS}>
      <PageHeader
        eyebrow="Get started"
        title="Serve your first recommendation"
        lede="This page takes you from zero to a live recommendation loop — a decision served, presented, and an outcome reported back — in about five minutes. Every response you see is the real frozen contract payload."
      />

      <h2 id="before-you-start" className="docs-h2">
        Before you start
        <a href="#before-you-start" className="docs-anchor" aria-label="Link to this section: Before you start">
          #
        </a>
      </h2>
      <Bullets
        items={[
          "An API key for the `demo` tenant (below).",
          "`curl` in your shell — or Node.js 20+ / TypeScript for the SDK tab.",
          "No data to import: the quickstart works against your existing retrieval — candidates are references to **your** item ids.",
        ]}
      />
      <Callout
        variant="note"
        title="The five-minute promise"
        body={[
          "One key, one request, one outcome event. The [core concepts](/get-started/core-concepts) page explains the loop you just ran — read it after, not before.",
        ]}
      />

      {QUICKSTART_STEPS.map((step) => (
        <section key={step.id} className="qs-step">
          <h2 id={step.id} className="qs-step-title">
            {step.title}
            <span className="qs-time">{step.minutes}</span>
            <a href={`#${step.id}`} className="docs-anchor" aria-label={`Link to this section: ${step.title}`}>
              #
            </a>
          </h2>
          {step.intro.map((paragraph) => (
            <P key={paragraph} text={paragraph} />
          ))}

          {step.tabs !== undefined && <CodeTabs tabs={step.tabs} />}

          {step.id === "get-your-api-keys" && (
            <Callout
              variant="status"
              title="Status — what runs today"
              body={[
                "The v0.1.0 API authenticates static keys configured by the operator (`RECKON_API_KEYS=devkey:demo-tenant:decisions,plans,catalog,experiences,…`). Dashboard-issued `sk_`/`pk_` keys and test mode land with S2-001/S2-003 — the key model documented here is that target contract.",
              ]}
            />
          )}

          {step.id === "serve-your-first-recommendation" && (
            <>
              <Callout
                variant="note"
                title="One contract, three transports"
                body={[
                  "All three tabs return the same frozen `reckon.decision-result` — switching later is a transport change, not a data-model change.",
                ]}
              />
              <Callout
                variant="status"
                title="Status — what runs today"
                body={[
                  "`POST /v1/decisions` and the SDK path are live in v0.1.0 (static Bearer keys). The SSE stream (`/v1/stream/decisions`) is the target streaming surface landing with S2-001.",
                ]}
              />
            </>
          )}

          {step.extra?.map((sample, index) => (
            <CodeBlock key={index} sample={sample} />
          ))}

          {step.id === "read-the-decision" && (
            <DocsTable
              columns={["Field", "Meaning"]}
              rows={DECISION_FIELDS}
              caption="Key fields of a decision result"
            />
          )}
        </section>
      ))}

      <h2 id="whats-next" className="docs-h2">
        What&apos;s next
        <a href="#whats-next" className="docs-anchor" aria-label="Link to this section: What's next">
          #
        </a>
      </h2>
      <Bullets
        items={[
          "Understand the loop you just ran — [core concepts](/get-started/core-concepts).",
          "Harden your integration — [authentication](/api-reference/authentication), [errors](/api-reference/errors), [idempotency](/api-reference/idempotent-requests).",
          "Stop polling — let Reckon [push events to you](/webhooks).",
          "Go typed end-to-end — the [SDKs](/sdks).",
        ]}
      />
    </DocsArticle>
  );
}
