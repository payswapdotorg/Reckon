/**
 * SIM-003 — LADDER LEVEL 6 INTEGRATION CASES: AD-SUPPORTED MEDIA.
 * "placements, formats, pacing, interruption, rights and consent"
 *
 * The synthetic host: Broadcastly (tenant-broadcastly), an ad-supported
 * streaming product. Ads are catalog items of kind `advertising` (they can
 * never masquerade as ordinary content); shows are `media`. The scenarios
 * exercise, through the PUBLIC standard loop only:
 *
 * - placements-formats — slot-driven decisions (pre-roll / rail / post-roll)
 *   with `format-required` constraints (interstitial / banner / in-feed /
 *   full), including a mid-pod creative SWITCH and a mindful rail SUGGEST;
 * - pacing            — a pod cadence plan (planId-coupled): a mid-roll pod
 *   INTERRUPTs the show, the show RESUMEs from its checkpoint, a later pod
 *   attempt is declined HOST-SIDE by the pacing gate (unpresented), and a
 *   post-roll airs after completion;
 * - interruption-resume — the full mid-roll round trip: interrupt → second
 *   creative (creative SWAP via SWITCH) → resume → complete;
 * - rights-consent    — policy-rights gates + the consent boundary: a
 *   remembered (host-ad-memory) personalized creative is presented when its
 *   rights gate passes, a personalized creative is declined when consent is
 *   absent (host-owned consent authority), the contextual fallback airs,
 *   and a REVOKED-rights vendor is declined host-side.
 *
 * RIGHTS/CONSENT LAW (host-owned): Reckon carries `policy-rights` gate ids
 * and never grants rights; the host's own rights/consent gates decide
 * presentation (unpresented decisions emit no outcome — measured honestly).
 */
import type {
  ScenarioHostInstance,
  ScenarioScript,
  IntegrationCaseScenario,
  CatalogItemInput,
  RealizationInput,
} from "../../../../packages/simulation/src/index.js";
import {
  createScenarioHost,
  standardLoopManifestContent,
  standardLoopProfile,
  capabilityProbeProfile,
} from "../../../../packages/simulation/src/index.js";

const TENANT = { tenantId: "tenant-broadcastly" };
const SUBJECT = { kind: "user", ref: "user-ad-supported-11" } as const;

const OBJECTIVE_ENTERTAINED = {
  objectiveId: "obj-broadcastly-evening",
  version: "1",
  kind: "be-entertained",
  params: { session: "evening", adSupported: true },
} as const;

const AP_BALANCED = { policyId: "ap-broadcastly-balanced", version: "1", style: "balanced", params: {} } as const;
const AP_MINDFUL = { policyId: "ap-broadcastly-mindful", version: "1", style: "mindful", params: {} } as const;

// ---------------------------------------------------------------------------
// Domain catalog (host-owned content + ad authority; ads are `advertising`)
// ---------------------------------------------------------------------------

const CATALOG_ITEMS: CatalogItemInput[] = [
  { itemId: "item-ads-show-1", kind: "media", labels: ["series", "cooking"], attributes: { title: "Cooking Tonight S2E4", runtimeMinutes: 24 } },
  { itemId: "item-ads-show-2", kind: "media", labels: ["series", "cooking"], attributes: { title: "Cooking Tonight S2E5", runtimeMinutes: 26 } },
  { itemId: "item-ad-1", kind: "advertising", labels: ["video", "sportswear"], attributes: { advertiser: "brand-a", campaign: "spring-launch", creativeSeconds: 15 } },
  { itemId: "item-ad-2", kind: "advertising", labels: ["video", "travel"], attributes: { advertiser: "brand-b", campaign: "city-escapes", creativeSeconds: 20 } },
  { itemId: "item-ad-3", kind: "advertising", labels: ["display", "banking"], attributes: { advertiser: "brand-c", campaign: "app-install", creativeSeconds: 5 } },
  { itemId: "item-ad-4", kind: "advertising", labels: ["feed", "gadgets"], attributes: { advertiser: "brand-d", campaign: "gadget-week", creativeSeconds: 6 } },
  { itemId: "item-ad-5", kind: "advertising", labels: ["video", "contextual", "coffee"], attributes: { advertiser: "brand-e", campaign: "contextual-brew", creativeSeconds: 15, contextualOnly: true } },
  { itemId: "item-ad-6", kind: "advertising", labels: ["video", "revoked"], attributes: { advertiser: "brand-x", campaign: "expired-rights", creativeSeconds: 12 } },
];

const CATALOG_REALIZATIONS: RealizationInput[] = [
  { realizationId: "real-ads-show-1", itemId: "item-ads-show-1", kind: "stream-hls", constraints: { maxResolution: "1080p" } },
  { realizationId: "real-ads-show-2", itemId: "item-ads-show-2", kind: "stream-hls", constraints: { maxResolution: "1080p" } },
  { realizationId: "real-ad-1", itemId: "item-ad-1", kind: "ad-creative", constraints: { creativeId: "cre-brand-a-spring-15s", rightsGate: "ad-rights-brand-a-spring" } },
  { realizationId: "real-ad-2", itemId: "item-ad-2", kind: "ad-creative", constraints: { creativeId: "cre-brand-b-city-20s", rightsGate: "ad-rights-brand-b" } },
  { realizationId: "real-ad-3", itemId: "item-ad-3", kind: "ad-creative", constraints: { creativeId: "cre-brand-c-banner", rightsGate: "ad-rights-brand-c" } },
  { realizationId: "real-ad-4", itemId: "item-ad-4", kind: "ad-creative", constraints: { creativeId: "cre-brand-d-feed", rightsGate: "ad-rights-brand-d" } },
  { realizationId: "real-ad-5", itemId: "item-ad-5", kind: "ad-creative", constraints: { creativeId: "cre-brand-e-context-15s", rightsGate: "ad-rights-brand-e" } },
  { realizationId: "real-ad-6", itemId: "item-ad-6", kind: "ad-creative", constraints: { creativeId: "cre-brand-x-12s", rightsGate: "ad-rights-brand-x-revoked" } },
];

const HOST_CATALOG = {
  items: CATALOG_ITEMS.map((item) => ({ ...item })),
  realizations: CATALOG_REALIZATIONS.map((realization) => ({ ...realization })),
};

const HOST_SYSTEM = { hostId: "host-broadcastly", name: "Broadcastly", version: "0.1.0" } as const;

const beyondSurface = [
  {
    capability: "ad-memory" as const,
    friction: "COMPOSITION_GAP" as const,
    notes:
      "the SDK/API exposes the AD-003 ads family (query/forget over Personal Ad Memory), but the SIM-001 harness port composes only the standard decision loop; this host retains encountered creatives host-side and re-submits remembered ones as ordinary candidates with source 'host-ad-memory' — measured host-side glue instead of the platform ad-memory lane",
  },
];

// ===== scenario: placements-formats =========================================
const placementsFormatsScript: ScenarioScript = {
  hostAdapterId: "adapter-l6-ads-placements-formats",
  hostSystem: HOST_SYSTEM,
  glue: { functions: 7, loc: 110, customAdapterLoc: 107 },
  manifestContent: standardLoopManifestContent({
    hostSystem: { ...HOST_SYSTEM, hostAdapterId: "adapter-l6-ads-placements-formats" },
    declaredAt: 1_100,
    beyondSurface,
  }),
  catalog: HOST_CATALOG,
  steps: [
    {
      contextId: "ctx-l6-placements-1",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l6-placements-1",
        candidates: [
          { itemId: "item-ad-1", realizationIds: ["real-ad-1"], source: "host-ad-pod", rankHint: 1, scoreHint: 0.9 },
          { itemId: "item-ad-2", realizationIds: ["real-ad-2"], source: "host-ad-pod", rankHint: 2, scoreHint: 0.7 },
        ],
      },
      constraints: [{ kind: "format-required", format: "interstitial" }],
      policySelector: { policyId: "broadcastly-slots-v1" },
      present: true,
      outcome: { eventType: "impression", metrics: { slot: 1, creativeSeconds: 15 } },
      preferenceDelta: { dimension: "ads.exposure.brand-a", op: "add", newValue: 1, resultingConfidence: 0.5, modelId: "broadcastly-adstate-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l6-placements-2",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l6-placements-2",
        candidates: [
          { itemId: "item-ad-2", realizationIds: ["real-ad-2"], source: "host-ad-pod", rankHint: 1, scoreHint: 0.85 },
        ],
      },
      constraints: [{ kind: "format-required", format: "interstitial" }],
      policySelector: { policyId: "broadcastly-slots-v1" },
      currentExperience: { kind: "selected-from-step", step: 1 },
      present: true,
      outcome: { eventType: "impression", metrics: { slot: 1, swapped: 1, creativeSeconds: 20 } },
      preferenceDelta: { dimension: "ads.exposure.brand-b", op: "add", newValue: 1, resultingConfidence: 0.5, modelId: "broadcastly-adstate-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l6-placements-3",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l6-placements-3",
        candidates: [
          { itemId: "item-ads-show-1", realizationIds: ["real-ads-show-1"], source: "host-recommendation", rankHint: 1 },
        ],
      },
      constraints: [{ kind: "format-required", format: "full" }],
      policySelector: { policyId: "broadcastly-slots-v1" },
      currentExperience: { kind: "selected-from-step", step: 2 },
      present: true,
      outcome: { eventType: "start", metrics: { afterPod: 1, positionSeconds: 0 } },
      preferenceDelta: { dimension: "genre.cooking", op: "add", newValue: 1, resultingConfidence: 0.55, modelId: "broadcastly-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l6-placements-4",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_MINDFUL,
      candidates: {
        setId: "cs-l6-placements-4",
        candidates: [
          { itemId: "item-ad-3", realizationIds: ["real-ad-3"], source: "host-ad-pod", rankHint: 1, scoreHint: 0.6 },
        ],
      },
      constraints: [{ kind: "format-required", format: "banner" }],
      policySelector: { policyId: "broadcastly-slots-v1" },
      currentExperience: { kind: "selected-from-step", step: 3 },
      present: true,
      outcome: { eventType: "impression", metrics: { slot: 3, suggestion: 1, creativeSeconds: 5 } },
    },
    {
      contextId: "ctx-l6-placements-5",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l6-placements-5",
        candidates: [
          { itemId: "item-ad-5", realizationIds: ["real-ad-5"], source: "host-ad-pod", rankHint: 1, scoreHint: 0.8 },
        ],
      },
      constraints: [{ kind: "format-required", format: "interstitial" }],
      policySelector: { policyId: "broadcastly-slots-v1" },
      currentExperience: { kind: "selected-from-step", step: 3 },
      present: true,
      outcome: { eventType: "completion", metrics: { watchedSeconds: 1440, postRoll: 1, creativeSeconds: 15 } },
      preferenceDelta: { dimension: "ads.exposure.brand-e", op: "add", newValue: 1, resultingConfidence: 0.5, modelId: "broadcastly-adstate-v1", modelVersion: "1" },
    },
  ],
};

export function createLevel6PlacementsFormatsHost(): ScenarioHostInstance {
  return createScenarioHost(placementsFormatsScript);
}
// ===== end scenario: placements-formats =====================================

// ===== scenario: pacing =====================================================
const pacingScript: ScenarioScript = {
  hostAdapterId: "adapter-l6-ads-pacing",
  hostSystem: HOST_SYSTEM,
  glue: { functions: 7, loc: 141, customAdapterLoc: 138 },
  manifestContent: standardLoopManifestContent({
    hostSystem: { ...HOST_SYSTEM, hostAdapterId: "adapter-l6-ads-pacing" },
    declaredAt: 1_100,
    beyondSurface,
  }),
  catalog: HOST_CATALOG,
  steps: [
    {
      contextId: "ctx-l6-pacing-1",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l6-pacing-1",
        candidates: [
          { itemId: "item-ads-show-1", realizationIds: ["real-ads-show-1"], source: "host-recommendation", rankHint: 1 },
        ],
      },
      constraints: [
        { kind: "format-required", format: "full" },
        { kind: "custom", constraintId: "ad-pacing-max-pods", params: { maxPodsPerHour: 3, minGapSeconds: 900 } },
      ],
      policySelector: { policyId: "broadcastly-slots-v1" },
      planId: "plan-broadcastly-pacing",
      present: true,
      outcome: { eventType: "start", metrics: { episode: 1, positionSeconds: 0 } },
      preferenceDelta: { dimension: "genre.cooking", op: "add", newValue: 1, resultingConfidence: 0.55, modelId: "broadcastly-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l6-pacing-2",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l6-pacing-2",
        candidates: [
          { itemId: "item-ad-1", realizationIds: ["real-ad-1"], source: "host-time-critical", rankHint: 1, scoreHint: 0.9 },
        ],
      },
      constraints: [
        { kind: "format-required", format: "interstitial" },
        { kind: "custom", constraintId: "ad-pacing-max-pods", params: { maxPodsPerHour: 3, minGapSeconds: 900 } },
      ],
      policySelector: { policyId: "broadcastly-slots-v1" },
      planId: "plan-broadcastly-pacing",
      currentExperience: { kind: "selected-from-step", step: 1 },
      present: true,
      outcome: { eventType: "interruption-accept", metrics: { podSlot: 1, checkpointSaved: 1, creativeSeconds: 15 } },
      preferenceDelta: { dimension: "ads.pod-count", op: "add", newValue: 1, resultingConfidence: 0.5, modelId: "broadcastly-adstate-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l6-pacing-3",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l6-pacing-3",
        candidates: [
          { itemId: "item-ads-show-1", realizationIds: ["real-ads-show-1"], source: "host-resume", rankHint: 1 },
        ],
      },
      constraints: [{ kind: "format-required", format: "full" }],
      policySelector: { policyId: "broadcastly-slots-v1" },
      planId: "plan-broadcastly-pacing",
      currentExperience: { kind: "selected-from-step", step: 2 },
      present: true,
      outcome: { eventType: "resume", metrics: { resumedFromCheckpoint: 1, positionSeconds: 900 } },
    },
    {
      contextId: "ctx-l6-pacing-4",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l6-pacing-4",
        candidates: [
          { itemId: "item-ads-show-1", realizationIds: ["real-ads-show-1"], source: "host-recommendation", rankHint: 1 },
        ],
      },
      policySelector: { policyId: "broadcastly-slots-v1" },
      planId: "plan-broadcastly-pacing",
      currentExperience: { kind: "selected-from-step", step: 3 },
      present: true,
      outcome: { eventType: "completion", metrics: { watchedSeconds: 1440 } },
      preferenceDelta: { dimension: "genre.cooking", op: "add", newValue: 1, resultingConfidence: 0.6, modelId: "broadcastly-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l6-pacing-5",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l6-pacing-5",
        candidates: [
          { itemId: "item-ad-3", realizationIds: ["real-ad-3"], source: "host-time-critical", rankHint: 1, scoreHint: 0.6 },
        ],
      },
      constraints: [
        { kind: "format-required", format: "banner" },
        { kind: "custom", constraintId: "ad-pacing-max-pods", params: { maxPodsPerHour: 3, minGapSeconds: 900 } },
      ],
      policySelector: { policyId: "broadcastly-slots-v1" },
      planId: "plan-broadcastly-pacing",
      currentExperience: { kind: "selected-from-step", step: 3 },
      present: false,
      outcome: { eventType: "impression", metrics: { declinedByPacingGate: 1 } },
    },
    {
      contextId: "ctx-l6-pacing-6",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l6-pacing-6",
        candidates: [
          { itemId: "item-ad-2", realizationIds: ["real-ad-2"], source: "host-ad-pod", rankHint: 1, scoreHint: 0.85 },
        ],
      },
      constraints: [{ kind: "format-required", format: "interstitial" }],
      policySelector: { policyId: "broadcastly-slots-v1" },
      planId: "plan-broadcastly-pacing",
      currentExperience: { kind: "selected-from-step", step: 3 },
      present: true,
      outcome: { eventType: "impression", metrics: { slot: 2, creativeSeconds: 20 } },
      preferenceDelta: { dimension: "ads.exposure.brand-b", op: "add", newValue: 1, resultingConfidence: 0.5, modelId: "broadcastly-adstate-v1", modelVersion: "1" },
    },
  ],
};

export function createLevel6PacingHost(): ScenarioHostInstance {
  return createScenarioHost(pacingScript);
}
// ===== end scenario: pacing =================================================

// ===== scenario: interruption-resume ========================================
const interruptionResumeScript: ScenarioScript = {
  hostAdapterId: "adapter-l6-ads-interruption-resume",
  hostSystem: HOST_SYSTEM,
  glue: { functions: 7, loc: 108, customAdapterLoc: 105 },
  manifestContent: standardLoopManifestContent({
    hostSystem: { ...HOST_SYSTEM, hostAdapterId: "adapter-l6-ads-interruption-resume" },
    declaredAt: 1_100,
    beyondSurface,
  }),
  catalog: HOST_CATALOG,
  steps: [
    {
      contextId: "ctx-l6-intres-1",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l6-intres-1",
        candidates: [
          { itemId: "item-ads-show-1", realizationIds: ["real-ads-show-1"], source: "host-recommendation", rankHint: 1 },
        ],
      },
      constraints: [{ kind: "format-required", format: "full" }],
      policySelector: { policyId: "broadcastly-slots-v1" },
      present: true,
      outcome: { eventType: "start", metrics: { episode: 1, positionSeconds: 0 } },
      preferenceDelta: { dimension: "genre.cooking", op: "add", newValue: 1, resultingConfidence: 0.55, modelId: "broadcastly-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l6-intres-2",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l6-intres-2",
        candidates: [
          { itemId: "item-ad-1", realizationIds: ["real-ad-1"], source: "host-time-critical", rankHint: 1, scoreHint: 0.9 },
        ],
      },
      constraints: [{ kind: "format-required", format: "interstitial" }],
      policySelector: { policyId: "broadcastly-slots-v1" },
      currentExperience: { kind: "selected-from-step", step: 1 },
      present: true,
      outcome: { eventType: "interruption-accept", metrics: { podSlot: 1, checkpointSaved: 1, creativeSeconds: 15 } },
      preferenceDelta: { dimension: "ads.pod-count", op: "add", newValue: 1, resultingConfidence: 0.5, modelId: "broadcastly-adstate-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l6-intres-3",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l6-intres-3",
        candidates: [
          { itemId: "item-ad-2", realizationIds: ["real-ad-2"], source: "host-ad-pod", rankHint: 1, scoreHint: 0.85 },
        ],
      },
      constraints: [{ kind: "format-required", format: "interstitial" }],
      policySelector: { policyId: "broadcastly-slots-v1" },
      currentExperience: { kind: "selected-from-step", step: 2 },
      present: true,
      outcome: { eventType: "impression", metrics: { podSlot: 1, creativeOrdinal: 2, creativeSeconds: 20 } },
      preferenceDelta: { dimension: "ads.exposure.brand-b", op: "add", newValue: 1, resultingConfidence: 0.5, modelId: "broadcastly-adstate-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l6-intres-4",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l6-intres-4",
        candidates: [
          { itemId: "item-ads-show-1", realizationIds: ["real-ads-show-1"], source: "host-resume", rankHint: 1 },
        ],
      },
      constraints: [{ kind: "format-required", format: "full" }],
      policySelector: { policyId: "broadcastly-slots-v1" },
      currentExperience: { kind: "selected-from-step", step: 3 },
      present: true,
      outcome: { eventType: "resume", metrics: { resumedFromCheckpoint: 1, positionSeconds: 930 } },
    },
    {
      contextId: "ctx-l6-intres-5",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l6-intres-5",
        candidates: [
          { itemId: "item-ads-show-1", realizationIds: ["real-ads-show-1"], source: "host-recommendation", rankHint: 1 },
        ],
      },
      policySelector: { policyId: "broadcastly-slots-v1" },
      currentExperience: { kind: "selected-from-step", step: 4 },
      present: true,
      outcome: { eventType: "completion", metrics: { watchedSeconds: 1440 } },
      preferenceDelta: { dimension: "genre.cooking", op: "add", newValue: 1, resultingConfidence: 0.6, modelId: "broadcastly-affinity-v1", modelVersion: "1" },
    },
  ],
};

export function createLevel6InterruptionResumeHost(): ScenarioHostInstance {
  return createScenarioHost(interruptionResumeScript);
}
// ===== end scenario: interruption-resume ====================================

// ===== scenario: rights-consent =============================================
const rightsConsentScript: ScenarioScript = {
  hostAdapterId: "adapter-l6-ads-rights-consent",
  hostSystem: HOST_SYSTEM,
  glue: { functions: 7, loc: 121, customAdapterLoc: 118 },
  manifestContent: standardLoopManifestContent({
    hostSystem: { ...HOST_SYSTEM, hostAdapterId: "adapter-l6-ads-rights-consent" },
    declaredAt: 1_100,
    beyondSurface,
  }),
  catalog: HOST_CATALOG,
  steps: [
    {
      contextId: "ctx-l6-rights-1",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l6-rights-1",
        candidates: [
          { itemId: "item-ads-show-1", realizationIds: ["real-ads-show-1"], source: "host-recommendation", rankHint: 1 },
        ],
      },
      constraints: [{ kind: "format-required", format: "full" }],
      policySelector: { policyId: "broadcastly-slots-v1" },
      present: true,
      outcome: { eventType: "start", metrics: { episode: 1, positionSeconds: 0 } },
      preferenceDelta: { dimension: "genre.cooking", op: "add", newValue: 1, resultingConfidence: 0.55, modelId: "broadcastly-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l6-rights-2",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l6-rights-2",
        candidates: [
          { itemId: "item-ad-1", realizationIds: ["real-ad-1"], source: "host-ad-memory", rankHint: 1, scoreHint: 0.9 },
        ],
      },
      constraints: [
        { kind: "format-required", format: "interstitial" },
        { kind: "policy-rights", gateId: "ad-rights-brand-a-spring" },
      ],
      policySelector: { policyId: "broadcastly-slots-v1" },
      currentExperience: { kind: "selected-from-step", step: 1 },
      present: true,
      outcome: { eventType: "impression", metrics: { personalization: 1, rightsGate: 1, creativeSeconds: 15 } },
      preferenceDelta: { dimension: "ads.exposure.brand-a", op: "add", newValue: 1, resultingConfidence: 0.5, modelId: "broadcastly-adstate-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l6-rights-3",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l6-rights-3",
        candidates: [
          { itemId: "item-ad-2", realizationIds: ["real-ad-2"], source: "host-ad-memory", rankHint: 1, scoreHint: 0.85 },
        ],
      },
      constraints: [
        { kind: "format-required", format: "interstitial" },
        { kind: "policy-rights", gateId: "ad-rights-brand-b" },
        { kind: "custom", constraintId: "ad-consent-personalization", params: { scope: "personalized-ads" } },
      ],
      policySelector: { policyId: "broadcastly-slots-v1" },
      currentExperience: { kind: "selected-from-step", step: 1 },
      present: false,
      outcome: { eventType: "impression", metrics: { declinedByConsentGate: 1 } },
    },
    {
      contextId: "ctx-l6-rights-4",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l6-rights-4",
        candidates: [
          { itemId: "item-ad-5", realizationIds: ["real-ad-5"], source: "host-ad-contextual", rankHint: 1, scoreHint: 0.7 },
        ],
      },
      constraints: [
        { kind: "format-required", format: "interstitial" },
        { kind: "policy-rights", gateId: "ad-rights-brand-e" },
      ],
      policySelector: { policyId: "broadcastly-slots-v1" },
      currentExperience: { kind: "selected-from-step", step: 1 },
      present: true,
      outcome: { eventType: "impression", metrics: { personalization: 2, rightsGate: 1, creativeSeconds: 15 } },
      preferenceDelta: { dimension: "ads.exposure.brand-e", op: "add", newValue: 1, resultingConfidence: 0.5, modelId: "broadcastly-adstate-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l6-rights-5",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l6-rights-5",
        candidates: [
          { itemId: "item-ad-6", realizationIds: ["real-ad-6"], source: "host-ad-memory", rankHint: 1, scoreHint: 0.8 },
        ],
      },
      constraints: [
        { kind: "format-required", format: "interstitial" },
        { kind: "policy-rights", gateId: "ad-rights-brand-x-revoked" },
      ],
      policySelector: { policyId: "broadcastly-slots-v1" },
      currentExperience: { kind: "selected-from-step", step: 1 },
      present: false,
      outcome: { eventType: "impression", metrics: { declinedByRightsGate: 1 } },
    },
  ],
};

export function createLevel6RightsConsentHost(): ScenarioHostInstance {
  return createScenarioHost(rightsConsentScript);
}
// ===== end scenario: rights-consent =========================================

// ---------------------------------------------------------------------------
// Profiles + the Level 6 scenario suite
// ---------------------------------------------------------------------------

export const level6Profile = standardLoopProfile({
  profileId: "profile-level-6-ad-supported-media",
  name: "Ad-supported media",
  description: "Ladder level 6 — placements, formats, pacing, interruption, rights and consent.",
  ladderLevel: 6,
  declaredAt: 1_000,
});

export const level6ProbeProfile = capabilityProbeProfile({
  baseline: level6Profile,
  probeCapability: "ad-memory",
});

export const level6Scenarios: readonly IntegrationCaseScenario[] = [
  {
    level: 6,
    scenarioId: "placements-formats",
    description: "slot-driven decisions with format-required constraints (pre-roll interstitial, creative swap, full show, mindful banner rail, post-roll)",
    archetypes: ["switching"],
    createHost: createLevel6PlacementsFormatsHost,
    profile: level6Profile,
    steps: 5,
    expectReckonComplete: true,
  },
  {
    level: 6,
    scenarioId: "pacing",
    description: "a planId-coupled pod cadence: mid-roll INTERRUPT + RESUME, a pacing-gated pod attempt declined host-side, a post-roll after completion",
    archetypes: ["interruption", "resume", "replan"],
    createHost: createLevel6PacingHost,
    profile: level6Profile,
    steps: 6,
    expectReckonComplete: true,
  },
  {
    level: 6,
    scenarioId: "interruption-resume",
    description: "the full mid-roll round trip: INTERRUPT the show, second creative in the pod, RESUME from the checkpoint, complete",
    archetypes: ["interruption", "resume", "switching"],
    createHost: createLevel6InterruptionResumeHost,
    profile: level6Profile,
    steps: 5,
    expectReckonComplete: true,
  },
  {
    level: 6,
    scenarioId: "rights-consent",
    description: "policy-rights gates and the consent boundary: remembered creative presented when rights pass, personalized creative declined without consent, contextual fallback, revoked-rights vendor declined",
    archetypes: ["switching"],
    createHost: createLevel6RightsConsentHost,
    profile: level6Profile,
    steps: 5,
    expectReckonComplete: true,
  },
  {
    level: 6,
    scenarioId: "probe-ad-memory",
    description: "capability probe: the level wants the platform Personal Ad Memory lane; the harness port composes only the standard decision loop — honestly incomplete (COMPOSITION_GAP)",
    archetypes: ["switching"],
    createHost: createLevel6RightsConsentHost,
    profile: level6ProbeProfile,
    steps: 5,
    expectReckonComplete: false,
  },
  {
    level: 6,
    scenarioId: "resilience",
    description: "the pacing scenario under a seeded transport-fault storm (faultRate 0.2, 3 retries) — failure/retry behavior measured honestly",
    archetypes: ["interruption", "resume", "replan"],
    createHost: createLevel6PacingHost,
    profile: level6Profile,
    steps: 6,
    faultRate: 0.2,
    maxRetries: 3,
    expectReckonComplete: true,
  },
];
