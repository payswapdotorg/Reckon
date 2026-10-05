/**
 * Contract fixtures for docs code samples (S1-004).
 *
 * Every example payload shown in the quickstart and reference pages lives
 * here as a typed object `satisfies`-ing the REAL frozen contract type from
 * @reckon/contracts. The vitest suite
 * (test/docs-contract-fixtures.test.ts) additionally validates each object
 * against the real zod schema, so docs samples can never drift from the
 * wire contracts.
 *
 * Only `import type` is used here: no runtime dependency on workspace
 * packages ships in the client bundle.
 */

import type {
  CandidateSet,
  CatalogItem,
  ContextSnapshot,
  DecisionRequest,
  DecisionResult,
  Experience,
  OutcomeEvent,
  PreferenceDelta,
  Realization,
} from "@reckon/contracts";

/** Render a fixture as the JSON shown in code blocks. */
export function jsonOf(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/* ------------------------------------------------------------------ *
 * The demo vertical: one evening "relax" decision for tenant "demo"
 * ------------------------------------------------------------------ */

export const contextSnapshotExample: ContextSnapshot = {
  schema: "reckon.context-snapshot",
  schemaVersion: "0.1.0",
  contextId: "ctx_01J8ZWJ9K2",
  at: 1769997720000,
  time: { localTime: "19:42", timezone: "Europe/Paris", dayPart: "evening" },
  device: { class: "phone", screenAvailable: true, audioRoute: "speaker" },
  network: { class: "wifi", bandwidthHint: "high" },
  activity: ["browsing-home", "winding-down"],
  attention: { availableMs: 1200000, quality: "partial" },
  session: { sessionId: "ses_01J8ZWHT7F", positionInSession: 3 },
  fatigue: { repetitionLevel: 0.22, recentInterruptions: 1 },
  extra: {},
  // Location deliberately omitted: ADR-003 — only sent when explicitly
  // permitted AND necessary.
};

export const catalogItemExample: CatalogItem = {
  schema: "reckon.catalog-item",
  schemaVersion: "0.1.0",
  itemId: "item_reef_doc",
  kind: "media",
  labels: ["nature", "calm", "shortform"],
  attributes: {
    title: "Coral Reef at Dusk",
    durationSeconds: 1200,
    contentRating: "G",
  },
  availableFrom: 1769900000000,
};

export const realizationExample: Realization = {
  schema: "reckon.realization",
  schemaVersion: "0.1.0",
  realizationId: "rlz_reef_en_hd",
  itemId: "item_reef_doc",
  kind: "stream-hls",
  locale: "en",
  constraints: { maxResolution: "1080p", minBandwidth: "medium" },
};

export const candidateSetExample: CandidateSet = {
  setId: "cand_01J8ZWJ4P8",
  candidates: [
    {
      itemId: "item_reef_doc",
      realizationIds: ["rlz_reef_en_hd"],
      source: "host-retrieval",
      rankHint: 1,
      scoreHint: 0.91,
    },
    {
      itemId: "item_alpine_run",
      realizationIds: ["rlz_alpine_en_hd"],
      source: "host-retrieval",
      rankHint: 2,
      scoreHint: 0.84,
    },
    {
      itemId: "item_kitchen_series",
      realizationIds: [],
      source: "approved-exploration",
      rankHint: 3,
    },
  ],
  provenance: { system: "host-retrieval", version: "2.4.0" },
};

export const selectedExperienceExample: Experience = {
  schema: "reckon.experience",
  schemaVersion: "0.1.0",
  experienceId: "exp_01J8ZWM8T2",
  itemId: "item_reef_doc",
  realizationId: "rlz_reef_en_hd",
  format: {
    kind: "card",
    params: { headline: "20 min · calm coral reefs", maxWidth: 360 },
  },
  duration: 1200,
  timing: { earliestMs: 1769997720123, latestMs: 1769998920123 },
  objectiveFit: {
    objective: {
      objectiveId: "obj_relax_evening",
      version: "1",
      kind: "relax",
      params: {},
    },
    fitScore: 0.82,
    notes: ["evening wind-down match"],
  },
  requirements: { deviceClass: ["phone"], requiresScreen: true, minBandwidth: "medium" },
  transformations: [],
  constraints: [],
};

export const decisionRequestExample: DecisionRequest = {
  schema: "reckon.decision-request",
  schemaVersion: "0.1.0",
  requestId: "req_01J8ZWK3Q7",
  tenant: { tenantId: "demo" },
  subject: { kind: "user", ref: "usr_88213" },
  objective: { objectiveId: "obj_relax_evening", version: "1", kind: "relax", params: {} },
  attentionPolicy: { policyId: "att_balanced", version: "1", style: "balanced", params: {} },
  context: { contextId: "ctx_01J8ZWJ9K2" },
  candidates: candidateSetExample,
  constraints: [],
  policySelector: { policyId: "pol_evening_relax", version: "3" },
  at: 1769997720000,
  idempotencyKey: "idem_01J8ZWKC1N",
};

export const decisionResultExample: DecisionResult = {
  schema: "reckon.decision-result",
  schemaVersion: "0.1.0",
  decisionId: "dec_01J8ZWM6X4",
  requestId: "req_01J8ZWK3Q7",
  tenant: { tenantId: "demo" },
  action: "SUGGEST",
  selectedExperience: selectedExperienceExample,
  alternatives: [
    {
      experienceId: "exp_01J8ZWM9F7",
      score: 0.71,
      reason: "strong objective fit, weaker fatigue guard",
      excludedBy: "fatigue-policy",
    },
  ],
  uncertainty: {
    confidence: 0.74,
    spread: 0.12,
    disagreement: 0.08,
    method: "ensemble-spread",
  },
  policy: { policyId: "pol_evening_relax", version: "3" },
  scheduleDelta: { action: "QUEUE", enqueue: ["exp_01J8ZWM9F7"], dequeue: [] },
  reasons: [
    {
      code: "objective_fit",
      message: "Matches the declared relax objective for the evening context.",
    },
    {
      code: "attention_budget",
      message: "Fits the 20-minute attention window with 5 minutes of slack.",
    },
    {
      code: "fatigue_guard",
      message: "One alternative was queued instead of suggested to limit repetition.",
    },
  ],
  provenance: { system: "reckon-decision-engine", version: "0.1.0", correlationId: "req_01J8ZWK3Q7" },
  latency: { latencyMsP50: 38, latencyMsP95: 61 },
  at: 1769997720123,
};

export const outcomeEventExample: OutcomeEvent = {
  schema: "reckon.outcome-event",
  schemaVersion: "0.1.0",
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
};

export const preferenceDeltaExample: PreferenceDelta = {
  schema: "reckon.preference-delta",
  schemaVersion: "0.1.0",
  deltaId: "pfd_01J9A7C2M6",
  tenant: { tenantId: "demo" },
  subject: { kind: "user", ref: "usr_88213" },
  dimension: "topic.calm-nature",
  op: "add",
  newValue: 0.34,
  confidenceDelta: 0.11,
  resultingConfidence: 0.61,
  uncertainty: { confidence: 0.61 },
  provenance: { system: "reckon-learning", version: "0.1.0" },
  decay: { halfLifeSeconds: 2592000 },
  model: { modelId: "pref-embed-v3", version: "12" },
  timestamp: 1769998920123,
};

/** Compact request used in the SDK sample (same contract, fewer lines). */
export const decisionRequestSdkExample: DecisionRequest = {
  ...decisionRequestExample,
  requestId: "req_01J8ZX4T2B",
  idempotencyKey: "idem_01J8ZX4V9L",
};
