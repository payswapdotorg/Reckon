import type { Metadata } from "next";
import { CodeBlock } from "@/components/code-block.js";
import { Callout } from "@/components/callout.js";
import { DocsArticle } from "@/components/docs-article.js";
import { PageHeader } from "@/components/page-header.js";
import { Bullets, P, SectionHeading } from "@/components/prose.js";
import {
  SIGNATURE_HEADER_EXAMPLE,
  SIGNATURE_VERIFY_PY,
  SIGNATURE_VERIFY_TS,
  WEBHOOK_EVENTS,
  WEBHOOKS_HEADINGS,
  WEBHOOK_ENVELOPE_NOTE,
  WEBHOOK_RETRY_BULLETS,
  WEBHOOK_SECURITY_BULLETS,
} from "@/content/webhooks.js";
import { routeMetaFor } from "@/content/route-meta.js";
import { routeMetadata } from "@/lib/site-routes.js";

export const metadata: Metadata = routeMetadata(routeMetaFor("/webhooks"));

export default function WebhooksPage() {
  return (
    <DocsArticle headings={WEBHOOKS_HEADINGS}>
      <PageHeader
        eyebrow="Webhooks"
        title="Event catalog & signatures"
        lede="Stop polling. Reckon POSTs the loop's events to your HTTPS endpoint, signs every delivery with HMAC-SHA256, and retries until you acknowledge."
        status={{ variant: "target", label: "Target contract · S2-002 implements delivery" }}
      />

      <SectionHeading id="how-webhooks-work" level={2}>
        How webhooks work
      </SectionHeading>
      <P text="Register an HTTPS endpoint and a per-endpoint signing secret (`whsec_…`). Reckon delivers events as signed JSON POSTs; respond with any 2xx within a reasonable window — do your heavy work asynchronously." />
      <Callout variant="note" title="Thin by default" body={WEBHOOK_ENVELOPE_NOTE} />

      <SectionHeading id="event-catalog" level={2}>
        Event catalog
      </SectionHeading>
      <P text="Four event types cover the loop today. Event names and payload fields follow the same vocabulary as the frozen contracts." />

      {WEBHOOK_EVENTS.map((event) => (
        <section key={event.id} className="concept" id={event.id}>
          <div className="concept-head">
            <h3 className="concept-term">{event.id}</h3>
            <span className="concept-tagline">{event.when}</span>
          </div>
          {event.description.map((paragraph) => (
            <P key={paragraph} text={paragraph} />
          ))}
          <CodeBlock
            sample={{
              language: "json",
              label: `${event.id} · payload`,
              code: event.payload,
            }}
          />
        </section>
      ))}

      <SectionHeading id="verify-signatures" level={2}>
        Verify signatures
      </SectionHeading>
      <P text="Every delivery carries a `Reckon-Signature` header: a signed timestamp `t` and a hex HMAC-SHA256 signature `v1`, computed over `${t}.${rawBody}` — the timestamp, a dot, then the raw request body — with your endpoint's `whsec_` secret." />
      <CodeBlock sample={SIGNATURE_HEADER_EXAMPLE} />
      <P text="Verify before trusting — and use the official SDK helper, which is the reference implementation below, maintained with the API:" />
      <CodeBlock sample={SIGNATURE_VERIFY_TS} />
      <CodeBlock sample={SIGNATURE_VERIFY_PY} />
      <Bullets items={WEBHOOK_SECURITY_BULLETS} />

      <SectionHeading id="retries-and-replay" level={2}>
        Retries, replay &amp; dedupe
      </SectionHeading>
      <Bullets items={WEBHOOK_RETRY_BULLETS} />
      <Callout
        variant="warning"
        title="Your handler must be idempotent"
        body={[
          "Delivery is at-least-once and replays reuse event ids — the same event will arrive more than once by design. Deduplicate on `event.id` before acting.",
        ]}
      />
    </DocsArticle>
  );
}
