/**
 * Quickstart content (S1-004 crown jewel): "Serve your first
 * recommendation" — numbered steps with Stripe-style integration-option
 * tabs (Hosted endpoint / SDK / Streaming). Every response shape is the
 * REAL frozen contract payload from src/content/fixtures (validated
 * against @reckon/contracts by the test suite).
 */

import type { QuickstartStep, TocEntry } from "./types.js";
import {
  decisionRequestExample,
  decisionResultExample,
  jsonOf,
  outcomeEventExample,
} from "./fixtures/index.js";

const DEMO_KEY = "sk_test_51DmReckonExampleKey4eC39";

export const QUICKSTART_HEADINGS: readonly TocEntry[] = [
  { id: "before-you-start", label: "Before you start", level: 2 },
  { id: "get-your-api-keys", label: "1. Get your API keys", level: 2 },
  { id: "serve-your-first-recommendation", label: "2. Serve your first recommendation", level: 2 },
  { id: "read-the-decision", label: "3. Read the decision", level: 2 },
  { id: "close-the-loop", label: "4. Close the loop: report the outcome", level: 2 },
  { id: "whats-next", label: "5. What's next", level: 2 },
];

export const QUICKSTART_STEPS: readonly QuickstartStep[] = [
  {
    id: "get-your-api-keys",
    title: "Get your API keys",
    minutes: "~1 min",
    intro: [
      "Reckon authenticates requests with API keys in the `Authorization: Bearer` header. Secret keys (`sk_…`) call the full API from your server; publishable keys (`pk_…`) are restricted to browser-safe surfaces such as decision streaming.",
      "Every key carries a tenant and a set of route scopes (decisions, outcomes, plans, catalog, candidates, experiences, preferences, research, agents, integrations) — a key can never read another tenant's data.",
    ],
    extra: [
      {
        language: "bash",
        label: "Shell",
        code: `export RECKON_API_KEY="sk_test_51DmReckonExampleKey4eC39"`,
        caption:
          "Keep secret keys in your server environment — never in client code, never in git. Test-mode keys (`sk_test_…`) and live keys (`sk_live_…`) are separate by design.",
      },
    ],
  },
  {
    id: "serve-your-first-recommendation",
    title: "Serve your first recommendation",
    minutes: "~2 min",
    intro: [
      "A decision request describes **who** is being optimized (subject), **what they want** (objective), **what is eligible** (candidate set), and **the context** right now. Pick the integration style that fits your stack — the tabs are equivalent and return the same frozen `reckon.decision-result` payload.",
    ],
    tabs: [
      {
        id: "hosted",
        label: "Hosted endpoint",
        tagline: "curl → JSON",
        samples: [
          {
            language: "bash",
            label: "Request",
            code: `curl https://api.reckon.dev/v1/decisions \\
  -H "Authorization: Bearer ${DEMO_KEY}" \\
  -H "Content-Type: application/json" \\
  -d @- <<'JSON'
${jsonOf(decisionRequestExample)}
JSON`,
          },
          {
            language: "json",
            label: "Response · 200 OK",
            code: jsonOf(decisionResultExample),
            caption:
              "The full `reckon.decision-result` contract: the chosen `action`, the `selectedExperience` to present, `alternatives`, `uncertainty`, machine-readable `reasons`, and `scheduleDelta` if the plan changed.",
          },
        ],
      },
      {
        id: "sdk",
        label: "TypeScript SDK",
        tagline: "typed end-to-end",
        samples: [
          {
            language: "typescript",
            label: "serve-recommendation.ts",
            code: `// npm install @reckon/sdk
import { createReckonClient } from "@reckon/sdk";

const reckon = createReckonClient({
  baseUrl: "https://api.reckon.dev",
  apiKey: process.env.RECKON_API_KEY!, // sk_test_… — server side only
});

const decision = await reckon.decisions.request({
  schema: "reckon.decision-request",
  schemaVersion: "0.1.0",
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
      { itemId: "item_alpine_run", realizationIds: ["rlz_alpine_en_hd"], source: "host-retrieval", rankHint: 2 },
      { itemId: "item_kitchen_series", realizationIds: [], source: "approved-exploration", rankHint: 3 },
    ],
  },
  constraints: [],
  policySelector: { policyId: "pol_evening_relax", version: "3" },
  at: 1769997720000,
  idempotencyKey: "idem_01J8ZWKC1N",
});

console.log(decision.action); // "SUGGEST"
console.log(decision.selectedExperience?.experienceId); // "exp_01J8ZWM8T2"`,
            caption:
              "The SDK validates the request against the frozen contract **before** it is sent and the response **before** it is returned — malformed payloads fail client-side with a typed `ReckonValidationError`, never with a raw fetch error.",
          },
        ],
      },
      {
        id: "streaming",
        label: "Streaming",
        tagline: "SSE decision feed",
        samples: [
          {
            language: "bash",
            label: "Request",
            code: `curl -N https://api.reckon.dev/v1/stream/decisions \\
  -H "Authorization: Bearer ${DEMO_KEY}" \\
  -H "Accept: text/event-stream" \\
  -G --data-urlencode "tenantId=demo" \\
  --data-urlencode "subject=usr_88213"`,
          },
          {
            language: "sse",
            label: "Event stream",
            code: `: reckon · heartbeat every 15s
event: decision
id: dec_01J8ZWM6X4
data: ${JSON.stringify(decisionResultExample)}

event: ping
data: {"t":1769997735000}`,
            caption:
              "Each `decision` event carries the full `reckon.decision-result` payload. The `id:` field is the decision id — reconnect with `Last-Event-ID` to resume without gaps.",
          },
          {
            language: "typescript",
            label: "browser.ts",
            code: `// Browser surfaces use the publishable key (pk_…) — stream-scope only.
const stream = new EventSource(
  "https://api.reckon.dev/v1/stream/decisions?key=pk_test_51DmReckonPublishableKey&tenantId=demo&subject=usr_88213",
);

stream.addEventListener("decision", (event) => {
  const decision = JSON.parse(event.data); // reckon.decision-result
  render(decision.selectedExperience);
});`,
          },
        ],
      },
    ],
  },
  {
    id: "read-the-decision",
    title: "Read the decision",
    minutes: "~1 min",
    intro: [
      "A decision is immutable: present `selectedExperience` to your user, and request a **new** decision when the context changes. Reckon never claims the objectively best future choice — every result carries `uncertainty` and human-readable `reasons` so you can explain it.",
      "Look up any past decision by id — the response is the same frozen contract.",
    ],
    extra: [
      {
        language: "bash",
        label: "Request",
        code: `curl https://api.reckon.dev/v1/decisions/dec_01J8ZWM6X4 \\
  -H "Authorization: Bearer ${DEMO_KEY}"`,
      },
    ],
  },
  {
    id: "close-the-loop",
    title: "Close the loop: report the outcome",
    minutes: "~1 min",
    intro: [
      "Reckon learns from what actually happened. After the user watches, skips, buys or abandons, append an outcome event that references the decision. Outcomes are append-only: corrections reference the earlier record instead of overwriting it, and every event declares its `evidenceClass` so simulated data can never masquerade as observed data.",
    ],
    extra: [
      {
        language: "bash",
        label: "Request",
        code: `curl https://api.reckon.dev/v1/outcomes \\
  -H "Authorization: Bearer ${DEMO_KEY}" \\
  -H "Content-Type: application/json" \\
  -d @- <<'JSON'
${jsonOf(outcomeEventExample)}
JSON`,
      },
      {
        language: "json",
        label: "Response · 200 OK",
        code: jsonOf(outcomeEventExample),
        caption:
          "The stored `reckon.outcome-event`, echoed back. From here Reckon derives [preference deltas](/get-started/core-concepts) and you can watch the loop learn.",
      },
      {
        language: "typescript",
        label: "with the SDK",
        code: `await reckon.outcomes.append({
  schema: "reckon.outcome-event",
  schemaVersion: "0.1.0",
  eventId: "evt_01J9A2K5R9",
  tenant: { tenantId: "demo" },
  decisionId: decision.decisionId,
  experienceId: decision.selectedExperience?.experienceId,
  subject: { kind: "user", ref: "usr_88213" },
  eventType: "completion",
  occurredAt: Date.now(),
  metrics: { watchedSeconds: 1180, completionRatio: 0.98 },
  evidenceClass: "production-observed",
  idempotencyKey: "idem_01J9A2K8D4",
});`,
      },
    ],
  },
];

/** Compact field guide rendered under step 3 in the page component. */
export const DECISION_FIELDS: readonly (readonly string[])[] = [
  ["`action`", "Scheduler action for this decision — `SUGGEST`, `HOLD`, `CONTINUE`, `QUEUE`, `SWITCH`, `INTERRUPT`, `RESUME` or `END`."],
  ["`selectedExperience`", "The experience to present: item + realization + `format` + timing + objective fit. Omitted when the action is `HOLD`."],
  ["`alternatives`", "Non-selected candidates with scores and, when policy excluded them, the `excludedBy` rule."],
  ["`uncertainty`", "Confidence metadata (confidence, spread, disagreement) — never discard this in dashboards."],
  ["`scheduleDelta`", "Queue changes ordered by this decision (enqueue/dequeue, resume checkpoint)."],
  ["`reasons`", "Machine-readable `code` + host-readable message for every meaningful factor."],
  ["`decisionId`", "Immutable id — quote it in support requests, outcome events and logs."],
];

export const QUICKSTART_REQUEST_FOR_LINKS = decisionRequestExample;
export const QUICKSTART_RESULT_FOR_LINKS = decisionResultExample;
