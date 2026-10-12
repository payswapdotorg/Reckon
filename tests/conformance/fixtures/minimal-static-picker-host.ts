/**
 * THE SIM-001 CONFORMANCE FIXTURE — a minimal synthetic host.
 *
 * This is the "minimal API-only onboarding example" from the ladder doc's
 * required final artifacts, at fixture evidence level: everything a host
 * product needs to become Reckon-Complete for the Level 1 profile
 * (static catalog picker) through Reckon's PUBLIC surface only.
 *
 * Host-side integration surface (the complete list — nothing else):
 * - a capability manifest (what the host supports, honestly declared);
 * - a catalog source (host-owned catalog authority);
 * - per-step decision inputs (context ref, retrieval, objective,
 *   attention policy, policy selector);
 * - presentation reactions + outcome events + preference deltas;
 * - an honest glue declaration (6 functions, 140 LOC, 45 custom-adapter
 *   LOC — the host-side code this file's adapter represents).
 *
 * LAWS obeyed here:
 * - ZERO internal Reckon imports: this file imports ONLY public types
 *   from @reckon/simulation's harness port + @reckon/contracts (enforced
 *   by tests/conformance/zero-internal-access.test.ts).
 * - Host-owned authorities stay host-owned: identity, catalog, context,
 *   outcomes, presentation.
 * - Evidence honesty: everything this fixture produces is labeled
 *   `fixture` — never observed production evidence.
 */
import type {
  SimulationHostAdapter,
  SimulationManifestContentInput,
  HostDecisionInputs,
  HostDecisionReaction,
  CatalogItemInput,
  RealizationInput,
  SubjectReference,
  TenantScope,
  DecisionResult,
} from "../../../packages/simulation/src/index.js";

/** The host's tenant + subject (host-owned identity authority). */
const TENANT: TenantScope = { tenantId: "tenant-minimal" };
const SUBJECT: SubjectReference = { kind: "user", ref: "user-42" };

/** The host's small static catalog (Level 1: "query a small catalog"). */
const CATALOG_ITEMS: CatalogItemInput[] = [
  { itemId: "pick-article-1", kind: "article", labels: ["news", "daily"], attributes: { title: "Morning brief" } },
  { itemId: "pick-article-2", kind: "article", labels: ["news", "tech"], attributes: { title: "Chip news" } },
  { itemId: "pick-article-3", kind: "article", labels: ["news", "local"], attributes: { title: "City notes" } },
];

const CATALOG_REALIZATIONS: RealizationInput[] = [
  { realizationId: "real-article-1", itemId: "pick-article-1", kind: "web" },
  { realizationId: "real-article-2", itemId: "pick-article-2", kind: "web" },
  { realizationId: "real-article-3", itemId: "pick-article-3", kind: "web" },
];

/** The host's capability manifest (statuses, evidence, ops, methods). */
const MANIFEST_CONTENT: SimulationManifestContentInput = {
  manifestVersion: "1",
  hostSystem: {
    hostId: "host-minimal-1",
    name: "Minimal Static Picker",
    hostAdapterId: "adapter-minimal-static-1",
    version: "0.1.0",
  },
  declaredAt: 1_100,
  supportedCapabilities: [
    { capability: "tenant-identity", status: "supported", evidenceClass: "fixture" },
    {
      capability: "catalog-registration",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/catalog/items", "POST /v1/catalog/realizations"],
      sdkMethods: ["catalog.upsertItem", "catalog.upsertRealization"],
    },
    {
      capability: "candidate-retrieval",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/candidates"],
      sdkMethods: ["candidates.submit"],
    },
    { capability: "objective-declaration", status: "supported", evidenceClass: "fixture" },
    { capability: "attention-policy", status: "supported", evidenceClass: "fixture" },
    {
      capability: "decision-request",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
    },
    {
      capability: "outcome-return",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/outcomes"],
      sdkMethods: ["outcomes.append"],
    },
    {
      capability: "preference-feedback",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/preferences/events"],
      sdkMethods: ["preferences.appendDelta"],
    },
    { capability: "conformance-verification", status: "supported", evidenceClass: "fixture" },
  ],
};

/**
 * The minimal host adapter. `glue` is the honest declaration of the
 * host-side code required to reach Reckon-Completeness at this level:
 * 6 functions, 140 total LOC, 45 of them custom adapter LOC.
 */
export const minimalStaticPickerHost: SimulationHostAdapter = {
  hostAdapterId: "adapter-minimal-static-picker-1",
  hostSystem: {
    hostId: "host-minimal-static-picker",
    name: "Minimal Static Picker",
    version: "0.1.0",
  },
  glue: { functions: 6, loc: 140, customAdapterLoc: 45 },
  manifestContent: MANIFEST_CONTENT,

  catalog: {
    items: CATALOG_ITEMS.map((item) => ({ ...item })),
    realizations: CATALOG_REALIZATIONS.map((realization) => ({ ...realization })),
  },

  provideDecisionInputs(step: number): HostDecisionInputs {
    // Host retrieval: rank the catalog (deterministic, host-owned).
    const candidates = CATALOG_ITEMS.map((item, index) => ({
      itemId: item.itemId,
      realizationIds: [CATALOG_REALIZATIONS[index]!.realizationId],
      source: "host-static-catalog",
      rankHint: index + 1,
    }));
    return {
      contextId: `ctx-minimal-${step}`,
      tenant: TENANT,
      subject: SUBJECT,
      objective: { objectiveId: "obj-stay-informed", version: "1", kind: "stay-informed", params: {} },
      attentionPolicy: { policyId: "ap-balanced", version: "1", style: "balanced", params: {} },
      candidates: { setId: `cs-minimal-${step}`, candidates },
      policySelector: { policyId: "greedy-v1" },
    };
  },

  consumeDecision(_step: number, _result: DecisionResult): HostDecisionReaction {
    // The minimal host presents whatever Reckon queues for it.
    return { presented: true };
  },

  provideOutcome(
    step: number,
    result: DecisionResult,
    _reaction: HostDecisionReaction,
    nowMs: number,
  ) {
    return {
      eventId: `ev-minimal-${step}`,
      tenant: TENANT,
      subject: SUBJECT,
      decisionId: result.decisionId,
      experienceId: result.selectedExperience?.experienceId,
      eventType: "completion",
      occurredAt: nowMs,
      evidenceClass: "fixture",
      metrics: { dwellSeconds: 30 + step },
      idempotencyKey: `idem-out-minimal-${step}`,
    };
  },

  providePreferenceDelta(step: number, _result: DecisionResult, nowMs: number) {
    return {
      deltaId: `delta-minimal-${step}`,
      tenant: TENANT,
      subject: SUBJECT,
      dimension: "topic.news",
      op: "add",
      newValue: 1,
      resultingConfidence: 0.55,
      model: { modelId: "host-static-picker-model", version: "1" },
      timestamp: nowMs,
    };
  },
};

/** The Level 1 Reckon-Complete profile this fixture targets. */
export const level1ProfileInput = {
  profileId: "profile-level-1-static-catalog",
  name: "Static catalog picker",
  description: "Ladder level 1 — query a small catalog and return the best item.",
  ladderLevel: 1,
  requiredCapabilities: [
    { capability: "tenant-identity" },
    { capability: "catalog-registration" },
    { capability: "candidate-retrieval" },
    { capability: "objective-declaration" },
    { capability: "attention-policy" },
    { capability: "decision-request" },
    { capability: "outcome-return" },
    { capability: "preference-feedback" },
    { capability: "conformance-verification" },
  ],
  requiredEvidenceClass: "fixture",
  declaredAt: 1_000,
} as const;
