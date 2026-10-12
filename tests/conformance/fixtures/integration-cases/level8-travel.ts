/**
 * SIM-003 — LADDER LEVEL 8 INTEGRATION CASES: TRAVEL / BOOKING.
 * "coupled itinerary constraints, availability, cancellation, replanning"
 *
 * The synthetic host: VoyageEasy (tenant-voyageeasy), a travel-booking
 * product. An itinerary is a rolling experience plan (planId-coupled
 * decisions); legs are catalog items (kind `commerce`) whose booking
 * classes / rate plans / activity slots are realizations carrying seats /
 * price delivery constraints. Coupled itinerary constraints are declared as
 * `custom` hard constraints (min/max connection) plus `time-window` and
 * `max-cost` gates — constraints stay separate from reward (lock #21).
 *
 * Scenarios (through the PUBLIC standard loop only):
 * - itinerary-assembly — sequential QUEUE decisions build the plan; a
 *   cheaper outbound is rebooked mid-planning (SWITCH + checkpoint);
 * - availability-switching — a rate-plan sell-out forces a same-item
 *   realization SWITCH (rate swap) under an activity time-window gate;
 * - cancellation-recovery — a carrier cancellation is corrected via an
 *   append-oriented CORRECTION outcome (correctsEventId → the original
 *   booking outcome), a time-critical rebooking INTERRUPTs the plan, and
 *   planning RESUMEs;
 * - budget-replan — the budget ceiling tightens across steps; the whole
 *   itinerary replans via SWITCHes (rate swap, outbound rebook, activity)
 *   under max-cost constraints, ending within budget.
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

const TENANT = { tenantId: "tenant-voyageeasy" };
const SUBJECT = { kind: "user", ref: "user-traveler-31" } as const;

const OBJECTIVE_BOOK_TRIP = {
  objectiveId: "obj-voyageeasy-trip",
  version: "1",
  kind: "custom",
  customKind: "book-trip",
  params: { origin: "ACC", destination: "JNB", travelers: 2 },
} as const;

const AP_BALANCED = { policyId: "ap-voyageeasy-balanced", version: "1", style: "balanced", params: {} } as const;

/** Coupled-leg hard constraint (host itinerary rule, opaque to the kernel). */
const COUPLED_ITINERARY = {
  kind: "custom",
  constraintId: "itinerary-leg-coupling",
  params: { minConnectionMinutes: 90, maxLayoverMinutes: 300 },
} as const;

/** Morning activity window (virtual clock — deterministic fixture time). */
const MORNING_WINDOW = { kind: "time-window", fromMs: 0, untilMs: 60_000 } as const;

// ---------------------------------------------------------------------------
// Domain catalog (host-owned travel authority: items = legs/stays/activities,
// realizations = booking classes / rate plans / activity slots)
// ---------------------------------------------------------------------------

const CATALOG_ITEMS: CatalogItemInput[] = [
  { itemId: "item-trv-flight-acc-jnb", kind: "commerce", labels: ["flight", "outbound"], attributes: { title: "Flight ACC→JNB 09:20", origin: "ACC", destination: "JNB", durationMinutes: 330 }, availableFrom: 0, availableUntil: 60_000 },
  { itemId: "item-trv-flight-acc-los", kind: "commerce", labels: ["flight", "outbound", "via-los"], attributes: { title: "Flight ACC→JNB via LOS", origin: "ACC", destination: "JNB", durationMinutes: 465 }, availableFrom: 0, availableUntil: 60_000 },
  { itemId: "item-trv-hotel-ctn", kind: "commerce", labels: ["hotel", "stay"], attributes: { title: "Cape Town Seaside Hotel", stars: 4, area: "Waterfront" } },
  { itemId: "item-trv-hotel-ctn-alt", kind: "commerce", labels: ["hotel", "stay", "budget"], attributes: { title: "Cape City Lodge", stars: 3, area: "City Bowl" } },
  { itemId: "item-trv-activity-ctn", kind: "commerce", labels: ["activity", "morning"], attributes: { title: "Table Mountain morning hike", startLocalTime: "07:30", durationMinutes: 180 } },
];

const CATALOG_REALIZATIONS: RealizationInput[] = [
  { realizationId: "real-flight-jnb-econ", itemId: "item-trv-flight-acc-jnb", kind: "booking-class", constraints: { cabin: "economy", seatsLeft: 3, priceCents: 82000, currency: "USD" } },
  { realizationId: "real-flight-los-econ", itemId: "item-trv-flight-acc-los", kind: "booking-class", constraints: { cabin: "economy", seatsLeft: 9, priceCents: 68000, currency: "USD" } },
  { realizationId: "real-hotel-ctn-std", itemId: "item-trv-hotel-ctn", kind: "rate-plan", constraints: { roomType: "standard", nights: 3, priceCents: 21000, currency: "USD" } },
  { realizationId: "real-hotel-ctn-alt-std", itemId: "item-trv-hotel-ctn-alt", kind: "rate-plan", constraints: { roomType: "standard", nights: 3, priceCents: 15500, currency: "USD" } },
  { realizationId: "real-activity-hike-am", itemId: "item-trv-activity-ctn", kind: "activity-slot", constraints: { slot: "morning", priceCents: 4500, currency: "USD", slotsLeft: 6 } },
];

const HOST_CATALOG = {
  items: CATALOG_ITEMS.map((item) => ({ ...item })),
  realizations: CATALOG_REALIZATIONS.map((realization) => ({ ...realization })),
};

const HOST_SYSTEM = { hostId: "host-voyageeasy", name: "VoyageEasy", version: "0.1.0" } as const;

const beyondSurface = [
  {
    capability: "plan-management" as const,
    friction: "COMPOSITION_GAP" as const,
    notes:
      "itineraries are rolling host-owned plans; decisions couple to the plan via DecisionRequest.planId and ScheduleDelta.planId and the SDK/API exposes plans.create/replan/get/history, but the SIM-001 harness port composes only the standard decision loop — plan CRUD is not reachable through the composed harness path",
  },
];

// ===== scenario: itinerary-assembly =========================================
const itineraryAssemblyScript: ScenarioScript = {
  hostAdapterId: "adapter-l8-trv-itinerary-assembly",
  hostSystem: HOST_SYSTEM,
  glue: { functions: 7, loc: 111, customAdapterLoc: 108 },
  manifestContent: standardLoopManifestContent({
    hostSystem: { ...HOST_SYSTEM, hostAdapterId: "adapter-l8-trv-itinerary-assembly" },
    declaredAt: 1_100,
    beyondSurface,
  }),
  catalog: HOST_CATALOG,
  steps: [
    {
      contextId: "ctx-l8-assembly-1",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_BOOK_TRIP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l8-assembly-1",
        candidates: [
          { itemId: "item-trv-flight-acc-jnb", realizationIds: ["real-flight-jnb-econ"], source: "host-recommendation", rankHint: 1, scoreHint: 0.9 },
        ],
      },
      constraints: [COUPLED_ITINERARY, { kind: "max-cost", cost: 120000, currency: "USD" }],
      policySelector: { policyId: "voyageeasy-itinerary-v1" },
      planId: "plan-voyageeasy-acc-jnb",
      present: true,
      outcome: { eventType: "impression", metrics: { leg: 1, priceCents: 82000 } },
      preferenceDelta: { dimension: "travel.class.economy", op: "add", newValue: 1, resultingConfidence: 0.5, modelId: "voyageeasy-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l8-assembly-2",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_BOOK_TRIP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l8-assembly-2",
        candidates: [
          { itemId: "item-trv-hotel-ctn", realizationIds: ["real-hotel-ctn-std"], source: "host-recommendation", rankHint: 1, scoreHint: 0.85 },
        ],
      },
      constraints: [COUPLED_ITINERARY, { kind: "max-cost", cost: 120000, currency: "USD" }],
      policySelector: { policyId: "voyageeasy-itinerary-v1" },
      planId: "plan-voyageeasy-acc-jnb",
      present: true,
      outcome: { eventType: "impression", metrics: { leg: 2, priceCents: 21000 } },
      preferenceDelta: { dimension: "travel.area.waterfront", op: "add", newValue: 1, resultingConfidence: 0.55, modelId: "voyageeasy-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l8-assembly-3",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_BOOK_TRIP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l8-assembly-3",
        candidates: [
          { itemId: "item-trv-activity-ctn", realizationIds: ["real-activity-hike-am"], source: "host-recommendation", rankHint: 1, scoreHint: 0.7 },
        ],
      },
      constraints: [COUPLED_ITINERARY, MORNING_WINDOW],
      policySelector: { policyId: "voyageeasy-itinerary-v1" },
      planId: "plan-voyageeasy-acc-jnb",
      present: true,
      outcome: { eventType: "impression", metrics: { leg: 3, priceCents: 4500 } },
    },
    {
      contextId: "ctx-l8-assembly-4",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_BOOK_TRIP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l8-assembly-4",
        candidates: [
          { itemId: "item-trv-flight-acc-los", realizationIds: ["real-flight-los-econ"], source: "host-recommendation", rankHint: 1, scoreHint: 0.88 },
        ],
      },
      constraints: [COUPLED_ITINERARY, { kind: "max-cost", cost: 120000, currency: "USD" }],
      policySelector: { policyId: "voyageeasy-itinerary-v1" },
      planId: "plan-voyageeasy-acc-jnb",
      currentExperience: { kind: "selected-from-step", step: 1 },
      present: true,
      outcome: { eventType: "custom", customEventType: "itinerary-rebook", metrics: { leg: 1, savedCents: 14000, newPriceCents: 68000 } },
      preferenceDelta: { dimension: "travel.route.via-los", op: "add", newValue: 1, resultingConfidence: 0.5, modelId: "voyageeasy-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l8-assembly-5",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_BOOK_TRIP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l8-assembly-5",
        candidates: [
          { itemId: "item-trv-flight-acc-los", realizationIds: ["real-flight-los-econ"], source: "host-recommendation", rankHint: 1, scoreHint: 0.88 },
        ],
      },
      policySelector: { policyId: "voyageeasy-itinerary-v1" },
      planId: "plan-voyageeasy-acc-jnb",
      currentExperience: { kind: "selected-from-step", step: 4 },
      present: true,
      outcome: { eventType: "conversion", metrics: { leg: 1, booked: 1, priceCents: 68000 } },
      preferenceDelta: { dimension: "travel.class.economy", op: "add", newValue: 1, resultingConfidence: 0.55, modelId: "voyageeasy-affinity-v1", modelVersion: "1" },
    },
  ],
};

export function createLevel8ItineraryAssemblyHost(): ScenarioHostInstance {
  return createScenarioHost(itineraryAssemblyScript);
}
// ===== end scenario: itinerary-assembly =====================================

// ===== scenario: availability-switching =====================================
const availabilitySwitchingScript: ScenarioScript = {
  hostAdapterId: "adapter-l8-trv-availability-switching",
  hostSystem: HOST_SYSTEM,
  glue: { functions: 7, loc: 105, customAdapterLoc: 102 },
  manifestContent: standardLoopManifestContent({
    hostSystem: { ...HOST_SYSTEM, hostAdapterId: "adapter-l8-trv-availability-switching" },
    declaredAt: 1_100,
    beyondSurface,
  }),
  catalog: HOST_CATALOG,
  steps: [
    {
      contextId: "ctx-l8-availability-1",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_BOOK_TRIP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l8-availability-1",
        candidates: [
          { itemId: "item-trv-flight-acc-jnb", realizationIds: ["real-flight-jnb-econ"], source: "host-recommendation", rankHint: 1, scoreHint: 0.9 },
        ],
      },
      constraints: [COUPLED_ITINERARY],
      policySelector: { policyId: "voyageeasy-itinerary-v1" },
      present: true,
      outcome: { eventType: "conversion", metrics: { seatsLeftAfter: 2, priceCents: 82000 } },
      preferenceDelta: { dimension: "travel.class.economy", op: "add", newValue: 1, resultingConfidence: 0.5, modelId: "voyageeasy-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l8-availability-2",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_BOOK_TRIP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l8-availability-2",
        candidates: [
          { itemId: "item-trv-hotel-ctn", realizationIds: ["real-hotel-ctn-std"], source: "host-recommendation", rankHint: 1, scoreHint: 0.85 },
        ],
      },
      policySelector: { policyId: "voyageeasy-itinerary-v1" },
      currentExperience: { kind: "selected-from-step", step: 1 },
      present: true,
      outcome: { eventType: "impression", metrics: { leg: 2, priceCents: 21000 } },
      preferenceDelta: { dimension: "travel.area.waterfront", op: "add", newValue: 1, resultingConfidence: 0.55, modelId: "voyageeasy-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l8-availability-3",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_BOOK_TRIP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l8-availability-3",
        candidates: [
          { itemId: "item-trv-hotel-ctn-alt", realizationIds: ["real-hotel-ctn-alt-std"], source: "host-recommendation", rankHint: 1, scoreHint: 0.8 },
        ],
      },
      policySelector: { policyId: "voyageeasy-itinerary-v1" },
      currentExperience: { kind: "selected-from-step", step: 2 },
      present: true,
      outcome: { eventType: "custom", customEventType: "inventory-replan", metrics: { soldOutRate: 1, newPriceCents: 15500 } },
    },
    {
      contextId: "ctx-l8-availability-4",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_BOOK_TRIP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l8-availability-4",
        candidates: [
          { itemId: "item-trv-activity-ctn", realizationIds: ["real-activity-hike-am"], source: "host-recommendation", rankHint: 1, scoreHint: 0.7 },
        ],
      },
      constraints: [COUPLED_ITINERARY, MORNING_WINDOW],
      policySelector: { policyId: "voyageeasy-itinerary-v1" },
      currentExperience: { kind: "selected-from-step", step: 3 },
      present: true,
      outcome: { eventType: "impression", metrics: { leg: 3, priceCents: 4500 } },
    },
    {
      contextId: "ctx-l8-availability-5",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_BOOK_TRIP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l8-availability-5",
        candidates: [
          { itemId: "item-trv-activity-ctn", realizationIds: ["real-activity-hike-am"], source: "host-recommendation", rankHint: 1, scoreHint: 0.7 },
        ],
      },
      policySelector: { policyId: "voyageeasy-itinerary-v1" },
      currentExperience: { kind: "selected-from-step", step: 4 },
      present: true,
      outcome: { eventType: "conversion", metrics: { leg: 3, booked: 1, priceCents: 4500 } },
      preferenceDelta: { dimension: "travel.activity.hiking", op: "add", newValue: 1, resultingConfidence: 0.55, modelId: "voyageeasy-affinity-v1", modelVersion: "1" },
    },
  ],
};

export function createLevel8AvailabilitySwitchingHost(): ScenarioHostInstance {
  return createScenarioHost(availabilitySwitchingScript);
}
// ===== end scenario: availability-switching =================================

// ===== scenario: cancellation-recovery ======================================
const cancellationRecoveryScript: ScenarioScript = {
  hostAdapterId: "adapter-l8-trv-cancellation-recovery",
  hostSystem: HOST_SYSTEM,
  glue: { functions: 7, loc: 113, customAdapterLoc: 110 },
  manifestContent: standardLoopManifestContent({
    hostSystem: { ...HOST_SYSTEM, hostAdapterId: "adapter-l8-trv-cancellation-recovery" },
    declaredAt: 1_100,
    beyondSurface,
  }),
  catalog: HOST_CATALOG,
  steps: [
    {
      contextId: "ctx-l8-cancellation-1",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_BOOK_TRIP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l8-cancellation-1",
        candidates: [
          { itemId: "item-trv-flight-acc-jnb", realizationIds: ["real-flight-jnb-econ"], source: "host-recommendation", rankHint: 1, scoreHint: 0.9 },
        ],
      },
      constraints: [COUPLED_ITINERARY],
      policySelector: { policyId: "voyageeasy-itinerary-v1" },
      planId: "plan-voyageeasy-acc-jnb",
      present: true,
      outcome: { eventType: "conversion", metrics: { booking: 1, priceCents: 82000 } },
      preferenceDelta: { dimension: "travel.class.economy", op: "add", newValue: 1, resultingConfidence: 0.5, modelId: "voyageeasy-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l8-cancellation-2",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_BOOK_TRIP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l8-cancellation-2",
        candidates: [
          { itemId: "item-trv-hotel-ctn", realizationIds: ["real-hotel-ctn-std"], source: "host-recommendation", rankHint: 1, scoreHint: 0.85 },
        ],
      },
      policySelector: { policyId: "voyageeasy-itinerary-v1" },
      planId: "plan-voyageeasy-acc-jnb",
      present: true,
      outcome: { eventType: "conversion", metrics: { booking: 2, priceCents: 21000 } },
      preferenceDelta: { dimension: "travel.area.waterfront", op: "add", newValue: 1, resultingConfidence: 0.55, modelId: "voyageeasy-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l8-cancellation-3",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_BOOK_TRIP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l8-cancellation-3",
        candidates: [
          { itemId: "item-trv-flight-acc-los", realizationIds: ["real-flight-los-econ"], source: "host-time-critical", rankHint: 1, scoreHint: 0.88 },
        ],
      },
      constraints: [COUPLED_ITINERARY],
      policySelector: { policyId: "voyageeasy-itinerary-v1" },
      planId: "plan-voyageeasy-acc-jnb",
      currentExperience: { kind: "selected-from-step", step: 1 },
      present: true,
      outcome: {
        eventType: "correction",
        metrics: { cancelledLeg: 1, rebookPriceCents: 68000, reason: 1 },
        correctsEventId: "ev-adapter-l8-trv-cancellation-recovery-1",
      },
    },
    {
      contextId: "ctx-l8-cancellation-4",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_BOOK_TRIP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l8-cancellation-4",
        candidates: [
          { itemId: "item-trv-hotel-ctn", realizationIds: ["real-hotel-ctn-std"], source: "host-resume", rankHint: 1, scoreHint: 0.85 },
        ],
      },
      policySelector: { policyId: "voyageeasy-itinerary-v1" },
      planId: "plan-voyageeasy-acc-jnb",
      currentExperience: { kind: "selected-from-step", step: 3 },
      present: true,
      outcome: { eventType: "resume", metrics: { resumedLeg: 2 } },
    },
    {
      contextId: "ctx-l8-cancellation-5",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_BOOK_TRIP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l8-cancellation-5",
        candidates: [
          { itemId: "item-trv-hotel-ctn", realizationIds: ["real-hotel-ctn-std"], source: "host-recommendation", rankHint: 1, scoreHint: 0.85 },
        ],
      },
      policySelector: { policyId: "voyageeasy-itinerary-v1" },
      planId: "plan-voyageeasy-acc-jnb",
      currentExperience: { kind: "selected-from-step", step: 2 },
      present: true,
      outcome: { eventType: "conversion", metrics: { leg: 2, booked: 1, priceCents: 21000 } },
      preferenceDelta: { dimension: "travel.area.waterfront", op: "add", newValue: 1, resultingConfidence: 0.6, modelId: "voyageeasy-affinity-v1", modelVersion: "1" },
    },
  ],
};

export function createLevel8CancellationRecoveryHost(): ScenarioHostInstance {
  return createScenarioHost(cancellationRecoveryScript);
}
// ===== end scenario: cancellation-recovery ==================================

// ===== scenario: budget-replan ==============================================
const budgetReplanScript: ScenarioScript = {
  hostAdapterId: "adapter-l8-trv-budget-replan",
  hostSystem: HOST_SYSTEM,
  glue: { functions: 7, loc: 130, customAdapterLoc: 127 },
  manifestContent: standardLoopManifestContent({
    hostSystem: { ...HOST_SYSTEM, hostAdapterId: "adapter-l8-trv-budget-replan" },
    declaredAt: 1_100,
    beyondSurface,
  }),
  catalog: HOST_CATALOG,
  steps: [
    {
      contextId: "ctx-l8-budget-1",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_BOOK_TRIP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l8-budget-1",
        candidates: [
          { itemId: "item-trv-flight-acc-jnb", realizationIds: ["real-flight-jnb-econ"], source: "host-recommendation", rankHint: 1, scoreHint: 0.9 },
        ],
      },
      constraints: [COUPLED_ITINERARY, { kind: "max-cost", cost: 120000, currency: "USD" }],
      policySelector: { policyId: "voyageeasy-itinerary-v1" },
      planId: "plan-voyageeasy-budget",
      present: true,
      outcome: { eventType: "impression", metrics: { budgetCents: 120000, priceCents: 82000 } },
      preferenceDelta: { dimension: "travel.class.economy", op: "add", newValue: 1, resultingConfidence: 0.5, modelId: "voyageeasy-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l8-budget-2",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_BOOK_TRIP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l8-budget-2",
        candidates: [
          { itemId: "item-trv-hotel-ctn", realizationIds: ["real-hotel-ctn-std"], source: "host-recommendation", rankHint: 1, scoreHint: 0.85 },
        ],
      },
      constraints: [COUPLED_ITINERARY, { kind: "max-cost", cost: 120000, currency: "USD" }],
      policySelector: { policyId: "voyageeasy-itinerary-v1" },
      planId: "plan-voyageeasy-budget",
      present: true,
      outcome: { eventType: "impression", metrics: { leg: 2, priceCents: 21000 } },
      preferenceDelta: { dimension: "travel.area.waterfront", op: "add", newValue: 1, resultingConfidence: 0.55, modelId: "voyageeasy-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l8-budget-3",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_BOOK_TRIP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l8-budget-3",
        candidates: [
          { itemId: "item-trv-hotel-ctn-alt", realizationIds: ["real-hotel-ctn-alt-std"], source: "host-recommendation", rankHint: 1, scoreHint: 0.8 },
        ],
      },
      constraints: [COUPLED_ITINERARY, { kind: "max-cost", cost: 80000, currency: "USD" }],
      policySelector: { policyId: "voyageeasy-itinerary-v1" },
      planId: "plan-voyageeasy-budget",
      currentExperience: { kind: "selected-from-step", step: 2 },
      present: true,
      outcome: { eventType: "custom", customEventType: "budget-replan", metrics: { budgetCents: 80000, newPriceCents: 15500 } },
    },
    {
      contextId: "ctx-l8-budget-4",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_BOOK_TRIP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l8-budget-4",
        candidates: [
          { itemId: "item-trv-flight-acc-los", realizationIds: ["real-flight-los-econ"], source: "host-recommendation", rankHint: 1, scoreHint: 0.88 },
        ],
      },
      constraints: [COUPLED_ITINERARY, { kind: "max-cost", cost: 80000, currency: "USD" }],
      policySelector: { policyId: "voyageeasy-itinerary-v1" },
      planId: "plan-voyageeasy-budget",
      currentExperience: { kind: "selected-from-step", step: 1 },
      present: true,
      outcome: { eventType: "custom", customEventType: "budget-replan", metrics: { leg: 1, newPriceCents: 68000 } },
    },
    {
      contextId: "ctx-l8-budget-5",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_BOOK_TRIP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l8-budget-5",
        candidates: [
          { itemId: "item-trv-activity-ctn", realizationIds: ["real-activity-hike-am"], source: "host-recommendation", rankHint: 1, scoreHint: 0.7 },
        ],
      },
      constraints: [COUPLED_ITINERARY, MORNING_WINDOW, { kind: "max-cost", cost: 80000, currency: "USD" }],
      policySelector: { policyId: "voyageeasy-itinerary-v1" },
      planId: "plan-voyageeasy-budget",
      currentExperience: { kind: "selected-from-step", step: 4 },
      present: true,
      outcome: { eventType: "impression", metrics: { leg: 3, priceCents: 4500 } },
    },
    {
      contextId: "ctx-l8-budget-6",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_BOOK_TRIP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l8-budget-6",
        candidates: [
          { itemId: "item-trv-activity-ctn", realizationIds: ["real-activity-hike-am"], source: "host-recommendation", rankHint: 1, scoreHint: 0.7 },
        ],
      },
      policySelector: { policyId: "voyageeasy-itinerary-v1" },
      planId: "plan-voyageeasy-budget",
      currentExperience: { kind: "selected-from-step", step: 5 },
      present: true,
      outcome: { eventType: "conversion", metrics: { totalCents: 88000, withinBudget: 1 } },
      preferenceDelta: { dimension: "travel.activity.hiking", op: "add", newValue: 1, resultingConfidence: 0.55, modelId: "voyageeasy-affinity-v1", modelVersion: "1" },
    },
  ],
};

export function createLevel8BudgetReplanHost(): ScenarioHostInstance {
  return createScenarioHost(budgetReplanScript);
}
// ===== end scenario: budget-replan ==========================================

// ---------------------------------------------------------------------------
// Profiles + the Level 8 scenario suite
// ---------------------------------------------------------------------------

export const level8Profile = standardLoopProfile({
  profileId: "profile-level-8-travel-booking",
  name: "Travel / booking",
  description: "Ladder level 8 — coupled itinerary constraints, availability, cancellation, replanning.",
  ladderLevel: 8,
  declaredAt: 1_000,
});

export const level8ProbeProfile = capabilityProbeProfile({
  baseline: level8Profile,
  probeCapability: "plan-management",
});

export const level8Scenarios: readonly IntegrationCaseScenario[] = [
  {
    level: 8,
    scenarioId: "itinerary-assembly",
    description: "sequential QUEUE decisions assemble a planId-coupled itinerary under coupled-leg and budget constraints; a cheaper outbound is rebooked mid-planning (SWITCH + checkpoint)",
    archetypes: ["replan", "switching"],
    createHost: createLevel8ItineraryAssemblyHost,
    profile: level8Profile,
    steps: 5,
    expectReckonComplete: true,
  },
  {
    level: 8,
    scenarioId: "availability-switching",
    description: "a rate-plan sell-out forces a same-item realization SWITCH; the activity leg is gated by a morning time-window constraint",
    archetypes: ["switching"],
    createHost: createLevel8AvailabilitySwitchingHost,
    profile: level8Profile,
    steps: 5,
    expectReckonComplete: true,
  },
  {
    level: 8,
    scenarioId: "cancellation-recovery",
    description: "a carrier cancellation is corrected append-oriented (correctsEventId → the original booking outcome), rebooked time-critically (INTERRUPT), and planning RESUMEs",
    archetypes: ["interruption", "resume", "replan"],
    createHost: createLevel8CancellationRecoveryHost,
    profile: level8Profile,
    steps: 5,
    expectReckonComplete: true,
  },
  {
    level: 8,
    scenarioId: "budget-replan",
    description: "the budget ceiling tightens across steps; the whole itinerary replans via SWITCHes (rate swap, outbound rebook, activity) under max-cost constraints, ending within budget",
    archetypes: ["replan", "switching"],
    createHost: createLevel8BudgetReplanHost,
    profile: level8Profile,
    steps: 6,
    expectReckonComplete: true,
  },
  {
    level: 8,
    scenarioId: "probe-plan-management",
    description: "capability probe: the level wants itinerary plan CRUD; the harness port composes only the standard decision loop — honestly incomplete (COMPOSITION_GAP)",
    archetypes: ["replan"],
    createHost: createLevel8ItineraryAssemblyHost,
    profile: level8ProbeProfile,
    steps: 5,
    expectReckonComplete: false,
  },
  {
    level: 8,
    scenarioId: "resilience",
    description: "the budget-replan scenario under a seeded transport-fault storm (faultRate 0.2, 3 retries) — failure/retry behavior measured honestly",
    archetypes: ["replan", "switching"],
    createHost: createLevel8BudgetReplanHost,
    profile: level8Profile,
    steps: 6,
    faultRate: 0.2,
    maxRetries: 3,
    expectReckonComplete: true,
  },
];
