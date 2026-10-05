# @reckon/docs — Reckon docs portal (S1-004)

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
- New code lives only under `apps/docs/**` (+ lockfile).

## Development

```bash
pnpm --filter ./apps/docs dev        # local dev server
pnpm --filter ./apps/docs build      # builds @reckon/contracts first, then next build
pnpm --filter ./apps/docs typecheck
pnpm --filter ./apps/docs test       # docs contract-fixture + IA tests
```

The app imports `@reckon/contracts` **types only** (`import type`), so no
runtime workspace code ships in the client bundle; the tests import the
schemas at runtime (hence the contracts-first build order above).
