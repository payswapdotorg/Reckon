import type { Metadata } from "next";
import { CodeBlock } from "@/components/code-block.js";
import { Callout } from "@/components/callout.js";
import { DocsArticle } from "@/components/docs-article.js";
import { DocsTable } from "@/components/docs-table.js";
import { PageHeader } from "@/components/page-header.js";
import { Bullets, P, SectionHeading } from "@/components/prose.js";
import {
  CONCEPTS,
  CONCEPTS_HEADINGS,
  CONCEPTS_SEE_ALSO,
  EVIDENCE_ROWS,
  HOST_AUTHORITY_BULLETS,
  LOOP_STEPS,
  TWO_SPEED_ROWS,
} from "@/content/core-concepts.js";

export const metadata: Metadata = {
  title: "Core concepts",
  description:
    "The Reckon vertical: catalog, context, candidates, experience, decision, schedule, outcome, preference delta — plus two-speed runtimes, host authority and evidence classes.",
};

export default function CoreConceptsPage() {
  return (
    <DocsArticle headings={CONCEPTS_HEADINGS}>
      <PageHeader
        eyebrow="Get started"
        title="Core concepts"
        lede="Reckon is provider-neutral recommendation infrastructure: your retrieval proposes, a versioned policy decides, you deliver, and learning writes auditable deltas. Eight concepts carry the whole loop."
      />

      <SectionHeading id="the-reckon-loop" level={2}>
        The Reckon loop
      </SectionHeading>
      <P text="Every Reckon integration walks the same vertical. The first implementation target of the architecture is exactly this chain — no demo UI, no provider-specific product, vertical first:" />
      <div className="loop" role="img" aria-label="The Reckon loop: catalog to context to candidates to experience to decision to schedule to outcome to preference delta, which feeds back into decisions">
        {LOOP_STEPS.map((step, index) => (
          <span key={step.label} className="loop-step-wrap">
            <span className="loop-step" data-kind={step.learning === true ? "learning" : undefined}>
              {step.label}
            </span>
            {index < LOOP_STEPS.length - 1 && (
              <span className="loop-arrow" aria-hidden="true">
                →
              </span>
            )}
          </span>
        ))}
        <span className="loop-arrow" aria-hidden="true">
          ↺
        </span>
      </div>
      <P text="**Learning closes the loop**: outcomes become preference deltas, preference deltas shape the next decision. Deltas are append-only and auditable — never an opaque state blob." />

      <SectionHeading id="concepts" level={2}>
        Concepts
      </SectionHeading>
      <P text="Each concept names its frozen contract — the versioned schema that formalizes it in `packages/contracts`. The JSON examples are real payloads: the docs test suite validates every one of them against those schemas." />

      {CONCEPTS.map((concept) => (
        <section key={concept.id} className="concept" id={concept.id}>
          <div className="concept-head">
            <h3 className="concept-term">{concept.term}</h3>
            <span className="concept-tagline">{concept.tagline}</span>
            {concept.contract !== undefined && (
              <code className="concept-contract">
                {concept.contract.id}@{concept.contract.version}
              </code>
            )}
          </div>
          {concept.summary.map((paragraph) => (
            <P key={paragraph} text={paragraph} />
          ))}
          {concept.fields !== undefined && (
            <DocsTable
              columns={["Field", "Type", "Meaning"]}
              rows={concept.fields}
              caption={`Fields of ${concept.term}`}
            />
          )}
          {concept.example !== undefined && (
            <CodeBlock
              sample={{
                language: "json",
                label: concept.contract !== undefined ? `${concept.contract.id}` : "Example",
                code: concept.example.json,
                caption: concept.example.caption,
              }}
            />
          )}
        </section>
      ))}

      <SectionHeading id="two-speed-runtimes" level={2}>
        Two-speed runtimes
      </SectionHeading>
      <P text="The same loop runs at two speeds. The fast runtime serves users; the research runtime learns, evaluates and replays — and the two never get confused because research artifacts are explicit about counterfactuals." />
      <DocsTable
        columns={["", "Fast runtime", "Research runtime"]}
        rows={TWO_SPEED_ROWS.map((row) => [
          row[0] ?? "",
          row[1] ?? "",
          row[2] ?? "",
        ])}
        caption="Fast runtime versus research runtime"
      />

      <SectionHeading id="host-authority" level={2}>
        Host authority
      </SectionHeading>
      <P text="Reckon is infrastructure inside **your** product, not a platform your product lives inside. The boundary is explicit:" />
      <Bullets items={HOST_AUTHORITY_BULLETS} />

      <SectionHeading id="evidence-classes" level={2}>
        Evidence classes
      </SectionHeading>
      <P text="Not all data is equal, and Reckon refuses to blur the difference. Every outcome carries a required evidence class, and the observed classes are typed separately from the research classes — simulated outcomes can never masquerade as observed production evidence." />
      <DocsTable
        columns={["Class", "Meaning"]}
        rows={EVIDENCE_ROWS}
        caption="Evidence classes"
      />
      <Callout
        variant="note"
        title="Why this page matters"
        body={CONCEPTS_SEE_ALSO}
      />
    </DocsArticle>
  );
}
