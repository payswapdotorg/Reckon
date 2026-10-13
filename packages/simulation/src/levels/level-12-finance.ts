/**
 * SIM-004 — Ladder Level 12: the FINANCE / OFFERS synthetic host.
 *
 * Ladder definition (docs/simulations/reckon-complete-ladder.md):
 *   "Finance / offers — strict eligibility, auditability, host
 *    suitability/policy constraints."
 *
 * The host owns a financial-offers product (host-owned offer catalog,
 * KYC/income/jurisdiction gates, suitability matrix, audit ledger —
 * architecture law: Reckon NEVER owns eligibility or rights gates) and
 * asks Reckon for the next offer decision through the PUBLIC surface
 * only: manifest → connect sources → per step: candidates → decision
 * request (objective, attention policy, constraints) → host presents →
 * outcome → preference delta.
 *
 * World-state transitions (all host-side, all deterministic, all
 * step-indexed — fixture-class scripted behaviors, never behavioral
 * claims):
 * - strict eligibility: every request declares the host's eligibility
 *   gates as hard constraints (policy-rights KYC + income gates, custom
 *   risk-band + jurisdiction gates) — the constraints CARRY the gates,
 *   Reckon never grants rights;
 * - host suitability: the host's suitability matrix (offer band vs the
 *   subject's band) runs at PRESENTATION; the premium offers (term
 *   insurance at step 3, brokerage at step 5) fail the band gate and
 *   the host DECLINES presentation (requested-but-not-presented: no
 *   outcome, no delta) — suitability is a HOST responsibility by
 *   architecture;
 * - auditability: every decision lands in the host's append-only audit
 *   ledger (decisionId, experienceId, outcome event linkage, gate
 *   verdicts); a post-acceptance APY change emits an append-oriented
 *   CORRECTION outcome (correctsEventId → the acceptance event);
 * - outcomes: impression (offer shown), conversion (offer accepted
 *   with approval value), correction.
 *
 * Honest gap: the audit trail needs decision/outcome linkage retrieval;
 * the public SDK exposes decision lookup (GET /v1/decisions/{id}) and
 * webhook delivery evidence, but the composed harness path composes
 * only the six standard-loop operations — the manifest declares
 * `evidence-retrieval` partial / COMPOSITION_GAP (domain 12, first
 * occurrence — recorded honestly, not yet a 3-domain candidate).
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
 *   (the offer / eligibility / suitability / audit-ledger code);
 * - `functions` — the named host functions: offerForStep,
 *   offerByItemId, eligibilityConstraints, suitabilityBandFor,
 *   provideDecisionInputs, consumeDecision, provideOutcome,
 *   providePreferenceDelta, createLevel12FinanceHost (9 total).
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
import type { ReckonCompleteProfileDeclarationInput } from "@reckon/contracts";

/** Host-owned identity (host is the identity authority — never Reckon). */
const TENANT: TenantScope = { tenantId: "tenant-l12-finance" };
const SUBJECT: SubjectReference = { kind: "user", ref: "user-l12-member-1" };

// --- glue:adapter:begin ----------------------------------------------------
// The finance world: 5 offers with term realizations, the host's
// eligibility gates (KYC / income / jurisdiction / risk-band — HOST
// authority, never Reckon's), the suitability matrix, and the
// append-only audit ledger.

interface FinanceOffer {
  readonly itemId: string;
  readonly title: string;
  readonly productLine: string;
  readonly suitabilityBand: "standard" | "premium";
  readonly realizationId: string;
  readonly apyPct: number;
  readonly feeUsd: number;
}

const OFFERS: readonly FinanceOffer[] = [
  { itemId: "l12-offer-credit", title: "Cashback credit card", productLine: "credit", suitabilityBand: "standard", realizationId: "l12-term-credit-12", apyPct: 14.9, feeUsd: 0 },
  { itemId: "l12-offer-savings", title: "High-yield savings boost", productLine: "savings", suitabilityBand: "standard", realizationId: "l12-term-savings-12", apyPct: 4.35, feeUsd: 0 },
  { itemId: "l12-offer-insurance", title: "Term life insurance", productLine: "insurance", suitabilityBand: "premium", realizationId: "l12-term-insurance-60", apyPct: 0, feeUsd: 42 },
  { itemId: "l12-offer-loan", title: "Personal consolidation loan", productLine: "lending", suitabilityBand: "standard", realizationId: "l12-term-loan-36", apyPct: 9.8, feeUsd: 60 },
  { itemId: "l12-offer-brokerage", title: "Brokerage intro bundle", productLine: "brokerage", suitabilityBand: "premium", realizationId: "l12-term-brokerage-0", apyPct: 0, feeUsd: 12 },
];

/** The subject's host-declared suitability band (HOST authority). */
const SUBJECT_SUITABILITY_BAND: "standard" | "premium" = "standard";
/** The step at which the accepted offer's APY changes (audit correction). */
const APY_CORRECTION_STEP = 6;
const APY_CORRECTION_DELTA_PCT = 0.25;
/** The accepted-offer step (the conversion the correction references). */
const ACCEPTANCE_STEP = 2;

/** The editorial offer rotation (deterministic, host-ranked). */
function offerForStep(step: number): FinanceOffer {
  return OFFERS[(step - 1) % OFFERS.length]!;
}

/** Host catalog knowledge: the offer behind an item id. */
function offerByItemId(itemId: string | undefined): FinanceOffer | undefined {
  return OFFERS.find((offer) => offer.itemId === itemId);
}

/** Strict eligibility: the host's gates, declared as hard constraints. */
function eligibilityConstraints(): HardConstraint[] {
  return [
    { kind: "policy-rights", gateId: "l12-kyc-verified" },
    { kind: "policy-rights", gateId: "l12-income-verified" },
    { kind: "custom", constraintId: "l12-risk-band", params: { band: "fair" } },
    { kind: "custom", constraintId: "l12-jurisdiction", params: { region: "US-CA" } },
  ];
}

/** The host suitability gate: does the offer's band admit the subject? */
function suitabilityBandFor(offer: FinanceOffer): boolean {
  if (offer.suitabilityBand === "standard") return true;
  return offer.suitabilityBand === SUBJECT_SUITABILITY_BAND;
}

interface AuditLedgerEntry {
  readonly step: number;
  readonly decisionId: string;
  readonly experienceId: string | undefined;
  readonly presented: boolean;
  readonly gate: string;
  readonly outcomeEventId: string | null;
}

interface Level12WorldState {
  presentations: number;
  auditLedger: AuditLedgerEntry[];
  suitabilityDeferrals: number[];
  shownSteps: number[];
  acceptedSteps: number[];
  correctionSteps: number[];
  feedbackSteps: number[];
  outcomeSteps: number[];
  outcomeTypes: string[];
  deltaDimensions: string[];
  productWeights: Map<string, number>;
}

/** Read-only view over the final world state (for deterministic assertions). */
export interface Level12WorldView {
  readonly presentations: number;
  readonly auditLedger: readonly AuditLedgerEntry[];
  readonly suitabilityDeferrals: readonly number[];
  readonly shownSteps: readonly number[];
  readonly acceptedSteps: readonly number[];
  readonly correctionSteps: readonly number[];
  readonly outcomeSteps: readonly number[];
  readonly outcomeTypes: readonly string[];
  readonly deltaDimensions: readonly string[];
  readonly productWeights: Readonly<Record<string, number>>;
}
// --- glue:adapter:end ------------------------------------------------------

/** Host catalog source — connected once, before the loop (public API). */
const LEVEL12_CATALOG: { items: readonly CatalogItemInput[]; realizations: readonly RealizationInput[] } = {
  items: OFFERS.map((offer) => ({
    itemId: offer.itemId,
    kind: "commerce" as const,
    labels: ["offer", offer.productLine],
    attributes: { title: offer.title, productLine: offer.productLine, suitabilityBand: offer.suitabilityBand },
  })),
  realizations: OFFERS.map((offer) => ({
    realizationId: offer.realizationId,
    itemId: offer.itemId,
    kind: "offer-term",
    constraints: { apyPct: offer.apyPct, feeUsd: offer.feeUsd, suitabilityBand: offer.suitabilityBand },
  })),
};

/** The host's honest capability manifest (statuses, evidence, ops, methods). */
const LEVEL12_MANIFEST_CONTENT: SimulationManifestContentInput = {
  manifestVersion: "1",
  hostSystem: {
    hostId: "host-l12-finance",
    name: "Meridian Offers",
    hostAdapterId: "adapter-l12-finance-1",
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
      notes: "realization constraints carry the host-owned term economics (apyPct/feeUsd/suitability band)",
    },
    {
      capability: "candidate-retrieval",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/candidates"],
      sdkMethods: ["candidates.submit"],
      notes: "the editorial offer rotation (host rank) with per-term realizations",
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
      notes: "strict eligibility: policy-rights KYC + income gates and custom risk-band + jurisdiction gates on every request — the constraints CARRY the host gates, Reckon never grants rights",
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
    },
    {
      capability: "schedule-execution",
      status: "supported",
      evidenceClass: "fixture",
      notes: "host-side execution of schedule deltas (QUEUE offer presentation; suitability-failing steps are requested but not presented)",
    },
    {
      capability: "outcome-return",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/outcomes"],
      sdkMethods: ["outcomes.append"],
      notes: "append-oriented APY correction events (correctsEventId) reference the earlier acceptance",
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
      capability: "evidence-retrieval",
      status: "partial",
      evidenceClass: "fixture",
      friction: "COMPOSITION_GAP",
      apiOperations: ["POST /v1/outcomes"],
      sdkMethods: ["outcomes.append"],
      notes:
        "the audit trail needs decision/outcome linkage retrieval; the public SDK exposes decision lookup (GET /v1/decisions/{id} via decisions.get) and webhook delivery evidence, but the SIM-001 harness port composes only the six standard-loop operations — evidence retrieval is not reachable through the composed harness path, so the audit ledger stays host-side",
    },
  ],
};

/** The Level 12 Reckon-Complete profile: what this archetype REQUIRES. */
export const level12FinanceProfile: ReckonCompleteProfileDeclarationInput = {
  profileId: "profile-l12-finance",
  name: "Finance / offers",
  description: "SIM-004 ladder level 12 — strict eligibility, auditability, host suitability/policy constraints.",
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
    { capability: "schedule-execution" },
    { capability: "outcome-return" },
    { capability: "preference-feedback" },
    { capability: "conformance-verification" },
    { capability: "evidence-retrieval" },
  ],
  requiredEvidenceClass: "fixture",
  declaredAt: 1_000,
};

/** A fresh Level 12 host (fresh world state — replay-safe by construction). */
export interface Level12Host {
  readonly host: SimulationHostAdapter;
  readonly world: Level12WorldView;
}

export function createLevel12FinanceHost(): Level12Host {
  const state: Level12WorldState = {
    presentations: 0,
    auditLedger: [],
    suitabilityDeferrals: [],
    shownSteps: [],
    acceptedSteps: [],
    correctionSteps: [],
    feedbackSteps: [],
    outcomeSteps: [],
    outcomeTypes: [],
    deltaDimensions: [],
    productWeights: new Map([["brokerage", 1], ["credit", 1], ["insurance", 1], ["lending", 1], ["savings", 1]]),
  };
  /** The acceptance event id (the audit correction references it). */
  let acceptanceEventId = "";

  const host: SimulationHostAdapter = {
    hostAdapterId: "adapter-l12-finance-1",
    hostSystem: {
      hostId: "host-l12-finance",
      name: "Meridian Offers",
      version: "0.1.0",
    },
    glue: { functions: 9, loc: 400, customAdapterLoc: 71 },
    manifestContent: LEVEL12_MANIFEST_CONTENT,
    catalog: {
      items: LEVEL12_CATALOG.items.map((item) => ({ ...item })),
      realizations: LEVEL12_CATALOG.realizations.map((realization) => ({ ...realization })),
    },

    provideDecisionInputs(step: number): HostDecisionInputs {
      const offer = offerForStep(step);
      return {
        contextId: `ctx-l12-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        objective: {
          objectiveId: "obj-l12-right-offer",
          version: "1",
          kind: "compare",
          params: { mode: "offer-eligibility" },
        },
        attentionPolicy: {
          policyId: "ap-l12-mindful",
          version: "1",
          style: "mindful",
          params: { maxOffersPerSession: 6 },
        },
        candidates: {
          setId: `cs-l12-${step}`,
          candidates: [
            { itemId: offer.itemId, realizationIds: [offer.realizationId], source: "host-editorial-offer", rankHint: 1 },
          ],
        },
        constraints: eligibilityConstraints(),
        policySelector: { policyId: "meridian-offers-v1" },
      };
    },

    consumeDecision(step: number, result: DecisionResult): HostDecisionReaction {
      const offer = offerByItemId(result.selectedExperience?.itemId);
      state.presentations += 1;
      const suitable = offer !== undefined && suitabilityBandFor(offer);
      if (!suitable) {
        // Host suitability/policy constraint: the selected offer fails the
        // band gate — requested-but-not-presented (no outcome, no delta).
        state.suitabilityDeferrals.push(step);
        state.auditLedger.push({
          step,
          decisionId: result.decisionId,
          experienceId: result.selectedExperience?.experienceId,
          presented: false,
          gate: "suitability-band",
          outcomeEventId: null,
        });
        return { presented: false };
      }
      state.auditLedger.push({
        step,
        decisionId: result.decisionId,
        experienceId: result.selectedExperience?.experienceId,
        presented: true,
        gate: "suitability-band:pass",
        outcomeEventId: null,
      });
      return { presented: true };
    },

    provideOutcome(step: number, result: DecisionResult, _reaction: HostDecisionReaction, nowMs: number) {
      state.outcomeSteps.push(step);
      const offer = offerByItemId(result.selectedExperience?.itemId) ?? OFFERS[0]!;
      const accepted = step === ACCEPTANCE_STEP;
      const correction = step === APY_CORRECTION_STEP;
      let eventType: "impression" | "conversion" | "correction" = "impression";
      if (accepted) {
        eventType = "conversion";
        state.acceptedSteps.push(step);
      } else if (correction) {
        eventType = "correction";
        state.correctionSteps.push(step);
      } else {
        state.shownSteps.push(step);
      }
      state.outcomeTypes.push(eventType);
      const outcome = {
        eventId: `ev-l12-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        decisionId: result.decisionId,
        experienceId: result.selectedExperience?.experienceId,
        eventType,
        occurredAt: nowMs,
        evidenceClass: "fixture" as const,
        metrics: {
          apyPct: offer.apyPct + (correction ? APY_CORRECTION_DELTA_PCT : 0),
          feeUsd: offer.feeUsd,
          approvalValueUsd: accepted ? 500 : 0,
          auditLedgerSize: state.auditLedger.length,
        },
        ...(eventType === "correction" ? { customEventType: "apy-adjustment" } : {}),
        ...(eventType === "correction" && acceptanceEventId !== "" ? { correctsEventId: acceptanceEventId } : {}),
        idempotencyKey: `idem-out-l12-${step}`,
      };
      if (accepted) acceptanceEventId = outcome.eventId;
      // Auditability: the ledger records the decision/outcome linkage.
      const ledgerIndex = state.auditLedger.findIndex((entry) => entry.step === step);
      if (ledgerIndex >= 0) {
        state.auditLedger[ledgerIndex] = { ...state.auditLedger[ledgerIndex]!, outcomeEventId: outcome.eventId };
      }
      return outcome;
    },

    providePreferenceDelta(step: number, result: DecisionResult, nowMs: number) {
      const offer = offerByItemId(result.selectedExperience?.itemId) ?? OFFERS[0]!;
      const dimension = `product.${offer.productLine}`;
      state.deltaDimensions.push(dimension);
      const weight = (state.productWeights.get(offer.productLine) ?? 1) + 0.2;
      state.productWeights.set(offer.productLine, Math.round(weight * 100) / 100);
      return {
        deltaId: `delta-l12-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        dimension,
        op: "add" as const,
        newValue: Math.round(weight * 100) / 100,
        resultingConfidence: Math.min(0.9, 0.5 + 0.06 * step),
        model: { modelId: "meridian-product-affinity", version: "1" },
        timestamp: nowMs,
      };
    },
  };

  return {
    host,
    world: {
      get presentations() { return state.presentations; },
      get auditLedger() { return state.auditLedger.map((entry) => ({ ...entry })); },
      get suitabilityDeferrals() { return [...state.suitabilityDeferrals]; },
      get shownSteps() { return [...state.shownSteps]; },
      get acceptedSteps() { return [...state.acceptedSteps]; },
      get correctionSteps() { return [...state.correctionSteps]; },
      get outcomeSteps() { return [...state.outcomeSteps]; },
      get outcomeTypes() { return [...state.outcomeTypes]; },
      get deltaDimensions() { return [...state.deltaDimensions]; },
      get productWeights() { return Object.fromEntries([...state.productWeights.entries()].sort()); },
    },
  };
}

/** Level metadata for wave reporting (mirrors the module's declarations). */
export const level12FinanceMeta = {
  level: 12,
  name: "Finance / offers",
  hostAdapterId: "adapter-l12-finance-1",
  requiredCapabilities: 13,
  expectedSatisfied: 12,
  expectedPartial: 1,
  expectedMissing: 0,
  expectedGaps: ["evidence-retrieval|COMPOSITION_GAP"] as readonly string[],
} as const;
