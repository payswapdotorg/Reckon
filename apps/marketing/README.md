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
