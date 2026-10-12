/**
 * SIM-003 — LADDER LEVEL 5 INTEGRATION CASES: MEDIA STREAMING.
 * "current/next experience, switching, resume, rolling plans"
 *
 * The synthetic host: StreamLine Media (tenant-streamline), a streaming
 * product whose evening session exercises the decision/experience/
 * scheduler surfaces through the PUBLIC standard loop only:
 *
 * - switching       — episode switch mid-session (SWITCH + checkpoint);
 * - interruption    — a live event interrupts the episode (INTERRUPT),
 *                     then the episode resumes (RESUME);
 * - resume          — checkpoint round-trip (interrupt → resume → continue);
 * - rolling-plans   — an evening plan (planId coupling on every request)
 *                     evolves across six steps as episodes complete.
 *
 * Everything is deterministic fixture data: no wall-clock, no unseeded
 * randomness, evidence class `fixture` throughout. Glue declarations are
 * host-honest counts of the scenario sections below (the counting method
 * is documented in docs/simulations/integration-cases/README.md).
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

const TENANT = { tenantId: "tenant-streamline" };
const SUBJECT = { kind: "user", ref: "user-stream-7" } as const;

const OBJECTIVE_ENTERTAINED = {
  objectiveId: "obj-streamline-evening",
  version: "1",
  kind: "be-entertained",
  params: { session: "evening" },
} as const;

const AP_BALANCED = { policyId: "ap-streamline-balanced", version: "1", style: "balanced", params: {} } as const;
const AP_IMMERSIVE = { policyId: "ap-streamline-binge", version: "1", style: "immersive", params: {} } as const;
const AP_MINDFUL = { policyId: "ap-streamline-mindful", version: "1", style: "mindful", params: {} } as const;

// ---------------------------------------------------------------------------
// Domain catalog (host-owned media authority)
// ---------------------------------------------------------------------------

const CATALOG_ITEMS: CatalogItemInput[] = [
  { itemId: "item-media-s1e1", kind: "media", labels: ["series", "drama"], attributes: { title: "Harbor Nights S1E1", runtimeMinutes: 48 } },
  { itemId: "item-media-s1e2", kind: "media", labels: ["series", "drama"], attributes: { title: "Harbor Nights S1E2", runtimeMinutes: 49 } },
  { itemId: "item-media-s1e3", kind: "media", labels: ["series", "drama"], attributes: { title: "Harbor Nights S1E3", runtimeMinutes: 47 } },
  { itemId: "item-media-s2e1", kind: "media", labels: ["series", "drama"], attributes: { title: "Harbor Nights S2E1", runtimeMinutes: 51 } },
  { itemId: "item-media-doc-1", kind: "media", labels: ["documentary", "ocean"], attributes: { title: "Deep Blue", runtimeMinutes: 39 } },
  { itemId: "item-media-live-1", kind: "media", labels: ["live", "sports"], attributes: { title: "Live: City Marathon", live: true } },
];

const CATALOG_REALIZATIONS: RealizationInput[] = [
  { realizationId: "real-media-s1e1", itemId: "item-media-s1e1", kind: "stream-hls", constraints: { maxResolution: "1080p" } },
  { realizationId: "real-media-s1e2", itemId: "item-media-s1e2", kind: "stream-hls", constraints: { maxResolution: "1080p" } },
  { realizationId: "real-media-s1e3", itemId: "item-media-s1e3", kind: "stream-hls", constraints: { maxResolution: "1080p" } },
  { realizationId: "real-media-s2e1", itemId: "item-media-s2e1", kind: "stream-hls", constraints: { maxResolution: "2160p" } },
  { realizationId: "real-media-doc-1", itemId: "item-media-doc-1", kind: "stream-hls", constraints: { maxResolution: "1080p" } },
  { realizationId: "real-media-live-1", itemId: "item-media-live-1", kind: "live-stream", constraints: { latencyMode: "low" } },
];

const HOST_CATALOG = {
  items: CATALOG_ITEMS.map((item) => ({ ...item })),
  realizations: CATALOG_REALIZATIONS.map((realization) => ({ ...realization })),
};

const HOST_SYSTEM = { hostId: "host-streamline", name: "StreamLine Media", version: "0.1.0" } as const;

const beyondSurface = [
  {
    capability: "plan-management" as const,
    friction: "COMPOSITION_GAP" as const,
    notes:
      "rolling plans are host-owned; decisions couple to the plan via DecisionRequest.planId and ScheduleDelta.planId and the SDK/API exposes plans.create/replan/get/history, but the SIM-001 harness port composes only the standard decision loop — plan CRUD is not reachable through the composed harness path",
  },
];

// ===== scenario: switching ==================================================
const switchingScript: ScenarioScript = {
  hostAdapterId: "adapter-l5-media-switching",
  hostSystem: HOST_SYSTEM,
  glue: { functions: 7, loc: 108, customAdapterLoc: 105 },
  manifestContent: standardLoopManifestContent({
    hostSystem: { ...HOST_SYSTEM, hostAdapterId: "adapter-l5-media-switching" },
    declaredAt: 1_100,
    beyondSurface,
  }),
  catalog: HOST_CATALOG,
  steps: [
    {
      contextId: "ctx-l5-switching-1",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l5-switching-1",
        candidates: [
          { itemId: "item-media-s1e1", realizationIds: ["real-media-s1e1"], source: "host-recommendation", rankHint: 1 },
          { itemId: "item-media-doc-1", realizationIds: ["real-media-doc-1"], source: "host-recommendation", rankHint: 2 },
        ],
      },
      policySelector: { policyId: "streamline-evening-v1" },
      present: true,
      outcome: { eventType: "start", metrics: { episode: 1, positionSeconds: 0 } },
      preferenceDelta: { dimension: "genre.drama", op: "add", newValue: 1, resultingConfidence: 0.55, modelId: "streamline-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l5-switching-2",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l5-switching-2",
        candidates: [
          { itemId: "item-media-s1e2", realizationIds: ["real-media-s1e2"], source: "host-recommendation", rankHint: 1 },
          { itemId: "item-media-doc-1", realizationIds: ["real-media-doc-1"], source: "host-recommendation", rankHint: 2 },
        ],
      },
      policySelector: { policyId: "streamline-evening-v1" },
      currentExperience: { kind: "selected-from-step", step: 1 },
      present: true,
      outcome: { eventType: "abandonment", metrics: { fromEpisode: 1, toEpisode: 2, checkpointSaved: 1 } },
      preferenceDelta: { dimension: "genre.drama", op: "add", newValue: 1, resultingConfidence: 0.58, modelId: "streamline-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l5-switching-3",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l5-switching-3",
        candidates: [
          { itemId: "item-media-s1e2", realizationIds: ["real-media-s1e2"], source: "host-recommendation", rankHint: 1 },
          { itemId: "item-media-doc-1", realizationIds: ["real-media-doc-1"], source: "host-recommendation", rankHint: 2 },
        ],
      },
      policySelector: { policyId: "streamline-evening-v1" },
      currentExperience: { kind: "selected-from-step", step: 2 },
      present: true,
      outcome: { eventType: "completion", metrics: { episode: 2, watchedSeconds: 480 } },
      preferenceDelta: { dimension: "genre.drama", op: "add", newValue: 1, resultingConfidence: 0.6, modelId: "streamline-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l5-switching-4",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_MINDFUL,
      candidates: {
        setId: "cs-l5-switching-4",
        candidates: [
          { itemId: "item-media-doc-1", realizationIds: ["real-media-doc-1"], source: "host-recommendation", rankHint: 1 },
        ],
      },
      policySelector: { policyId: "streamline-evening-v1" },
      currentExperience: { kind: "selected-from-step", step: 3 },
      present: true,
      outcome: { eventType: "impression", metrics: { suggestionQueued: 1 } },
      preferenceDelta: { dimension: "genre.documentary", op: "add", newValue: 1, resultingConfidence: 0.52, modelId: "streamline-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l5-switching-5",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l5-switching-5",
        candidates: [
          { itemId: "item-media-s1e3", realizationIds: ["real-media-s1e3"], source: "host-recommendation", rankHint: 1 },
        ],
      },
      policySelector: { policyId: "streamline-evening-v1" },
      currentExperience: { kind: "selected-from-step", step: 3 },
      present: true,
      outcome: { eventType: "start", metrics: { episode: 3, autoplay: 1 } },
      preferenceDelta: { dimension: "genre.drama", op: "add", newValue: 1, resultingConfidence: 0.62, modelId: "streamline-affinity-v1", modelVersion: "1" },
    },
  ],
};

export function createLevel5SwitchingHost(): ScenarioHostInstance {
  return createScenarioHost(switchingScript);
}
// ===== end scenario: switching ==============================================

// ===== scenario: interruption ===============================================
const interruptionScript: ScenarioScript = {
  hostAdapterId: "adapter-l5-media-interruption",
  hostSystem: HOST_SYSTEM,
  glue: { functions: 7, loc: 87, customAdapterLoc: 84 },
  manifestContent: standardLoopManifestContent({
    hostSystem: { ...HOST_SYSTEM, hostAdapterId: "adapter-l5-media-interruption" },
    declaredAt: 1_100,
    beyondSurface,
  }),
  catalog: HOST_CATALOG,
  steps: [
    {
      contextId: "ctx-l5-interrupt-1",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l5-interrupt-1",
        candidates: [
          { itemId: "item-media-s1e1", realizationIds: ["real-media-s1e1"], source: "host-recommendation", rankHint: 1 },
        ],
      },
      policySelector: { policyId: "streamline-evening-v1" },
      present: true,
      outcome: { eventType: "start", metrics: { episode: 1, positionSeconds: 0 } },
      preferenceDelta: { dimension: "genre.drama", op: "add", newValue: 1, resultingConfidence: 0.55, modelId: "streamline-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l5-interrupt-2",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l5-interrupt-2",
        candidates: [
          { itemId: "item-media-live-1", realizationIds: ["real-media-live-1"], source: "host-time-critical", rankHint: 1 },
        ],
      },
      policySelector: { policyId: "streamline-evening-v1" },
      currentExperience: { kind: "selected-from-step", step: 1 },
      present: true,
      outcome: { eventType: "interruption-accept", metrics: { interruptingLive: 1, checkpointSaved: 1 } },
      preferenceDelta: { dimension: "context.live-interrupt", op: "add", newValue: 1, resultingConfidence: 0.5, modelId: "streamline-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l5-interrupt-3",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l5-interrupt-3",
        candidates: [
          { itemId: "item-media-s1e1", realizationIds: ["real-media-s1e1"], source: "host-resume", rankHint: 1 },
        ],
      },
      policySelector: { policyId: "streamline-evening-v1" },
      currentExperience: { kind: "selected-from-step", step: 2 },
      present: true,
      outcome: { eventType: "resume", metrics: { resumedFromCheckpoint: 1, positionSeconds: 720 } },
      preferenceDelta: { dimension: "genre.drama", op: "add", newValue: 1, resultingConfidence: 0.57, modelId: "streamline-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l5-interrupt-4",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l5-interrupt-4",
        candidates: [
          { itemId: "item-media-s1e2", realizationIds: ["real-media-s1e2"], source: "host-recommendation", rankHint: 1 },
        ],
      },
      policySelector: { policyId: "streamline-evening-v1" },
      currentExperience: { kind: "selected-from-step", step: 3 },
      present: true,
      outcome: { eventType: "completion", metrics: { episode: 1, watchedSeconds: 1440 } },
      preferenceDelta: { dimension: "genre.drama", op: "add", newValue: 1, resultingConfidence: 0.6, modelId: "streamline-affinity-v1", modelVersion: "1" },
    },
  ],
};

export function createLevel5InterruptionHost(): ScenarioHostInstance {
  return createScenarioHost(interruptionScript);
}
// ===== end scenario: interruption ===========================================

// ===== scenario: resume =====================================================
const resumeScript: ScenarioScript = {
  hostAdapterId: "adapter-l5-media-resume",
  hostSystem: HOST_SYSTEM,
  glue: { functions: 7, loc: 86, customAdapterLoc: 83 },
  manifestContent: standardLoopManifestContent({
    hostSystem: { ...HOST_SYSTEM, hostAdapterId: "adapter-l5-media-resume" },
    declaredAt: 1_100,
    beyondSurface,
  }),
  catalog: HOST_CATALOG,
  steps: [
    {
      contextId: "ctx-l5-resume-1",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l5-resume-1",
        candidates: [
          { itemId: "item-media-doc-1", realizationIds: ["real-media-doc-1"], source: "host-recommendation", rankHint: 1 },
        ],
      },
      policySelector: { policyId: "streamline-evening-v1" },
      present: true,
      outcome: { eventType: "start", metrics: { documentary: 1, positionSeconds: 0 } },
      preferenceDelta: { dimension: "genre.documentary", op: "add", newValue: 1, resultingConfidence: 0.55, modelId: "streamline-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l5-resume-2",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l5-resume-2",
        candidates: [
          { itemId: "item-media-live-1", realizationIds: ["real-media-live-1"], source: "host-time-critical", rankHint: 1 },
        ],
      },
      policySelector: { policyId: "streamline-evening-v1" },
      currentExperience: { kind: "selected-from-step", step: 1 },
      present: true,
      outcome: { eventType: "interruption-accept", metrics: { interruptingLive: 1, checkpointSaved: 1 } },
    },
    {
      contextId: "ctx-l5-resume-3",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l5-resume-3",
        candidates: [
          { itemId: "item-media-doc-1", realizationIds: ["real-media-doc-1"], source: "host-resume", rankHint: 1 },
        ],
      },
      policySelector: { policyId: "streamline-evening-v1" },
      currentExperience: { kind: "selected-from-step", step: 2 },
      present: true,
      outcome: { eventType: "resume", metrics: { resumedFromCheckpoint: 1, positionSeconds: 480 } },
      preferenceDelta: { dimension: "genre.documentary", op: "add", newValue: 1, resultingConfidence: 0.58, modelId: "streamline-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l5-resume-4",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_ENTERTAINED,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l5-resume-4",
        candidates: [
          { itemId: "item-media-doc-1", realizationIds: ["real-media-doc-1"], source: "host-recommendation", rankHint: 1 },
        ],
      },
      policySelector: { policyId: "streamline-evening-v1" },
      currentExperience: { kind: "selected-from-step", step: 3 },
      present: true,
      outcome: { eventType: "completion", metrics: { documentary: 1, watchedSeconds: 2340 } },
      preferenceDelta: { dimension: "genre.documentary", op: "add", newValue: 1, resultingConfidence: 0.61, modelId: "streamline-affinity-v1", modelVersion: "1" },
    },
  ],
};

export function createLevel5ResumeHost(): ScenarioHostInstance {
  return createScenarioHost(resumeScript);
}
// ===== end scenario: resume =================================================

// ===== scenario: rolling-plans ==============================================
const rollingPlansScript: ScenarioScript = {
  hostAdapterId: "adapter-l5-media-rolling-plans",
  hostSystem: HOST_SYSTEM,
  glue: { functions: 7, loc: 130, customAdapterLoc: 127 },
  manifestContent: standardLoopManifestContent({
    hostSystem: { ...HOST_SYSTEM, hostAdapterId: "adapter-l5-media-rolling-plans" },
    declaredAt: 1_100,
    beyondSurface,
  }),
  catalog: HOST_CATALOG,
  steps: [
    {
      contextId: "ctx-l5-plan-1",
      tenant: TENANT,
      subject: SUBJECT,
      objective: { objectiveId: "obj-streamline-binge", version: "1", kind: "be-entertained", params: { session: "evening-binge" } },
      attentionPolicy: AP_IMMERSIVE,
      candidates: {
        setId: "cs-l5-plan-1",
        candidates: [
          { itemId: "item-media-s1e1", realizationIds: ["real-media-s1e1"], source: "host-recommendation", rankHint: 1 },
        ],
      },
      policySelector: { policyId: "streamline-binge-v1" },
      planId: "plan-streamline-evening",
      present: true,
      outcome: { eventType: "start", metrics: { episode: 1, positionSeconds: 0 } },
      preferenceDelta: { dimension: "genre.drama", op: "add", newValue: 1, resultingConfidence: 0.55, modelId: "streamline-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l5-plan-2",
      tenant: TENANT,
      subject: SUBJECT,
      objective: { objectiveId: "obj-streamline-binge", version: "1", kind: "be-entertained", params: { session: "evening-binge" } },
      attentionPolicy: AP_IMMERSIVE,
      candidates: {
        setId: "cs-l5-plan-2",
        candidates: [
          { itemId: "item-media-s1e2", realizationIds: ["real-media-s1e2"], source: "host-recommendation", rankHint: 1 },
        ],
      },
      policySelector: { policyId: "streamline-binge-v1" },
      planId: "plan-streamline-evening",
      currentExperience: { kind: "selected-from-step", step: 1 },
      present: true,
      outcome: { eventType: "completion", metrics: { episode: 1, watchedSeconds: 2880, autoplay: 1 } },
      preferenceDelta: { dimension: "genre.drama", op: "add", newValue: 1, resultingConfidence: 0.58, modelId: "streamline-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l5-plan-3",
      tenant: TENANT,
      subject: SUBJECT,
      objective: { objectiveId: "obj-streamline-binge", version: "1", kind: "be-entertained", params: { session: "evening-binge" } },
      attentionPolicy: AP_IMMERSIVE,
      candidates: {
        setId: "cs-l5-plan-3",
        candidates: [
          { itemId: "item-media-s1e3", realizationIds: ["real-media-s1e3"], source: "host-recommendation", rankHint: 1 },
          { itemId: "item-media-doc-1", realizationIds: ["real-media-doc-1"], source: "host-recommendation", rankHint: 2 },
        ],
      },
      policySelector: { policyId: "streamline-binge-v1" },
      planId: "plan-streamline-evening",
      currentExperience: { kind: "selected-from-step", step: 2 },
      present: true,
      outcome: { eventType: "completion", metrics: { episode: 2, watchedSeconds: 2940, autoplay: 1 } },
      preferenceDelta: { dimension: "genre.drama", op: "add", newValue: 1, resultingConfidence: 0.61, modelId: "streamline-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l5-plan-4",
      tenant: TENANT,
      subject: SUBJECT,
      objective: { objectiveId: "obj-streamline-binge", version: "1", kind: "be-entertained", params: { session: "evening-binge" } },
      attentionPolicy: AP_IMMERSIVE,
      candidates: {
        setId: "cs-l5-plan-4",
        candidates: [
          { itemId: "item-media-doc-1", realizationIds: ["real-media-doc-1"], source: "host-recommendation", rankHint: 1 },
        ],
      },
      policySelector: { policyId: "streamline-binge-v1" },
      planId: "plan-streamline-evening",
      currentExperience: { kind: "selected-from-step", step: 3 },
      present: true,
      outcome: { eventType: "completion", metrics: { episode: 3, watchedSeconds: 2820, autoplay: 1 } },
      preferenceDelta: { dimension: "genre.drama", op: "add", newValue: 1, resultingConfidence: 0.63, modelId: "streamline-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l5-plan-5",
      tenant: TENANT,
      subject: SUBJECT,
      objective: { objectiveId: "obj-streamline-binge", version: "1", kind: "be-entertained", params: { session: "evening-binge" } },
      attentionPolicy: AP_IMMERSIVE,
      candidates: {
        setId: "cs-l5-plan-5",
        candidates: [
          { itemId: "item-media-s2e1", realizationIds: ["real-media-s2e1"], source: "host-recommendation", rankHint: 1 },
        ],
      },
      policySelector: { policyId: "streamline-binge-v1" },
      planId: "plan-streamline-evening",
      currentExperience: { kind: "selected-from-step", step: 4 },
      present: true,
      outcome: { eventType: "completion", metrics: { documentary: 1, watchedSeconds: 2340, autoplay: 1 } },
      preferenceDelta: { dimension: "genre.documentary", op: "add", newValue: 1, resultingConfidence: 0.6, modelId: "streamline-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l5-plan-6",
      tenant: TENANT,
      subject: SUBJECT,
      objective: { objectiveId: "obj-streamline-binge", version: "1", kind: "be-entertained", params: { session: "evening-binge" } },
      attentionPolicy: AP_IMMERSIVE,
      candidates: {
        setId: "cs-l5-plan-6",
        candidates: [
          { itemId: "item-media-s2e1", realizationIds: ["real-media-s2e1"], source: "host-recommendation", rankHint: 1 },
        ],
      },
      policySelector: { policyId: "streamline-binge-v1" },
      planId: "plan-streamline-evening",
      currentExperience: { kind: "selected-from-step", step: 5 },
      present: true,
      outcome: { eventType: "completion", metrics: { season: 2, episode: 1, watchedSeconds: 300 } },
      preferenceDelta: { dimension: "genre.drama", op: "add", newValue: 1, resultingConfidence: 0.66, modelId: "streamline-affinity-v1", modelVersion: "1" },
    },
  ],
};

export function createLevel5RollingPlansHost(): ScenarioHostInstance {
  return createScenarioHost(rollingPlansScript);
}
// ===== end scenario: rolling-plans ==========================================

// ---------------------------------------------------------------------------
// Profiles + the Level 5 scenario suite
// ---------------------------------------------------------------------------

export const level5Profile = standardLoopProfile({
  profileId: "profile-level-5-media-streaming",
  name: "Media streaming",
  description: "Ladder level 5 — current/next experience, switching, resume, rolling plans.",
  ladderLevel: 5,
  declaredAt: 1_000,
});

export const level5ProbeProfile = capabilityProbeProfile({
  baseline: level5Profile,
  probeCapability: "plan-management",
});

export const level5Scenarios: readonly IntegrationCaseScenario[] = [
  {
    level: 5,
    scenarioId: "switching",
    description: "episode switch mid-session: SWITCH + resume checkpoint, then CONTINUE, a mindful SUGGEST, and the next SWITCH",
    archetypes: ["switching"],
    createHost: createLevel5SwitchingHost,
    profile: level5Profile,
    steps: 5,
    expectReckonComplete: true,
  },
  {
    level: 5,
    scenarioId: "interruption",
    description: "a live event INTERRUPTs the episode (checkpoint kept), the episode RESUMEs from the checkpoint, then completes",
    archetypes: ["interruption", "resume"],
    createHost: createLevel5InterruptionHost,
    profile: level5Profile,
    steps: 4,
    expectReckonComplete: true,
  },
  {
    level: 5,
    scenarioId: "resume",
    description: "checkpoint round-trip: interrupt a documentary, resume it from the retained token, continue to completion",
    archetypes: ["interruption", "resume"],
    createHost: createLevel5ResumeHost,
    profile: level5Profile,
    steps: 4,
    expectReckonComplete: true,
  },
  {
    level: 5,
    scenarioId: "rolling-plans",
    description: "an evening binge plan (planId on every request) evolves across six steps as episodes complete and the queue rolls forward",
    archetypes: ["replan", "switching"],
    createHost: createLevel5RollingPlansHost,
    profile: level5Profile,
    steps: 6,
    expectReckonComplete: true,
  },
  {
    level: 5,
    scenarioId: "probe-plan-management",
    description: "capability probe: the level genuinely wants plan CRUD; the harness port composes only the standard decision loop — honestly incomplete (COMPOSITION_GAP)",
    archetypes: ["replan"],
    createHost: createLevel5RollingPlansHost,
    profile: level5ProbeProfile,
    steps: 6,
    expectReckonComplete: false,
  },
  {
    level: 5,
    scenarioId: "resilience",
    description: "the rolling-plans scenario under a seeded transport-fault storm (faultRate 0.2, 3 retries) — failure/retry behavior measured honestly",
    archetypes: ["replan", "switching"],
    createHost: createLevel5RollingPlansHost,
    profile: level5Profile,
    steps: 6,
    faultRate: 0.2,
    maxRetries: 3,
    expectReckonComplete: true,
  },
];
