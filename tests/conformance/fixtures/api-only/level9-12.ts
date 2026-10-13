/**
 * SIM-004 — the API-only measurement scenarios for ladder Levels 9–12
 * (W3 lane, Wave B mandate).
 *
 * Each scenario is a flat script of PUBLIC operations — the request
 * bodies that cross `@reckon/sdk`'s REAL client (catalog upserts in the
 * connect phase; per step: POST /v1/candidates → POST /v1/decisions →
 * POST /v1/outcomes → POST /v1/preferences/events). NO host-adapter
 * callbacks: the host IS the script. The outcome/delta builders are the
 * host glue that maps its domain state onto the frozen contract
 * vocabulary; a builder returning undefined (or absent) is the honest
 * host-side DECLINE (no outcome call — presentation authority is
 * host-owned).
 *
 * Scenario set:
 * - `l9-food-dispatch` — Level 9 through the public API only: fresh
 *   order → substitution SWITCH → priority-prep INTERRUPT → delivery,
 *   with hard-deadline constraints, planId coupling and a competing
 *   reward (speed vs cost) on every request;
 * - `l10-spatial-dispatch` — Level 10: zone-rotated matching → ride
 *   tracking → completion → nearest-zone scarcity → surge re-dispatch
 *   INTERRUPT, with a tight max-latency budget and zone-bearing
 *   context ids (the spatial context that cannot cross as data);
 * - `l11-feed-page` — Level 11: large candidate sets (18 candidates),
 *   exploration candidates every 3rd step, a policy-boundary DECLINE at
 *   step 4 (requested-but-not-presented), one abandonment;
 * - `l12-offer-audit` — Level 12: strict-eligibility constraints, a
 *   suitability DECLINE at step 3, an acceptance (step 2) and the
 *   append-oriented APY CORRECTION (step 5) that references it;
 * - `l9-malformed-dispatch` — the terminal-classification probe: step 3
 *   carries an empty candidate set (contract-invalid) — the calls that
 *   carry it fail TERMINALLY (SDK_REQUEST_INVALID, never retried) and
 *   the run continues honestly;
 * - resilience variants of l10 and l12 under a seeded transport-fault
 *   storm (faultRate 0.25, 3 retries) — transient faults are retried
 *   and classified.
 *
 * Glue measurement basis (host-declared, mechanical — mirrors the
 * SIM-003 fixture convention): each scenario section is marker-delimited
 * (`// ===== api-only scenario: <id> =====` … `// ===== end … =====`);
 * `glue.loc` counts the non-blank, non-comment lines of the section;
 * `glue.customAdapterLoc` counts the subset inside the
 * `// ~ adapter-map:begin … // ~ adapter-map:end` markers (the lines
 * that map host domain state onto Reckon contract vocabulary);
 * `glue.functions` counts the camelCase named builder functions in
 * the section (function declarations plus const-arrow builders — the
 * SCREAMING_SNAKE constants are host domain data, not glue functions)
 * (re-verified mechanically by packages/simulation/test/
 * api-only.test.ts).
 *
 * Determinism: no wall-clock, no unseeded randomness, evidence class
 * `fixture` throughout.
 */
import type {
  ApiOnlyScenario,
  ApiOnlyStep,
  DecisionRequestInput,
  OutcomeEventInput,
  PreferenceDeltaInput,
  SimulationManifestContentInput,
  DecisionResult,
} from "../../../../packages/simulation/src/index.js";
import type {
  HardConstraint,
  SubjectReference,
  Objective,
  AttentionPolicy,
  RewardSpec,
  OutcomeEventType,
} from "../../../../packages/contracts/src/index.js";

// ---------------------------------------------------------------------------
// Shared API-only manifest builders (the public-surface declaration)
// ---------------------------------------------------------------------------

/** The input shape of one manifest supported-capabilities entry. */
type SupportedCapabilityInput = NonNullable<SimulationManifestContentInput["supportedCapabilities"]>[number];

const API_ONLY_OPERATIONS = {
  catalog: ["POST /v1/catalog/items", "POST /v1/catalog/realizations"],
  candidates: ["POST /v1/candidates"],
  decisions: ["POST /v1/decisions"],
  outcomes: ["POST /v1/outcomes"],
  preferences: ["POST /v1/preferences/events"],
} as const;

/** The standard-loop capabilities an API-only host wires (all supported at fixture evidence). */
function apiOnlyStandardCapabilities(): SupportedCapabilityInput[] {
  return [
    { capability: "tenant-identity", status: "supported", evidenceClass: "fixture" },
    { capability: "catalog-registration", status: "supported", evidenceClass: "fixture", apiOperations: [...API_ONLY_OPERATIONS.catalog], sdkMethods: ["catalog.upsertItem", "catalog.upsertRealization"] },
    { capability: "realization-declaration", status: "supported", evidenceClass: "fixture", apiOperations: [...API_ONLY_OPERATIONS.catalog], sdkMethods: ["catalog.upsertRealization"] },
    { capability: "candidate-retrieval", status: "supported", evidenceClass: "fixture", apiOperations: [...API_ONLY_OPERATIONS.candidates], sdkMethods: ["candidates.submit"] },
    { capability: "objective-declaration", status: "supported", evidenceClass: "fixture", apiOperations: [...API_ONLY_OPERATIONS.decisions], sdkMethods: ["decisions.request"], notes: "objective declared in-request on POST /v1/decisions" },
    { capability: "constraint-declaration", status: "supported", evidenceClass: "fixture", apiOperations: [...API_ONLY_OPERATIONS.decisions], sdkMethods: ["decisions.request"], notes: "hard constraints declared in-request on POST /v1/decisions" },
    { capability: "attention-policy", status: "supported", evidenceClass: "fixture", apiOperations: [...API_ONLY_OPERATIONS.decisions], sdkMethods: ["decisions.request"], notes: "attention policy declared in-request on POST /v1/decisions" },
    { capability: "decision-request", status: "supported", evidenceClass: "fixture", apiOperations: [...API_ONLY_OPERATIONS.decisions], sdkMethods: ["decisions.request"] },
    { capability: "outcome-return", status: "supported", evidenceClass: "fixture", apiOperations: [...API_ONLY_OPERATIONS.outcomes], sdkMethods: ["outcomes.append"] },
    { capability: "preference-feedback", status: "supported", evidenceClass: "fixture", apiOperations: [...API_ONLY_OPERATIONS.preferences], sdkMethods: ["preferences.appendDelta"] },
    { capability: "conformance-verification", status: "supported", evidenceClass: "fixture", notes: "harness conformance verdict; no API route — machine-checked offline" },
  ];
}

// ===== api-only scenario: l9-food-dispatch ==================================
// ~ adapter-map:begin
const L9_TENANT = { tenantId: "tenant-api-l9-food" };
const L9_SUBJECT: SubjectReference = { kind: "user", ref: "user-api-l9-diner-1" };
const L9_OBJECTIVE: Objective = { objectiveId: "obj-api-l9-deliver-on-time", version: "1", kind: "complete-task", params: { mode: "delivery-promise" } };
const L9_ATTENTION: AttentionPolicy = { policyId: "ap-api-l9-balanced", version: "1", style: "balanced", params: {} };
const L9_ITEMS = ["l9-dish-pasta", "l9-dish-risotto", "l9-dish-curry"].map((itemId) => ({
  itemId,
  kind: "commerce" as const,
  labels: ["dish"],
  attributes: { domain: "food-delivery" },
}));
const L9_REALIZATIONS = [
  { realizationId: "l9-real-api-pasta-standard", itemId: "l9-dish-pasta", kind: "courier-standard-prep", constraints: { etaMinutes: 18, priceUsd: 14 } },
  { realizationId: "l9-real-api-pasta-express", itemId: "l9-dish-pasta", kind: "courier-priority-prep", constraints: { etaMinutes: 12, priceUsd: 17 } },
  { realizationId: "l9-real-api-risotto-standard", itemId: "l9-dish-risotto", kind: "courier-standard-prep", constraints: { etaMinutes: 21, priceUsd: 17 } },
];
const L9_CONSTRAINTS = (step: number): HardConstraint[] => [
  { kind: "time-window", untilMs: 60_000 * (step + 20) },
  { kind: "max-latency", latencyMs: 250 },
  { kind: "catalog-rule", ruleId: "l9-kitchen-open" },
];
const L9_REWARD: RewardSpec = {
  rewardId: "reward-api-l9-dispatch",
  version: "1",
  terms: [
    { termId: "term-on-time", version: "1", kind: "task-success", weight: 0.6, params: {} },
    { termId: "term-cost", version: "1", kind: "inference-cost", weight: -0.4, params: {} },
  ],
};
function l9Outcome(eventType: OutcomeEventType, customType?: string): (decision: DecisionResult, nowMs: number) => OutcomeEventInput {
  return (decision, nowMs): OutcomeEventInput => ({
    eventId: `ev-api-l9-${customType ?? eventType}`,
    tenant: L9_TENANT,
    subject: L9_SUBJECT,
    decisionId: decision.decisionId,
    experienceId: decision.selectedExperience?.experienceId,
    eventType,
    ...(customType !== undefined ? { customEventType: customType } : {}),
    occurredAt: nowMs,
    evidenceClass: "fixture" as const,
    metrics: { etaMinutes: 18 + 2 * Number(customType?.slice(-1) ?? 0), orderValueUsd: 14 },
    idempotencyKey: `idem-api-l9-${customType ?? eventType}`,
  });
}
function l9Delta(dimension: string, weight: number): (decision: DecisionResult, nowMs: number) => PreferenceDeltaInput {
  return (_decision, nowMs): PreferenceDeltaInput => ({
    deltaId: `delta-api-l9-${dimension}`,
    tenant: L9_TENANT,
    subject: L9_SUBJECT,
    dimension,
    op: "add" as const,
    newValue: weight,
    resultingConfidence: 0.6,
    model: { modelId: "api-l9-cuisine-affinity", version: "1" },
    timestamp: nowMs,
  });
}
// ~ adapter-map:end

const l9FoodDispatchScenario: ApiOnlyScenario = {
  level: 9,
  scenarioId: "l9-food-dispatch",
  description:
    "Level 9 driven through the public API only: fresh order (QUEUE) → substitution SWITCH → priority-prep INTERRUPT → delivery, with hard deadlines, planId coupling and a competing reward",
  hostSystem: { hostId: "host-api-l9-food", name: "ForkRoute API-only host", hostAdapterId: "adapter-api-l9-food-1", version: "0.1.0" },
  glue: { functions: 2, loc: 233, customAdapterLoc: 56 },
  manifestContent: {
    manifestVersion: "1",
    hostSystem: { hostId: "host-api-l9-food", name: "ForkRoute API-only host", hostAdapterId: "adapter-api-l9-food-1", version: "0.1.0" },
    declaredAt: 0,
    supportedCapabilities: [
      ...apiOnlyStandardCapabilities(),
      {
        capability: "plan-management",
        status: "partial",
        evidenceClass: "fixture",
        friction: "COMPOSITION_GAP",
        apiOperations: [...API_ONLY_OPERATIONS.decisions],
        sdkMethods: ["decisions.request"],
        notes: "the rolling delivery plan couples via DecisionRequest.planId only; the public SDK exposes plans.create/replan/get but the composed harness path has no plan route — measured by the surface probe",
      },
    ],
  },
  profile: {
    profileId: "profile-api-l9-food-dispatch",
    name: "Food delivery (API-only)",
    description: "SIM-004 API-only measurement — ladder level 9 through the public surface only.",
    ladderLevel: 9,
    requiredCapabilities: [
      { capability: "tenant-identity" },
      { capability: "catalog-registration" },
      { capability: "realization-declaration" },
      { capability: "candidate-retrieval" },
      { capability: "objective-declaration" },
      { capability: "constraint-declaration" },
      { capability: "attention-policy" },
      { capability: "decision-request" },
      { capability: "outcome-return" },
      { capability: "preference-feedback" },
      { capability: "conformance-verification" },
      { capability: "plan-management" },
    ],
    requiredEvidenceClass: "fixture",
    declaredAt: 1_000,
  },
  connect: { items: L9_ITEMS, realizations: L9_REALIZATIONS },
  steps: [
    {
      candidates: { setId: "cs-api-l9-1", candidates: [{ itemId: "l9-dish-pasta", realizationIds: ["l9-real-api-pasta-standard"], source: "host-menu-rank", rankHint: 1 }] },
      request: {
        requestId: "req-api-l9-1",
        tenant: L9_TENANT,
        subject: L9_SUBJECT,
        objective: L9_OBJECTIVE,
        attentionPolicy: L9_ATTENTION,
        context: { contextId: "ctx-api-l9-1" },
        candidates: { setId: "cs-api-l9-1", candidates: [{ itemId: "l9-dish-pasta", realizationIds: ["l9-real-api-pasta-standard"], source: "host-menu-rank", rankHint: 1 }] },
        constraints: L9_CONSTRAINTS(1),
        policySelector: { policyId: "forkroute-dispatch-v1" },
        planId: "plan-api-l9-order-1",
        reward: L9_REWARD,
        idempotencyKey: "idem-api-l9-req-1",
      },
      outcome: l9Outcome("start", "order-1"),
      preferenceDelta: l9Delta("cuisine.italian", 1.1),
    },
    {
      candidates: { setId: "cs-api-l9-2", candidates: [{ itemId: "l9-dish-pasta", realizationIds: ["l9-real-api-pasta-standard"], source: "host-order-track", rankHint: 1 }] },
      request: {
        requestId: "req-api-l9-2",
        tenant: L9_TENANT,
        subject: L9_SUBJECT,
        objective: L9_OBJECTIVE,
        attentionPolicy: L9_ATTENTION,
        context: { contextId: "ctx-api-l9-2" },
        candidates: { setId: "cs-api-l9-2", candidates: [{ itemId: "l9-dish-pasta", realizationIds: ["l9-real-api-pasta-standard"], source: "host-order-track", rankHint: 1 }] },
        constraints: L9_CONSTRAINTS(2),
        policySelector: { policyId: "forkroute-dispatch-v1" },
        currentExperience: {
          schema: "reckon.experience",
          experienceId: "exp-api-l9-live-order",
          itemId: "l9-dish-pasta",
          realizationId: "l9-real-api-pasta-standard",
          format: { kind: "card", params: {} },
          duration: 60,
        },
        planId: "plan-api-l9-order-1",
        reward: L9_REWARD,
        idempotencyKey: "idem-api-l9-req-2",
      },
      outcome: l9Outcome("custom", "status-2"),
      preferenceDelta: l9Delta("cuisine.italian", 1.2),
    },
    {
      candidates: { setId: "cs-api-l9-3", candidates: [{ itemId: "l9-dish-risotto", realizationIds: ["l9-real-api-risotto-standard"], source: "host-substitution", rankHint: 1 }] },
      request: {
        requestId: "req-api-l9-3",
        tenant: L9_TENANT,
        subject: L9_SUBJECT,
        objective: L9_OBJECTIVE,
        attentionPolicy: L9_ATTENTION,
        context: { contextId: "ctx-api-l9-3" },
        candidates: { setId: "cs-api-l9-3", candidates: [{ itemId: "l9-dish-risotto", realizationIds: ["l9-real-api-risotto-standard"], source: "host-substitution", rankHint: 1 }] },
        constraints: L9_CONSTRAINTS(3),
        policySelector: { policyId: "forkroute-dispatch-v1" },
        currentExperience: {
          schema: "reckon.experience",
          experienceId: "exp-api-l9-live-order",
          itemId: "l9-dish-pasta",
          realizationId: "l9-real-api-pasta-standard",
          format: { kind: "card", params: {} },
          duration: 60,
        },
        planId: "plan-api-l9-order-1",
        reward: L9_REWARD,
        idempotencyKey: "idem-api-l9-req-3",
      },
      outcome: l9Outcome("custom", "substitution-3"),
      preferenceDelta: l9Delta("cuisine.italian", 1.3),
    },
    {
      candidates: { setId: "cs-api-l9-4", candidates: [{ itemId: "l9-dish-pasta", realizationIds: ["l9-real-api-pasta-express"], source: "host-time-critical", rankHint: 1 }] },
      request: {
        requestId: "req-api-l9-4",
        tenant: L9_TENANT,
        subject: L9_SUBJECT,
        objective: L9_OBJECTIVE,
        attentionPolicy: L9_ATTENTION,
        context: { contextId: "ctx-api-l9-4" },
        candidates: { setId: "cs-api-l9-4", candidates: [{ itemId: "l9-dish-pasta", realizationIds: ["l9-real-api-pasta-express"], source: "host-time-critical", rankHint: 1 }] },
        constraints: L9_CONSTRAINTS(4),
        policySelector: { policyId: "forkroute-dispatch-v1" },
        currentExperience: {
          schema: "reckon.experience",
          experienceId: "exp-api-l9-live-order",
          itemId: "l9-dish-risotto",
          realizationId: "l9-real-api-risotto-standard",
          format: { kind: "card", params: {} },
          duration: 60,
        },
        planId: "plan-api-l9-order-1",
        reward: L9_REWARD,
        idempotencyKey: "idem-api-l9-req-4",
      },
      outcome: l9Outcome("interruption-accept", "boost-4"),
      preferenceDelta: l9Delta("cuisine.italian", 1.4),
    },
    {
      candidates: { setId: "cs-api-l9-5", candidates: [{ itemId: "l9-dish-pasta", realizationIds: ["l9-real-api-pasta-express"], source: "host-order-track", rankHint: 1 }] },
      request: {
        requestId: "req-api-l9-5",
        tenant: L9_TENANT,
        subject: L9_SUBJECT,
        objective: L9_OBJECTIVE,
        attentionPolicy: L9_ATTENTION,
        context: { contextId: "ctx-api-l9-5" },
        candidates: { setId: "cs-api-l9-5", candidates: [{ itemId: "l9-dish-pasta", realizationIds: ["l9-real-api-pasta-express"], source: "host-order-track", rankHint: 1 }] },
        constraints: L9_CONSTRAINTS(5),
        policySelector: { policyId: "forkroute-dispatch-v1" },
        currentExperience: {
          schema: "reckon.experience",
          experienceId: "exp-api-l9-live-order",
          itemId: "l9-dish-pasta",
          realizationId: "l9-real-api-pasta-express",
          format: { kind: "card", params: {} },
          duration: 60,
        },
        planId: "plan-api-l9-order-1",
        reward: L9_REWARD,
        idempotencyKey: "idem-api-l9-req-5",
      },
      outcome: l9Outcome("conversion", "delivered-5"),
      preferenceDelta: l9Delta("cuisine.italian", 1.5),
    },
  ],
};
// ===== end api-only scenario: l9-food-dispatch ==============================

// ===== api-only scenario: l10-spatial-dispatch ==============================
// ~ adapter-map:begin
const L10_TENANT = { tenantId: "tenant-api-l10-mobility" };
const L10_SUBJECT: SubjectReference = { kind: "user", ref: "user-api-l10-rider-1" };
const L10_OBJECTIVE: Objective = { objectiveId: "obj-api-l10-arrive-on-time", version: "1", kind: "complete-task", params: { mode: "dispatch" } };
const L10_ATTENTION: AttentionPolicy = { policyId: "ap-api-l10-balanced", version: "1", style: "balanced", params: {} };
const L10_ITEMS = ["l10-ride-standard", "l10-ride-xl"].map((itemId) => ({
  itemId,
  kind: "other" as const,
  labels: ["ride"],
  attributes: { domain: "mobility" },
}));
const L10_REALIZATIONS = [
  { realizationId: "l10-real-api-standard-01", itemId: "l10-ride-standard", kind: "vehicle-dispatch", constraints: { homeZone: "central", baseEtaMinutes: 4 } },
  { realizationId: "l10-real-api-xl-01", itemId: "l10-ride-xl", kind: "vehicle-dispatch", constraints: { homeZone: "central", baseEtaMinutes: 7 } },
];
const L10_CONSTRAINTS = (zone: string): HardConstraint[] => [
  { kind: "max-latency", latencyMs: 250 },
  { kind: "custom", constraintId: "l10-driver-supply", params: { zone, minDriversRequired: 1 } },
];
function l10Outcome(eventType: OutcomeEventType, customType: string): (decision: DecisionResult, nowMs: number) => OutcomeEventInput {
  return (decision, nowMs): OutcomeEventInput => ({
    eventId: `ev-api-l10-${customType}`,
    tenant: L10_TENANT,
    subject: L10_SUBJECT,
    decisionId: decision.decisionId,
    experienceId: decision.selectedExperience?.experienceId,
    eventType,
    ...(eventType === "custom" ? { customEventType: customType } : {}),
    occurredAt: nowMs,
    evidenceClass: "fixture" as const,
    metrics: { waitMinutes: 4, surgeMultiplier: 1, fareUsd: 13.6 },
    idempotencyKey: `idem-api-l10-${customType}`,
  });
}
function l10Delta(zone: string): (decision: DecisionResult, nowMs: number) => PreferenceDeltaInput {
  return (_decision, nowMs): PreferenceDeltaInput => ({
    deltaId: `delta-api-l10-${zone}`,
    tenant: L10_TENANT,
    subject: L10_SUBJECT,
    dimension: `zone.${zone}`,
    op: "add" as const,
    newValue: 1.15,
    resultingConfidence: 0.6,
    model: { modelId: "api-l10-zone-affinity", version: "1" },
    timestamp: nowMs,
  });
}
const l10ZoneContext = (step: number, zone: string) => ({ contextId: `ctx-api-l10-${step}-${zone}` });
// ~ adapter-map:end

const l10SpatialDispatchScenario: ApiOnlyScenario = {
  level: 10,
  scenarioId: "l10-spatial-dispatch",
  description:
    "Level 10 through the public API only: central match (QUEUE) → ride tracking (CONTINUE) → completion → south-zone scarcity (nearest-zone QUEUE) → surge re-dispatch (INTERRUPT), with a tight latency budget and zone-bearing context ids",
  hostSystem: { hostId: "host-api-l10-mobility", name: "VectorHail API-only host", hostAdapterId: "adapter-api-l10-mobility-1", version: "0.1.0" },
  glue: { functions: 3, loc: 206, customAdapterLoc: 47 },
  manifestContent: {
    manifestVersion: "1",
    hostSystem: { hostId: "host-api-l10-mobility", name: "VectorHail API-only host", hostAdapterId: "adapter-api-l10-mobility-1", version: "0.1.0" },
    declaredAt: 0,
    supportedCapabilities: [
      ...apiOnlyStandardCapabilities(),
      {
        capability: "context-snapshots",
        status: "partial",
        evidenceClass: "fixture",
        friction: "API_GAP",
        apiOperations: [...API_ONLY_OPERATIONS.decisions],
        sdkMethods: ["decisions.request"],
        notes: "the pickup zone rides the contextId reference only; the frozen ContextSnapshot payload (location.coarse, device) has no public ingestion route — spatial context cannot cross the public surface as data",
      },
    ],
  },
  profile: {
    profileId: "profile-api-l10-spatial-dispatch",
    name: "Mobility / ride-hailing (API-only)",
    description: "SIM-004 API-only measurement — ladder level 10 through the public surface only.",
    ladderLevel: 10,
    requiredCapabilities: [
      { capability: "tenant-identity" },
      { capability: "catalog-registration" },
      { capability: "realization-declaration" },
      { capability: "candidate-retrieval" },
      { capability: "objective-declaration" },
      { capability: "constraint-declaration" },
      { capability: "attention-policy" },
      { capability: "decision-request" },
      { capability: "outcome-return" },
      { capability: "preference-feedback" },
      { capability: "conformance-verification" },
      { capability: "context-snapshots" },
    ],
    requiredEvidenceClass: "fixture",
    declaredAt: 1_000,
  },
  connect: { items: L10_ITEMS, realizations: L10_REALIZATIONS },
  steps: [
    {
      candidates: { setId: "cs-api-l10-1", candidates: [{ itemId: "l10-ride-standard", realizationIds: ["l10-real-api-standard-01"], source: "home-zone-supply", rankHint: 1 }] },
      request: {
        requestId: "req-api-l10-1",
        tenant: L10_TENANT,
        subject: L10_SUBJECT,
        objective: L10_OBJECTIVE,
        attentionPolicy: L10_ATTENTION,
        context: l10ZoneContext(1, "central"),
        candidates: { setId: "cs-api-l10-1", candidates: [{ itemId: "l10-ride-standard", realizationIds: ["l10-real-api-standard-01"], source: "home-zone-supply", rankHint: 1 }] },
        constraints: L10_CONSTRAINTS("central"),
        policySelector: { policyId: "vectorhail-dispatch-v1" },
        idempotencyKey: "idem-api-l10-req-1",
      },
      outcome: l10Outcome("start", "match-1"),
      preferenceDelta: l10Delta("central"),
    },
    {
      candidates: { setId: "cs-api-l10-2", candidates: [{ itemId: "l10-ride-standard", realizationIds: ["l10-real-api-standard-01"], source: "host-ride-track", rankHint: 1 }] },
      request: {
        requestId: "req-api-l10-2",
        tenant: L10_TENANT,
        subject: L10_SUBJECT,
        objective: L10_OBJECTIVE,
        attentionPolicy: L10_ATTENTION,
        context: l10ZoneContext(2, "north"),
        candidates: { setId: "cs-api-l10-2", candidates: [{ itemId: "l10-ride-standard", realizationIds: ["l10-real-api-standard-01"], source: "host-ride-track", rankHint: 1 }] },
        constraints: L10_CONSTRAINTS("north"),
        policySelector: { policyId: "vectorhail-dispatch-v1" },
        currentExperience: {
          schema: "reckon.experience",
          experienceId: "exp-api-l10-live-ride",
          itemId: "l10-ride-standard",
          realizationId: "l10-real-api-standard-01",
          format: { kind: "card", params: {} },
          duration: 60,
        },
        idempotencyKey: "idem-api-l10-req-2",
      },
      outcome: l10Outcome("custom", "progress-2"),
      preferenceDelta: l10Delta("north"),
    },
    {
      candidates: { setId: "cs-api-l10-3", candidates: [{ itemId: "l10-ride-standard", realizationIds: ["l10-real-api-standard-01"], source: "host-ride-track", rankHint: 1 }] },
      request: {
        requestId: "req-api-l10-3",
        tenant: L10_TENANT,
        subject: L10_SUBJECT,
        objective: L10_OBJECTIVE,
        attentionPolicy: L10_ATTENTION,
        context: l10ZoneContext(3, "east"),
        candidates: { setId: "cs-api-l10-3", candidates: [{ itemId: "l10-ride-standard", realizationIds: ["l10-real-api-standard-01"], source: "host-ride-track", rankHint: 1 }] },
        constraints: L10_CONSTRAINTS("east"),
        policySelector: { policyId: "vectorhail-dispatch-v1" },
        currentExperience: {
          schema: "reckon.experience",
          experienceId: "exp-api-l10-live-ride",
          itemId: "l10-ride-standard",
          realizationId: "l10-real-api-standard-01",
          format: { kind: "card", params: {} },
          duration: 60,
        },
        idempotencyKey: "idem-api-l10-req-3",
      },
      outcome: l10Outcome("completion", "complete-3"),
      preferenceDelta: l10Delta("east"),
    },
    {
      candidates: { setId: "cs-api-l10-4", candidates: [{ itemId: "l10-ride-xl", realizationIds: ["l10-real-api-xl-01"], source: "host-nearest-zone", rankHint: 1 }] },
      request: {
        requestId: "req-api-l10-4",
        tenant: L10_TENANT,
        subject: L10_SUBJECT,
        objective: L10_OBJECTIVE,
        attentionPolicy: L10_ATTENTION,
        context: l10ZoneContext(4, "south"),
        candidates: { setId: "cs-api-l10-4", candidates: [{ itemId: "l10-ride-xl", realizationIds: ["l10-real-api-xl-01"], source: "host-nearest-zone", rankHint: 1 }] },
        constraints: L10_CONSTRAINTS("south"),
        policySelector: { policyId: "vectorhail-dispatch-v1" },
        idempotencyKey: "idem-api-l10-req-4",
      },
      outcome: l10Outcome("start", "match-4"),
      preferenceDelta: l10Delta("south"),
    },
    {
      candidates: { setId: "cs-api-l10-5", candidates: [{ itemId: "l10-ride-xl", realizationIds: ["l10-real-api-xl-01"], source: "host-time-critical", rankHint: 1 }] },
      request: {
        requestId: "req-api-l10-5",
        tenant: L10_TENANT,
        subject: L10_SUBJECT,
        objective: L10_OBJECTIVE,
        attentionPolicy: L10_ATTENTION,
        context: l10ZoneContext(5, "central"),
        candidates: { setId: "cs-api-l10-5", candidates: [{ itemId: "l10-ride-xl", realizationIds: ["l10-real-api-xl-01"], source: "host-time-critical", rankHint: 1 }] },
        constraints: L10_CONSTRAINTS("central"),
        policySelector: { policyId: "vectorhail-dispatch-v1" },
        currentExperience: {
          schema: "reckon.experience",
          experienceId: "exp-api-l10-live-ride",
          itemId: "l10-ride-standard",
          realizationId: "l10-real-api-standard-01",
          format: { kind: "card", params: {} },
          duration: 60,
        },
        idempotencyKey: "idem-api-l10-req-5",
      },
      outcome: l10Outcome("interruption-accept", "surge-5"),
      preferenceDelta: l10Delta("central"),
    },
  ],
};
// ===== end api-only scenario: l10-spatial-dispatch ==========================

// ===== api-only scenario: l11-feed-page ====================================
// ~ adapter-map:begin
const L11_TENANT = { tenantId: "tenant-api-l11-social" };
const L11_SUBJECT: SubjectReference = { kind: "user", ref: "user-api-l11-scroller-1" };
const L11_OBJECTIVE: Objective = { objectiveId: "obj-api-l11-discover", version: "1", kind: "discover", params: { mode: "feed-scroll" } };
const L11_ATTENTION: AttentionPolicy = { policyId: "ap-api-l11-balanced", version: "1", style: "balanced", params: {} };
const L11_ITEM_IDS = Array.from({ length: 18 }, (_, index) => `l11-api-post-${String(index + 1).padStart(2, "0")}`);
const L11_ITEMS = L11_ITEM_IDS.map((itemId) => ({
  itemId,
  kind: "article" as const,
  labels: ["post"],
  attributes: { domain: "social-feed" },
}));
const L11_REALIZATIONS = L11_ITEM_IDS.map((itemId) => ({
  realizationId: `real-api-${itemId}`,
  itemId,
  kind: "feed-card",
  constraints: {},
}));
/** The large candidate set (18 entries; exploration candidates on every 3rd step). */
const L11_CANDIDATES = (step: number) => ({
  setId: `cs-api-l11-${step}`,
  candidates: L11_ITEM_IDS.map((itemId, index) => ({
    itemId,
    realizationIds: [`real-api-${itemId}`],
    source: step % 3 === 0 && index >= 16 ? "host-explore" : "host-feed-rank",
    rankHint: index + 1,
  })),
});
const L11_CONSTRAINTS: HardConstraint[] = [
  { kind: "policy-rights", gateId: "l11-content-policy-v1" },
  { kind: "custom", constraintId: "l11-seen-exclusion", params: { scope: "session" } },
  { kind: "max-latency", latencyMs: 150 },
];
/** Policy-boundary DECLINE at step 4: the builder returns undefined (no outcome call). */
function l11Outcome(step: number): (decision: DecisionResult, nowMs: number) => OutcomeEventInput | undefined {
  return (decision, nowMs): OutcomeEventInput | undefined => {
    if (step === 4) return undefined;
    return {
      eventId: `ev-api-l11-${step}`,
      tenant: L11_TENANT,
      subject: L11_SUBJECT,
      decisionId: decision.decisionId,
      experienceId: decision.selectedExperience?.experienceId,
      eventType: step === 5 ? ("abandonment" as const) : ("completion" as const),
      occurredAt: nowMs,
      evidenceClass: "fixture" as const,
      metrics: { dwellSeconds: step === 5 ? 2 : 30, candidateSetSize: 18 },
      idempotencyKey: `idem-api-l11-${step}`,
    };
  };
}
function l11Delta(step: number): (decision: DecisionResult, nowMs: number) => PreferenceDeltaInput {
  return (_decision, nowMs): PreferenceDeltaInput => ({
    deltaId: `delta-api-l11-${step}`,
    tenant: L11_TENANT,
    subject: L11_SUBJECT,
    dimension: `topic.api-${step}`,
    op: "add" as const,
    newValue: 1.25,
    resultingConfidence: 0.6,
    model: { modelId: "api-l11-topic-affinity", version: "1" },
    timestamp: nowMs,
  });
}
// ~ adapter-map:end

const l11FeedPageScenario: ApiOnlyScenario = {
  level: 11,
  scenarioId: "l11-feed-page",
  description:
    "Level 11 through the public API only: large candidate sets (18 entries), exploration candidates every 3rd step, a policy-boundary DECLINE at step 4, an abandonment at step 5",
  hostSystem: { hostId: "host-api-l11-social", name: "Driftline API-only host", hostAdapterId: "adapter-api-l11-social-1", version: "0.1.0" },
  glue: { functions: 2, loc: 114, customAdapterLoc: 61 },
  manifestContent: {
    manifestVersion: "1",
    hostSystem: { hostId: "host-api-l11-social", name: "Driftline API-only host", hostAdapterId: "adapter-api-l11-social-1", version: "0.1.0" },
    declaredAt: 0,
    supportedCapabilities: apiOnlyStandardCapabilities(),
  },
  profile: {
    profileId: "profile-api-l11-feed-page",
    name: "Social feed (API-only)",
    description: "SIM-004 API-only measurement — ladder level 11 through the public surface only.",
    ladderLevel: 11,
    requiredCapabilities: [
      { capability: "tenant-identity" },
      { capability: "catalog-registration" },
      { capability: "realization-declaration" },
      { capability: "candidate-retrieval" },
      { capability: "objective-declaration" },
      { capability: "constraint-declaration" },
      { capability: "attention-policy" },
      { capability: "decision-request" },
      { capability: "outcome-return" },
      { capability: "preference-feedback" },
      { capability: "conformance-verification" },
    ],
    requiredEvidenceClass: "fixture",
    declaredAt: 1_000,
  },
  connect: { items: L11_ITEMS, realizations: L11_REALIZATIONS },
  steps: ([1, 2, 3, 4, 5] as const).map((step) => ({
    candidates: L11_CANDIDATES(step),
    request: {
      requestId: `req-api-l11-${step}`,
      tenant: L11_TENANT,
      subject: L11_SUBJECT,
      objective: L11_OBJECTIVE,
      attentionPolicy: L11_ATTENTION,
      context: { contextId: `ctx-api-l11-${step}` },
      candidates: L11_CANDIDATES(step),
      constraints: L11_CONSTRAINTS,
      policySelector: { policyId: "driftline-feed-v1" },
      idempotencyKey: `idem-api-l11-req-${step}`,
    },
    outcome: l11Outcome(step),
    preferenceDelta: step === 4 ? undefined : l11Delta(step),
  })) as readonly ApiOnlyStep[],
};
// ===== end api-only scenario: l11-feed-page =================================

// ===== api-only scenario: l12-offer-audit ===================================
// ~ adapter-map:begin
const L12_TENANT = { tenantId: "tenant-api-l12-finance" };
const L12_SUBJECT: SubjectReference = { kind: "user", ref: "user-api-l12-member-1" };
const L12_OBJECTIVE: Objective = { objectiveId: "obj-api-l12-right-offer", version: "1", kind: "compare", params: { mode: "offer-eligibility" } };
const L12_ATTENTION: AttentionPolicy = { policyId: "ap-api-l12-mindful", version: "1", style: "mindful", params: {} };
const L12_OFFERS = [
  { itemId: "l12-api-offer-credit", realizationId: "l12-api-term-credit-12", apyPct: 14.9, feeUsd: 0 },
  { itemId: "l12-api-offer-savings", realizationId: "l12-api-term-savings-12", apyPct: 4.35, feeUsd: 0 },
  { itemId: "l12-api-offer-insurance", realizationId: "l12-api-term-insurance-60", apyPct: 0, feeUsd: 42 },
];
const L12_ITEMS = L12_OFFERS.map((offer) => ({
  itemId: offer.itemId,
  kind: "commerce" as const,
  labels: ["offer"],
  attributes: { domain: "finance-offers" },
}));
const L12_REALIZATIONS = L12_OFFERS.map((offer) => ({
  realizationId: offer.realizationId,
  itemId: offer.itemId,
  kind: "offer-term",
  constraints: { apyPct: offer.apyPct, feeUsd: offer.feeUsd },
}));
/** Strict eligibility: the host's gates as hard constraints (rights stay host-owned). */
const L12_CONSTRAINTS: HardConstraint[] = [
  { kind: "policy-rights", gateId: "l12-kyc-verified" },
  { kind: "policy-rights", gateId: "l12-income-verified" },
  { kind: "custom", constraintId: "l12-risk-band", params: { band: "fair" } },
];
/** Suitability DECLINE at step 3 (the insurance offer band-mismatches); correction at step 5. */
function l12Outcome(step: number): (decision: DecisionResult, nowMs: number) => OutcomeEventInput | undefined {
  return (decision, nowMs): OutcomeEventInput | undefined => {
    if (step === 3) return undefined;
    const accepted = step === 2;
    const correction = step === 5;
    return {
      eventId: `ev-api-l12-${step}`,
      tenant: L12_TENANT,
      subject: L12_SUBJECT,
      decisionId: decision.decisionId,
      experienceId: decision.selectedExperience?.experienceId,
      eventType: accepted ? "conversion" : correction ? "correction" : "impression",
      ...(correction ? { customEventType: "apy-adjustment" } : {}),
      occurredAt: nowMs,
      evidenceClass: "fixture" as const,
      metrics: { apyPct: 4.35 + (correction ? 0.25 : 0), feeUsd: 0, approvalValueUsd: accepted ? 500 : 0 },
      ...(correction ? { correctsEventId: "ev-api-l12-2" } : {}),
      idempotencyKey: `idem-api-l12-${step}`,
    };
  };
}
function l12Delta(productLine: string): (decision: DecisionResult, nowMs: number) => PreferenceDeltaInput {
  return (_decision, nowMs): PreferenceDeltaInput => ({
    deltaId: `delta-api-l12-${productLine}`,
    tenant: L12_TENANT,
    subject: L12_SUBJECT,
    dimension: `product.${productLine}`,
    op: "add" as const,
    newValue: 1.2,
    resultingConfidence: 0.6,
    model: { modelId: "api-l12-product-affinity", version: "1" },
    timestamp: nowMs,
  });
}
// ~ adapter-map:end

const l12OfferAuditScenario: ApiOnlyScenario = {
  level: 12,
  scenarioId: "l12-offer-audit",
  description:
    "Level 12 through the public API only: strict-eligibility constraints on every request, a suitability DECLINE at step 3, an acceptance at step 2 and the append-oriented APY correction (step 5) that references it",
  hostSystem: { hostId: "host-api-l12-finance", name: "Meridian API-only host", hostAdapterId: "adapter-api-l12-finance-1", version: "0.1.0" },
  glue: { functions: 2, loc: 132, customAdapterLoc: 60 },
  manifestContent: {
    manifestVersion: "1",
    hostSystem: { hostId: "host-api-l12-finance", name: "Meridian API-only host", hostAdapterId: "adapter-api-l12-finance-1", version: "0.1.0" },
    declaredAt: 0,
    supportedCapabilities: [
      ...apiOnlyStandardCapabilities(),
      {
        capability: "evidence-retrieval",
        status: "partial",
        evidenceClass: "fixture",
        friction: "COMPOSITION_GAP",
        apiOperations: [...API_ONLY_OPERATIONS.outcomes],
        sdkMethods: ["outcomes.append"],
        notes: "the audit trail needs decision/outcome linkage retrieval; the public SDK exposes decisions.get and webhook delivery evidence, but the composed harness path has no route — measured by the surface probe",
      },
    ],
  },
  profile: {
    profileId: "profile-api-l12-offer-audit",
    name: "Finance / offers (API-only)",
    description: "SIM-004 API-only measurement — ladder level 12 through the public surface only.",
    ladderLevel: 12,
    requiredCapabilities: [
      { capability: "tenant-identity" },
      { capability: "catalog-registration" },
      { capability: "realization-declaration" },
      { capability: "candidate-retrieval" },
      { capability: "objective-declaration" },
      { capability: "constraint-declaration" },
      { capability: "attention-policy" },
      { capability: "decision-request" },
      { capability: "outcome-return" },
      { capability: "preference-feedback" },
      { capability: "conformance-verification" },
      { capability: "evidence-retrieval" },
    ],
    requiredEvidenceClass: "fixture",
    declaredAt: 1_000,
  },
  connect: { items: L12_ITEMS, realizations: L12_REALIZATIONS },
  steps: ([1, 2, 3, 4, 5] as const).map((step) => {
    const offer = L12_OFFERS[(step - 1) % L12_OFFERS.length]!;
    const candidates = {
      setId: `cs-api-l12-${step}`,
      candidates: [{ itemId: offer.itemId, realizationIds: [offer.realizationId], source: "host-editorial-offer", rankHint: 1 }],
    };
    return {
      candidates,
      request: {
        requestId: `req-api-l12-${step}`,
        tenant: L12_TENANT,
        subject: L12_SUBJECT,
        objective: L12_OBJECTIVE,
        attentionPolicy: L12_ATTENTION,
        context: { contextId: `ctx-api-l12-${step}` },
        candidates,
        constraints: L12_CONSTRAINTS,
        policySelector: { policyId: "meridian-offers-v1" },
        idempotencyKey: `idem-api-l12-req-${step}`,
      },
      outcome: l12Outcome(step),
      preferenceDelta: step === 3 ? undefined : l12Delta(`line-${step}`),
    } satisfies ApiOnlyStep;
  }),
};
// ===== end api-only scenario: l12-offer-audit ===============================

// ===== api-only scenario: l9-malformed-dispatch =============================
// ~ adapter-map:begin
/** The contract-invalid candidate set (empty — zod min(1) violation): a
 *  deterministic TERMINAL request failure, measured honestly. */
const L9_MALFORMED_CANDIDATES = { setId: "cs-api-l9-bad", candidates: [] };
// ~ adapter-map:end

const l9MalformedDispatchScenario: ApiOnlyScenario = {
  level: 9,
  scenarioId: "l9-malformed-dispatch",
  description:
    "The terminal-classification probe: step 3 carries a contract-invalid (empty) candidate set — every call that carries it fails TERMINALLY (SDK_REQUEST_INVALID, never retried) and the run continues honestly",
  hostSystem: { hostId: "host-api-l9-food", name: "ForkRoute API-only host", hostAdapterId: "adapter-api-l9-food-1", version: "0.1.0" },
  glue: { functions: 0, loc: 78, customAdapterLoc: 1 },
  manifestContent: {
    manifestVersion: "1",
    hostSystem: { hostId: "host-api-l9-food", name: "ForkRoute API-only host", hostAdapterId: "adapter-api-l9-food-1", version: "0.1.0" },
    declaredAt: 0,
    supportedCapabilities: apiOnlyStandardCapabilities(),
  },
  profile: {
    profileId: "profile-api-l9-malformed-dispatch",
    name: "Food delivery (API-only, terminal-classification probe)",
    description: "SIM-004 API-only measurement — terminal request-failure classification at ladder level 9.",
    ladderLevel: 9,
    requiredCapabilities: [
      { capability: "tenant-identity" },
      { capability: "catalog-registration" },
      { capability: "realization-declaration" },
      { capability: "candidate-retrieval" },
      { capability: "objective-declaration" },
      { capability: "constraint-declaration" },
      { capability: "attention-policy" },
      { capability: "decision-request" },
      { capability: "outcome-return" },
      { capability: "preference-feedback" },
      { capability: "conformance-verification" },
    ],
    requiredEvidenceClass: "fixture",
    declaredAt: 1_000,
  },
  connect: { items: L9_ITEMS, realizations: L9_REALIZATIONS },
  steps: [1, 2, 3, 4].map((step) => {
    const malformed = step === 3;
    const candidates = malformed
      ? L9_MALFORMED_CANDIDATES
      : {
          setId: `cs-api-l9-mal-${step}`,
          candidates: [{ itemId: "l9-dish-pasta", realizationIds: ["l9-real-api-pasta-standard"], source: "host-menu-rank", rankHint: 1 }],
        };
    return {
      candidates,
      request: {
        requestId: `req-api-l9-mal-${step}`,
        tenant: L9_TENANT,
        subject: L9_SUBJECT,
        objective: L9_OBJECTIVE,
        attentionPolicy: L9_ATTENTION,
        context: { contextId: `ctx-api-l9-mal-${step}` },
        candidates,
        constraints: L9_CONSTRAINTS(step),
        policySelector: { policyId: "forkroute-dispatch-v1" },
        idempotencyKey: `idem-api-l9-mal-${step}`,
      },
      ...(malformed
        ? {}
        : {
            outcome: (_decision: { decisionId: string; selectedExperience?: { experienceId?: string } }, nowMs: number) => ({
              eventId: `ev-api-l9-mal-${step}`,
              tenant: L9_TENANT,
              subject: L9_SUBJECT,
              decisionId: _decision.decisionId,
              experienceId: _decision.selectedExperience?.experienceId,
              eventType: "start",
              occurredAt: nowMs,
              evidenceClass: "fixture" as const,
              metrics: { etaMinutes: 18 },
              idempotencyKey: `idem-api-l9-mal-out-${step}`,
            }),
            preferenceDelta: l9Delta("cuisine.italian", 1.1),
          }),
    } satisfies ApiOnlyStep;
  }),
};
// ===== end api-only scenario: l9-malformed-dispatch =========================

// ---------------------------------------------------------------------------
// The API-only measurement entries (scenario + run configuration)
// ---------------------------------------------------------------------------

/** The canonical API-only measurement battery for Levels 9–12. */
export const API_ONLY_LEVEL_ENTRIES: ReadonlyArray<{
  readonly config: { readonly seed: string; readonly faultRate?: number; readonly maxRetries?: number };
  readonly scenario: ApiOnlyScenario;
}> = [
  { config: { seed: "3109" }, scenario: l9FoodDispatchScenario },
  { config: { seed: "3110" }, scenario: l10SpatialDispatchScenario },
  { config: { seed: "3111" }, scenario: l11FeedPageScenario },
  { config: { seed: "3112" }, scenario: l12OfferAuditScenario },
];

/** The terminal-classification probe entry. */
export const API_ONLY_TERMINAL_PROBE_ENTRY = {
  config: { seed: "3109" as const },
  scenario: l9MalformedDispatchScenario,
} as const;

/** The resilience entries (seeded transport-fault storms). */
export const API_ONLY_RESILIENCE_ENTRIES: ReadonlyArray<{
  readonly config: { readonly seed: string; readonly faultRate: number; readonly maxRetries: number };
  readonly scenario: ApiOnlyScenario;
}> = [
  { config: { seed: "3110", faultRate: 0.25, maxRetries: 3 }, scenario: l10SpatialDispatchScenario },
  { config: { seed: "3112", faultRate: 0.25, maxRetries: 3 }, scenario: l12OfferAuditScenario },
];

export { l9FoodDispatchScenario, l10SpatialDispatchScenario, l11FeedPageScenario, l12OfferAuditScenario, l9MalformedDispatchScenario };
