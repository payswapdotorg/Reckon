/**
 * SDKs content (S1-004): TypeScript + Python reference SDKs.
 *
 * The TypeScript SDK is REAL today (@reckon/sdk, W3-002: typed client,
 * contract validation both ways, typed errors). The hardened target
 * shape aligned with the API reference pages (apiVersion, expand,
 * auto-pagination, verifyWebhook) and the Python SDK land with S2-004.
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
  "Every request is validated against the real frozen schema **before** it is sent, and every response is validated **before** it is returned — contract violations surface as typed errors, never as mystery payloads.",
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
  label: "Target shape · S2-004",
  code: `const reckon = createReckonClient({
  baseUrl: "https://api.reckon.dev",
  apiKey: process.env.RECKON_API_KEY!,
  apiVersion: "2026-10-01",       // pinned Reckon-Version
});

// Expansion, retries and idempotency are one-liners:
const decision = await reckon.decisions.get(id, {
  expand: ["selectedExperience.item"],
});

// Auto-paginating iterators:
for await (const plan of reckon.plans.list({ limit: 100 })) {
  await archive(plan);
}

// Webhook verification (the reference implementation, maintained):
import { verifyWebhook } from "@reckon/sdk";
const ok = verifyWebhook(rawBody, req.headers["reckon-signature"], whsec);`,
};

export const SDK_PY_TARGET = {
  language: "python" as const,
  label: "Python · target shape (S2-004)",
  code: `# pip install reckon
import os
import uuid
from reckon import ReckonClient

reckon = ReckonClient(
    api_key=os.environ["RECKON_API_KEY"],
    api_version="2026-10-01",
)

decision = reckon.decisions.request(
    schema="reckon.decision-request",
    schema_version="0.1.0",
    request_id=str(uuid.uuid4()),
    tenant={"tenantId": "demo"},
    subject={"kind": "user", "ref": "usr_88213"},
    objective={"objectiveId": "obj_relax_evening", "kind": "relax"},
    attention_policy={"policyId": "att_balanced", "style": "balanced"},
    context={"contextId": context.context_id},
    candidates=retrieval.to_candidate_set(),
    policy_selector={"policyId": "pol_evening_relax", "version": "3"},
    idempotency_key=str(uuid.uuid4()),
)

print(decision.action, decision.selected_experience.experience_id)

reckon.outcomes.append(
    schema="reckon.outcome-event",
    schema_version="0.1.0",
    event_id=str(uuid.uuid4()),
    tenant={"tenantId": "demo"},
    decision_id=decision.decision_id,
    experience_id=decision.selected_experience.experience_id,
    subject={"kind": "user", "ref": "usr_88213"},
    event_type="completion",
    occurred_at=int(time.time() * 1000),
    metrics={"watchedSeconds": 1180},
    evidence_class="production-observed",
    idempotency_key=str(uuid.uuid4()),
)`,
};

export const SDK_FEATURE_ROWS: readonly (readonly string[])[] = [
  ["Contract validation (both ways)", "Live today", "Target (S2-004)"],
  ["Typed errors (`ReckonSdkError` classes)", "Live today", "Target (S2-004)"],
  ["Automatic `Idempotency-Key` for POSTs", "Live today (routes without body keys)", "Target (S2-004)"],
  ["`apiVersion` pinning", "Target (S2-001/S2-004)", "Target (S2-004)"],
  ["`?expand[]` support", "Target (S2-001/S2-004)", "Target (S2-004)"],
  ["Auto-paginating iterators", "Target (S2-004)", "Target (S2-004)"],
  ["Webhook signature verification", "Target (S2-002/S2-004)", "Target (S2-004)"],
  ["Streaming (SSE) client", "Target (S2-001/S2-004)", "Not planned"],
];
