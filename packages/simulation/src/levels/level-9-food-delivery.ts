/**
 * SIM-004 — Ladder Level 9: the FOOD DELIVERY synthetic host.
 *
 * Ladder definition (docs/simulations/reckon-complete-ladder.md):
 *   "Food delivery — changing ETA, substitutions, urgent replanning,
 *    hard deadlines."
 *
 * The host owns a delivery marketplace slice (host-owned catalog,
 * kitchen stock, rider fleet, ETA model — architecture law) and asks
 * Reckon for the next order decision through the PUBLIC surface only:
 * manifest → connect sources → per step: candidates → decision request
 * (objective, attention policy, constraints, currentExperience) →
 * host presents → outcome → preference delta.
 *
 * World-state transitions (all host-side, all deterministic, all
 * step-indexed — fixture-class scripted behaviors, never behavioral
 * claims):
 * - changing ETA: the traffic model adds +2 min per step to the live
 *   order's ETA; when the ETA first exceeds the promised ETA + slack,
 *   the host emits an append-oriented CORRECTION outcome
 *   (correctsEventId → the step-1 "start" promise);
 * - substitutions: the pasta dish's kitchen stock is scripted to sell
 *   out at step 3 (fixture world event); retrieval then offers the
 *   substitution-group sibling (risotto) with retrieval source
 *   "host-substitution" — a different item ⇒ the decision SWITCHes;
 * - urgent replanning: when the ETA breach persists at step 6, the
 *   priority-prep candidate (source "host-time-critical", the
 *   responder's well-known time-critical source) INTERRUPTs the live
 *   order with a retained resume checkpoint — the replan the ladder
 *   demands;
 * - hard deadlines: every request carries a time-window constraint
 *   (order cutoff at the promise deadline) and a max-latency budget.
 *
 * Honest gap: the host's rolling delivery plan (order → substitution →
 * priority prep → deadline) wants platform plan custody; the manifest
 * declares `plan-management` partial / COMPOSITION_GAP (the public
 * SDK/API exposes plans create/replan/get; the composed harness path
 * carries only the planId coupling). Domain 9 joins SIM-003's domains
 * 5+8 for the 3-domain law analysis.
 *
 * LAWS obeyed (SIM-004 work order):
 * - zero internal Reckon imports — only @reckon/contracts types + the
 *   harness host-adapter seam (enforced by the conformance scanner);
 * - no Math.random, no Date.now / wall-clock reads, no LLM/network;
 * - every synthetic outcome carries evidenceClass "fixture" — synthetic
 *   host output NEVER becomes observed evidence;
 * - deterministic: a fresh host from this factory + the same run seed
 *   yields byte-identical records (replay gate).
 *
 * Glue declaration (honest, host-declared; mechanically re-verified by
 * packages/simulation/test/levels-wave-b.test.ts):
 * - `loc` — comment-stripped non-blank lines of THIS module;
 * - `customAdapterLoc` — lines between the `glue:adapter` markers below
 *   (the world-state / ETA / substitution / deadline code);
 * - `functions` — the named host functions: dishByItemId,
 *   substitutionFor, trafficEtaMinutes, deadlineConstraints,
 *   deliveryCandidates, provideDecisionInputs, consumeDecision,
 *   provideOutcome, providePreferenceDelta,
 *   createLevel9FoodDeliveryHost (10 total).
 */
import type {
  DecisionResult,
  HostDecisionReaction,
  HostDecisionInputs,
  CatalogItemInput,
  RealizationInput,
  SimulationHostAdapter,
  SimulationManifestContentInput,
  SubjectReference,
  TenantScope,
} from "../harness/host-adapter.js";
import type { HardConstraint } from "@reckon/contracts";
import type { ExperienceInput } from "../harness/port.js";
import type { ReckonCompleteProfileDeclarationInput } from "@reckon/contracts";

/** Host-owned identity (host is the identity authority — never Reckon). */
const TENANT: TenantScope = { tenantId: "tenant-l9-food-delivery" };
const SUBJECT: SubjectReference = { kind: "user", ref: "user-l9-diner-1" };

// --- glue:adapter:begin ----------------------------------------------------
// The delivery world: 6 dishes across 3 restaurants, one standard prep
// realization each; the italian-staples dishes additionally offer a
// priority-prep (express) realization. Kitchen stock, the ETA model,
// and the substitution groups are HOST-owned.

interface DeliveryDish {
  readonly itemId: string;
  readonly title: string;
  readonly restaurant: string;
  readonly cuisine: string;
  readonly substitutionGroup: string;
  readonly realizationId: string;
  readonly expressRealizationId: string | null;
  readonly baseEtaMinutes: number;
  readonly priceUsd: number;
  readonly stock: number;
}

const MENU_DISHES: readonly DeliveryDish[] = [
  { itemId: "l9-dish-pasta", title: "Spaghetti al pomodoro", restaurant: "Casa Verde", cuisine: "italian", substitutionGroup: "italian-staples", realizationId: "l9-real-pasta-standard", expressRealizationId: "l9-real-pasta-express", baseEtaMinutes: 18, priceUsd: 14, stock: 1 },
  { itemId: "l9-dish-risotto", title: "Risotto ai funghi", restaurant: "Casa Verde", cuisine: "italian", substitutionGroup: "italian-staples", realizationId: "l9-real-risotto-standard", expressRealizationId: "l9-real-risotto-express", baseEtaMinutes: 21, priceUsd: 17, stock: 3 },
  { itemId: "l9-dish-curry", title: "Red curry bowl", restaurant: "Lantern Wok", cuisine: "thai", substitutionGroup: "comfort", realizationId: "l9-real-curry-standard", expressRealizationId: null, baseEtaMinutes: 16, priceUsd: 13, stock: 3 },
  { itemId: "l9-dish-stew", title: "Beef stew pot", restaurant: "Lantern Wok", cuisine: "thai", substitutionGroup: "comfort", realizationId: "l9-real-stew-standard", expressRealizationId: null, baseEtaMinutes: 24, priceUsd: 19, stock: 2 },
  { itemId: "l9-dish-burger", title: "Double smash burger", restaurant: "Smoke Line", cuisine: "american", substitutionGroup: "grill", realizationId: "l9-real-burger-standard", expressRealizationId: null, baseEtaMinutes: 14, priceUsd: 12, stock: 3 },
  { itemId: "l9-dish-ribs", title: "BBQ ribs plate", restaurant: "Smoke Line", cuisine: "american", substitutionGroup: "grill", realizationId: "l9-real-ribs-standard", expressRealizationId: null, baseEtaMinutes: 27, priceUsd: 22, stock: 2 },
];

/** Kitchen stock (host authority): scripted sell-out of the pasta at step 3. */
const PASTA_SELL_OUT_STEP = 3;
/** ETA drift: +2 min per step (traffic model, host-owned). */
const TRAFFIC_MINUTES_PER_STEP = 2;
/** Promise: the host promises the base ETA; slack 5 min before a correction. */
const ETA_SLACK_MINUTES = 5;
/** Hard deadline: the order must land within promise + 12 min. */
const DEADLINE_SLACK_MINUTES = 12;
/** The step at which the priority-prep (urgent replan) is requested. */
const PRIORITY_PREP_STEP = 6;
/** The delivery lands on the final step (scripted world event). */
const DELIVERY_STEP = 8;

interface Level9WorldState {
  presentations: number;
  orderedItemId: string | null;
  promisedEtaMinutes: number;
  etaLog: number[];
  correctionSteps: number[];
  substitutionSteps: number[];
  priorityPrepSteps: number[];
  soldOutItems: string[];
  deliveredSteps: number[];
  outcomeSteps: number[];
  outcomeTypes: string[];
  deltaDimensions: string[];
  cuisineWeights: Map<string, number>;
}

/** Read-only view over the final world state (for deterministic assertions). */
export interface Level9WorldView {
  readonly presentations: number;
  readonly orderedItemId: string | null;
  readonly promisedEtaMinutes: number;
  readonly etaLog: readonly number[];
  readonly correctionSteps: readonly number[];
  readonly substitutionSteps: readonly number[];
  readonly priorityPrepSteps: readonly number[];
  readonly soldOutItems: readonly string[];
  readonly deliveredSteps: readonly number[];
  readonly outcomeSteps: readonly number[];
  readonly outcomeTypes: readonly string[];
  readonly deltaDimensions: readonly string[];
  readonly cuisineWeights: Readonly<Record<string, number>>;
}

function createLevel9WorldState(): Level9WorldState {
  return {
    presentations: 0,
    orderedItemId: null,
    promisedEtaMinutes: 0,
    etaLog: [],
    correctionSteps: [],
    substitutionSteps: [],
    priorityPrepSteps: [],
    soldOutItems: [],
    deliveredSteps: [],
    outcomeSteps: [],
    outcomeTypes: [],
    deltaDimensions: [],
    cuisineWeights: new Map([["american", 1], ["italian", 1], ["thai", 1]]),
  };
}

/** Host catalog knowledge: the dish behind an item id. */
function dishByItemId(itemId: string | undefined): DeliveryDish | undefined {
  return MENU_DISHES.find((dish) => dish.itemId === itemId);
}

/** The substitution sibling for a sold-out dish (same group, in stock). */
function substitutionFor(itemId: string): DeliveryDish | undefined {
  const dish = dishByItemId(itemId);
  if (dish === undefined) return undefined;
  return MENU_DISHES.find(
    (candidate) =>
      candidate.substitutionGroup === dish.substitutionGroup &&
      candidate.itemId !== itemId &&
      candidate.stock > 0,
  );
}

/** The traffic model: base ETA + drift per step, floor at 1. */
function trafficEtaMinutes(baseEtaMinutes: number, step: number): number {
  return Math.max(1, baseEtaMinutes + TRAFFIC_MINUTES_PER_STEP * (step - 1));
}

/** Hard-deadline constraints on every request (order cutoff + latency budget). */
function deadlineConstraints(step: number, deadlineMinutes: number): HardConstraint[] {
  return [
    { kind: "time-window", untilMs: 1_000 * 60 * (step + Math.max(1, deadlineMinutes)) },
    { kind: "max-latency", latencyMs: 250 },
    { kind: "catalog-rule", ruleId: "l9-kitchen-open" },
  ];
}

interface DeliveryCandidate {
  readonly itemId: string;
  readonly realizationIds: string[];
  readonly source: string;
  readonly rankHint: number;
}

/** Retrieval: the live order's candidates for this step (substitution / priority-prep aware). */
function deliveryCandidates(
  state: Level9WorldState,
  liveRealizationId: string | null,
  step: number,
): DeliveryCandidate[] {
  if (state.orderedItemId === null) {
    // Fresh order: rank the in-stock dishes by (host) editorial order.
    const candidates: DeliveryCandidate[] = [];
    let rank = 1;
    for (const dish of MENU_DISHES) {
      if (dish.stock <= 0) continue;
      candidates.push({ itemId: dish.itemId, realizationIds: [dish.realizationId], source: "host-menu-rank", rankHint: rank });
      rank += 1;
    }
    return candidates;
  }
  const ordered = dishByItemId(state.orderedItemId);
  if (ordered === undefined) return [];
  const soldOut = state.soldOutItems.includes(state.orderedItemId);
  if (soldOut) {
    const substitute = substitutionFor(state.orderedItemId);
    if (substitute === undefined) return [];
    return [
      { itemId: substitute.itemId, realizationIds: [substitute.realizationId], source: "host-substitution", rankHint: 1 },
    ];
  }
  const eta = trafficEtaMinutes(state.promisedEtaMinutes, step);
  if (
    step === PRIORITY_PREP_STEP &&
    ordered.expressRealizationId !== null &&
    eta > state.promisedEtaMinutes + ETA_SLACK_MINUTES
  ) {
    // Urgent replanning: priority prep is time-critical.
    return [
      { itemId: ordered.itemId, realizationIds: [ordered.expressRealizationId], source: "host-time-critical", rankHint: 1 },
    ];
  }
  // Order tracking: continue the realization the live order is on.
  const realizationId = liveRealizationId ?? ordered.realizationId;
  return [{ itemId: ordered.itemId, realizationIds: [realizationId], source: "host-order-track", rankHint: 1 }];
}
// --- glue:adapter:end ------------------------------------------------------

/** Host catalog source — connected once, before the loop (public API). */
const LEVEL9_CATALOG: { items: readonly CatalogItemInput[]; realizations: readonly RealizationInput[] } = {
  items: MENU_DISHES.map((dish) => ({
    itemId: dish.itemId,
    kind: "commerce" as const,
    labels: ["dish", dish.cuisine, dish.substitutionGroup],
    attributes: { title: dish.title, restaurant: dish.restaurant, cuisine: dish.cuisine, substitutionGroup: dish.substitutionGroup },
  })),
  realizations: MENU_DISHES.flatMap((dish) => {
    const standard = {
      realizationId: dish.realizationId,
      itemId: dish.itemId,
      kind: "courier-standard-prep",
      constraints: { etaMinutes: dish.baseEtaMinutes, priceUsd: dish.priceUsd },
    };
    return dish.expressRealizationId === null
      ? [standard]
      : [
          standard,
          {
            realizationId: dish.expressRealizationId,
            itemId: dish.itemId,
            kind: "courier-priority-prep",
            constraints: { etaMinutes: Math.max(1, dish.baseEtaMinutes - 6), priceUsd: dish.priceUsd + 3 },
          },
        ];
  }),
};

/** The host's honest capability manifest (statuses, evidence, ops, methods). */
const LEVEL9_MANIFEST_CONTENT: SimulationManifestContentInput = {
  manifestVersion: "1",
  hostSystem: {
    hostId: "host-l9-food-delivery",
    name: "ForkRoute Delivery",
    hostAdapterId: "adapter-l9-food-delivery-1",
    version: "0.1.0",
  },
  declaredAt: 0,
  supportedCapabilities: [
    { capability: "tenant-identity", status: "supported", evidenceClass: "fixture" },
    {
      capability: "catalog-registration",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/catalog/items"],
      sdkMethods: ["catalog.upsertItem"],
    },
    {
      capability: "realization-declaration",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/catalog/realizations"],
      sdkMethods: ["catalog.upsertRealization"],
      notes: "realization constraints carry the host-owned ETA/price delivery characteristics; express variants are priority-prep realizations",
    },
    {
      capability: "candidate-retrieval",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/candidates"],
      sdkMethods: ["candidates.submit"],
    },
    {
      capability: "objective-declaration",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "objective declared on every decision request (in-request field)",
    },
    {
      capability: "constraint-declaration",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "time-window order cutoff + max-latency budget + catalog-rule kitchen gate on every request",
    },
    {
      capability: "attention-policy",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "attention policy declared on every decision request (in-request field)",
    },
    {
      capability: "decision-request",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "requests carry currentExperience for the live order (SWITCH on substitution, INTERRUPT on priority prep)",
    },
    {
      capability: "schedule-execution",
      status: "supported",
      evidenceClass: "fixture",
      notes: "host-side execution of schedule deltas (SWITCH substitution, INTERRUPT priority prep with retained checkpoint, CONTINUE order tracking)",
    },
    {
      capability: "outcome-return",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/outcomes"],
      sdkMethods: ["outcomes.append"],
      notes: "append-oriented ETA correction events (correctsEventId) reference the original promise",
    },
    {
      capability: "preference-feedback",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/preferences/events"],
      sdkMethods: ["preferences.appendDelta"],
    },
    {
      capability: "conformance-verification",
      status: "supported",
      evidenceClass: "fixture",
      notes: "harness conformance verdict; no API route — machine-checked offline",
    },
    {
      capability: "plan-management",
      status: "partial",
      evidenceClass: "fixture",
      friction: "COMPOSITION_GAP",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes:
        "the rolling delivery plan (order → substitution → priority prep → deadline) is host-owned; decisions couple to the plan via DecisionRequest.planId and ScheduleDelta.planId and the SDK/API exposes plans.create/replan/get, but the SIM-001 harness port composes only the standard decision loop — plan CRUD is not reachable through the composed harness path",
    },
  ],
};

/** The Level 9 Reckon-Complete profile: what this archetype REQUIRES. */
export const level9FoodDeliveryProfile: ReckonCompleteProfileDeclarationInput = {
  profileId: "profile-l9-food-delivery",
  name: "Food delivery",
  description: "SIM-004 ladder level 9 — changing ETA, substitutions, urgent replanning, hard deadlines.",
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
    { capability: "schedule-execution" },
    { capability: "outcome-return" },
    { capability: "preference-feedback" },
    { capability: "conformance-verification" },
    { capability: "plan-management" },
  ],
  requiredEvidenceClass: "fixture",
  declaredAt: 1_000,
};

/** A fresh Level 9 host (fresh world state — replay-safe by construction). */
export interface Level9Host {
  readonly host: SimulationHostAdapter;
  readonly world: Level9WorldView;
}

export function createLevel9FoodDeliveryHost(): Level9Host {
  const state = createLevel9WorldState();
  /** The experience the previous step's decision selected (the live order). */
  let liveExperience: ExperienceInput | undefined;
  /** The realization the live order currently rides (for CONTINUE). */
  let liveRealizationId: string | null = null;
  /** The original order-promise event id (corrections reference it). */
  let promiseEventId = "";
  const stockByDish = new Map(MENU_DISHES.map((dish) => [dish.itemId, dish.stock]));

  const host: SimulationHostAdapter = {
    hostAdapterId: "adapter-l9-food-delivery-1",
    hostSystem: {
      hostId: "host-l9-food-delivery",
      name: "ForkRoute Delivery",
      version: "0.1.0",
    },
    glue: { functions: 10, loc: 497, customAdapterLoc: 140 },
    manifestContent: LEVEL9_MANIFEST_CONTENT,
    catalog: {
      items: LEVEL9_CATALOG.items.map((item) => ({ ...item })),
      realizations: LEVEL9_CATALOG.realizations.map((realization) => ({ ...realization })),
    },

    provideDecisionInputs(step: number): HostDecisionInputs {
      // World transition: the pasta kitchen stock is scripted to sell out
      // at step 3 (fixture world event — host authority, honest fixture).
      if (step === PASTA_SELL_OUT_STEP && !state.soldOutItems.includes("l9-dish-pasta")) {
        state.soldOutItems.push("l9-dish-pasta");
        stockByDish.set("l9-dish-pasta", 0);
      }
      if (state.orderedItemId !== null) {
        state.etaLog.push(trafficEtaMinutes(state.promisedEtaMinutes, step));
      }
      const deadlineMinutes = state.orderedItemId === null
        ? 20
        : state.promisedEtaMinutes + DEADLINE_SLACK_MINUTES - TRAFFIC_MINUTES_PER_STEP * (step - 1);
      return {
        contextId: `ctx-l9-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        objective: {
          objectiveId: "obj-l9-deliver-on-time",
          version: "1",
          kind: "complete-task",
          params: { mode: "delivery-promise" },
        },
        attentionPolicy: {
          policyId: "ap-l9-balanced",
          version: "1",
          style: "balanced",
          params: { maxDeliveryUpdatesPerOrder: 4 },
        },
        candidates: {
          setId: `cs-l9-${step}`,
          candidates: deliveryCandidates(state, liveRealizationId, step).map((candidate) => ({ ...candidate })),
        },
        constraints: deadlineConstraints(step, deadlineMinutes),
        policySelector: { policyId: "forkroute-dispatch-v1" },
        ...(liveExperience !== undefined ? { currentExperience: liveExperience } : {}),
        planId: "plan-l9-order-1",
      };
    },

    consumeDecision(step: number, result: DecisionResult): HostDecisionReaction {
      const itemId = result.selectedExperience?.itemId ?? "";
      const dish = dishByItemId(itemId);
      state.presentations += 1;
      if (result.action === "SWITCH" && state.orderedItemId !== null && itemId !== state.orderedItemId) {
        // Substitution accepted: the order moves to the sibling dish.
        state.substitutionSteps.push(step);
        state.orderedItemId = itemId;
        state.promisedEtaMinutes = dish?.baseEtaMinutes ?? state.promisedEtaMinutes;
      } else if (result.action === "INTERRUPT") {
        // Urgent replanning: priority prep interrupts the live order.
        state.priorityPrepSteps.push(step);
        state.promisedEtaMinutes = Math.max(1, state.promisedEtaMinutes - 6);
      } else if (state.orderedItemId === null) {
        // Fresh order placed.
        state.orderedItemId = itemId;
        state.promisedEtaMinutes = dish?.baseEtaMinutes ?? 20;
        const remaining = (stockByDish.get(itemId) ?? 0) - 1;
        stockByDish.set(itemId, Math.max(0, remaining));
      }
      liveExperience = result.selectedExperience;
      liveRealizationId = result.selectedExperience?.realizationId ?? null;
      return { presented: true };
    },

    provideOutcome(step: number, result: DecisionResult, _reaction: HostDecisionReaction, nowMs: number) {
      state.outcomeSteps.push(step);
      const dish = dishByItemId(result.selectedExperience?.itemId ?? "");
      const cuisine = dish?.cuisine ?? "italian";
      const eta = trafficEtaMinutes(state.promisedEtaMinutes, step);
      const substitutionStep = state.substitutionSteps.includes(step);
      const priorityPrepStep = state.priorityPrepSteps.includes(step);
      const delivered = step === DELIVERY_STEP;
      const breached = state.orderedItemId !== null && eta > state.promisedEtaMinutes + ETA_SLACK_MINUTES;
      const freshOrder = state.outcomeSteps.length === 1;
      let eventType: "start" | "conversion" | "correction" | "interruption-accept" | "custom" =
        "custom";
      let customEventType: string | undefined = "delivery-status";
      if (delivered) {
        eventType = "conversion";
        customEventType = undefined;
        state.deliveredSteps.push(step);
      } else if (priorityPrepStep) {
        eventType = "interruption-accept";
        customEventType = undefined;
      } else if (breached && state.correctionSteps.length === 0) {
        // Changing ETA: append-oriented correction of the original promise.
        eventType = "correction";
        customEventType = undefined;
        state.correctionSteps.push(step);
      } else if (substitutionStep) {
        eventType = "custom";
        customEventType = "substitution-applied";
      } else if (freshOrder) {
        eventType = "start";
        customEventType = undefined;
      }
      state.outcomeTypes.push(eventType);
      const outcome = {
        eventId: `ev-l9-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        decisionId: result.decisionId,
        experienceId: result.selectedExperience?.experienceId,
        eventType,
        ...(customEventType !== undefined ? { customEventType } : {}),
        occurredAt: nowMs,
        evidenceClass: "fixture" as const,
        metrics: {
          etaMinutes: eta,
          promisedEtaMinutes: state.promisedEtaMinutes,
          orderValueUsd: dish?.priceUsd ?? 0,
          substitutionCount: state.substitutionSteps.length,
          priorityPrepCount: state.priorityPrepSteps.length,
        },
        ...(eventType === "correction" && promiseEventId !== "" ? { correctsEventId: promiseEventId } : {}),
        idempotencyKey: `idem-out-l9-${step}`,
      };
      if (eventType === "start" && promiseEventId === "") {
        promiseEventId = outcome.eventId;
      }
      return outcome;
    },

    providePreferenceDelta(step: number, result: DecisionResult, nowMs: number) {
      const dish = dishByItemId(result.selectedExperience?.itemId ?? "");
      const cuisine = dish?.cuisine ?? "italian";
      const dimension = `cuisine.${cuisine}`;
      state.deltaDimensions.push(dimension);
      const weight = (state.cuisineWeights.get(cuisine) ?? 1) + 0.1;
      state.cuisineWeights.set(cuisine, Math.round(weight * 100) / 100);
      return {
        deltaId: `delta-l9-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        dimension,
        op: "add" as const,
        newValue: Math.round(weight * 100) / 100,
        resultingConfidence: Math.min(0.9, 0.5 + 0.05 * step),
        model: { modelId: "forkroute-cuisine-affinity", version: "1" },
        timestamp: nowMs,
      };
    },
  };

  return {
    host,
    world: {
      get presentations() { return state.presentations; },
      get orderedItemId() { return state.orderedItemId; },
      get promisedEtaMinutes() { return state.promisedEtaMinutes; },
      get etaLog() { return [...state.etaLog]; },
      get correctionSteps() { return [...state.correctionSteps]; },
      get substitutionSteps() { return [...state.substitutionSteps]; },
      get priorityPrepSteps() { return [...state.priorityPrepSteps]; },
      get soldOutItems() { return [...state.soldOutItems]; },
      get deliveredSteps() { return [...state.deliveredSteps]; },
      get outcomeSteps() { return [...state.outcomeSteps]; },
      get outcomeTypes() { return [...state.outcomeTypes]; },
      get deltaDimensions() { return [...state.deltaDimensions]; },
      get cuisineWeights() { return Object.fromEntries([...state.cuisineWeights.entries()].sort()); },
    },
  };
}

/** Level metadata for wave reporting (mirrors the module's declarations). */
export const level9FoodDeliveryMeta = {
  level: 9,
  name: "Food delivery",
  hostAdapterId: "adapter-l9-food-delivery-1",
  requiredCapabilities: 13,
  expectedSatisfied: 12,
  expectedPartial: 1,
  expectedMissing: 0,
  expectedGaps: ["plan-management|COMPOSITION_GAP"] as readonly string[],
} as const;
