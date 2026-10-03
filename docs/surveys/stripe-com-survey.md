# Stripe.com Survey — Blueprint for "The Stripe of AI Recommendations"

**Date:** 2026-10-03 (night) · **Method:** live browser survey through the replay
(Chrome 153, logged-in Google OAuth pass + public/docs surfaces) · **Operator
credentials used:** yaslencatty@gmail.com (Google auth SUCCEEDED; the identity has
no existing Stripe account — Stripe landed on its signup page; signup UX captured
as artifact 02, dashboard internals to be surveyed if the operator completes
signup through the replay image).

Artifacts: `01-login-page.jpg` (login: email/pass · Google · Passkey · SSO —
the social-login-first auth pattern), `02-google-auth-signup.jpg` (progressive
signup: Email prefilled from Google + Full name + country selector), `03-*.jpg`
(marketing pages), `04-*.jpg` (docs pages), `ia-marketing.json`, `ia-docs.json`,
`vlm-home.json` (design-system analysis).

---

## 1. What "a complete stripe.com" IS (the decomposition)

Stripe is not one page — it is a **four-surface product system**:

| Surface | Stripe's version | Reckon equivalent |
|---|---|---|
| **Marketing site** | stripe.com: gradient-mesh hero, product grid, social proof, code-first selling | reckon.marketing: recommendation-API-as-hero |
| **Docs portal** | docs.stripe.com: quickstarts, API reference, webhooks, SDKs | docs.reckon: "your first recommendation" quickstart, API ref |
| **API + DX** | keys, idempotency, expand, versioning, test mode, webhooks | reckoned API hardened Stripe-style |
| **Dashboard** | dashboard.stripe.com: test/live toggle, logs, analytics | reckon dashboard for ops |

The end-to-end promise to replicate: **sign up → get a key → first successful
call in minutes → see it in a log → see it in analytics → get paid-tiered**.

## 2. Marketing site patterns (from home / pricing / payments / billing / customers)

**Information architecture (nav):** Products · Solutions · Developers ·
Resources · Pricing · [Sign in] [Start now] + an enterprise/startup/platform
sub-nav. Personas addressed explicitly ("Stripe for enterprises / startups /
platforms").

**Homepage section grammar** (in order):
1. **Ticker micro-proof** above the hero ("Global GDP running on Stripe…") —
   a live-stat credibility hook.
2. **Split-field hero** — headline left (~40-45% width), abstract
   high-fidelity visual right; 1.5–2× breathing whitespace.
3. **Product-grid sections**, each = one product with one-line value prop +
   "Enable any billing model" / "Monetise through agentic commerce" class
   headlines (outcome-phrased, never feature-phrased).
4. **The backbone claim** ("The backbone of global commerce") — the
   infrastructure framing.
5. **Social proof at scale** — customer logos + quantified case studies
   ("URBN consolidates $5 billion…", "Hertz unifies commerce…").
6. **Dual CTA everywhere**: "Start now" (self-serve) + "Contact sales"
   (enterprise) — the two-track conversion architecture.

**Design system (VLM pass, vlm-home.json):**
- **Gradient mesh backgrounds** (orange→pink→purple→blue, SVG-filter/3D
  quality — "liquid", never a flat CSS gradient).
- **Technical vibrancy**: vivid gradient art against near-monochrome text
  columns.
- **High-contrast indigo CTA** (#635BFF family) — the single brand accent.
- **Code-first marketing**: real integration snippets rendered as first-class
  marketing artifacts (with language tabs).
- Typography: tight large headline (one idea per line), comfortable body,
  generous section rhythm.

**Pricing page structure:** per-transaction + productized add-on pricing,
standard vs custom enterprise tiers, interactive volume calculator,
"everything included" comparison tables.

## 3. Docs portal patterns (docs.stripe.com)

- **Taxonomy:** Get started · Payments · Revenue · Risk · Data · Money
  management · Stablecoins · Embedded finance · Developer resources →
  Reckon analog: Get started · Recommendation API · Personalization ·
  Scheduling · Quality & drift · Analytics · Developer resources.
- **Quickstart = the crown jewel**: "Accept a payment" with **UI-option tabs**
  (Stripe-hosted page / embedded / custom) and **payment-method category
  tabs** (cards, wallets, bank redirects…) → Reckon: "Serve your first
  recommendation" with integration-style tabs (hosted endpoint / SDK /
  streaming) and model-category tabs.
- **API reference discipline** (index headings): Authentication · Errors ·
  Idempotent requests · Expanding Responses · Versioning · Pagination. These
  are the API-craft laws the hardened Reckon API must adopt verbatim.
- **Webhooks reference**: snapshot vs thin events, Dashboard + API tabs,
  signature verification with official libraries, replay.
- 178 code blocks on the docs home alone — docs ARE runnable code.

## 4. Auth & account patterns (from the login/signup flow)

- Login page offers **email/password, Google, Passkey, SSO** in rank order.
- Google OAuth → if no account exists, **progressive signup** with email
  prefilled + full-name + country — zero re-typing of identity the IdP
  already vouches for.
- The session persists in the browser profile across restarts.

## 5. The build plan this survey implies (roadmap skeleton)

**Phase S1 — Marketing + docs site** (the visible "stripe.com"):
S1-001 marketing home (ticker, split hero + gradient mesh, product grid,
outcome headlines, social proof, dual CTA) · S1-002 product pages
(Recommendation API / Personalization / Scheduling / Analytics) · S1-003
pricing (per-1k-request tiers + volume calculator + comparison table) ·
S1-004 docs portal (quickstart with option tabs, API reference, webhooks
guide, SDK snippets).

**Phase S2 — API & developer experience** (the depth):
S2-001 Stripe-style API hardening (sk_/pk_ keys, versioned API,
idempotency-key semantics, expand, cursor pagination, typed error codes) ·
S2-002 recommendation webhooks (event catalog + HMAC signatures + replay) ·
S2-003 test mode (test keys, canned scenarios, toggle) · S2-004 reference
SDKs (TypeScript + Python).

**Phase S3 — Dashboard**: shell IA (Home / Recommendations / Models / Data
Sources / Analytics / Developers / Settings), API-keys + request-log +
events console, analytics views (CTR lift, latency, drift).

**Phase S4 — End-to-end + release**: the full signup→key→call→log→analytics
journey demo, production deploy, final evidence + release.

**Non-negotiable quality bar** (from the survey): code-first marketing
artifacts, outcome-phrased copy, test-mode-first DX, docs that run,
indigo-grade single brand accent, gradient-mesh hero, quantified social
proof, dual CTA conversion.
