/**
 * Reckon pricing page (S1-003) — typed content model for /pricing, in
 * the stripe.com pricing grammar (docs/surveys/stripe-com-survey.md §2 +
 * work item S1-003):
 *
 *   pricing hero → per-1k-request tiers → interactive volume calculator
 *   → "everything included" comparison table → FAQ → dual CTA.
 *
 * Laws (binding, S1-003 content honesty):
 *  - every price figure is ILLUSTRATIVE and labeled as such — Reckon has
 *    no billing system; nothing is metered or enforced (the page says so
 *    wherever a figure appears);
 *  - every feature listed EXISTS in the repo: comparison rows cross-
 *    check against real surfaces (apps/api routes, apps/web dashboard
 *    pages, apps/docs routes) and carry `dashboard` / `roadmap` marks
 *    where the surface is dashboard-only or not shipping yet;
 *  - tier semantics mirror the REAL key model (apps/api README "Test
 *    mode", S2-003): sk_test_ keys + canned scenarios are free forever,
 *    sk_live_ keys are the paid track, limits are typed 429s with
 *    Retry-After — never surprise invoices;
 *  - no invented customers, metrics, or social proof;
 *  - static, typed content only — no backend calls, no env vars.
 *
 * This module is deliberately SELF-CONTAINED (zero imports): it is
 * shared by the Next.js page, the client calculator, and the colocated
 * vitest suite, which typechecks under the root NodeNext program.
 */

/** The docs portal origin (the pinned seam — matches DOCS_BASE_URL in
 *  product-content.ts and ERROR_DOC_URL_BASE in packages/contracts). */
export const DOCS_BASE_URL = "https://docs.reckon.dev";

/** The sales contact (mailto, as on the home's dual CTA). */
export const SALES_HREF = "mailto:sales@reckon.dev";

/** The self-serve entry — the docs quickstart runs on a test-mode key. */
export const QUICKSTART_HREF = `${DOCS_BASE_URL}/get-started/quickstart`;

/** The honesty label shown wherever a price figure appears. */
export const ILLUSTRATIVE_NOTE =
  "Illustrative pricing — not yet billing-enforced. Reckon has no billing system; nothing here charges anything.";

/** The four pricing tiers, in display order. */
export const PRICING_TIER_IDS = [
  "developer",
  "standard",
  "scale",
  "enterprise",
] as const;

export type PricingTierId = (typeof PRICING_TIER_IDS)[number];

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

export const pricingHero = {
  eyebrow: "Pricing · Reckon platform",
  /** ONE outcome-phrased idea per line. */
  headline: ["Pay for decisions,", "not seats."],
  subheadline:
    "One metered unit — the live decision request. Build the whole integration free in test mode, then pay per 1,000 requests with volume discounts that apply automatically.",
  /** Mono chip — reuses the route-tag style; the pricing-status line. */
  caveatChip: "Illustrative pricing · not yet billing-enforced",
  microTrust:
    "No credit card · Test-mode keys from day one · Typed 429s at limits, never surprise invoices",
};

/* ------------------------------------------------------------------ */
/* Tiers                                                               */
/* ------------------------------------------------------------------ */

/** A tier-card feature bullet, honestly marked. */
export interface TierFeature {
  /** The bullet copy. */
  readonly text: string;
  /**
   * Where the feature really lives:
   *  - "included"  — ships in the repo today (API surface or docs);
   *  - "dashboard" — ships today, in the operator dashboard (apps/web);
   *  - "roadmap"   — does not exist yet; `ref` says what is planned.
   */
  readonly status: "included" | "dashboard" | "roadmap";
  /** For dashboard/roadmap marks: the surface or the work-item/planned note. */
  readonly ref?: string;
}

export interface PricingTier {
  readonly id: PricingTierId;
  readonly name: string;
  /** The big price figure ("$0", "$0.90", "from $0.63", "Custom"). */
  readonly priceLine: string;
  /** The unit line under the price. */
  readonly priceUnit: string;
  /** One-line audience descriptor. */
  readonly descriptor: string;
  /** Small ribbon on the card (only where it earns its place). */
  readonly badge?: string;
  /** The tier's CTA. */
  readonly cta: { readonly label: string; readonly href: string };
  /** 3–6 feature bullets. */
  readonly features: readonly TierFeature[];
  /** The illustrative caveat for priced tiers (omitted on free/custom). */
  readonly footnote?: string;
}

export const pricingTiers: readonly PricingTier[] = [
  {
    id: "developer",
    name: "Developer",
    priceLine: "$0",
    priceUnit: "free · test mode",
    descriptor: "Build and verify your entire integration before anyone pays anything.",
    cta: { label: "Start in test mode", href: QUICKSTART_HREF },
    features: [
      {
        text: "Test-mode keys (sk_test_) — no card, no clock",
        status: "included",
      },
      {
        text: "All eleven canned scenarios: decline, queue, switch, interrupt, error…",
        status: "included",
      },
      {
        text: "The full hardened API — idempotency, expand, versioning, pagination",
        status: "included",
      },
      {
        text: "API key manager",
        status: "dashboard",
        ref: "dashboard /developers/keys",
      },
    ],
  },
  {
    id: "standard",
    name: "Standard",
    priceLine: "$0.90",
    priceUnit: "per 1k requests · list rate",
    descriptor: "Go live. The hardened API and the full developer surface, at list rate.",
    badge: "Live traffic starts here",
    cta: { label: "Start now", href: QUICKSTART_HREF },
    features: [
      {
        text: "Live keys (sk_live_) on the frozen contracts",
        status: "included",
      },
      {
        text: "Webhooks with HMAC signatures + event replay",
        status: "included",
      },
      {
        text: "Request logs + webhook events console",
        status: "dashboard",
        ref: "dashboard /developers/logs · /developers/events",
      },
      {
        text: "Typed errors, opt-in per-key rate limits (429 + Retry-After)",
        status: "included",
      },
    ],
    footnote: "Illustrative list rate — not yet billing-enforced.",
  },
  {
    id: "scale",
    name: "Scale",
    priceLine: "from $0.63",
    priceUnit: "per 1k requests · volume-discounted",
    descriptor: "Volume pricing that steps down automatically as traffic grows.",
    badge: "Volume pricing",
    cta: { label: "Estimate your volume", href: "#calculator" },
    features: [
      {
        text: "Automatic volume discounts — 10% at 5M, 20% at 25M, 30% at 100M requests/mo",
        status: "included",
      },
      {
        text: "Analytics views — lift, latency, drift",
        status: "roadmap",
        ref: "dashboard analytics views (work item S3-002)",
      },
      {
        text: "Priority routing",
        status: "roadmap",
        ref: "planned — no work item yet",
      },
      {
        text: "Everything in Standard, including webhooks + replay",
        status: "included",
      },
    ],
    footnote:
      "Illustrative — discounts apply automatically at 5M / 25M / 100M requests per month.",
  },
  {
    id: "enterprise",
    name: "Enterprise",
    priceLine: "Custom",
    priceUnit: "volume agreements",
    descriptor: "A named track for large volumes and custom terms.",
    cta: { label: "Contact sales", href: SALES_HREF },
    features: [
      {
        text: "Custom per-1k rates + volume agreements on your actual traffic",
        status: "included",
      },
      {
        text: "Direct line to the team building the engine",
        status: "included",
      },
      {
        text: "SSO + audit surface",
        status: "roadmap",
        ref: "planned — no work item yet",
      },
    ],
  },
];

/** The tiers section heading. */
export const tiersSection = {
  eyebrow: "Tiers",
  title: "Free to build. Priced per decision.",
  sub: "Test mode is free and fully featured. Live traffic is metered per 1,000 decision requests — one unit, no seats, no platform fee.",
};

/** The shared honesty note under the tier grid. */
export const tiersFootnote =
  "Every tier gets the full platform — nothing that exists today is gated behind a paid plan. Prices are illustrative while billing does not exist; when it ships, this page changes in the same commit.";

/* ------------------------------------------------------------------ */
/* Volume calculator                                                   */
/* ------------------------------------------------------------------ */

export const calculatorCopy = {
  eyebrow: "Volume calculator",
  title: "Your rate, at your volume.",
  sub: "Slide to your monthly live decision volume — the per-1k tier and volume discount apply automatically. Test-mode traffic never counts.",
  /** The calculator's initial volume (requests/month). */
  defaultVolume: 1_000_000,
  /** Slider bounds (the number field allows more, up to inputMax). */
  sliderMax: 100_000_000,
  sliderStep: 10_000,
  /** Hard cap for typed input — beyond this is firmly enterprise territory. */
  inputMax: 2_000_000_000,
  presets: [10_000, 100_000, 1_000_000, 10_000_000, 100_000_000] as const,
  inputLabel: "Requests per month",
  sliderLabel: "Monthly decision requests (slider)",
  presetsLabel: "Preset volumes",
  readoutTierLabel: "Tier",
  readoutRateLabel: "Effective rate",
  readoutUnitsLabel: "Billable units (1k)",
  readoutEstimateLabel: "Estimated monthly",
  zeroVolumeNote: "Zero live volume — everything runs free in test mode.",
  handoffTitle: "Custom territory.",
  handoffBody:
    "Volume agreements start at 500M requests per month. The calculator stops quoting here; sales starts listening.",
  handoffCta: { label: "Contact sales", href: SALES_HREF },
  footnote:
    "Estimates are illustrative and round up to full 1,000-request units. Not yet billing-enforced — no metering, no invoices, no surprises.",
};

/* ------------------------------------------------------------------ */
/* "Everything included" comparison table                              */
/* ------------------------------------------------------------------ */

/** A cell in the features × tiers matrix. */
export type ComparisonCell =
  | { readonly kind: "included" }
  /** Included, and the surface lives in the operator dashboard. */
  | { readonly kind: "dashboard" }
  /** Not shipping yet — the row's roadmapRef says what is planned. */
  | { readonly kind: "roadmap" }
  /** Enterprise-specific custom terms. */
  | { readonly kind: "custom" }
  | { readonly kind: "none" };

export interface ComparisonRow {
  /** Stable id — pinned unique by tests. */
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** One cell per tier, keyed by PricingTierId. */
  readonly cells: Readonly<Record<PricingTierId, ComparisonCell>>;
  /** Optional docs deep-link (a REAL apps/docs route — test-pinned). */
  readonly docsHref?: string;
  /** Dashboard surface path (apps/web route) when any cell is dashboard. */
  readonly dashboardRef?: string;
  /** What the roadmap mark means, when any cell is roadmap. */
  readonly roadmapRef?: string;
}

const included: ComparisonCell = { kind: "included" };
const dashboard: ComparisonCell = { kind: "dashboard" };
const roadmap: ComparisonCell = { kind: "roadmap" };
const custom: ComparisonCell = { kind: "custom" };
const none: ComparisonCell = { kind: "none" };

export const comparisonSection = {
  eyebrow: "Everything included",
  title: "One platform. Every tier gets the real thing.",
  sub: "What exists today ships to every key — the matrix marks dashboard-only surfaces and roadmap items honestly instead of gating features.",
  ariaLabel: "Feature comparison across Reckon pricing tiers",
  footnote:
    "Dashboard surfaces ship in the Reckon operator dashboard. Roadmap items do not exist yet and are labeled as planned — never sold as shipped.",
};

export const comparisonRows: readonly ComparisonRow[] = [
  {
    id: "test-mode",
    label: "Test mode + canned scenarios",
    description: "sk_test_ keys, eleven deterministic scenarios, fully separated state.",
    cells: { developer: included, standard: included, scale: included, enterprise: included },
    docsHref: `${DOCS_BASE_URL}/api-reference/authentication`,
  },
  {
    id: "api-craft",
    label: "Hardened API craft",
    description: "Idempotency keys, ?expand[], version pinning, cursor pagination.",
    cells: { developer: included, standard: included, scale: included, enterprise: included },
    docsHref: `${DOCS_BASE_URL}/api-reference/idempotent-requests`,
  },
  {
    id: "typed-errors",
    label: "Typed errors + 429 rate limiting",
    description: "Stable machine codes with doc links; opt-in per-key limits with Retry-After.",
    cells: { developer: included, standard: included, scale: included, enterprise: included },
    docsHref: `${DOCS_BASE_URL}/api-reference/errors`,
  },
  {
    id: "live-keys",
    label: "Live keys (sk_live_)",
    description: "Live-mode traffic on the frozen contracts — the paid meter starts.",
    cells: { developer: none, standard: included, scale: included, enterprise: included },
  },
  {
    id: "webhooks",
    label: "Webhooks + event replay",
    description: "Signed events, endpoint management, replay from the delivery log.",
    cells: { developer: none, standard: included, scale: included, enterprise: included },
    docsHref: `${DOCS_BASE_URL}/webhooks`,
  },
  {
    id: "request-logs",
    label: "Request logs",
    description: "Cursor-paginated log of every call — time, route, status, latency.",
    cells: { developer: none, standard: dashboard, scale: dashboard, enterprise: dashboard },
    dashboardRef: "/developers/logs",
  },
  {
    id: "events-console",
    label: "Webhook events console",
    description: "Event types, delivery status, and replay from the dashboard.",
    cells: { developer: none, standard: dashboard, scale: dashboard, enterprise: dashboard },
    dashboardRef: "/developers/events",
  },
  {
    id: "keys-manager",
    label: "API key manager",
    description: "List, create, and revoke keys with live-mode confirmation gating.",
    cells: { developer: dashboard, standard: dashboard, scale: dashboard, enterprise: dashboard },
    dashboardRef: "/developers/keys",
  },
  {
    id: "sdks",
    label: "TypeScript SDK",
    description: "The typed client over the frozen contracts (Python is roadmap).",
    cells: { developer: included, standard: included, scale: included, enterprise: included },
    docsHref: `${DOCS_BASE_URL}/sdks`,
  },
  {
    id: "docs",
    label: "Docs portal + quickstart",
    description: "Quickstart, API reference, webhooks guide — your first call in minutes.",
    cells: { developer: included, standard: included, scale: included, enterprise: included },
    docsHref: QUICKSTART_HREF,
  },
  {
    id: "volume-discounts",
    label: "Automatic volume discounts",
    description: "The per-1k rate steps down at 5M / 25M / 100M requests per month.",
    cells: { developer: none, standard: none, scale: included, enterprise: custom },
  },
  {
    id: "analytics-views",
    label: "Analytics views",
    description: "CTR lift, latency percentiles, drift indicators, funnels.",
    cells: { developer: none, standard: none, scale: roadmap, enterprise: roadmap },
    dashboardRef: "/analytics",
    roadmapRef: "dashboard analytics views (work item S3-002)",
  },
  {
    id: "priority-routing",
    label: "Priority routing",
    description: "Preferred capacity allocation at sustained high volume.",
    cells: { developer: none, standard: none, scale: roadmap, enterprise: roadmap },
    roadmapRef: "planned — no work item yet",
  },
  {
    id: "support",
    label: "Support",
    description: "Docs portal today, plus email — SLAs do not exist yet.",
    cells: {
      developer: { kind: "included" },
      standard: { kind: "included" },
      scale: { kind: "included" },
      enterprise: { kind: "included" },
    },
  },
  {
    id: "sso-audit",
    label: "SSO + audit surface",
    description: "Enterprise identity and audit trails for the dashboard.",
    cells: { developer: none, standard: none, scale: none, enterprise: roadmap },
    roadmapRef: "planned — no work item yet",
  },
];

/* ------------------------------------------------------------------ */
/* FAQ — honest answers per the repo's actual semantics                */
/* ------------------------------------------------------------------ */

export const faqSection = {
  eyebrow: "FAQ",
  title: "The honest fine print.",
  sub: "Six questions, answered the way the API actually behaves — not the way pricing pages usually talk.",
};

export interface FaqEntry {
  readonly question: string;
  readonly answer: string;
}

export const faqEntries: readonly FaqEntry[] = [
  {
    question: "What counts as a request?",
    answer:
      "One live-mode decision request — a POST /v1/decisions call made with an sk_live_ key. Nothing else is metered: preference events, outcome reports, and plan operations are not decision requests, and test-mode traffic never counts. Volume is billed in full 1,000-request units, so the calculator rounds up. And to be completely plain: nothing is metered today — billing does not exist yet, so all of this describes the designed model, not an invoice you could receive.",
  },
  {
    question: "What is the difference between test and live mode?",
    answer:
      "The mode lives in the key. An sk_test_ key runs every decision against the canned scenario engine — default, decline, queue, switch, interrupt, error, and friends — with state that is fully separated from live data and an X-Reckon-Mode: test marker on every response. An sk_live_ key runs your mounted handlers for real. The request shape, the frozen contracts, and the error catalog are identical in both modes, so the code you verify in test mode is the code that goes live.",
  },
  {
    question: "What happens when I hit a limit?",
    answer:
      "A typed 429 rate_limit_error — RATE_LIMIT_EXCEEDED — with a Retry-After header telling your client exactly how many seconds until the window resets. It is a stable machine code your code branches on, never a surprise charge. Rate limiting is opt-in per-key configuration today (off unless configured), and with no billing system there is no overage invoice to fear: the enforcement that exists is honest errors, not meters.",
  },
  {
    question: "Are these prices real?",
    answer:
      "No — and the page says so wherever a figure appears. Reckon does not have a billing system yet: the rates are illustrative of how per-1k pricing is designed to work, and nothing on this page can charge you anything. When billing ships, the figures and this answer change in the same commit.",
  },
  {
    question: "Is anything gated behind a paid tier today?",
    answer:
      "No. Every feature that exists in the repository — test mode, the hardened API surface, webhooks with replay, the dashboard's request logs, events console, and key manager, the TypeScript SDK — is available to every key. The tiers describe designed volume pricing, not current gates, and the comparison table marks dashboard-only and roadmap items instead of implying shipped features.",
  },
  {
    question: "Do you offer enterprise agreements?",
    answer:
      "Yes — the track exists. Contact sales for volume agreements and custom per-1k rates on your actual traffic. Honestly: SSO and the audit surface are roadmap, not shipping today, and the conversation starts from what is real.",
  },
];

/* ------------------------------------------------------------------ */
/* Final CTA + page metadata                                           */
/* ------------------------------------------------------------------ */

export const pricingFinalCta = {
  title: "Start deciding in minutes.",
  sub: "Grab a test key, run the canned scenarios, and price your real volume when you are ready — no card, no clock.",
  primaryCta: { label: "Start in test mode", href: QUICKSTART_HREF },
  secondaryCta: { label: "Contact sales", href: SALES_HREF },
};

export const pricingMetadata = {
  title: "Pricing — Reckon",
  description:
    "Per-1k-request pricing for Reckon: free test mode with canned scenarios, live keys at $0.90 per 1,000 decision requests with automatic volume discounts, and a custom enterprise track. Illustrative figures — billing is not yet enforced.",
};
