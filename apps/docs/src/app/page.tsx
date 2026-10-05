import type { Metadata } from "next";
import { CodeBlock } from "@/components/code-block.js";
import { DocsArticle } from "@/components/docs-article.js";
import { DocsLink } from "@/components/docs-link.js";
import { DOCS_SECTIONS } from "@/content/navigation.js";

export const metadata: Metadata = {
  title: "Reckon Docs",
  description:
    "Reckon developer documentation — serve your first recommendation in five minutes, then go deeper on the API reference, webhooks and SDKs.",
};

const SECTION_BLURBS: Record<string, string> = {
  "get-started": "The five-minute quickstart and the concepts behind the loop.",
  "api-reference": "The API-craft laws: keys, errors, idempotency, expand, pagination, versioning.",
  webhooks: "Push events with HMAC signatures, retries and replay.",
  sdks: "Typed clients for TypeScript and Python over the frozen contracts.",
};

const HERO_SAMPLE = {
  language: "typescript" as const,
  label: "serve-recommendation.ts",
  code: `import { createReckonClient } from "@reckon/sdk";

const reckon = createReckonClient({
  baseUrl: "https://api.reckon.dev",
  apiKey: process.env.RECKON_API_KEY!,
});

const decision = await reckon.decisions.request({
  requestId: crypto.randomUUID(),
  tenant: { tenantId: "demo" },
  subject: { kind: "user", ref: "usr_88213" },
  objective: { objectiveId: "relax", kind: "relax" },
  candidates: retrieval.toCandidateSet(),
  idempotencyKey: crypto.randomUUID(),
});

console.log(decision.action); // "SUGGEST"`,
  caption:
    "Runnable end-to-end — every response in these docs is the real frozen contract payload, validated against `packages/contracts` in CI.",
};

export default function DocsHomePage() {
  return (
    <DocsArticle headings={[]}>
      <section className="docs-hero">
        <div className="docs-hero-grid">
          <div>
            <p className="page-eyebrow">Reckon documentation</p>
            <h1>Docs for the recommendation loop</h1>
            <p className="docs-hero-lede">
              Provider-neutral recommendation infrastructure: your retrieval proposes, a versioned
              policy decides, you deliver, and learning writes auditable deltas. Serve your first
              recommendation in about five minutes.
            </p>
            <div className="hero-cta-row">
              <DocsLink href="/get-started/quickstart" className="btn-primary">
                Serve your first recommendation
              </DocsLink>
              <DocsLink href="/get-started/core-concepts" className="btn-secondary">
                Read the core concepts
              </DocsLink>
            </div>
          </div>
          <div>
            <CodeBlock sample={HERO_SAMPLE} />
          </div>
        </div>
      </section>

      <nav aria-label="Documentation sections" className="home-cards">
        {DOCS_SECTIONS.map((section) => (
          <div key={section.id} className="home-card">
            <p className="home-card-title">{section.title}</p>
            <p className="home-card-desc">{SECTION_BLURBS[section.id]}</p>
            <ul className="home-card-pages">
              {section.pages.map((page) => (
                <li key={page.id}>
                  <DocsLink href={page.path}>
                    {page.title}
                    {page.status === "target" ? (
                      <span className="mini-target" title="Target contract — lands with the S2 lane">
                        S2
                      </span>
                    ) : null}
                  </DocsLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </DocsArticle>
  );
}
