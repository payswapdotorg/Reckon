# @reckon/marketing — Reckon marketing site (S1-001 + S1-002 + S1-003)

A stripe.com-class site shell implementing the survey grammar
(`docs/surveys/stripe-com-survey.md` §2): live-stat ticker → split-field
gradient-mesh hero → outcome-phrased product grid → code-first marketing
artifact → quantified social proof → final dual-CTA band → four-surface
footer. Product pages (`/products/<id>`, S1-002) follow the product-page
grammar; the pricing page (`/pricing`, S1-003) ships per-1k-request
tiers, an interactive volume calculator (pure function in
`src/lib/pricing-calculator.ts`, unit-tested), an "everything included"
comparison table, an honest FAQ, and the enterprise track.

- Pure CSS (`src/app/marketing.css`) + React — zero runtime deps beyond
  next/react/react-dom, pinned to `apps/web`'s exact versions.
- All copy lives in typed content modules (`src/lib/*.ts`);
  fictional customers/numbers are marked illustrative.
- `START_NOW_HREF` points at the real `/pricing` surface (S1-003).
- Pricing figures are ILLUSTRATIVE and labeled as such — billing does
  not exist; the comparison table marks dashboard/roadmap surfaces
  honestly instead of gating or over-claiming.
- Contact sales is a `mailto:sales@reckon.dev` placeholder; the ticker
  stat is a typed constant labeled "Network stat" until network
  telemetry lands (S2/S3).

Build: `pnpm --filter ./apps/marketing build` (webpack path, like apps/web).

## Deployment (Vercel — S4-002 deploy readiness)

Production-deployed as a **Vercel project with the Next.js framework
preset** (the full four-project setup lives in
`docs/deployment/stripe-phase-release.md`; the release verification gate is
`scripts/verify-deployment.mjs` at the repo root):

| Field | Value |
|---|---|
| Project | `reckon-marketing` (git-connected, this monorepo) |
| Root directory | `apps/marketing` |
| Framework preset | Next.js (16.3.8 — pinned to `apps/web`'s exact versions, single Next family across the workspace) |
| Build command | `pnpm run build` — the package build script (`next build --webpack`); no workspace-package build is chained because this app has zero runtime workspace dependencies |
| Env vars | **NONE — zero-env surface.** Pure static content from typed content modules; the `process.env.RECKON_API_KEY` strings inside `src/lib/*.ts` code samples are marketing copy (text), never runtime consumption. Do not configure any variable. |
| `vercel.json` | **None, deliberately.** No route rewrites exist on this surface (`/`, `/pricing`, `/products/<id>` are plain App Router routes) — the framework preset serves them as built. |
| Output mode | Standard Next.js build output (no `standalone` — the Vercel preset handles output; no config change required for deploy) |

The `next.config.ts` in this directory is the production config as shipped
(`reactStrictMode` only — the webpack `resolveExtensionAlias` mapping is not
needed here because this app contains no NodeNext `.js`-specifier workspace
imports). Deploying requires no configuration change to this app.
