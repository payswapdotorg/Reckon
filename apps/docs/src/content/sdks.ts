/**
 * SDKs content (S1-004, locked to the shipped surface by S2-004):
 * TypeScript + Python reference SDKs.
 *
 * The TypeScript SDK is REAL today (@reckon/sdk, W3-002 + S2-004: typed
 * client, contract validation both ways, typed errors, apiVersion
 * pinning, ?expand[], cursor pagination + auto-iterators, webhook
 * management + signature verification). The Python reference client
 * (sdks/python) shipped with S2-004. Every snippet on this page runs
 * against the shipped SDKs (the monorepo's docs-matrix suites run the
 * same flows against the real API).
 */

import type { TocEntry } from "./types.js";

export const SDKS_HEADINGS: readonly TocEntry[] = [
  { id: "philosophy", label: "Philosophy", level: 2 },
  { id: "typescript", label: "TypeScript", level: 2 },
  { id: "python", label: "Python", level: 2 },
  { id: "feature-matrix", label: "Feature matrix", level: 2 },
];

export const SDKS_PHILOSOPHY: readonly string[] = [
  "The SDKs are thin, typed plumbing over HTTP + the frozen contracts — **no model calls, no client-side policy** (the NO-LLM law: nothing in an SDK requires or invokes a model).",
  "Every request is validated against the real frozen schema **before** it is sent, and every response is validated **before** it is returned — contract violations surface as typed errors, never as mystery payloads. (Python: the server validates every request; failures surface as typed `ReckonError`s with full envelope detail.)",
  "Every failure is a typed error class discriminated by a machine-readable `code` — raw fetch/network errors never escape the SDK.",
];

export const SDK_TS_TODAY = {
  language: "typescript" as const,
  label: "Available today · @reckon/sdk",
  code: `// npm install @reckon/sdk
import { createReckonClient } from "@reckon/sdk";

const reckon = createReckonClient({
  baseUrl: "https://api.reckon.dev",
  apiKey: process.env.RECKON_API_KEY!,
});

// Request a decision (validated against reckon.decision-request
// before the request, and reckon.decision-result after it).
const decision = await reckon.decisions.request({
  schema: "reckon.decision-request",
  schemaVersion: "0.1.0",
  requestId: crypto.randomUUID(),
  tenant: { tenantId: "demo" },
  subject: { kind: "user", ref: "usr_88213" },
  objective: { objectiveId: "obj_relax_evening", kind: "relax" },
  attentionPolicy: { policyId: "att_balanced", style: "balanced" },
  context: { contextId: context.contextId },
  candidates: retrieval.toCandidateSet(),
  policySelector: { policyId: "pol_evening_relax", version: "3" },
  idempotencyKey: crypto.randomUUID(),
});

// Report what happened.
await reckon.outcomes.append({
  schema: "reckon.outcome-event",
  schemaVersion: "0.1.0",
  eventId: crypto.randomUUID(),
  tenant: { tenantId: "demo" },
  decisionId: decision.decisionId,
  experienceId: decision.selectedExperience?.experienceId,
  subject: { kind: "user", ref: "usr_88213" },
  eventType: "completion",
  occurredAt: Date.now(),
  metrics: { watchedSeconds: 1180 },
  evidenceClass: "production-observed",
  idempotencyKey: crypto.randomUUID(),
});`,
};

export const SDK_TS_TARGET = {
  language: "typescript" as const,
  label: "Hardened shape · shipped with S2-004",
  code: `const reckon = createReckonClient({
  baseUrl: "https://api.reckon.dev",
  apiKey: process.env.RECKON_API_KEY!,
  apiVersion: "0.1.0", // pinned X-Reckon-Version on every request
});

// Expansion, idempotency and mode markers are one-liners:
const decision = await reckon.decisions.get(id, {
  expand: ["selectedExperience.item"],
});
reckon.lastResponseMode(); // "test" | "live" (X-Reckon-Mode)

// Auto-paginating iterators:
for await (const plan of reckon.plans.list({ limit: 100 })) {
  await archive(plan);
}

// Webhook management + verification (the reference implementation):
import { verifyWebhook } from "@reckon/sdk";
const ok = verifyWebhook(rawBody, req.headers["reckon-signature"], whsec);`,
};

export const SDK_PY_TARGET = {
  language: "python" as const,
  label: "Python · shipped with S2-004",
  code: `# Vendor the single-file client (a pip package follows the same source):
#   cp sdks/python/reckon.py your_app/reckon.py
import os
import uuid
from reckon import ReckonClient, verify_webhook

reckon = ReckonClient(
    api_key=os.environ["RECKON_API_KEY"],  # sk_test_… or sk_live_…
    api_version="0.1.0",  # optional X-Reckon-Version pin
)

decision = reckon.decisions.request(
    schema="reckon.decision-request",
    schema_version="0.1.0",
    request_id=str(uuid.uuid4()),
    tenant={"tenantId": "demo"},
    subject={"kind": "user", "ref": "usr_88213"},
    objective={"objectiveId": "obj_relax_evening", "kind": "relax"},
    attention_policy={"policyId": "att_balanced", "style": "balanced"},
    context={"contextId": "ctx_01J8ZWJ9K2"},
    candidates={
        "setId": f"cand-{uuid.uuid4().hex[:8]}",
        "candidates": [{"itemId": "item_reef_doc", "source": "host-retrieval"}],
    },
    policy_selector={"policyId": "pol_evening_relax", "version": "3"},
    idempotency_key=str(uuid.uuid4()),
)

print(decision.action, decision.selected_experience.experience_id)
print(reckon.last_mode)  # "test" | "live" — the mode lives in the key

# Webhook verification — the reference algorithm, byte for byte:
assert verify_webhook(raw_body, headers["Reckon-Signature"], whsec)`,
};

export const SDK_FEATURE_ROWS: readonly (readonly string[])[] = [
  ["Contract validation (both ways)", "Live today (zod, both directions)", "Server-side (typed `ReckonError`s)"],
  ["Typed errors (`ReckonSdkError` / `ReckonError` classes)", "Live today", "Live (S2-004)"],
  ["Automatic `Idempotency-Key` for POSTs", "Live today (routes without body keys)", "Live (S2-004)"],
  ["`apiVersion` pinning", "Live (S2-004)", "Live (S2-004)"],
  ["`?expand[]` support", "Live (S2-004) — `decisions.get`", "Live (S2-004) — `decisions.get`"],
  ["Auto-paginating iterators", "Live (S2-004) — `plans.list`, webhook lists", "Live (S2-004) — `list_all()` generators"],
  ["Webhook signature verification", "Live (S2-004) — `verifyWebhook`", "Live (S2-004) — `verify_webhook`"],
  ["Streaming (SSE) client", "Future", "Not planned"],
];
