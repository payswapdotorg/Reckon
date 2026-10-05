/**
 * Reckon marketing — legal pages content (S5-001): /terms and /privacy.
 *
 * Laws (work item S5-001):
 *  - TEMPLATE TEXT, PENDING LEGAL REVIEW — stated plainly on the page
 *    (status chip + intro paragraph), never implied to be reviewed or
 *    binding. No claims about company registration, jurisdictions,
 *    counsels, or compliance certifications (none exist to cite);
 *  - every factual statement about the product mirrors the repo's real
 *    semantics (test mode with sk_test_ keys + canned scenarios, live
 *    keys + billing not yet enforced, illustrative pricing figures) —
 *    the same honesty law as the pricing page (S1-003);
 *  - plain language, outcome-first sentences, no legalese thickets;
 *  - static, typed content only — no backend calls, no env vars.
 *
 * This module is deliberately SELF-CONTAINED (zero imports): it is
 * shared by the Next.js pages and the colocated vitest suite, which
 * typechecks under the root NodeNext program.
 */

/** The honesty chip shown on both legal pages (the evidence class). */
export const LEGAL_STATUS_CHIP = "Template text · pending legal review";

/** Date of this template (repo timeline — matches the S5-001 authoring date). */
export const LEGAL_LAST_UPDATED = "2026-10-05";

export type LegalDocId = "terms" | "privacy";

export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalDoc {
  id: LegalDocId;
  /** The route this doc ships at. */
  path: `/terms` | `/privacy`;
  /** The page H1. */
  title: string;
  /** Page metadata title (browser tab / social card). */
  metadata: { title: string; description: string };
  eyebrow: string;
  /** The mono status line rendered under the headline. */
  statusChip: string;
  lastUpdated: string;
  intro: string;
  sections: LegalSection[];
  contact: { label: string; href: string };
}

const CONTACT_TERMS = { label: "legal@reckon.dev", href: "mailto:legal@reckon.dev" };
const CONTACT_PRIVACY = { label: "privacy@reckon.dev", href: "mailto:privacy@reckon.dev" };

export const termsDoc: LegalDoc = {
  id: "terms",
  path: "/terms",
  title: "Terms of Service",
  metadata: {
    title: "Terms of Service — Reckon",
    description:
      "The template terms for using Reckon — what the service is today (test mode with canned scenarios, live keys not yet billing-enforced), what you may and may not do, and what happens when things change. Template text, pending legal review.",
  },
  eyebrow: "Legal",
  statusChip: LEGAL_STATUS_CHIP,
  lastUpdated: LEGAL_LAST_UPDATED,
  intro:
    "These terms describe how you may use Reckon. They are template text, pending legal review: nothing here is legal advice, and the reviewed agreement may differ. If any statement below conflicts with how the service actually behaves, the service's real behavior wins — and we want to hear about it.",
  sections: [
    {
      heading: "The service, as it exists today",
      paragraphs: [
        "Reckon is recommendation infrastructure: APIs that decide what to show, say, and send next — decisions, preference events, experience plans, and outcome measurements. Today the service operates in test mode: test keys (sk_test_…) run against canned scenarios, and live keys are not yet billing-enforced.",
        "Every pricing figure you see on this site is illustrative and clearly labeled as such. Nothing is metered, invoiced, or charged while these terms are in template form.",
      ],
    },
    {
      heading: "Your account and your keys",
      paragraphs: [
        "You are responsible for the keys issued to you and for keeping them secret. Treat every key like a password: do not commit it to source control, do not paste it into shared documents, do not send it over email.",
        "You are responsible for what is sent through the API under your account, including by anyone who obtains your keys.",
      ],
    },
    {
      heading: "Acceptable use",
      paragraphs: [
        "Use the service lawfully. Do not attack it, do not attempt to extract other customers' data, do not use it to build content that infringes others' rights, and do not resell raw API access as if it were your own infrastructure.",
        "We may rate-limit or refuse traffic that abuses the service — today as typed 429 responses with a Retry-After header, never as surprise invoices.",
      ],
    },
    {
      heading: "Your content and ours",
      paragraphs: [
        "Your content stays yours. The candidates, preference events, plans, and outcome measurements you send through the API remain your data; we process them only to operate the service for you.",
        "The Reckon service, its contracts, documentation, and brand are ours. You may reference them honestly (in documentation, blog posts, talks) — you may not claim to own or to have built them.",
      ],
    },
    {
      heading: "Disclaimers",
      paragraphs: [
        "The service is provided as-is during this template period. Test-mode results come from canned scenarios, not from production-grade models; do not treat them as production recommendations or as performance claims.",
        "We work to keep the service available and correct, and we will be honest in our documentation when it is not. Beyond that, no warranties are offered while this text is a template.",
      ],
    },
    {
      heading: "Liability",
      paragraphs: [
        "While these terms are in template form, Reckon's aggregate liability to you for claims arising out of the service is capped at the amount you have actually paid us — which, while billing is not enforced, is zero.",
      ],
    },
    {
      heading: "Termination and changes",
      paragraphs: [
        "You may stop using the service at any time; you may close your account by asking us to. We may suspend accounts that violate these terms, with notice where practical.",
        "We may change these terms as the reviewed agreement is finalized. Material changes will be announced on this page with a new last-updated date, not buried in silence.",
      ],
    },
    {
      heading: "Contact",
      paragraphs: [
        "Questions about these terms go to legal@reckon.dev — a human reads every message, even at template stage.",
      ],
    },
  ],
  contact: CONTACT_TERMS,
};

export const privacyDoc: LegalDoc = {
  id: "privacy",
  path: "/privacy",
  title: "Privacy Policy",
  metadata: {
    title: "Privacy Policy — Reckon",
    description:
      "What Reckon collects (account details and API request metadata), what it is used for (operating the service, debugging, abuse prevention — no ad tracking, no data selling), and how to reach us. Template text, pending legal review.",
  },
  eyebrow: "Legal",
  statusChip: LEGAL_STATUS_CHIP,
  lastUpdated: LEGAL_LAST_UPDATED,
  intro:
    "This policy describes what data Reckon handles and why. It is template text, pending legal review — we would rather tell you plainly what exists today than pretend at a reviewed policy that is not real yet.",
  sections: [
    {
      heading: "What we collect",
      paragraphs: [
        "Account details you give us when you sign up: your name, your email address, and basic account preferences. Authentication is delegated to an identity provider — we never store your password.",
        "API request metadata: the requests your integrations send (tenant and request identifiers, timestamps, payload shapes) and the decisions, preference events, plans, and outcomes they carry. This is the data the service exists to process.",
        "Operational telemetry: logs and metrics needed to run the service — error rates, latency figures, request counts.",
      ],
    },
    {
      heading: "What we do with it",
      paragraphs: [
        "We use your data to operate the service for you: to serve decisions, to keep the API working, to debug failures, and to prevent abuse. That is the whole list.",
        "We do not sell your data. We do not run advertising trackers. We do not build third-party audience profiles from what you send through the API.",
      ],
    },
    {
      heading: "Test-mode data",
      paragraphs: [
        "Test keys run against canned scenarios. Test-mode requests may be retained in logs to debug the service; do not send real people's personal data in test mode.",
        "When live mode ships with billing, this section will say so plainly, with the retention and processing terms that come with it.",
      ],
    },
    {
      heading: "Where it lives and how long",
      paragraphs: [
        "Your data is processed by the infrastructure that runs this deployment. Retention periods for each data class will be stated numerically once set with counsel; until then, request logs are kept no longer than needed to operate and debug the service.",
      ],
    },
    {
      heading: "Security",
      paragraphs: [
        "We apply reasonable technical and organizational measures: secrets are handled as secrets, access to production data is limited, and traffic is encrypted in transit. No system is perfect — if you believe you have found a problem, tell us and we will act on it.",
      ],
    },
    {
      heading: "Your rights and choices",
      paragraphs: [
        "You can ask to access, correct, or delete the personal data we hold about you by writing to privacy@reckon.dev. Response timelines will be committed to when this template is reviewed; today, a human answers as fast as a small team can.",
        "You can stop sending data through the API at any time — and you can ask us to close your account.",
      ],
    },
    {
      heading: "Children",
      paragraphs: [
        "Reckon is developer infrastructure. It is not directed at children, and we do not knowingly collect personal data from them.",
      ],
    },
    {
      heading: "Changes to this policy",
      paragraphs: [
        "We will post changes on this page with an updated date rather than editing quietly. If a change is material, we will say so at the top of the page.",
      ],
    },
    {
      heading: "Contact",
      paragraphs: [
        "Privacy questions go to privacy@reckon.dev. For anything urgent, that address is also the fastest door.",
      ],
    },
  ],
  contact: CONTACT_PRIVACY,
};

/** Both legal docs, keyed by route id — the footer links point here. */
export const legalDocs: Record<LegalDocId, LegalDoc> = {
  terms: termsDoc,
  privacy: privacyDoc,
};
