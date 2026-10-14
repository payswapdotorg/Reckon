/**
 * SIM-005 — Ladder Level 13: the HEALTHCARE INFORMATION synthetic host.
 *
 * Ladder definition (docs/simulations/reckon-complete-ladder.md):
 *   "Healthcare information — high-stakes uncertainty, provenance,
 *    consent, host safety gates."
 *
 * The host owns a patient-facing care-information product (host-owned
 * content catalog, provenance chains, consent ledger, clinical safety
 * board — architecture law: Reckon NEVER owns consent, rights or safety
 * authority) and asks Reckon for the next information decision through
 * the PUBLIC surface only: manifest → connect sources → per step:
 * candidates → decision request (objective, attention policy,
 * constraints) → host presents → outcome → preference delta.
 *
 * World-state transitions (all host-side, all deterministic, all
 * step-indexed — fixture-class scripted behaviors, never behavioral
 * claims):
 * - provenance: every recommended item carries its provenance chain
 *   (source system, review board, evidence grade) in the host catalog;
 *   every presented item lands in the host's append-only provenance
 *   ledger with decision linkage, and every outcome's metrics carry the
 *   item's uncertainty score and evidence grade — provenance is never
 *   dropped on the floor;
 * - consent gates decision eligibility: the subject's granted consent
 *   scopes (["general"]) are HOST authority; the genetic-screening
 *   explainer (scope "genetic") is requested at step 4 but the consent
 *   gate DENIES presentation (requested-but-not-presented: no outcome,
 *   no delta) — consent denial is recorded in the consent ledger;
 * - host safety gate veto: the subject reports starting an
 *   anticoagulant at step 6 (scripted world event); the requested
 *   generic anticoagulant-diet guide FAILS the clinical safety board's
 *   interaction gate and is vetoed (requested-but-not-presented: no
 *   outcome, no delta) — the safety gate can always veto;
 * - high-stakes uncertainty surfaced, never hidden: every outcome
 *   carries metrics.uncertaintyScore; the imaging prep guide's
 *   uncertainty (0.45, renal-function dependent) exceeds the 0.4
 *   disclosure threshold at its presentation (step 3) and at its
 *   guidance update (step 7) — both outcomes carry the surfaced
 *   uncertainty flag;
 * - the step-7 guidance update (the radiology review board updated the
 *   contrast guidance) is an append-oriented CORRECTION outcome
 *   (correctsEventId → the step-3 presentation event);
 * - the urgent medication recall at step 5 rides the well-known
 *   time-critical source and INTERRUPTs the live reading (checkpoint
 *   retained) — a safety-critical interrupt is the one interrupt the
 *   balanced attention policy admits.
 *
 * Honest gap: the provenance/consent audit ledger needs
 * decision/outcome linkage retrieval; the public SDK exposes decision
 * lookup (GET /v1/decisions/{id}), but the composed harness path
 * composes only the six standard-loop operations — the manifest
 * declares `evidence-retrieval` partial / COMPOSITION_GAP (domain 13,
 * second occurrence after Wave B level 12 — recorded honestly, not yet
 * a 3-domain candidate at declaration time).
 *
 * LAWS obeyed (SIM-005 work order):
 * - zero internal Reckon imports — only @reckon/contracts types + the
 *   harness host-adapter seam (enforced by the conformance scanner);
 * - no Math.random, no Date.now / wall-clock reads, no LLM/network;
 * - every synthetic outcome carries evidenceClass "fixture" — synthetic
 *   host output NEVER becomes observed evidence;
 * - deterministic: a fresh host from this factory + the same run seed
 *   yields byte-identical records (replay gate).
 *
 * Glue declaration (honest, host-declared; mechanically re-verified by
 * packages/simulation/test/levels-wave-c.test.ts):
 * - `loc` — comment-stripped non-blank lines of THIS module;
 * - `customAdapterLoc` — lines between the `glue:adapter` markers below
 *   (the care-information / consent / safety / provenance code);
 * - `functions` — the named host functions: infoByItemId,
 *   consentScopeAllows, safetyGateAllows, provenanceOf, careCandidates,
 *   careConstraints, provideDecisionInputs, consumeDecision,
 *   provideOutcome, providePreferenceDelta,
 *   createLevel13HealthcareHost (11 total).
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
const TENANT: TenantScope = { tenantId: "tenant-l13-healthcare" };
const SUBJECT: SubjectReference = { kind: "user", ref: "user-l13-patient-1" };

// --- glue:adapter:begin ----------------------------------------------------
// The care-information world: 6 information items, each with its
// provenance chain (source system, review board, evidence grade),
// consent scope, uncertainty score and reading time. The consent
// ledger, the clinical safety board and the provenance ledger are
// HOST-owned (architecture law — Reckon never owns consent, rights or
// safety authority).

interface CareInfoItem {
  readonly itemId: string;
  readonly title: string;
  readonly topic: string;
  readonly consentScope: string;
  readonly realizationId: string;
  readonly readingMinutes: number;
  /** Host-tracked uncertainty of the information's applicability (0..1). */
  readonly uncertaintyScore: number;
  readonly sourceSystem: string;
  readonly reviewBoard: string;
  readonly evidenceGrade: "A" | "B";
}

const CARE_ITEMS: readonly CareInfoItem[] = [
  { itemId: "l13-info-appointment-prep", title: "Preparing for your appointment", topic: "appointments", consentScope: "general", realizationId: "l13-real-appointment-prep-standard", readingMinutes: 4, uncertaintyScore: 0.2, sourceSystem: "care-ops-content", reviewBoard: "clinical-education-board", evidenceGrade: "B" },
  { itemId: "l13-info-imaging-contrast", title: "Imaging scan preparation guide", topic: "imaging", consentScope: "general", realizationId: "l13-real-imaging-standard", readingMinutes: 9, uncertaintyScore: 0.45, sourceSystem: "radiology-guidelines", reviewBoard: "radiology-review-board", evidenceGrade: "A" },
  { itemId: "l13-info-genetic-screening", title: "Genetic screening explainer", topic: "genetics", consentScope: "genetic", realizationId: "l13-real-genetic-standard", readingMinutes: 12, uncertaintyScore: 0.35, sourceSystem: "genomics-reference", reviewBoard: "genomics-review-board", evidenceGrade: "A" },
  { itemId: "l13-info-med-recall", title: "Urgent medication recall notice", topic: "medication-safety", consentScope: "general", realizationId: "l13-real-recall-urgent", readingMinutes: 3, uncertaintyScore: 0.1, sourceSystem: "safety-notifications", reviewBoard: "drug-safety-board", evidenceGrade: "A" },
  { itemId: "l13-info-anticoagulant-diet", title: "Anticoagulant diet guidance", topic: "medication-safety", consentScope: "general", realizationId: "l13-real-diet-standard", readingMinutes: 7, uncertaintyScore: 0.3, sourceSystem: "clinical-education", reviewBoard: "clinical-education-board", evidenceGrade: "B" },
  { itemId: "l13-info-telehealth-howto", title: "How to join a telehealth visit", topic: "telehealth", consentScope: "general", realizationId: "l13-real-telehealth-standard", readingMinutes: 5, uncertaintyScore: 0.15, sourceSystem: "care-ops-content", reviewBoard: "clinical-education-board", evidenceGrade: "B" },
];

/** The subject's granted consent scopes (HOST authority, never Reckon's). */
const GRANTED_CONSENT_SCOPES: readonly string[] = ["general"];
/** Uncertainty above this threshold forces a disclosure (never hidden). */
const UNCERTAINTY_DISCLOSURE_THRESHOLD = 0.4;
/** The step at which the subject reports starting an anticoagulant. */
const ANTICOAGULANT_REPORT_STEP = 6;
/** The step at which the radiology board updates the imaging guidance. */
const GUIDANCE_UPDATE_STEP = 7;
/** The scripted editorial rotation of requested items (deterministic). */
const REQUESTED_ITEM_BY_STEP: readonly string[] = [
  "l13-info-appointment-prep", // 1
  "l13-info-appointment-prep", // 2
  "l13-info-imaging-contrast", // 3
  "l13-info-genetic-screening", // 4
  "l13-info-med-recall", // 5
  "l13-info-anticoagulant-diet", // 6
  "l13-info-imaging-contrast", // 7
];

interface ProvenanceLedgerEntry {
  readonly step: number;
  readonly itemId: string;
  readonly sourceSystem: string;
  readonly reviewBoard: string;
  readonly evidenceGrade: string;
  readonly decisionId: string;
}

interface ConsentLedgerEntry {
  readonly step: number;
  readonly scope: string;
  readonly granted: boolean;
}

interface Level13WorldState {
  presentations: number;
  provenanceLedger: ProvenanceLedgerEntry[];
  consentLedger: ConsentLedgerEntry[];
  consentDeferrals: number[];
  safetyVetoSteps: number[];
  anticoagulantReportedAtStep: number;
  interruptionSteps: number[];
  correctionSteps: number[];
  progressSteps: number[];
  uncertaintySurfacedSteps: number[];
  outcomeSteps: number[];
  outcomeTypes: string[];
  deltaDimensions: string[];
  topicWeights: Map<string, number>;
}

/** Read-only view over the final world state (for deterministic assertions). */
export interface Level13WorldView {
  readonly presentations: number;
  readonly provenanceLedger: readonly ProvenanceLedgerEntry[];
  readonly consentLedger: readonly ConsentLedgerEntry[];
  readonly consentDeferrals: readonly number[];
  readonly safetyVetoSteps: readonly number[];
  readonly anticoagulantReportedAtStep: number;
  readonly interruptionSteps: readonly number[];
  readonly correctionSteps: readonly number[];
  readonly progressSteps: readonly number[];
  readonly uncertaintySurfacedSteps: readonly number[];
  readonly outcomeSteps: readonly number[];
  readonly outcomeTypes: readonly string[];
  readonly deltaDimensions: readonly string[];
  readonly topicWeights: Readonly<Record<string, number>>;
}

/** Host catalog knowledge: the item behind an item id. */
function infoByItemId(itemId: string | undefined): CareInfoItem | undefined {
  return CARE_ITEMS.find((item) => item.itemId === itemId);
}

/** The consent gate: is the item's scope granted to the subject? */
function consentScopeAllows(item: CareInfoItem): boolean {
  return GRANTED_CONSENT_SCOPES.includes(item.consentScope);
}

/** The clinical safety board gate: can this item be presented now? */
function safetyGateAllows(item: CareInfoItem, anticoagulantReported: boolean): boolean {
  if (!anticoagulantReported) return true;
  // The generic diet guidance is unsafe while a new anticoagulant is
  // unreviewed — the safety board vetoes pending clinician review.
  return item.itemId !== "l13-info-anticoagulant-diet";
}

/** The item's provenance chain (host-owned catalog metadata). */
function provenanceOf(item: CareInfoItem): {
  readonly sourceSystem: string;
  readonly reviewBoard: string;
  readonly evidenceGrade: string;
} {
  return { sourceSystem: item.sourceSystem, reviewBoard: item.reviewBoard, evidenceGrade: item.evidenceGrade };
}

/** Retrieval: the requested information item for this step. */
function careCandidates(step: number): {
  readonly itemId: string;
  readonly realizationIds: string[];
  readonly source: string;
  readonly rankHint: number;
}[] {
  const itemId = REQUESTED_ITEM_BY_STEP[step - 1]!;
  let source = "host-care-rank";
  if (step === 2) {
    source = "host-care-track";
  } else if (step === 5) {
    source = "host-time-critical";
  } else if (step === GUIDANCE_UPDATE_STEP) {
    source = "host-guidance-update";
  }
  const item = infoByItemId(itemId)!;
  return [{ itemId: item.itemId, realizationIds: [item.realizationId], source, rankHint: 1 }];
}

/** High-stakes constraints on every request (consent + safety + latency). */
function careConstraints(item: CareInfoItem): HardConstraint[] {
  return [
    { kind: "policy-rights", gateId: `l13-consent-${item.consentScope}` },
    { kind: "custom", constraintId: "l13-safety-review", params: { gate: "clinical-safety-board" } },
    { kind: "max-latency", latencyMs: 200 },
    { kind: "time-window", untilMs: 3_600_000 },
  ];
}
// --- glue:adapter:end ------------------------------------------------------

/** Host catalog source — connected once, before the loop (public API). */
const LEVEL13_CATALOG: { items: readonly CatalogItemInput[]; realizations: readonly RealizationInput[] } = {
  items: CARE_ITEMS.map((item) => ({
    itemId: item.itemId,
    kind: "article" as const,
    labels: ["care-information", item.topic, `consent-${item.consentScope}`],
    attributes: {
      title: item.title,
      topic: item.topic,
      consentScope: item.consentScope,
      readingMinutes: item.readingMinutes,
      uncertaintyScore: item.uncertaintyScore,
      sourceSystem: item.sourceSystem,
      reviewBoard: item.reviewBoard,
      evidenceGrade: item.evidenceGrade,
    },
  })),
  realizations: CARE_ITEMS.map((item) => ({
    realizationId: item.realizationId,
    itemId: item.itemId,
    kind: "care-information",
    constraints: {
      readingMinutes: item.readingMinutes,
      evidenceGrade: item.evidenceGrade,
      uncertaintyScore: item.uncertaintyScore,
    },
  })),
};

/** The host's honest capability manifest (statuses, evidence, ops, methods). */
const LEVEL13_MANIFEST_CONTENT: SimulationManifestContentInput = {
  manifestVersion: "1",
  hostSystem: {
    hostId: "host-l13-healthcare",
    name: "Halo Health Companion",
    hostAdapterId: "adapter-l13-healthcare-1",
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
      notes: "realization constraints carry the host-owned reading time, evidence grade and uncertainty score of every information item",
    },
    {
      capability: "candidate-retrieval",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/candidates"],
      sdkMethods: ["candidates.submit"],
      notes: "the editorial care rotation with consent- and safety-gated items (requested-but-not-presented when a host gate vetoes)",
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
      notes: "policy-rights consent gate + custom clinical-safety-board gate + max-latency budget + session time-window on every request — the constraints CARRY the host gates, Reckon never grants consent or safety",
    },
    {
      capability: "attention-policy",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "balanced attention with a bounded safety-interrupt budget (the urgent recall INTERRUPTs the live reading)",
    },
    {
      capability: "decision-request",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "requests carry currentExperience for the live reading (SWITCH on new guides, INTERRUPT on the urgent recall)",
    },
    {
      capability: "schedule-execution",
      status: "supported",
      evidenceClass: "fixture",
      notes: "host-side execution of schedule deltas (QUEUE first guide, CONTINUE reading progress, SWITCH new guides, INTERRUPT urgent recall with retained checkpoint)",
    },
    {
      capability: "outcome-return",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/outcomes"],
      sdkMethods: ["outcomes.append"],
      notes: "append-oriented guidance-update correction events (correctsEventId) reference the earlier presentation; uncertainty scores ride every outcome's metrics",
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
        "the provenance/consent audit ledger needs decision/outcome linkage retrieval; the public SDK exposes decision lookup (GET /v1/decisions/{id} via decisions.get), but the SIM-001 harness port composes only the six standard-loop operations — evidence retrieval is not reachable through the composed harness path, so the provenance ledger stays host-side, second domain after Wave B level 12",
    },
  ],
};

/** The Level 13 Reckon-Complete profile: what this archetype REQUIRES. */
export const level13HealthcareProfile: ReckonCompleteProfileDeclarationInput = {
  profileId: "profile-l13-healthcare",
  name: "Healthcare information",
  description: "SIM-005 ladder level 13 — high-stakes uncertainty, provenance, consent, host safety gates.",
  ladderLevel: 13,
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

/** A fresh Level 13 host (fresh world state — replay-safe by construction). */
export interface Level13Host {
  readonly host: SimulationHostAdapter;
  readonly world: Level13WorldView;
}

export function createLevel13HealthcareHost(): Level13Host {
  const state: Level13WorldState = {
    presentations: 0,
    provenanceLedger: [],
    consentLedger: [],
    consentDeferrals: [],
    safetyVetoSteps: [],
    anticoagulantReportedAtStep: 0,
    interruptionSteps: [],
    correctionSteps: [],
    progressSteps: [],
    uncertaintySurfacedSteps: [],
    outcomeSteps: [],
    outcomeTypes: [],
    deltaDimensions: [],
    topicWeights: new Map([
      ["appointments", 1],
      ["genetics", 1],
      ["imaging", 1],
      ["medication-safety", 1],
      ["telehealth", 1],
    ]),
  };
  /** The experience the previous PRESENTED decision selected (the live reading). */
  let liveExperience: ExperienceInput | undefined;
  /** The imaging presentation event id (the guidance update corrects it). */
  let imagingEventId = "";

  const host: SimulationHostAdapter = {
    hostAdapterId: "adapter-l13-healthcare-1",
    hostSystem: {
      hostId: "host-l13-healthcare",
      name: "Halo Health Companion",
      version: "0.1.0",
    },
    glue: { functions: 11, loc: 503, customAdapterLoc: 121 },
    manifestContent: LEVEL13_MANIFEST_CONTENT,
    catalog: {
      items: LEVEL13_CATALOG.items.map((item) => ({ ...item })),
      realizations: LEVEL13_CATALOG.realizations.map((realization) => ({ ...realization })),
    },

    provideDecisionInputs(step: number): HostDecisionInputs {
      // World transition: the subject reports starting an anticoagulant
      // at step 6 (fixture world event — host authority, honest fixture).
      if (step === ANTICOAGULANT_REPORT_STEP && state.anticoagulantReportedAtStep === 0) {
        state.anticoagulantReportedAtStep = step;
      }
      const item = infoByItemId(REQUESTED_ITEM_BY_STEP[step - 1])!;
      return {
        contextId: `ctx-l13-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        objective: {
          objectiveId: "obj-l13-informed-safe-patient",
          version: "1",
          kind: "stay-informed",
          params: { domain: "care-information", stakes: "high" },
        },
        attentionPolicy: {
          policyId: "ap-l13-patient-gentle",
          version: "1",
          style: "balanced",
          params: { maxSafetyInterruptsPerSession: 1 },
        },
        candidates: {
          setId: `cs-l13-${step}`,
          candidates: careCandidates(step).map((candidate) => ({ ...candidate })),
        },
        constraints: careConstraints(item),
        policySelector: { policyId: "halo-care-info-v1" },
        ...(liveExperience !== undefined ? { currentExperience: liveExperience } : {}),
      };
    },

    consumeDecision(step: number, result: DecisionResult): HostDecisionReaction {
      const item = infoByItemId(result.selectedExperience?.itemId);
      state.presentations += 1;
      // Consent gate: the requested item's scope must be granted.
      const consentOk = item !== undefined && consentScopeAllows(item);
      state.consentLedger.push({
        step,
        scope: item?.consentScope ?? "unknown",
        granted: consentOk,
      });
      if (!consentOk) {
        // Consent gates decision eligibility: requested-but-not-
        // presented (no outcome, no delta) — HOST authority.
        state.consentDeferrals.push(step);
        return { presented: false };
      }
      // Host safety gate: the clinical safety board can always veto.
      const safetyOk = item !== undefined && safetyGateAllows(item, state.anticoagulantReportedAtStep > 0);
      if (!safetyOk) {
        // Safety veto: requested-but-not-presented (no outcome, no
        // delta) — the live reading is NOT disturbed.
        state.safetyVetoSteps.push(step);
        return { presented: false };
      }
      if (result.action === "INTERRUPT") {
        // The urgent recall interrupts the live reading.
        state.interruptionSteps.push(step);
      } else if (result.action === "CONTINUE") {
        state.progressSteps.push(step);
      }
      // Provenance ledger: every presented item, with decision linkage.
      state.provenanceLedger.push({
        step,
        itemId: item?.itemId ?? "",
        sourceSystem: item?.sourceSystem ?? "",
        reviewBoard: item?.reviewBoard ?? "",
        evidenceGrade: item?.evidenceGrade ?? "",
        decisionId: result.decisionId,
      });
      liveExperience = result.selectedExperience;
      return { presented: true };
    },

    provideOutcome(step: number, result: DecisionResult, _reaction: HostDecisionReaction, nowMs: number) {
      state.outcomeSteps.push(step);
      const item = infoByItemId(result.selectedExperience?.itemId) ?? CARE_ITEMS[0]!;
      const guidanceUpdate = step === GUIDANCE_UPDATE_STEP;
      const interrupted = state.interruptionSteps.includes(step);
      const progressed = state.progressSteps.includes(step);
      const uncertaintySurfaced = item.uncertaintyScore > UNCERTAINTY_DISCLOSURE_THRESHOLD;
      if (uncertaintySurfaced) {
        state.uncertaintySurfacedSteps.push(step);
      }
      let eventType: "start" | "impression" | "correction" | "interruption-accept" | "custom" = "custom";
      let customEventType: string | undefined = "reading-progress";
      if (guidanceUpdate) {
        eventType = "correction";
        customEventType = "guidance-update";
        state.correctionSteps.push(step);
      } else if (interrupted) {
        eventType = "interruption-accept";
        customEventType = undefined;
      } else if (progressed) {
        eventType = "custom";
        customEventType = "reading-progress";
      } else if (state.outcomeSteps.length === 1) {
        eventType = "start";
        customEventType = undefined;
      } else {
        eventType = "impression";
        customEventType = undefined;
      }
      state.outcomeTypes.push(eventType);
      const outcome = {
        eventId: `ev-l13-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        decisionId: result.decisionId,
        experienceId: result.selectedExperience?.experienceId,
        eventType,
        ...(customEventType !== undefined ? { customEventType } : {}),
        occurredAt: nowMs,
        evidenceClass: "fixture" as const,
        metrics: {
          readingMinutes: item.readingMinutes,
          uncertaintyScore: item.uncertaintyScore,
          uncertaintySurfaced: uncertaintySurfaced ? 1 : 0,
          evidenceGradeRank: item.evidenceGrade === "A" ? 1 : 2,
          provenanceEntries: state.provenanceLedger.length,
          safetyCritical: interrupted ? 1 : 0,
        },
        ...(eventType === "correction" && imagingEventId !== "" ? { correctsEventId: imagingEventId } : {}),
        idempotencyKey: `idem-out-l13-${step}`,
      };
      if (item.itemId === "l13-info-imaging-contrast" && imagingEventId === "") {
        imagingEventId = outcome.eventId;
      }
      return outcome;
    },

    providePreferenceDelta(step: number, result: DecisionResult, nowMs: number) {
      const item = infoByItemId(result.selectedExperience?.itemId) ?? CARE_ITEMS[0]!;
      const dimension = `topic.${item.topic}`;
      state.deltaDimensions.push(dimension);
      const weight = (state.topicWeights.get(item.topic) ?? 1) + 0.15;
      state.topicWeights.set(item.topic, Math.round(weight * 100) / 100);
      return {
        deltaId: `delta-l13-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        dimension,
        op: "add" as const,
        newValue: Math.round(weight * 100) / 100,
        resultingConfidence: Math.min(0.9, 0.5 + 0.05 * step),
        model: { modelId: "halo-care-topic-affinity", version: "1" },
        timestamp: nowMs,
      };
    },
  };

  return {
    host,
    world: {
      get presentations() { return state.presentations; },
      get provenanceLedger() { return state.provenanceLedger.map((entry) => ({ ...entry })); },
      get consentLedger() { return state.consentLedger.map((entry) => ({ ...entry })); },
      get consentDeferrals() { return [...state.consentDeferrals]; },
      get safetyVetoSteps() { return [...state.safetyVetoSteps]; },
      get anticoagulantReportedAtStep() { return state.anticoagulantReportedAtStep; },
      get interruptionSteps() { return [...state.interruptionSteps]; },
      get correctionSteps() { return [...state.correctionSteps]; },
      get progressSteps() { return [...state.progressSteps]; },
      get uncertaintySurfacedSteps() { return [...state.uncertaintySurfacedSteps]; },
      get outcomeSteps() { return [...state.outcomeSteps]; },
      get outcomeTypes() { return [...state.outcomeTypes]; },
      get deltaDimensions() { return [...state.deltaDimensions]; },
      get topicWeights() { return Object.fromEntries([...state.topicWeights.entries()].sort()); },
    },
  };
}

/** Level metadata for wave reporting (mirrors the module's declarations). */
export const level13HealthcareMeta = {
  level: 13,
  name: "Healthcare information",
  hostAdapterId: "adapter-l13-healthcare-1",
  requiredCapabilities: 13,
  expectedSatisfied: 12,
  expectedPartial: 1,
  expectedMissing: 0,
  expectedGaps: ["evidence-retrieval|COMPOSITION_GAP"] as readonly string[],
} as const;
