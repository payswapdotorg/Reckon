/**
 * SIM-006 — Ladder Level 19: the RESOURCE-CONSTRAINED ADAPTIVE
 * synthetic host.
 *
 * Ladder definition (docs/simulations/reckon-complete-ladder.md):
 *   "Resource-constrained adaptive system — CPU/API/money/time/attention
 *    budgets and graceful degradation."
 *
 * The host owns an edge deployment (EdgeCast) serving a device fleet
 * with tight resource budgets: an API-call quota, CPU units, a money
 * budget (per-decision inference/delivery cost), per-decision latency
 * deadlines, and a user-attention budget. Per the SIM-006 work-order
 * law, the budgets map onto EXISTING contract surfaces — constraints
 * separate from reward (lock #21) — and graceful degradation is
 * observable in outcomes/evidence, NOT a new scheduler feature:
 *
 * - money  → the hard `max-cost` constraint (tightening per tier);
 * - time   → the hard `max-latency` constraint (tightening per tier);
 * - CPU    → the `catalog-rule` edge-class gate + realization tier
 *   constraints (qualityTier / cpuUnits / costPerCallUsd);
 * - API    → the host-side call-quota ledger (which retrieval width and
 *   realization tier the host may afford this step);
 * - attention → the attention policy (style + params) declared on every
 *   request, downgraded as the attention budget depletes.
 *
 * The reward stays SEPARATE from the constraints: every request also
 * declares a versioned RewardSpec (satisfaction-proxy vs inference-cost
 * vs latency terms) — constraints gate eligibility; reward shapes
 * preference among eligible experiences.
 *
 * World-state transitions (all host-side, all deterministic, all
 * step-indexed — fixture-class scripted behaviors, never behavioral
 * claims):
 * - budget tiers: the host ledger degrades full (steps 1–4: API calls
 *   remaining ≥ 20) → reduced (steps 5–7: ≥ 8) → minimal (step 8);
 * - graceful degradation per tier: candidate-set width 4 → 2 → 1,
 *   attention style balanced → mindful, realization tier edge-full →
 *   edge-lite → edge-minimal, max-cost 0.10 → 0.05 → 0.02 USD,
 *   max-latency 250 → 150 → 80 ms;
 * - the ultimate degradation is honest non-presentation: at step 8 the
 *   attention budget is exhausted, so the host REQUESTS the decision
 *   but declines to present it (no outcome, no preference delta — the
 *   requested-but-not-presented boundary, host authority);
 * - every presented outcome's metrics carry the tier + the full budget
 *   ledger state (apiCallsRemaining, cpuUnitsUsed, costUsdTotal,
 *   attentionUnitsRemaining) — degradation is OBSERVABLE in evidence.
 *
 * LAWS obeyed (SIM-006 work order):
 * - zero internal Reckon imports — only @reckon/contracts types and the
 *   harness host-adapter seam (enforced by the conformance scanner);
 * - no Math.random, no Date.now / wall-clock reads, no LLM/network;
 * - every synthetic outcome carries evidenceClass "fixture" — synthetic
 *   host output NEVER becomes observed evidence;
 * - deterministic: a fresh host from this factory + the same run seed
 *   yields byte-identical records (replay gate);
 * - NO new scheduler feature: the host composes ONLY the six
 *   standard-loop public operations; degradation is host-side budget
 *   policy expressed through existing constraints/realizations.
 *
 * Glue declaration (honest, host-declared; mechanically re-verified by
 * packages/simulation/test/levels-wave-c.test.ts):
 * - `loc` — comment-stripped non-blank lines of THIS module;
 * - `customAdapterLoc` — lines between the `glue:adapter` markers below
 *   (the budget ledger / tier / degradation code);
 * - `functions` — the named host functions: budgetTierFor,
 *   attentionStyleFor, budgetConstraints, degradationReward,
 *   tierCandidates, contentRoleOf, createLevel19WorldState,
 *   createLevel19ResourceConstrainedHost + its four adapter callbacks
 *   (12).
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
import type { RewardSpecInput } from "../harness/port.js";
import type { ReckonCompleteProfileDeclarationInput } from "@reckon/contracts";

/** Host-owned identity (host is the identity authority — never Reckon). */
const TENANT: TenantScope = { tenantId: "tenant-l19-edgecast" };
const SUBJECT: SubjectReference = { kind: "user", ref: "user-l19-edge-1" };

// --- glue:adapter:begin ----------------------------------------------------
// The resource-constrained world: a host-owned budget ledger over
// API calls / CPU units / money / attention, mapped onto the existing
// constraint + realization + attention-policy surfaces.

/** The degradation tiers (host budget policy — never a scheduler feature). */
type BudgetTier = "full" | "reduced" | "minimal";

/** Total API-call budget; the connect phase consumes 16 (4 items + 12 realizations). */
const API_CALL_BUDGET = 48;
const CONNECT_CALLS = 16;
/** Post-connect budget remaining at step 1. */
const API_CALLS_AFTER_CONNECT = API_CALL_BUDGET - CONNECT_CALLS;
/** API calls consumed per decision-loop step (candidates/decision/outcome/delta). */
const API_CALLS_PER_STEP = 4;

/** Full-tier floor: while remaining ≥ 20 the host runs full quality. */
const FULL_TIER_FLOOR = 20;
/** Reduced-tier floor: while remaining ≥ 8 the host runs reduced quality. */
const REDUCED_TIER_FLOOR = 8;

/** The user-attention budget: 9.0 units for the whole session. */
const ATTENTION_BUDGET_UNITS = 9.0;
/** Attention cost per presented decision, by tier. */
const ATTENTION_COST_BY_TIER: Readonly<Record<BudgetTier, number>> = Object.freeze({
  full: 1.5,
  reduced: 1.0,
  minimal: 0.5,
});

/** The money budget for the session (USD). */
const MONEY_BUDGET_USD = 0.6;
/** Actual spend per presented decision, by tier (fixture cost model). */
const SPEND_USD_BY_TIER: Readonly<Record<BudgetTier, number>> = Object.freeze({
  full: 0.08,
  reduced: 0.04,
  minimal: 0.02,
});

/** The CPU-unit budget for the session. */
const CPU_BUDGET_UNITS = 100;
/** CPU units consumed per decision step, by tier (requests always run). */
const CPU_UNITS_BY_TIER: Readonly<Record<BudgetTier, number>> = Object.freeze({
  full: 8,
  reduced: 5,
  minimal: 3,
});

/** The hard-constraint ceilings and attention style per tier. */
const TIER_PARAMS: Readonly<Record<BudgetTier, {
  readonly maxLatencyMs: number;
  readonly maxCostUsd: number;
  readonly candidateWidth: number;
  readonly attentionStyle: "balanced" | "mindful";
  readonly realizationSuffix: "full" | "lite" | "minimal";
  readonly cpuClassRule: string;
}>> = Object.freeze({
  full: { maxLatencyMs: 250, maxCostUsd: 0.1, candidateWidth: 4, attentionStyle: "balanced", realizationSuffix: "full", cpuClassRule: "l19-edge-class-A" },
  reduced: { maxLatencyMs: 150, maxCostUsd: 0.05, candidateWidth: 2, attentionStyle: "mindful", realizationSuffix: "lite", cpuClassRule: "l19-edge-class-B" },
  minimal: { maxLatencyMs: 80, maxCostUsd: 0.02, candidateWidth: 1, attentionStyle: "mindful", realizationSuffix: "minimal", cpuClassRule: "l19-edge-class-C" },
});

/** The host's content corpus (retrieval order). */
const CORPUS_ITEM_IDS = [
  "l19-item-brief-a",
  "l19-item-brief-b",
  "l19-item-ambient",
  "l19-item-alert",
] as const;

/** The content role of a corpus item (preference dimension). */
function contentRoleOf(itemId: string): string {
  if (itemId.includes("brief")) return "brief";
  if (itemId.includes("ambient")) return "ambient";
  return "alert";
}

/** Numeric tier codes (the frozen MetricPayload is numeric-only). */
const TIER_CODE: Readonly<Record<BudgetTier, number>> = Object.freeze({
  full: 3,
  reduced: 2,
  minimal: 1,
});

/** Numeric serving-role codes. */
const ROLE_CODE: Readonly<Record<string, number>> = Object.freeze({
  brief: 1,
  ambient: 2,
  alert: 3,
});

/** The degradation tier for a step, from the API-call ledger. */
function budgetTierFor(apiCallsRemaining: number): BudgetTier {
  if (apiCallsRemaining >= FULL_TIER_FLOOR) return "full";
  if (apiCallsRemaining >= REDUCED_TIER_FLOOR) return "reduced";
  return "minimal";
}

/** The attention style for a tier (attention budget → policy surface). */
function attentionStyleFor(tier: BudgetTier): "balanced" | "mindful" {
  return TIER_PARAMS[tier].attentionStyle;
}

/** The hard constraints for a step (money/time/CPU — separate from reward). */
function budgetConstraints(tier: BudgetTier): HardConstraint[] {
  return [
    { kind: "time-window", untilMs: 1_000 * 60 * (60 + 6) },
    { kind: "max-latency", latencyMs: TIER_PARAMS[tier].maxLatencyMs },
    { kind: "max-cost", cost: TIER_PARAMS[tier].maxCostUsd, currency: "USD" },
    { kind: "catalog-rule", ruleId: TIER_PARAMS[tier].cpuClassRule },
  ];
}

/** The declared reward (SEPARATE from the hard constraints — lock #21). */
function degradationReward(): RewardSpecInput {
  return {
    rewardId: "l19-edgecast-reward",
    version: "1",
    terms: [
      { termId: "l19-term-satisfaction", kind: "satisfaction-proxy", weight: 1.0, params: {} },
      { termId: "l19-term-inference-cost", kind: "inference-cost", weight: -0.6, params: { budget: "money" } },
      { termId: "l19-term-latency", kind: "latency", weight: -0.3, params: { budget: "time" } },
    ],
  };
}

/** The tier-shaped candidate set (retrieval width degrades with the API budget). */
function tierCandidates(tier: BudgetTier, step: number): { itemId: string; realizationId: string }[] {
  const width = TIER_PARAMS[tier].candidateWidth;
  const suffix = TIER_PARAMS[tier].realizationSuffix;
  const candidates: { itemId: string; realizationId: string }[] = [];
  for (let offset = 0; offset < width; offset += 1) {
    const itemId = CORPUS_ITEM_IDS[(step - 1 + offset) % CORPUS_ITEM_IDS.length]!;
    candidates.push({ itemId, realizationId: `l19-real-${itemId.replace("l19-item-", "")}-${suffix}` });
  }
  return candidates;
}

interface Level19WorldState {
  presentations: number;
  declinedSteps: number[];
  tierLog: BudgetTier[];
  candidateSetSizes: number[];
  realizationTiersUsed: string[];
  apiCallsRemainingLog: number[];
  attentionRemainingLog: number[];
  costUsdLog: number[];
  cpuUnitsUsedLog: number[];
  maxLatencyLog: number[];
  maxCostLog: number[];
  outcomeSteps: number[];
  outcomeTypes: string[];
  deltaDimensions: string[];
  contentWeights: Map<string, number>;
}

function createLevel19WorldState(): Level19WorldState {
  return {
    presentations: 0,
    declinedSteps: [],
    tierLog: [],
    candidateSetSizes: [],
    realizationTiersUsed: [],
    apiCallsRemainingLog: [],
    attentionRemainingLog: [],
    costUsdLog: [],
    cpuUnitsUsedLog: [],
    maxLatencyLog: [],
    maxCostLog: [],
    outcomeSteps: [],
    outcomeTypes: [],
    deltaDimensions: [],
    contentWeights: new Map([
      ["brief", 1],
      ["ambient", 1],
      ["alert", 1],
    ]),
  };
}
// --- glue:adapter:end ------------------------------------------------------

/** Host catalog source — connected once, before the loop (public API). */
const LEVEL19_CATALOG: { items: readonly CatalogItemInput[]; realizations: readonly RealizationInput[] } = {
  items: [
    { itemId: "l19-item-brief-a", kind: "article", labels: ["brief", "grid"], attributes: { title: "Grid load brief A", contentRole: "brief" } },
    { itemId: "l19-item-brief-b", kind: "article", labels: ["brief", "grid"], attributes: { title: "Grid load brief B", contentRole: "brief" } },
    { itemId: "l19-item-ambient", kind: "media", labels: ["ambient", "audio"], attributes: { title: "Fleet ambient mix", contentRole: "ambient" } },
    { itemId: "l19-item-alert", kind: "notification", labels: ["alert", "priority"], attributes: { title: "Priority fleet alert", contentRole: "alert" } },
  ],
  realizations: [
    { realizationId: "l19-real-brief-a-full", itemId: "l19-item-brief-a", kind: "edge-full", constraints: { qualityTier: "full", cpuUnits: 8, costPerCallUsd: 0.08, attentionUnits: 1.5 } },
    { realizationId: "l19-real-brief-a-lite", itemId: "l19-item-brief-a", kind: "edge-lite", constraints: { qualityTier: "reduced", cpuUnits: 5, costPerCallUsd: 0.04, attentionUnits: 1.0 } },
    { realizationId: "l19-real-brief-a-minimal", itemId: "l19-item-brief-a", kind: "edge-minimal", constraints: { qualityTier: "minimal", cpuUnits: 3, costPerCallUsd: 0.02, attentionUnits: 0.5 } },
    { realizationId: "l19-real-brief-b-full", itemId: "l19-item-brief-b", kind: "edge-full", constraints: { qualityTier: "full", cpuUnits: 8, costPerCallUsd: 0.08, attentionUnits: 1.5 } },
    { realizationId: "l19-real-brief-b-lite", itemId: "l19-item-brief-b", kind: "edge-lite", constraints: { qualityTier: "reduced", cpuUnits: 5, costPerCallUsd: 0.04, attentionUnits: 1.0 } },
    { realizationId: "l19-real-brief-b-minimal", itemId: "l19-item-brief-b", kind: "edge-minimal", constraints: { qualityTier: "minimal", cpuUnits: 3, costPerCallUsd: 0.02, attentionUnits: 0.5 } },
    { realizationId: "l19-real-ambient-full", itemId: "l19-item-ambient", kind: "edge-full", constraints: { qualityTier: "full", cpuUnits: 8, costPerCallUsd: 0.08, attentionUnits: 1.5 } },
    { realizationId: "l19-real-ambient-lite", itemId: "l19-item-ambient", kind: "edge-lite", constraints: { qualityTier: "reduced", cpuUnits: 5, costPerCallUsd: 0.04, attentionUnits: 1.0 } },
    { realizationId: "l19-real-ambient-minimal", itemId: "l19-item-ambient", kind: "edge-minimal", constraints: { qualityTier: "minimal", cpuUnits: 3, costPerCallUsd: 0.02, attentionUnits: 0.5 } },
    { realizationId: "l19-real-alert-full", itemId: "l19-item-alert", kind: "edge-full", constraints: { qualityTier: "full", cpuUnits: 8, costPerCallUsd: 0.08, attentionUnits: 1.5 } },
    { realizationId: "l19-real-alert-lite", itemId: "l19-item-alert", kind: "edge-lite", constraints: { qualityTier: "reduced", cpuUnits: 5, costPerCallUsd: 0.04, attentionUnits: 1.0 } },
    { realizationId: "l19-real-alert-minimal", itemId: "l19-item-alert", kind: "edge-minimal", constraints: { qualityTier: "minimal", cpuUnits: 3, costPerCallUsd: 0.02, attentionUnits: 0.5 } },
  ],
};

/** The host's honest capability manifest (composed surface). */
const LEVEL19_MANIFEST_CONTENT: SimulationManifestContentInput = {
  manifestVersion: "1",
  hostSystem: {
    hostId: "host-l19-edgecast",
    name: "EdgeCast",
    hostAdapterId: "adapter-l19-edgecast-1",
    version: "0.1.0",
  },
  declaredAt: 0,
  supportedCapabilities: [
    { capability: "tenant-identity", status: "supported", evidenceClass: "fixture" },
    { capability: "catalog-registration", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/catalog/items"], sdkMethods: ["catalog.upsertItem"] },
    { capability: "realization-declaration", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/catalog/realizations"], sdkMethods: ["catalog.upsertRealization"], notes: "realization constraints carry the degradation tiers (qualityTier / cpuUnits / costPerCallUsd / attentionUnits) — edge-full, edge-lite, edge-minimal" },
    { capability: "candidate-retrieval", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/candidates"], sdkMethods: ["candidates.submit"], notes: "retrieval width degrades with the API-call ledger (4 → 2 → 1 candidates)" },
    { capability: "objective-declaration", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/decisions"], sdkMethods: ["decisions.request"], notes: "objective declared on every decision request (in-request field)" },
    { capability: "constraint-declaration", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/decisions"], sdkMethods: ["decisions.request"], notes: "the resource budgets map onto existing hard constraints: max-cost (money), max-latency (time), catalog-rule edge-class gate (CPU) — tightening per degradation tier" },
    { capability: "attention-policy", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/decisions"], sdkMethods: ["decisions.request"], notes: "the attention budget maps onto the attention policy (balanced → mindful as the ledger depletes)" },
    { capability: "decision-request", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/decisions"], sdkMethods: ["decisions.request"], notes: "requests ALSO declare a versioned RewardSpec (satisfaction vs inference-cost vs latency) — constraints separate from reward (lock #21)" },
    { capability: "schedule-execution", status: "supported", evidenceClass: "fixture", notes: "host-side execution of schedule deltas (QUEUE presentations; the attention-exhausted step is requested but honestly NOT presented)" },
    { capability: "outcome-return", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/outcomes"], sdkMethods: ["outcomes.append"], notes: "outcome metrics carry the degradation tier and the full budget ledger state — degradation is observable in evidence" },
    { capability: "preference-feedback", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/preferences/events"], sdkMethods: ["preferences.appendDelta"], notes: "content-role affinity deltas (host-side preference model)" },
    { capability: "conformance-verification", status: "supported", evidenceClass: "fixture", notes: "harness conformance verdict; no API route — machine-checked offline" },
  ],
};

/** The Level 19 Reckon-Complete profile: what this archetype REQUIRES. */
export const level19ResourceConstrainedProfile: ReckonCompleteProfileDeclarationInput = {
  profileId: "profile-l19-resource-constrained",
  name: "Resource-constrained adaptive system",
  description: "SIM-006 ladder level 19 — CPU/API/money/time/attention budgets and graceful degradation.",
  ladderLevel: 19,
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
  ],
  requiredEvidenceClass: "fixture",
  declaredAt: 1_000,
};

/** Read-only view over the final world state (deterministic assertions). */
export interface Level19WorldView {
  readonly presentations: number;
  readonly declinedSteps: readonly number[];
  readonly tierLog: readonly string[];
  readonly candidateSetSizes: readonly number[];
  readonly realizationTiersUsed: readonly string[];
  readonly apiCallsRemainingLog: readonly number[];
  readonly attentionRemainingLog: readonly number[];
  readonly costUsdLog: readonly number[];
  readonly cpuUnitsUsedLog: readonly number[];
  readonly maxLatencyLog: readonly number[];
  readonly maxCostLog: readonly number[];
  readonly outcomeSteps: readonly number[];
  readonly outcomeTypes: readonly string[];
  readonly deltaDimensions: readonly string[];
  readonly contentWeights: Readonly<Record<string, number>>;
}

/** A fresh Level 19 host (fresh world state — replay-safe by construction). */
export interface Level19Host {
  readonly host: SimulationHostAdapter;
  readonly world: Level19WorldView;
}

export function createLevel19ResourceConstrainedHost(): Level19Host {
  const state = createLevel19WorldState();
  /** The host-side budget ledger (host authority — never a scheduler feature). */
  let apiCallsRemaining = API_CALLS_AFTER_CONNECT;
  let attentionRemaining = ATTENTION_BUDGET_UNITS;
  let costSpentUsd = 0;
  let cpuUnitsUsed = 0;

  const host: SimulationHostAdapter = {
    hostAdapterId: "adapter-l19-edgecast-1",
    hostSystem: {
      hostId: "host-l19-edgecast",
      name: "EdgeCast",
      version: "0.1.0",
    },
    // Glue honesty (wave-C battery recounts mechanically): loc = the
    // module's comment-stripped non-blank lines; the custom adapter LOC
    // = the recount inside the glue:adapter markers.
    glue: { functions: 12, loc: 399, customAdapterLoc: 135 },
    manifestContent: LEVEL19_MANIFEST_CONTENT,
    catalog: {
      items: LEVEL19_CATALOG.items.map((item) => ({ ...item })),
      realizations: LEVEL19_CATALOG.realizations.map((realization) => ({ ...realization })),
    },

    provideDecisionInputs(step: number): HostDecisionInputs {
      // The step's requests always execute (candidates + decision).
      apiCallsRemaining -= 2;
      const tier = budgetTierFor(apiCallsRemaining + 2);
      state.tierLog.push(tier);
      cpuUnitsUsed += CPU_UNITS_BY_TIER[tier];
      state.cpuUnitsUsedLog.push(cpuUnitsUsed);
      state.apiCallsRemainingLog.push(apiCallsRemaining + 2);
      const params = TIER_PARAMS[tier];
      state.maxLatencyLog.push(params.maxLatencyMs);
      state.maxCostLog.push(params.maxCostUsd);
      const candidates = tierCandidates(tier, step);
      state.candidateSetSizes.push(candidates.length);
      state.realizationTiersUsed.push(params.realizationSuffix);
      return {
        contextId: `ctx-l19-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        objective: {
          objectiveId: "obj-l19-serve-fleet",
          version: "1",
          kind: "stay-informed",
          params: { tier },
        },
        attentionPolicy: {
          policyId: "ap-l19-edge",
          version: "1",
          style: attentionStyleFor(tier),
          params: { attentionUnitsRemaining: Math.round(attentionRemaining * 10) / 10 },
        },
        candidates: {
          setId: `cs-l19-${step}`,
          candidates: candidates.map((candidate) => ({
            itemId: candidate.itemId,
            realizationIds: [candidate.realizationId],
            source: "host-edge-retrieval",
            rankHint: 1,
          })),
        },
        constraints: budgetConstraints(tier),
        reward: degradationReward(),
        policySelector: { policyId: "edgecast-serve-v1" },
        planId: "plan-l19-fleet-day",
      };
    },

    consumeDecision(step: number, result: DecisionResult): HostDecisionReaction {
      // The remaining 2 loop calls (outcome + delta) are only spent when
      // the host actually presents — the attention-exhausted step declines.
      const tier = state.tierLog[step - 1]!;
      const attentionCost = ATTENTION_COST_BY_TIER[tier];
      if (attentionRemaining >= attentionCost) {
        attentionRemaining = Math.round((attentionRemaining - attentionCost) * 10) / 10;
        state.attentionRemainingLog.push(attentionRemaining);
        costSpentUsd = Math.round((costSpentUsd + SPEND_USD_BY_TIER[tier]) * 100) / 100;
        state.costUsdLog.push(costSpentUsd);
        apiCallsRemaining -= 2;
        state.presentations += 1;
        return { presented: true };
      }
      // Graceful degradation, final tier: the host REQUESTED the decision
      // but honestly declines to present it (attention budget exhausted).
      state.declinedSteps.push(step);
      state.attentionRemainingLog.push(attentionRemaining);
      return { presented: false };
    },

    provideOutcome(step: number, result: DecisionResult, _reaction: HostDecisionReaction, nowMs: number) {
      state.outcomeSteps.push(step);
      const servingRole = contentRoleOf(result.selectedExperience?.itemId ?? "");
      const isLastPresentedStep = state.outcomeSteps.length === state.presentations;
      const eventType: "start" | "completion" = state.outcomeSteps.length % 2 === 1 ? "start" : "completion";
      state.outcomeTypes.push(eventType);
      const tier = state.tierLog[step - 1]!;
      return {
        eventId: `ev-l19-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        decisionId: result.decisionId,
        experienceId: result.selectedExperience?.experienceId,
        eventType,
        occurredAt: nowMs,
        evidenceClass: "fixture" as const,
        metrics: {
          tierCode: TIER_CODE[tier],
          apiCallsRemaining: state.apiCallsRemainingLog[step - 1] ?? 0,
          attentionUnitsRemaining: state.attentionRemainingLog[step - 1] ?? 0,
          costUsdTotal: state.costUsdLog[state.costUsdLog.length - 1] ?? 0,
          cpuUnitsUsed: state.cpuUnitsUsedLog[step - 1] ?? 0,
          servingRoleCode: ROLE_CODE[servingRole] ?? 0,
          ...(isLastPresentedStep && state.declinedSteps.length > 0
            ? { degradedSession: 1, declinedStepCount: state.declinedSteps.length }
            : {}),
        },
        idempotencyKey: `idem-out-l19-${step}`,
      };
    },

    providePreferenceDelta(step: number, result: DecisionResult, nowMs: number) {
      const role = contentRoleOf(result.selectedExperience?.itemId ?? "");
      const dimension = `content.${role}`;
      state.deltaDimensions.push(dimension);
      const weight = (state.contentWeights.get(role) ?? 1) + 0.1;
      state.contentWeights.set(role, Math.round(weight * 100) / 100);
      return {
        deltaId: `delta-l19-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        dimension,
        op: "add" as const,
        newValue: Math.round(weight * 100) / 100,
        resultingConfidence: Math.min(0.9, 0.5 + 0.05 * step),
        model: { modelId: "edgecast-content-affinity", version: "1" },
        timestamp: nowMs,
      };
    },
  };

  return {
    host,
    world: {
      get presentations() { return state.presentations; },
      get declinedSteps() { return [...state.declinedSteps]; },
      get tierLog() { return [...state.tierLog]; },
      get candidateSetSizes() { return [...state.candidateSetSizes]; },
      get realizationTiersUsed() { return [...state.realizationTiersUsed]; },
      get apiCallsRemainingLog() { return [...state.apiCallsRemainingLog]; },
      get attentionRemainingLog() { return [...state.attentionRemainingLog]; },
      get costUsdLog() { return [...state.costUsdLog]; },
      get cpuUnitsUsedLog() { return [...state.cpuUnitsUsedLog]; },
      get maxLatencyLog() { return [...state.maxLatencyLog]; },
      get maxCostLog() { return [...state.maxCostLog]; },
      get outcomeSteps() { return [...state.outcomeSteps]; },
      get outcomeTypes() { return [...state.outcomeTypes]; },
      get deltaDimensions() { return [...state.deltaDimensions]; },
      get contentWeights() { return Object.fromEntries([...state.contentWeights.entries()].sort()); },
    },
  };
}

/** Level metadata for wave reporting (mirrors the module's declarations). */
export const level19ResourceConstrainedMeta = {
  level: 19,
  name: "Resource-constrained adaptive system",
  hostAdapterId: "adapter-l19-edgecast-1",
  requiredCapabilities: 12,
  expectedSatisfied: 12,
  expectedPartial: 0,
  expectedMissing: 0,
  expectedGaps: [] as readonly string[],
} as const;
