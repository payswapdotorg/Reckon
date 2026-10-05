# @reckon/marketing — Reckon marketing home (S1-001)

A stripe.com-class site shell implementing the survey grammar
(`docs/surveys/stripe-com-survey.md` §2): live-stat ticker → split-field
gradient-mesh hero → outcome-phrased product grid → code-first marketing
artifact → quantified social proof → final dual-CTA band → four-surface
footer.

- Pure CSS (`src/app/marketing.css`) + React — zero runtime deps beyond
  next/react/react-dom, pinned to `apps/web`'s exact versions.
- All copy lives in typed content modules (`src/lib/marketing-content.ts`);
  fictional customers/numbers are marked illustrative.
- `START_NOW_HREF` points at the `/pricing` placeholder (S1-003 ships the
  real pricing page).
- Contact sales is a `mailto:sales@reckon.dev` placeholder; the ticker stat
  is a typed constant labeled "Network stat" until network telemetry lands
  (S2/S3).

Build: `pnpm --filter ./apps/marketing build` (webpack path, like apps/web).
