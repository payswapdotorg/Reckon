/**
 * Changelog content (S5-002) — the stripe.com/changelog grammar applied to
 * the Reckon repository: reverse-chronological dated entries, category
 * chips, per-entry anchors, plain outcome-phrased one-liners with optional
 * detail.
 *
 * HONESTY LAW (this module): every entry is a true repo fact derived from
 * the repository's own release history — `git log` on `main` plus the
 * feature map in `docs/handoff/final-release-evidence.md` §4. Dates are
 * commit timestamps (the merge/closing commit of each release wave), work
 * items are the ids recorded in `docs/work-items/state.json`, and evidence
 * classes are stated in the detail text — never claimed stronger than the
 * underlying artifact. No invented entries, no aspirational features.
 *
 * Data shape (work item S5-002): { date, categories, title, oneLiner,
 * detail?, anchor } — rendered data-driven by app/changelog/page.tsx and
 * contract-tested by test/changelog.test.ts.
 */

import type { ChangelogCategory, ChangelogEntry, TocEntry } from "./types.js";

/** The allowed category-chip set (stripe changelog grammar: one chip per affected surface). */
export const CHANGELOG_CATEGORIES: readonly ChangelogCategory[] = [
  "API",
  "SDKs",
  "Dashboard",
  "Docs",
  "Platform",
];

/**
 * The changelog entries, newest first. Same-date entries are ordered by
 * reverse merge sequence (the commit order on that day).
 */
export const CHANGELOG_ENTRIES: readonly ChangelogEntry[] = [
  {
    date: "2026-10-05",
    categories: ["Docs"],
    title: "Changelog and SEO completeness for the docs portal",
    oneLiner:
      "This changelog shipped, along with per-route Open Graph + Twitter cards, a 1200×630 social card, sitemap.xml, robots.txt and a Previous/Next pager across the get-started track.",
    detail:
      "Work item S5-002 (`work/s5-002-docs-polish`): every entry on this page is a repo fact derived from commit history — dates are commit timestamps, and evidence classes are stated. The colocated vitest suite contract-tests the content module, the sitemap/robots generators, the per-route metadata and the pager wiring. Evidence class: observed.",
    anchor: "2026-10-05-docs-changelog-seo",
  },
  {
    date: "2026-10-05",
    categories: ["Platform", "API", "SDKs", "Dashboard"],
    title: "RELEASE-002: the four-surface system goes to production",
    oneLiner:
      "Webhooks, test mode, reference SDKs, dashboard analytics and pricing shipped together — and all four surfaces (API, dashboard, docs, marketing) are verified live in production.",
    detail:
      "The stripe-phase release: 13 work items (S1-001..S1-004, S2-001..S2-004, S3-001..S3-002, S4-001..S4-002) on top of RELEASE-001 — 65/65 done, `implementationComplete=true` at the closing commit. Production URLs and deployment evidence are recorded in `docs/handoff/final-release-evidence.md`; the docs portal and marketing site deployed for the first time this release. Evidence class: observed — the §6 battery plus `scripts/verify-deployment.mjs` over the public wire.",
    anchor: "2026-10-05-release-002",
  },
  {
    date: "2026-10-05",
    categories: ["Platform"],
    title: "End-to-end journey proof: six hops, one driver, repeatable",
    oneLiner:
      "A repeatable driver proves the whole loop over the live API — signup → API key → first recommendation → request-log entry → analytics entry → webhook event — with all six hops asserted.",
    detail:
      "Work item S4-001: `scripts/e2e-journey.mjs` plus the captured transcript in `docs/handoff/e2e-journey-proof.md`, rerun live with exit 0 (6/6 hops). An 8-test lockstep keeps driver, docs and surfaces in agreement. Evidence class: observed.",
    anchor: "2026-10-05-journey-proof",
  },
  {
    date: "2026-10-05",
    categories: ["SDKs", "Dashboard"],
    title: "Reference SDKs for TypeScript and Python, pricing, and dashboard analytics",
    oneLiner:
      "`@reckon/sdk` gained webhook verification, hardening and typed-error extensions; a `requests`-only Python reference client shipped; the pricing page and the dashboard analytics views (CTR lift, latency percentiles, drift, funnels) went live.",
    detail:
      "Work items S2-004, S1-003 and S3-002, merged as stripe-phase wave-4. The Python client's `verify_webhook` is byte-for-byte the documented algorithm; docs snippets run against the shipped SDKs (`docs-lockstep` tests). Analytics views carry evidence-class badges and not-wired honesty naming the pending routes. Evidence class: observed — wave-4 lane batteries, Lead-verified.",
    anchor: "2026-10-05-sdks-pricing-analytics",
  },
  {
    date: "2026-10-05",
    categories: ["API", "Dashboard"],
    title: "Webhooks, test mode and the dashboard shell ship",
    oneLiner:
      "Webhook endpoints gained the four-event catalog, HMAC signatures, replay and a deliveries log; `sk_test_` keys with canned scenarios arrived with test mode; the dashboard got its shell — keys manager, request logs, events console and the test/live toggle.",
    detail:
      "Work items S2-002, S2-003 and S3-001, merged as stripe-phase wave-2. Test mode never executes live handler state (the separation law); publishable keys are rejected as credentials. Evidence class: observed — the seven `apps/api/test/webhook-*.test.ts` files plus `test-mode.test.ts` and the dashboard-view batteries.",
    anchor: "2026-10-05-webhooks-test-mode-dashboard",
  },
  {
    date: "2026-10-05",
    categories: ["API", "Docs"],
    title: "API hardening, the docs portal, and the marketing home",
    oneLiner:
      "The API adopted the API-craft laws documented here — `sk_`/`pk_` keys, `Reckon-Version` negotiation, idempotency replay, `?expand[]`, cursor pagination, typed errors — and this docs portal shipped with the quickstart, core concepts and API reference.",
    detail:
      "Work items S1-001, S1-004 and S2-001, merged as stripe-phase wave-1. Every docs example payload is validated against the real zod contracts in CI, so the docs cannot drift from the wire. Evidence class: observed — `apps/api/test/{keys,versioning,idempotency,expansion,pagination,errors-catalog}.test.ts` all green.",
    anchor: "2026-10-05-api-hardening-docs-portal",
  },
  {
    date: "2026-10-03",
    categories: ["Platform", "API", "Dashboard"],
    title: "RELEASE-001: the 52-item initial release",
    oneLiner:
      "v0.1.0 of the frozen-contract system shipped: the decision API, nine dashboard workspaces, PostgreSQL persistence with migrations, and the first end-to-end journey proof.",
    detail:
      "The 52 pre-stripe work items (W-lanes, UI-001..009, P1-001..004) plus the release item itself, closed at the final-release commit — gates reconciled green in `docs/handoff/final-release-evidence.md`, full battery 60 files / 1023 tests plus build, typecheck and verify-repo green in the release window. Evidence class: observed.",
    anchor: "2026-10-03-release-001",
  },
  {
    date: "2026-10-03",
    categories: ["Platform"],
    title: "The API and dashboard go live",
    oneLiner:
      "`reckon-api` and `reckon-web` deployed as git-connected Vercel projects on Neon PostgreSQL; the public demo tenant was verified over the wire — decision queue, durable read-back, outcome and evidence.",
    detail:
      "DEPLOY-001..003: the Neon production database was provisioned with all four migrations applied over the real wire, then GATE-N passed over the public wire before RELEASE-001 closed. Evidence class: observed.",
    anchor: "2026-10-03-first-production-deploys",
  },
];

/** "On this page" rail entries — one per changelog entry, in feed order. */
export const CHANGELOG_HEADINGS: readonly TocEntry[] = CHANGELOG_ENTRIES.map((entry) => ({
  id: entry.anchor,
  label: entry.title,
  level: 2,
}));

/**
 * Render a changelog date for display: "2026-10-05" → "October 5, 2026".
 * Pure string formatting (no Intl/timezone dependency — deterministic at
 * build time, matching the statically prerendered page).
 */
const MONTH_NAMES: readonly string[] = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function formatChangelogDate(isoDate: string): string {
  const month = Number.parseInt(isoDate.slice(5, 7), 10);
  const day = Number.parseInt(isoDate.slice(8, 10), 10);
  const year = isoDate.slice(0, 4);
  const monthName = MONTH_NAMES[month - 1] ?? isoDate;
  return `${monthName} ${day}, ${year}`;
}
