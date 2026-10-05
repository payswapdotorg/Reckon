/**
 * Reckon product pages (S1-002) — typed content model for the four
 * product pages at /products/<id>, in the stripe.com product-page grammar
 * (docs/surveys/stripe-com-survey.md §2 + work item S1-002):
 *
 *   product hero → code-first artifact → feature sections →
 *   how-it-works strip → related products band → docs deep-links.
 *
 * Laws (binding, S1-002 content honesty):
 *  - every request/response pair is a REAL call against the frozen
 *    @reckon/contracts surface (apps/api/src/routes/{decisions,preferences,
 *    plans,outcomes}.ts) — no invented fields; example values mirror the
 *    contract-validated fixtures in apps/docs/src/content/fixtures;
 *  - every number in copy is either real from the repo (enum lengths,
 *    window sizes) or explicitly labeled illustrative;
 *  - outcome-phrased headlines, ONE idea per line, never feature lists;
 *  - docs deep-links point at the docs app's REAL routes
 *    (apps/docs/src/content/navigation.ts — the docs portal ships at
 *    docs.reckon.dev);
 *  - static, typed content only — no backend calls, no env vars.
 *
 * This module is deliberately SELF-CONTAINED (zero imports): it is shared
 * by the Next.js pages and the colocated vitest suite, which typechecks
 * under the root NodeNext program (no "@"-alias chains — see
 * apps/web/test conventions).
 */

/** The docs portal origin (the pinned seam — matches ERROR_DOC_URL_BASE in packages/contracts/src/api-platform.ts). */
export const DOCS_BASE_URL = "https://docs.reckon.dev";

/** Product page ids — exactly the marketing home's products[] ids. */
export const PRODUCT_PAGE_IDS = [
  "recommendation-api",
  "personalization",
  "scheduling",
  "analytics",
] as const;

export type ProductPageId = (typeof PRODUCT_PAGE_IDS)[number];

/** One docs deep-link: label, one-line description, REAL docs route. */
export interface DocsDeepLink {
  label: string;
  description: string;
  /** Absolute href into the docs portal (DOCS_BASE_URL + a real apps/docs route). */
  href: string;
}

/** One capability block — outcome-phrased headline + one-line body. */
export interface ProductFeature {
  headline: string;
  body: string;
}

/** One how-it-works step — integrate → decide → observe, mapped to the product's flow. */
export interface ProductStep {
  label: string;
  title: string;
  body: string;
}

/** A code-first marketing artifact: language tabs + typed response. */
export interface CodeTab {
  id: string;
  label: string;
  language: "curl" | "typescript";
  code: string;
}

export interface ProductCodeArtifact {
  eyebrow: string;
  title: string;
  sub: string;
  tabs: CodeTab[];
  responseLabel: string;
  /** JSON string — parseable, shaped by the real frozen contract. */
  response: string;
  craftNotes: string[];
}

export interface ProductPageContent {
  /** Product id — one of PRODUCT_PAGE_IDS. */
  id: ProductPageId;
  name: string;
  /** Hero eyebrow: product name + platform tag. */
  eyebrow: string;
  /** ONE outcome-phrased idea per line. */
  headline: readonly string[];
  subheadline: string;
  /** Mono route tag — mirrors products[].routeTag and a real registered route. */
  routeTag: string;
  microTrust: string;
  code: ProductCodeArtifact;
  /** 3–5 capability blocks. */
  features: readonly ProductFeature[];
  /** Exactly 3 steps. */
  steps: readonly ProductStep[];
  /** Docs deep-links into the real docs portal routes. */
  docsLinks: readonly DocsDeepLink[];
  /** Per-page <Metadata> (title + description). */
  metadata: { title: string; description: string };
}

/* ------------------------------------------------------------------ */
/* Shared demo key — mirrors the docs quickstart DEMO_KEY (test mode). */
/* ------------------------------------------------------------------ */

const DEMO_KEY = "sk_test_51DmReckonExampleKey4eC39";

/* ================================================================== */
/* Recommendation API — POST /v1/decisions                             */
/* (contracts: packages/contracts/src/decision.ts; route:              */
/*  apps/api/src/routes/decisions.ts; fixtures: apps/docs quickstart)  */
/* ================================================================== */

const recommendationApiCurl = `curl https://api.reckon.dev/v1/decisions \\
  -H "Authorization: Bearer ${DEMO_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "schema": "reckon.decision-request",
    "schemaVersion": "0.1.0",
    "requestId": "req_01J8ZWK3Q7",
    "tenant": { "tenantId": "demo" },
    "subject": { "kind": "user", "ref": "usr_88213" },
    "objective": { "objectiveId": "obj_relax_evening", "version": "1", "kind": "relax", "params": {} },
    "attentionPolicy": { "policyId": "att_balanced", "version": "1", "style": "balanced", "params": {} },
    "context": { "contextId": "ctx_01J8ZWJ9K2" },
    "candidates": {
      "setId": "cand_01J8ZWJ4P8",
      "candidates": [
        { "itemId": "item_reef_doc", "realizationIds": ["rlz_reef_en_hd"], "source": "host-retrieval", "rankHint": 1, "scoreHint": 0.91 },
        { "itemId": "item_alpine_run", "realizationIds": ["rlz_alpine_en_hd"], "source": "host-retrieval", "rankHint": 2, "scoreHint": 0.84 },
        { "itemId": "item_kitchen_series", "realizationIds": [], "source": "approved-exploration", "rankHint": 3 }
      ],
      "provenance": { "system": "host-retrieval", "version": "2.4.0" }
    },
    "constraints": [],
    "policySelector": { "policyId": "pol_evening_relax", "version": "3" },
    "at": 1769997720000,
    "idempotencyKey": "idem_01J8ZWKC1N"
  }'`;

const recommendationApiTypescript = `import { createReckonClient } from "@reckon/sdk";

const reckon = createReckonClient({
  baseUrl: "https://api.reckon.dev",
  apiKey: process.env.RECKON_API_KEY!, // sk_test_… — server side only
});

const decision = await reckon.decisions.request({
  requestId: "req_01J8ZWK3Q7",
  tenant: { tenantId: "demo" },
  subject: { kind: "user", ref: "usr_88213" },
  objective: { objectiveId: "obj_relax_evening", version: "1", kind: "relax", params: {} },
  attentionPolicy: { policyId: "att_balanced", version: "1", style: "balanced", params: {} },
  context: { contextId: "ctx_01J8ZWJ9K2" },
  candidates: {
    setId: "cand_01J8ZWJ4P8",
    candidates: [
      { itemId: "item_reef_doc", realizationIds: ["rlz_reef_en_hd"], source: "host-retrieval", rankHint: 1 },
      { itemId: "item_alpine_run", source: "host-retrieval", rankHint: 2 },
    ],
  },
  policySelector: { policyId: "pol_evening_relax", version: "3" },
  idempotencyKey: "idem_01J8ZWKC1N",
});

decision.action; // "SUGGEST"
decision.selectedExperience?.experienceId; // "exp_01J8ZWM8T2"
decision.uncertainty?.confidence; // 0.74`;

/** Mirrors decisionResultExample (apps/docs/src/content/fixtures) — reckon.decision-result. */
const recommendationApiResponse = `{
  "schema": "reckon.decision-result",
  "schemaVersion": "0.1.0",
  "decisionId": "dec_01J8ZWM6X4",
  "requestId": "req_01J8ZWK3Q7",
  "tenant": { "tenantId": "demo" },
  "action": "SUGGEST",
  "selectedExperience": {
    "schema": "reckon.experience",
    "schemaVersion": "0.1.0",
    "experienceId": "exp_01J8ZWM8T2",
    "itemId": "item_reef_doc",
    "realizationId": "rlz_reef_en_hd",
    "format": { "kind": "card", "params": { "headline": "20 min · calm coral reefs", "maxWidth": 360 } },
    "duration": 1200,
    "timing": { "earliestMs": 1769997720123, "latestMs": 1769998920123 },
    "objectiveFit": { "fitScore": 0.82, "notes": ["evening wind-down match"] },
    "requirements": { "deviceClass": ["phone"], "requiresScreen": true, "minBandwidth": "medium" },
    "transformations": [],
    "constraints": []
  },
  "alternatives": [
    { "experienceId": "exp_01J8ZWM9F7", "score": 0.71, "reason": "strong objective fit, weaker fatigue guard", "excludedBy": "fatigue-policy" }
  ],
  "uncertainty": { "confidence": 0.74, "spread": 0.12, "disagreement": 0.08, "method": "ensemble-spread" },
  "policy": { "policyId": "pol_evening_relax", "version": "3" },
  "scheduleDelta": { "action": "QUEUE", "enqueue": ["exp_01J8ZWM9F7"], "dequeue": [] },
  "reasons": [
    { "code": "objective_fit", "message": "Matches the declared relax objective for the evening context." },
    { "code": "attention_budget", "message": "Fits the 20-minute attention window with 5 minutes of slack." },
    { "code": "fatigue_guard", "message": "One alternative was queued instead of suggested to limit repetition." }
  ],
  "provenance": { "system": "reckon-decision-engine", "version": "0.1.0", "correlationId": "req_01J8ZWK3Q7" },
  "latency": { "latencyMsP50": 38, "latencyMsP95": 61 },
  "at": 1769997720123
}`;

/* ================================================================== */
/* Personalization — POST /v1/preferences/events                       */
/* (contracts: packages/contracts/src/preferences.ts; route:           */
/*  apps/api/src/routes/preferences.ts — Idempotency-Key HEADER,       */
/*  the frozen PreferenceDelta carries no body-level key)              */
/* ================================================================== */

const personalizationCurl = `curl https://api.reckon.dev/v1/preferences/events \\
  -H "Authorization: Bearer ${DEMO_KEY}" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: idem_7c31f9a0" \\
  -d '{
    "schema": "reckon.preference-delta",
    "schemaVersion": "0.1.0",
    "deltaId": "pfd_01J9A7C2M6",
    "tenant": { "tenantId": "demo" },
    "subject": { "kind": "user", "ref": "usr_88213" },
    "dimension": "topic.calm-nature",
    "op": "add",
    "newValue": 0.34,
    "confidenceDelta": 0.11,
    "resultingConfidence": 0.61,
    "uncertainty": { "confidence": 0.61 },
    "provenance": { "system": "reckon-learning", "version": "0.1.0" },
    "decay": { "halfLifeSeconds": 2592000 },
    "model": { "modelId": "pref-embed-v3", "version": "12" },
    "timestamp": 1769998920123
  }'`;

const personalizationTypescript = `import { createReckonClient } from "@reckon/sdk";

const reckon = createReckonClient({
  baseUrl: "https://api.reckon.dev",
  apiKey: process.env.RECKON_API_KEY!,
});

const delta = await reckon.preferences.appendDelta(
  {
    deltaId: "pfd_01J9A7C2M6",
    tenant: { tenantId: "demo" },
    subject: { kind: "user", ref: "usr_88213" },
    dimension: "topic.calm-nature",
    op: "add",
    newValue: 0.34,
    confidenceDelta: 0.11,
    resultingConfidence: 0.61,
    decay: { halfLifeSeconds: 2592000 },
    model: { modelId: "pref-embed-v3", version: "12" },
    timestamp: 1769998920123,
  },
  { idempotencyKey: "idem_7c31f9a0" }, // Idempotency-Key header
);

delta.resultingConfidence; // 0.61
delta.model; // { modelId: "pref-embed-v3", version: "12" }`;

/** Mirrors preferenceDeltaExample (apps/docs/src/content/fixtures) — reckon.preference-delta echo. */
const personalizationResponse = `{
  "schema": "reckon.preference-delta",
  "schemaVersion": "0.1.0",
  "deltaId": "pfd_01J9A7C2M6",
  "tenant": { "tenantId": "demo" },
  "subject": { "kind": "user", "ref": "usr_88213" },
  "dimension": "topic.calm-nature",
  "op": "add",
  "newValue": 0.34,
  "confidenceDelta": 0.11,
  "resultingConfidence": 0.61,
  "uncertainty": { "confidence": 0.61 },
  "provenance": { "system": "reckon-learning", "version": "0.1.0" },
  "decay": { "halfLifeSeconds": 2592000 },
  "model": { "modelId": "pref-embed-v3", "version": "12" },
  "timestamp": 1769998920123
}`;

/* ================================================================== */
/* Scheduling — POST /v1/plans                                         */
/* (contracts: packages/contracts/src/plans.ts + experience.ts;        */
/*  route: apps/api/src/routes/plans.ts — Idempotency-Key HEADER;      */
/*  replan via POST /v1/plans/{planId}/replan, history via             */
/*  GET /v1/plans/{planId}/history)                                    */
/* ================================================================== */

const schedulingCurl = `curl https://api.reckon.dev/v1/plans \\
  -H "Authorization: Bearer ${DEMO_KEY}" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: idem_4e80bb12" \\
  -d '{
    "schema": "reckon.experience-plan",
    "schemaVersion": "0.1.0",
    "planId": "pln_01J9B4D6X1",
    "version": 0,
    "tenant": { "tenantId": "demo" },
    "subject": { "kind": "user", "ref": "usr_88213" },
    "objective": { "objectiveId": "obj_relax_evening", "version": "1", "kind": "relax", "params": {} },
    "attentionPolicy": { "policyId": "att_balanced", "version": "1", "style": "balanced", "params": {} },
    "queuedExperiences": [
      {
        "schema": "reckon.experience",
        "schemaVersion": "0.1.0",
        "experienceId": "exp_01J8ZWM9F7",
        "itemId": "item_reef_doc",
        "realizationId": "rlz_reef_en_hd",
        "format": { "kind": "notification", "params": { "headline": "Your evening wind-down is ready" } },
        "timing": { "earliestMs": 1770001380000, "latestMs": 1770012180000 },
        "objectiveFit": { "fitScore": 0.78, "notes": ["queued from the evening decision"] },
        "transformations": [],
        "constraints": []
      }
    ],
    "planningHorizon": { "maxItems": 5 },
    "replanTriggers": ["context-changed", "outcome-observed", "fatigue-signal"],
    "resumeCheckpoints": [],
    "createdAt": 1769997720123,
    "updatedAt": 1769997720123
  }'`;

const schedulingTypescript = `import { createReckonClient } from "@reckon/sdk";

const reckon = createReckonClient({
  baseUrl: "https://api.reckon.dev",
  apiKey: process.env.RECKON_API_KEY!,
});

const plan = await reckon.plans.create(
  {
    planId: "pln_01J9B4D6X1",
    tenant: { tenantId: "demo" },
    subject: { kind: "user", ref: "usr_88213" },
    objective: { objectiveId: "obj_relax_evening", version: "1", kind: "relax", params: {} },
    attentionPolicy: { policyId: "att_balanced", version: "1", style: "balanced", params: {} },
    queuedExperiences: [],
    planningHorizon: { maxItems: 5 },
    replanTriggers: ["context-changed", "outcome-observed", "fatigue-signal"],
    resumeCheckpoints: [],
    createdAt: 1769997720123,
    updatedAt: 1769997720123,
  },
  { idempotencyKey: "idem_4e80bb12" },
);

// A new signal arrives → replan appends a version, never overwrites:
const replanned = await reckon.plans.replan(plan.planId, {
  trigger: "outcome-observed",
});

replanned.version; // 1
const history = await reckon.plans.history(plan.planId);
history.length; // 2 — the full chain, reasons included`;

/** Echo of the created reckon.experience-plan (version bumped by the replan below it). */
const schedulingResponse = `{
  "schema": "reckon.experience-plan",
  "schemaVersion": "0.1.0",
  "planId": "pln_01J9B4D6X1",
  "version": 1,
  "tenant": { "tenantId": "demo" },
  "subject": { "kind": "user", "ref": "usr_88213" },
  "objective": { "objectiveId": "obj_relax_evening", "version": "1", "kind": "relax", "params": {} },
  "attentionPolicy": { "policyId": "att_balanced", "version": "1", "style": "balanced", "params": {} },
  "currentExperience": {
    "schema": "reckon.experience",
    "schemaVersion": "0.1.0",
    "experienceId": "exp_01J8ZWM8T2",
    "itemId": "item_reef_doc",
    "realizationId": "rlz_reef_en_hd",
    "format": { "kind": "card", "params": { "headline": "20 min · calm coral reefs", "maxWidth": 360 } },
    "duration": 1200,
    "objectiveFit": { "fitScore": 0.82, "notes": ["evening wind-down match"] },
    "transformations": [],
    "constraints": []
  },
  "queuedExperiences": [
    {
      "schema": "reckon.experience",
      "schemaVersion": "0.1.0",
      "experienceId": "exp_01J8ZWM9F7",
      "itemId": "item_reef_doc",
      "realizationId": "rlz_reef_en_hd",
      "format": { "kind": "notification", "params": { "headline": "Your evening wind-down is ready" } },
      "timing": { "earliestMs": 1770001380000, "latestMs": 1770012180000 },
      "objectiveFit": { "fitScore": 0.78, "notes": ["queued from the evening decision"] },
      "transformations": [],
      "constraints": []
    }
  ],
  "planningHorizon": { "maxItems": 5 },
  "replanTriggers": ["context-changed", "outcome-observed", "fatigue-signal"],
  "resumeCheckpoints": [],
  "createdAt": 1769997720123,
  "updatedAt": 1769999100000
}`;

/* ================================================================== */
/* Analytics — POST /v1/outcomes                                       */
/* (contracts: packages/contracts/src/outcomes.ts; route:              */
/*  apps/api/src/routes/outcomes.ts — body-level idempotencyKey)       */
/* ================================================================== */

const analyticsCurl = `curl https://api.reckon.dev/v1/outcomes \\
  -H "Authorization: Bearer ${DEMO_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "schema": "reckon.outcome-event",
    "schemaVersion": "0.1.0",
    "eventId": "evt_01J9A2K5R9",
    "tenant": { "tenantId": "demo" },
    "decisionId": "dec_01J8ZWM6X4",
    "experienceId": "exp_01J8ZWM8T2",
    "subject": { "kind": "user", "ref": "usr_88213" },
    "eventType": "completion",
    "occurredAt": 1769998896123,
    "context": { "contextId": "ctx_01J8ZWJ9K2" },
    "metrics": { "watchedSeconds": 1180, "completionRatio": 0.98 },
    "evidenceClass": "production-observed",
    "idempotencyKey": "idem_01J9A2K8D4"
  }'`;

const analyticsTypescript = `import { createReckonClient } from "@reckon/sdk";

const reckon = createReckonClient({
  baseUrl: "https://api.reckon.dev",
  apiKey: process.env.RECKON_API_KEY!,
});

const event = await reckon.outcomes.append({
  eventId: "evt_01J9A2K5R9",
  tenant: { tenantId: "demo" },
  decisionId: "dec_01J8ZWM6X4",
  experienceId: "exp_01J8ZWM8T2",
  subject: { kind: "user", ref: "usr_88213" },
  eventType: "completion",
  occurredAt: 1769998896123,
  context: { contextId: "ctx_01J8ZWJ9K2" },
  metrics: { watchedSeconds: 1180, completionRatio: 0.98 },
  evidenceClass: "production-observed",
  idempotencyKey: "idem_01J9A2K8D4",
});

event.eventType; // "completion"
event.evidenceClass; // "production-observed" — typed, never a free string`;

/** Mirrors outcomeEventExample (apps/docs/src/content/fixtures) — reckon.outcome-event echo. */
const analyticsResponse = `{
  "schema": "reckon.outcome-event",
  "schemaVersion": "0.1.0",
  "eventId": "evt_01J9A2K5R9",
  "tenant": { "tenantId": "demo" },
  "decisionId": "dec_01J8ZWM6X4",
  "experienceId": "exp_01J8ZWM8T2",
  "subject": { "kind": "user", "ref": "usr_88213" },
  "eventType": "completion",
  "occurredAt": 1769998896123,
  "context": { "contextId": "ctx_01J8ZWJ9K2" },
  "metrics": { "watchedSeconds": 1180, "completionRatio": 0.98 },
  "evidenceClass": "production-observed",
  "idempotencyKey": "idem_01J9A2K8D4"
}`;

/* ================================================================== */
/* The four product pages                                              */
/* ================================================================== */

export const productPages: Record<ProductPageId, ProductPageContent> = {
  "recommendation-api": {
    id: "recommendation-api",
    name: "Recommendation API",
    eyebrow: "Recommendation API · Reckon platform",
    headline: ["One call decides", "what comes next."],
    subheadline:
      "Send who they are, what they want, and what is eligible. Get back a decision you can inspect — action, experience, confidence, reasons, latency. Never a black box.",
    routeTag: "POST /v1/decisions",
    microTrust: "Idempotent by default · Test-mode keys from day one",
    code: {
      eyebrow: "The call",
      title: "A typed request. A decision with receipts.",
      sub: "One POST against the frozen reckon.decision-request contract. The reply names its action, the selected experience, the alternatives it rejected, and why.",
      tabs: [
        { id: "curl", label: "cURL", language: "curl", code: recommendationApiCurl },
        { id: "typescript", label: "TypeScript", language: "typescript", code: recommendationApiTypescript },
      ],
      responseLabel: "Response · 200 OK · reckon.decision-result",
      response: recommendationApiResponse,
      craftNotes: [
        "Idempotency keys in the request body",
        "Eight scheduler actions, not just rank",
        "Typed error codes with doc links",
        "Expand references with ?expand[]",
      ],
    },
    features: [
      {
        headline: "A decision you can inspect, not a score you have to trust.",
        body: "Every result carries confidence, spread, machine-readable reasons, provenance, and latency — the full reckoning, on the record.",
      },
      {
        headline: "Eight actions, not just a rank.",
        body: "SUGGEST, HOLD, QUEUE, SWITCH, INTERRUPT, RESUME, CONTINUE, END — the scheduler answers what to do, not only what is on top.",
      },
      {
        headline: "Replay-safe by contract.",
        body: "Requests are idempotent with a 24-hour replay window: the same key returns the same decision, never a double charge of attention.",
      },
      {
        headline: "Failures are typed, not prose.",
        body: "Stable machine codes in a frozen error envelope — your code branches on codes, your on-call reads doc links.",
      },
      {
        headline: "Expand what you need.",
        body: "?expand[]=selectedExperience.item inlines the catalog item into the decision — one call, everything needed to render.",
      },
    ],
    steps: [
      {
        label: "Integrate",
        title: "Send a typed request",
        body: "Subject, objective, attention policy, context, candidate set — one POST /v1/decisions from your server.",
      },
      {
        label: "Decide",
        title: "The policy engine answers",
        body: "Your versioned policySelector scores the candidates and returns an action, the selected experience, and its reasons.",
      },
      {
        label: "Observe",
        title: "Report what happened",
        body: "Send the outcome event for the delivered experience — the loop that makes the next decision better.",
      },
    ],
    docsLinks: [
      {
        label: "Quickstart",
        description: "Serve your first recommendation in about five minutes.",
        href: `${DOCS_BASE_URL}/get-started/quickstart`,
      },
      {
        label: "Core concepts",
        description: "The Reckon vertical: catalog → context → candidates → experience → decision.",
        href: `${DOCS_BASE_URL}/get-started/core-concepts`,
      },
      {
        label: "Authentication",
        description: "sk_/pk_ API keys, route scopes, and test mode.",
        href: `${DOCS_BASE_URL}/api-reference/authentication`,
      },
      {
        label: "Errors",
        description: "Typed error classes, stable machine codes, and HTTP mapping.",
        href: `${DOCS_BASE_URL}/api-reference/errors`,
      },
    ],
    metadata: {
      title: "Recommendation API — Reckon",
      description:
        "Decide what to show next with one API call. POST /v1/decisions returns a typed decision — action, selected experience, confidence, reasons, latency — against frozen contracts.",
    },
  },

  personalization: {
    id: "personalization",
    name: "Personalization",
    eyebrow: "Personalization · Reckon platform",
    headline: ["Every surface adapts", "to the person seeing it."],
    subheadline:
      "Learning writes append-only preference deltas — dimension, operation, confidence, decay, model lineage — so you can always answer why a surface looks the way it does.",
    routeTag: "POST /v1/preferences/events",
    microTrust: "Append-only learning · Every delta carries its model lineage",
    code: {
      eyebrow: "The delta",
      title: "Learning you can audit, line by line.",
      sub: "A preference delta is a typed record: what changed, by how much, with what confidence, how it decays, and exactly which model version produced it.",
      tabs: [
        { id: "curl", label: "cURL", language: "curl", code: personalizationCurl },
        { id: "typescript", label: "TypeScript", language: "typescript", code: personalizationTypescript },
      ],
      responseLabel: "Response · 200 OK · reckon.preference-delta",
      response: personalizationResponse,
      craftNotes: [
        "Six typed operations: set · add · multiply · decay · remove · merge",
        "Half-life decay and validity windows on every delta",
        "Idempotency-Key header — replay-safe ingestion",
      ],
    },
    features: [
      {
        headline: "Learning with receipts.",
        body: "Every delta names its dimension, operation, confidence change, and the exact model lineage that produced it — no opaque state blobs.",
      },
      {
        headline: "Preferences that fade honestly.",
        body: "Half-life decay and temporal validity windows are part of the contract, so stale affinities step aside on schedule.",
      },
      {
        headline: "Append-only, auditable state.",
        body: "The chain decision → outcome → delta → model version answers “why does this person see this?” with evidence.",
      },
      {
        headline: "Scoped to the moment.",
        body: "Deltas can bind to a context kind and a validity window — evening tastes do not leak into the morning commute.",
      },
    ],
    steps: [
      {
        label: "Deliver",
        title: "The decision renders",
        body: "A decision from POST /v1/decisions hands your surface the experience to present.",
      },
      {
        label: "Learn",
        title: "Outcomes become deltas",
        body: "As outcome events land, learning emits typed preference deltas via POST /v1/preferences/events — each one auditable.",
      },
      {
        label: "Adapt",
        title: "The next decision reads them",
        body: "Updated preference state shapes the next ranking — and you can show the delta that moved it.",
      },
    ],
    docsLinks: [
      {
        label: "Core concepts",
        description: "Preference deltas — the contract, the operations, the audit chain.",
        href: `${DOCS_BASE_URL}/get-started/core-concepts`,
      },
      {
        label: "Quickstart",
        description: "Close the loop: decision → outcome → preference delta.",
        href: `${DOCS_BASE_URL}/get-started/quickstart`,
      },
      {
        label: "Webhooks guide",
        description: "preference.updated and the event catalog, with HMAC signatures.",
        href: `${DOCS_BASE_URL}/webhooks`,
      },
      {
        label: "Idempotent requests",
        description: "Idempotency-Key semantics for the ingestion routes.",
        href: `${DOCS_BASE_URL}/api-reference/idempotent-requests`,
      },
    ],
    metadata: {
      title: "Personalization — Reckon",
      description:
        "Adapt every surface to the person seeing it. Preference deltas are append-only, typed records with confidence, decay, and model lineage — personalization you can audit.",
    },
  },

  scheduling: {
    id: "scheduling",
    name: "Scheduling",
    eyebrow: "Scheduling · Reckon platform",
    headline: ["Arrive at the right moment,", "not the loudest one."],
    subheadline:
      "Experience plans queue what comes next across a horizon — and replan on real signals like context changes, outcomes, and fatigue. Every version is kept; nothing is rewritten.",
    routeTag: "POST /v1/plans",
    microTrust: "Versioned replans · Ten typed triggers · History never rewritten",
    code: {
      eyebrow: "The plan",
      title: "A horizon of experiences, replanned on evidence.",
      sub: "Create a plan with queued experiences and replan triggers. When the world changes, replan appends a new version with its reason — the history route returns the whole chain.",
      tabs: [
        { id: "curl", label: "cURL", language: "curl", code: schedulingCurl },
        { id: "typescript", label: "TypeScript", language: "typescript", code: schedulingTypescript },
      ],
      responseLabel: "Response · 200 OK · reckon.experience-plan",
      response: schedulingResponse,
      craftNotes: [
        "Ten replan triggers, from context-changed to fatigue-signal",
        "Interruption is a named policy, never a surprise",
        "Resume checkpoints for interrupted experiences",
        "?expand[]=history inlines the version chain",
      ],
    },
    features: [
      {
        headline: "A horizon, not a cron.",
        body: "Plans hold a queue of future experiences with timing windows and a planning horizon — digests land when each person is actually there.",
      },
      {
        headline: "Replan on real signals.",
        body: "Ten typed triggers — context-changed, outcome-observed, fatigue-signal, and seven more. Every replan appends a version with its reason.",
      },
      {
        headline: "Interruption is a policy, never a surprise.",
        body: "An explicit interruption policy reference gates every switch; interrupted experiences keep resume checkpoints.",
      },
      {
        headline: "History you can replay.",
        body: "GET /v1/plans/{id}/history returns the full version chain with recorded reasons — or inline it with ?expand[]=history.",
      },
    ],
    steps: [
      {
        label: "Plan",
        title: "Queue what comes next",
        body: "POST /v1/plans with queued experiences, a planning horizon, and the signals that should trigger a replan.",
      },
      {
        label: "Replan",
        title: "Signals append versions",
        body: "When context, outcomes, or fatigue change, POST /v1/plans/{id}/replan — a new version lands, the old one never disappears.",
      },
      {
        label: "Observe",
        title: "The plan meets reality",
        body: "Outcomes arrive against planned experiences; every replan carries the trigger that caused it.",
      },
    ],
    docsLinks: [
      {
        label: "Core concepts",
        description: "Schedule & plans — the eight actions and versioned replans.",
        href: `${DOCS_BASE_URL}/get-started/core-concepts`,
      },
      {
        label: "Quickstart",
        description: "From first decision to a queued plan in minutes.",
        href: `${DOCS_BASE_URL}/get-started/quickstart`,
      },
      {
        label: "Expanding responses",
        description: "Inline plan history and queued catalog items with ?expand[].",
        href: `${DOCS_BASE_URL}/api-reference/expanding-responses`,
      },
      {
        label: "Webhooks guide",
        description: "schedule.executed and the event catalog, with HMAC signatures.",
        href: `${DOCS_BASE_URL}/webhooks`,
      },
    ],
    metadata: {
      title: "Scheduling — Reckon",
      description:
        "Arrive at the right moment, not the loudest one. Experience plans queue future experiences across a horizon and replan on real signals — versioned, never overwritten.",
    },
  },

  analytics: {
    id: "analytics",
    name: "Analytics",
    eyebrow: "Analytics · Reckon platform",
    headline: ["Prove the lift,", "not just the clicks."],
    subheadline:
      "Report what actually happened: 18 typed event kinds, numeric metrics, and evidence classes that keep simulated results out of production proof. Corrections append — nothing is rewritten.",
    routeTag: "POST /v1/outcomes",
    microTrust: "Typed evidence classes · Append-only corrections · Caller-supplied time",
    code: {
      eyebrow: "The report",
      title: "Ground truth, typed end to end.",
      sub: "An outcome event names the decision and experience it answers, carries numeric metrics, and declares its evidence class — production-observed can never be faked by a simulation.",
      tabs: [
        { id: "curl", label: "cURL", language: "curl", code: analyticsCurl },
        { id: "typescript", label: "TypeScript", language: "typescript", code: analyticsTypescript },
      ],
      responseLabel: "Response · 200 OK · reckon.outcome-event",
      response: analyticsResponse,
      craftNotes: [
        "18 typed event kinds, plus custom",
        "evidenceClass is required — simulated ≠ observed",
        "Corrections reference the record they correct",
        "occurredAt is caller-supplied for deterministic replay",
      ],
    },
    features: [
      {
        headline: "Ground truth, typed.",
        body: "From impression to purchase to explicit feedback — 18 event kinds plus custom, each linked to its decision and experience.",
      },
      {
        headline: "Evidence classes that cannot lie.",
        body: "Simulated and counterfactual outcomes are typed separately from production-observed — a simulation can never masquerade as proof.",
      },
      {
        headline: "Corrections append, never overwrite.",
        body: "A correction event references the record it corrects; the history of what was believed and when stays intact.",
      },
      {
        headline: "Replay-safe measurement.",
        body: "Caller-supplied occurrence times and idempotency keys make backfills and retries deterministic — numbers that survive an audit.",
      },
    ],
    steps: [
      {
        label: "Report",
        title: "Send events as they happen",
        body: "POST /v1/outcomes with the typed event, its metrics, and its evidence class.",
      },
      {
        label: "Attribute",
        title: "Every event answers a decision",
        body: "Events reference the decisionId and experienceId they belong to — measurement is tied to the choice that caused it.",
      },
      {
        label: "Prove",
        title: "The chain tells the story",
        body: "Decisions, outcomes, and preference deltas chain into an auditable lift narrative — evidence first, dashboards second.",
      },
    ],
    docsLinks: [
      {
        label: "Core concepts",
        description: "Outcome events — the loop's ground truth, evidence classes included.",
        href: `${DOCS_BASE_URL}/get-started/core-concepts`,
      },
      {
        label: "Quickstart",
        description: "Step 4: close the loop by reporting your first outcome.",
        href: `${DOCS_BASE_URL}/get-started/quickstart`,
      },
      {
        label: "Idempotent requests",
        description: "Replay-safe ingestion with Idempotency-Key semantics.",
        href: `${DOCS_BASE_URL}/api-reference/idempotent-requests`,
      },
      {
        label: "Webhooks guide",
        description: "recommendation.delivered and the event catalog, with HMAC signatures.",
        href: `${DOCS_BASE_URL}/webhooks`,
      },
    ],
    metadata: {
      title: "Analytics — Reckon",
      description:
        "Prove the lift, not just the clicks. Typed outcome events with metrics and evidence classes keep simulated results out of production proof — corrections append, nothing is rewritten.",
    },
  },
};

/** The related-products band: the other three products for a given page. */
export function relatedProducts(current: ProductPageId): ProductPageId[] {
  return PRODUCT_PAGE_IDS.filter((id) => id !== current);
}
