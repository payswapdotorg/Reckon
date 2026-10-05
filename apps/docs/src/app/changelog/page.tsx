import type { Metadata } from "next";
import { DocsArticle } from "@/components/docs-article.js";
import { PageHeader } from "@/components/page-header.js";
import { P } from "@/components/prose.js";
import {
  CHANGELOG_ENTRIES,
  CHANGELOG_HEADINGS,
  formatChangelogDate,
} from "@/content/changelog.js";
import { routeMetaFor } from "@/content/route-meta.js";
import { routeMetadata } from "@/lib/site-routes.js";

export const metadata: Metadata = routeMetadata(routeMetaFor("/changelog"));

/**
 * Reckon changelog (S5-002) — the stripe.com/changelog grammar: a
 * reverse-chronological feed of dated entries, each with category chips,
 * a per-entry anchor, a plain outcome-phrased one-liner and an optional
 * detail. Content is 100% data-driven from src/content/changelog.ts
 * (every entry a repo fact — dates from commit timestamps, evidence
 * classes stated); the page only renders.
 */
export default function ChangelogPage() {
  return (
    <DocsArticle headings={CHANGELOG_HEADINGS}>
      <PageHeader
        eyebrow="Release notes"
        title="Changelog"
        lede="What shipped on Reckon, newest first — dated by the commits that carried it, categorized by the surface it touched, and grounded in repository evidence."
      />
      <P
        text={`Every entry on this page is a fact from the [Reckon repository](https://github.com/payswapdotorg/Reckon): dates are commit timestamps, work items and evidence classes are stated in the detail lines, and nothing is claimed beyond what the repo shows. Categories mark the surface — **API**, **SDKs**, **Dashboard**, **Docs**, **Platform**.`}
      />

      <div className="changelog-list">
        {CHANGELOG_ENTRIES.map((entry) => (
          <article key={entry.anchor} className="changelog-entry">
            <a id={entry.anchor} />
            <div className="changelog-meta">
              <time className="changelog-date" dateTime={entry.date}>
                {formatChangelogDate(entry.date)}
              </time>
              <ul className="changelog-chips" aria-label="Entry categories">
                {entry.categories.map((category) => (
                  <li key={category} className="changelog-chip">
                    {category}
                  </li>
                ))}
              </ul>
            </div>
            <h2 className="changelog-title">
              {entry.title}
              <a
                href={`#${entry.anchor}`}
                className="docs-anchor"
                aria-label={`Link to this entry: ${entry.title}`}
              >
                #
              </a>
            </h2>
            <p className="changelog-one-liner">{entry.oneLiner}</p>
            {entry.detail !== undefined && <p className="changelog-detail">{entry.detail}</p>}
          </article>
        ))}
      </div>
    </DocsArticle>
  );
}
