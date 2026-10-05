/**
 * Reckon marketing home — typed content model (S1-001).
 *
 * Laws (docs/surveys/stripe-com-survey.md §2 + §5):
 *  - outcome-phrased copy, one idea per headline line, never feature lists;
 *  - quantified social proof with fictional-but-plausible B2B names;
 *  - dual CTA (self-serve "Start now" + enterprise "Contact sales");
 *  - code-first marketing artifacts shaped by the frozen @reckon/contracts
 *    (DecisionRequest / DecisionResult, POST /v1/decisions);
 *  - static, typed content only — no backend calls, no env vars.
 *
 * TARGET NOTE: this file is shared verbatim between the preview build and
 * the monorepo `apps/marketing` build, with ONE deliberate difference —
 * START_NOW_HREF. The preview build has a single route, so the self-serve
 * CTA anchors to the in-page start section; the monorepo build ships the
 * S1-003 placeholder route /pricing and points the CTA there.
 */

/**
 * Primary CTA target. Monorepo build: "/pricing" (S1-003 placeholder route).
 * Preview build: "#get-started" (the code-first section on this page).
 */
export const START_NOW_HREF = "/pricing";

export interface CtaLink {
  label: string;
  href: string;
}

/** Dual CTA pair — used on the hero, every section tail, and the final band. */
export const primaryCta: CtaLink = { label: "Start now", href: START_NOW_HREF };
export const secondaryCta: CtaLink = {
  label: "Contact sales",
  href: "mailto:sales@reckon.dev",
};

export interface NavItem {
  label: string;
  href: string;
  /** Placeholder links disclose that their surface ships later. */
  placeholder?: boolean;
}

export const headerNav: NavItem[] = [
  { label: "Product", href: "#product" },
  { label: "Docs", href: "#", placeholder: true },
  { label: "Pricing", href: "#", placeholder: true },
];

export const headerActions: { signIn: NavItem; startNow: CtaLink } = {
  signIn: { label: "Sign in", href: "#", placeholder: true },
  startNow: primaryCta,
};

/**
 * Live-stat ticker (survey §2.1). The figure is a static placeholder until
 * real network telemetry lands (S2/S3); it is explicitly labeled as a
 * network stat so the claim stays honest.
 */
export const tickerStat = {
  label: "Recommendations served across the Reckon network this week",
  value: 41_233_598,
  note: "Network stat · refreshed weekly",
};

export const hero = {
  headline: ["Recommendation infrastructure", "for every product."],
  subheadline:
    "Reckon decides what to show, say, and send next — one API call, every surface, measured end-to-end.",
  primaryCta,
  secondaryCta,
  microTrust: "No credit card required · Test-mode keys from day one",
};

export type ProductIconKind = "api" | "personalization" | "scheduling" | "analytics";

export interface Product {
  id: string;
  name: string;
  /** ONE outcome-phrased line. Never a feature list. */
  outcome: string;
  /** Mono tag grounded in a real API route (apps/api/src/routes/*). */
  routeTag: string;
  href: string;
  placeholder: boolean;
  icon: ProductIconKind;
}

export const productSection = {
  eyebrow: "The platform",
  title: "The backbone of every intelligent surface.",
  sub: "Four primitives, one decision engine — feeds, digests, queues, and notifications all ask Reckon what comes next.",
};

export const products: Product[] = [
  {
    id: "recommendation-api",
    name: "Recommendation API",
    outcome: "Decide what to show next with one API call.",
    routeTag: "POST /v1/decisions",
    href: "#",
    placeholder: true,
    icon: "api",
  },
  {
    id: "personalization",
    name: "Personalization",
    outcome: "Adapt every surface to the person seeing it.",
    routeTag: "/v1/preferences",
    href: "#",
    placeholder: true,
    icon: "personalization",
  },
  {
    id: "scheduling",
    name: "Scheduling",
    outcome: "Arrive at the right moment, not the loudest one.",
    routeTag: "/v1/plans",
    href: "#",
    placeholder: true,
    icon: "scheduling",
  },
  {
    id: "analytics",
    name: "Analytics",
    outcome: "Prove the lift, not just the clicks.",
    routeTag: "/v1/outcomes",
    href: "#",
    placeholder: true,
    icon: "analytics",
  },
];

export const codeSection = {
  eyebrow: "Developers",
  title: "Your first recommendation, in one call.",
  sub: "A typed request. A decision you can inspect — confidence, reasons, latency. Never a black box.",
  responseLabel: "Response · 200 OK",
  craftNotes: [
    "Idempotency keys built in",
    "Typed error codes",
    "Frozen, versioned contracts",
  ],
};

/** Request snippet — cURL against the real POST /v1/decisions contract. */
export const curlSnippet = `curl https://api.reckon.dev/v1/decisions \\
  -H "Authorization: Bearer sk_test_51reckon" \\
  -H "Content-Type: application/json" \\
  -d '{
    "schema": "reckon.decision-request",
    "requestId": "req_7f3a91c2",
    "tenant": { "tenantId": "tn_ardent" },
    "subject": { "kind": "user", "ref": "usr_2841" },
    "objective": { "objectiveId": "obj_home_feed", "kind": "discover" },
    "attentionPolicy": { "policyId": "ap_balanced", "style": "balanced" },
    "context": { "contextId": "ctx_9917" },
    "candidates": {
      "setId": "cs_home_2841",
      "candidates": [
        { "itemId": "itm_linen_throw", "source": "host-retrieval", "scoreHint": 0.62 },
        { "itemId": "itm_walnut_clock", "source": "host-retrieval", "scoreHint": 0.58 }
      ]
    },
    "policySelector": { "policyId": "pol_feed_v3" },
    "idempotencyKey": "idem_6b41"
  }'`;

/** Request snippet — @reckon/sdk usage, mirrors packages/sdk/src/index.ts. */
export const typescriptSnippet = `import { createReckonClient } from "@reckon/sdk";

const reckon = createReckonClient({
  baseUrl: "https://api.reckon.dev",
  apiKey: process.env.RECKON_API_KEY!,
});

const decision = await reckon.decisions.request({
  requestId: "req_7f3a91c2",
  tenant: { tenantId: "tn_ardent" },
  subject: { kind: "user", ref: "usr_2841" },
  objective: { objectiveId: "obj_home_feed", kind: "discover" },
  attentionPolicy: { policyId: "ap_balanced", style: "balanced" },
  context: { contextId: "ctx_9917" },
  candidates: {
    setId: "cs_home_2841",
    candidates: [
      { itemId: "itm_linen_throw", source: "host-retrieval" },
      { itemId: "itm_walnut_clock", source: "host-retrieval" },
    ],
  },
  policySelector: { policyId: "pol_feed_v3" },
  idempotencyKey: "idem_6b41",
});

decision.selectedExperience; // the experience to render`;

/**
 * Response snippet — a DecisionResult exactly shaped by
 * packages/contracts/src/decision.ts (schema, action, selectedExperience,
 * alternatives, uncertainty, policy, reasons, provenance, latency, at).
 */
export const responseSnippet = `{
  "schema": "reckon.decision-result",
  "schemaVersion": "0.1.0",
  "decisionId": "dec_8c41f2",
  "requestId": "req_7f3a91c2",
  "tenant": { "tenantId": "tn_ardent" },
  "action": "SUGGEST",
  "selectedExperience": {
    "schema": "reckon.experience",
    "experienceId": "exp_55d10c",
    "itemId": "itm_linen_throw",
    "realizationId": "rlz_primary",
    "format": { "kind": "card", "params": { "aspect": "square" } },
    "objectiveFit": { "fitScore": 0.94 }
  },
  "alternatives": [
    { "experienceId": "exp_9a02f1", "score": 0.71, "reason": "lower affinity" }
  ],
  "uncertainty": { "confidence": 0.91, "method": "ensemble-spread" },
  "policy": { "policyId": "pol_feed_v3", "version": "12" },
  "reasons": [
    { "code": "affinity", "message": "Strong affinity: home goods, evening browsing." }
  ],
  "provenance": { "system": "reckon-core", "version": "0.1.0" },
  "latency": { "latencyMsP50": 38, "latencyMsP95": 61 },
  "at": 1760000000000
}`;

export interface CaseStudy {
  company: string;
  metric: string;
  metricLabel: string;
  headline: string;
  quote: string;
  person: string;
  role: string;
}

export const proofSection = {
  eyebrow: "Proof",
  title: "Teams that measure, ship Reckon.",
  sub: "Quantified outcomes from the first wave of Reckon builders.",
};

/** Fictional-but-plausible B2B names — no real trademarks. */
export const caseStudies: CaseStudy[] = [
  {
    company: "Ardent Commerce",
    metric: "+34%",
    metricLabel: "feed click-through",
    headline: "Ardent Commerce lifted CTR 34% with Reckon",
    quote: "We replaced three homegrown rankers with one decision call.",
    person: "Maya Okonkwo",
    role: "Head of Growth, Ardent Commerce",
  },
  {
    company: "MeridianStream",
    metric: "−18%",
    metricLabel: "listener churn",
    headline: "MeridianStream cut churn 18% with Reckon",
    quote: "Digests now land when each listener actually opens — not when a cron fires.",
    person: "Jonas Feld",
    role: "VP Product, MeridianStream",
  },
  {
    company: "Vaultline",
    metric: "+27%",
    metricLabel: "checkout conversion",
    headline: "Vaultline converted 27% more carts with Reckon",
    quote: "Next-best-offer went from guesswork to a typed contract.",
    person: "Priya Raman",
    role: "Director of Engineering, Vaultline",
  },
];

export const proofLogos = [
  "Ardent Commerce",
  "MeridianStream",
  "Vaultline",
  "Fablecraft",
  "Oscilla",
];

export const finalCta = {
  title: "Start deciding in minutes.",
  sub: "Sign up, grab a test key, and serve your first recommendation — no sales call required.",
  primaryCta,
  secondaryCta,
};

/** Footer — the four-surface IA (survey §1) as placeholder links. */
export const footerSurfaces: NavItem[] = [
  { label: "Product", href: "#product" },
  { label: "Docs", href: "#", placeholder: true },
  { label: "Pricing", href: "#", placeholder: true },
  { label: "Dashboard", href: "#", placeholder: true },
];

export interface FooterColumn {
  heading: string;
  links: NavItem[];
}

export const footerColumns: FooterColumn[] = [
  {
    heading: "Products",
    links: [
      { label: "Recommendation API", href: "#", placeholder: true },
      { label: "Personalization", href: "#", placeholder: true },
      { label: "Scheduling", href: "#", placeholder: true },
      { label: "Analytics", href: "#", placeholder: true },
    ],
  },
  {
    heading: "Developers",
    links: [
      { label: "Documentation", href: "#", placeholder: true },
      { label: "API reference", href: "#", placeholder: true },
      { label: "Quickstart", href: "#", placeholder: true },
      { label: "Webhooks guide", href: "#", placeholder: true },
      { label: "Status", href: "#", placeholder: true },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "Contact sales", href: secondaryCta.href },
      { label: "Security", href: "#", placeholder: true },
      { label: "Privacy", href: "#", placeholder: true },
      { label: "Terms", href: "#", placeholder: true },
    ],
  },
];

export const footerMeta = {
  brandLine: "Recommendation infrastructure for every product.",
  copyright: "© 2026 Reckon. All rights reserved.",
  contractChip: "reckon.decision-result · v0.1.0",
};
