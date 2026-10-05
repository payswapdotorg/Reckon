# @reckon/docs — Reckon docs portal (S1-004 + S5-002)

A Next.js (App Router, TypeScript) documentation portal whose information
architecture mirrors docs.stripe.com, per
`docs/surveys/stripe-com-survey.md` §3 (the survey is the specification):

- **Get started** — the *"Serve your first recommendation"* quickstart
  (the crown jewel): numbered steps with **integration-option tabs**
  (Hosted endpoint / SDK / Streaming — curl→JSON, TypeScript SDK,
  streaming SSE), plus **Core concepts** covering the vertical
  `catalog → context → candidates → experience → decision → schedule →
  outcome → preference delta` from
  `docs/development/implementation-rules.md`.
- **API reference** — the six API-craft laws as skeleton pages with a
  short spec + one runnable example each: Authentication (sk_/pk_ target
  model), Errors (typed 4-class catalog), Idempotent requests (24h
  replay window), Expanding responses (`?expand[]`), Pagination
  (cursor/`has_more`/`next_cursor`), Versioning (`Reckon-Version`).
- **Webhooks** — event catalog (`recommendation.delivered`,
  `model.drift.detected`, `schedule.executed`, `preference.updated`) +
  HMAC signature verification guide (official-libraries
  recommendation) + replay semantics. TARGET contract; S2-002
  implements.
- **SDKs** — TypeScript (live: `@reckon/sdk`) + Python (target, S2-004).
- **Changelog (S5-002)** — the stripe.com/changelog grammar applied to
  the repo's own release history: a reverse-chronological feed of dated
  entries with category chips, per-entry anchors and outcome-phrased
  one-liners, 100% data-driven from `src/content/changelog.ts` (every
  entry a repository fact — dates are commit timestamps, evidence
  classes stated, nothing invented).
- **SEO / social / crawl completeness (S5-002)** — per-route Open Graph +
  Twitter cards on every page (via the shared `routeMetadata()` builder
  in `src/lib/site-routes.ts`, fed by `src/content/route-meta.ts`), a
  1200×630 social card from the `app/opengraph-image.tsx` file
  convention (next/og `ImageResponse` — the approach proven green under
  `next build --webpack` by the S5-001 marketing app on the same
  workspace-pinned Next 16.3.8; **no static PNG fallback needed**),
  `sitemap.xml` + `robots.txt` (`app/sitemap.ts` / `app/robots.ts`,
  generated from the same route model), and a stripe-docs style
  Previous/Next pager across the get-started reading track
  (quickstart → core concepts → the six API-reference pages), driven by
  `src/content/get-started-nav.ts` (derived from the sidebar IA, so the
  pager and the sidebar can never disagree).

## Laws (violations void the delivery)

- Content is **typed data structures rendered by small components** —
  no markdown runtime, no MDX (the workspace has no MDX deps).
- Every example payload lives in `src/content/fixtures` typed against
  the REAL frozen contracts (`import type` from `@reckon/contracts`) and
  is **validated against the real zod schemas** by
  `test/docs-contract-fixtures.test.ts` — docs samples cannot drift from
  the wire contracts.
- TARGET-contract surfaces (S2-001/S2-002/S2-003/S2-004) are marked
  with status badges and callouts — the portal never claims v0.1.0
  implements what it does not (honest-degradation law applied to docs).
- Runnable, copyable code samples with a small inline highlighter
  (`src/lib/highlight.ts`, zero dependencies).
- Sidebar IA: collapsible sections, live filter, active-page state,
  sticky; mobile drawer; "On this page" rail on desktop.
- Clean light theme, single brand accent family (`#009768` Reckon
  green, matching `apps/web` design tokens). No indigo/blue.
- No env vars, no backend, no data fetching — every page is static.
  (S5-002 exception: `NEXT_PUBLIC_SITE_URL` may OPTIONALLY override the
  canonical base URL used by the sitemap/robots/OG-card generators —
  preview deployments and future domain moves. It is never required;
  unset, everything defaults to the production deployment
  `https://reckon-docs.vercel.app`. This is the surface's one sanctioned
  env read, and the pages themselves stay fully static.)
- New code lives only under `apps/docs/**` (+ lockfile).

## Development

```bash
pnpm --filter ./apps/docs dev        # local dev server
pnpm --filter ./apps/docs build      # builds @reckon/contracts first, then next build
pnpm --filter ./apps/docs typecheck
pnpm --filter ./apps/docs test       # contract-fixture + IA + changelog/SEO/nav tests
```

The app imports `@reckon/contracts` **types only** (`import type`), so no
runtime workspace code ships in the client bundle; the tests import the
schemas at runtime (hence the contracts-first build order above).

## Deployment (Vercel — S4-002 deploy readiness)

Production-deployed as a **Vercel project with the Next.js framework
preset** (the full four-project setup lives in
`docs/deployment/stripe-phase-release.md`; the release verification gate is
`scripts/verify-deployment.mjs` at the repo root):

| Field | Value |
|---|---|
| Project | `reckon-docs` (git-connected, this monorepo) |
| Root directory | `apps/docs` |
| Framework preset | Next.js (16.3.8 — the workspace-pinned Next family) |
| Build command | `pnpm run build` — the package build script, which chains `pnpm --filter @reckon/contracts build && next build --webpack` (the contracts dist must exist before `next build` typechecks the `import type` fixtures) |
| Env vars | **NONE required — zero-env by default.** Every page is static; the `process.env.RECKON_API_KEY` strings inside `src/content/**` are documentation code samples (text), never runtime consumption. S5-002 adds exactly one OPTIONAL override: `NEXT_PUBLIC_SITE_URL` retargets the sitemap/robots/OG-card canonical base (preview deploys, domain moves); unset it defaults to `https://reckon-docs.vercel.app` — do not configure it for production. |
| `vercel.json` | **None, deliberately.** No route rewrites exist on this surface — the framework preset serves the App Router routes as built. |
| Output mode | Standard Next.js build output (no `standalone` — the Vercel preset handles output; no config change required for deploy) |

The `next.config.ts` in this directory is the production config (webpack
build path with the `resolveExtensionAlias` mapping for the workspace's
NodeNext `.js`-specifier convention — same bundler note as `apps/web`).
Deploying requires no configuration change to this app.
