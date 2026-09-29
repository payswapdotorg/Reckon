/**
 * W3-005/W3-006 — the adapter declaration surface.
 *
 * HOST-AUTHORITY LAW (AGENTS.md ground rule 6): host systems remain
 * authoritative for identity, consent, catalog, rights, provider
 * access, delivery, campaign policy and payment. Every adapter must
 * DECLARE its capabilities, authorization requirements, limits,
 * live-verification status, provenance and failure semantics as typed
 * constants. Fixture evidence never proves a live provider integration
 * — the live-verification status type is narrowed to "fixture-only"
 * until a real provider path is verified (production truth requires
 * real authorization, observed output, measured latency and failure
 * behavior).
 *
 * Every adapter in this package is a pure deterministic mapper: it
 * NEVER calls a live provider, NEVER verifies rights, NEVER delivers
 * content and NEVER contains core ranking logic (forbidden dependency
 * direction: domain-specific adapter → core ranking logic).
 */
import type { PlanState, SwitchEvaluationInput } from "../../scheduler/src/index.js";
import type { OBSERVED_EVIDENCE_CLASSES } from "@reckon/contracts";

/**
 * Live-verification status. Deliberately narrowed: nothing in this
 * package has been verified against a live provider, so the only
 * honest value is "fixture-only". Widening requires an Architecture
 * Change Record with real acceptance evidence.
 */
export type AdapterLiveVerificationStatus = "fixture-only";

/** A host- or Reckon-enforced authorization requirement (declared, never bypassed). */
export interface AdapterAuthorizationRequirement {
  /** The protected resource this requirement guards. */
  resource: string;
  /** What must hold before the adapter's mapped data may be used. */
  requirement: string;
  /** Who enforces it — the host stays authoritative for its own gates. */
  enforcedBy: "host" | "reckon-api";
}

/** Declared adapter limits (enforced with typed LIMIT_EXCEEDED errors). */
export interface AdapterLimits {
  /** Maximum host items accepted in one catalog/guide import batch. */
  maxItemsPerImport: number;
  /** Maximum delivery options per host item. */
  maxRealizationsPerItem: number;
  /** Maximum retrieval rows accepted in one candidate-set mapping. */
  maxCandidatesPerSet: number;
  /** Mapping latency BUDGET (a target, never a measurement — measured
   *  latency is only claimed with production-observed evidence). */
  mappingLatencyBudgetMs: number;
}

/** Declared failure semantics (fail-closed, honest absence). */
export interface AdapterFailureSemantics {
  /** Malformed host input → typed INVALID_INPUT error; nothing mapped. */
  invalidInput: "typed-error";
  /** Unknown host vocabulary → typed error; never silently coerced. */
  unknownVocabulary: "typed-error";
  /** References to items with no host capability truth map as
   *  unavailable (honest absence) — records are never invented. */
  unavailableData: "honest-absence";
  /** Import batches are all-or-nothing; partial imports are rejected. */
  partialImport: "rejected";
  /** The adapter never performs live provider calls (fixture-only). */
  liveProviderCalls: "none";
  /** Non-observed evidence classes on the host observation channel are
   *  typed errors — simulated/counterfactual/fixture records can never
   *  masquerade as observed outcomes (architecture-lock #20). */
  nonObservedEvidence: "typed-error";
}

/** Declared data/right provenance (host-authoritative everywhere). */
export interface AdapterProvenanceDeclaration {
  /** The host owns every record the adapter maps. */
  dataOwnership: "host";
  /** Where catalog data comes from (enters via adapter input types). */
  catalogSource: string;
  /** Rights metadata source — the adapter only passes host-declared
   *  rights tags through; it never verifies rights. */
  rightsSource: string;
  /** Delivery source — the host player is the delivery authority. */
  deliverySource: string;
  /** Identity source — host identity system, never the adapter. */
  identitySource: string;
  /** Consent source — host consent system, never the adapter. */
  consentSource: string;
}

/** The typed adapter declaration required of every reference adapter. */
export interface AdapterDeclaration {
  adapterId: string;
  /** Provider-neutral domain label (e.g. "media"). */
  domain: string;
  /** Reckon contract version the adapter maps into. */
  contractVersion: string;
  /** Capabilities this adapter implements. */
  supportedCapabilities: readonly string[];
  /** Capabilities explicitly NOT provided (host stays authoritative). */
  unsupportedCapabilities: readonly string[];
  /** Authorization requirements that must hold before use. */
  authorizationRequirements: readonly AdapterAuthorizationRequirement[];
  /** Rate/size/latency limits enforced by the adapter. */
  limits: AdapterLimits;
  /** Live-verification status — fixture-only until proven otherwise. */
  liveVerification: {
    status: AdapterLiveVerificationStatus;
    evidenceClass: "fixture";
    note: string;
  };
  /** Data/right provenance. */
  provenance: AdapterProvenanceDeclaration;
  /** Failure semantics. */
  failureSemantics: AdapterFailureSemantics;
}

/**
 * Scheduler-relevant intents extracted from a host action
 * (W3-005/W3-006 "host actions → scheduler action inputs").
 *
 * - `planState` — host-driven plan-state transition. "Play"/"tune" and
 *   "queue"/"enqueue" are HOST-authoritative (the host player is the
 *   delivery authority); the adapter records them as plan-state truth,
 *   never as scheduler decisions.
 * - `switch` — caller-supplied switch numbers (SEPARATION LAW, lock
 *   #9: every number is host-supplied; the scheduler never derives
 *   them). The scheduler alone decides SWITCH/SUGGEST/HOLD.
 * - `interruptRequested` / `endRequested` / `resumeTokens` — the
 *   host-requested flags and caller-supplied resume tokens accepted by
 *   the scheduler (resume tokens are never invented).
 */
export interface HostSchedulerIntents {
  /** Host-driven plan-state transition (present for host play/queue). */
  planState?: PlanState;
  /** Caller-supplied switch evaluation input (present for host switch). */
  switch?: SwitchEvaluationInput;
  /** Host explicitly requests interrupting the current experience. */
  interruptRequested?: boolean;
  /** Host explicitly requests ending the plan. */
  endRequested?: boolean;
  /** Caller-supplied resume tokens by experienceId (never invented). */
  resumeTokens?: Record<string, string>;
}

/**
 * The observed evidence classes (frozen contract enum): the only
 * classes accepted on host OBSERVATION channels (player/playout
 * reports). Simulated/counterfactual/fixture classes are research
 * classes and can never masquerade as observed outcomes
 * (architecture-lock #20).
 */
export type ObservedEvidenceClass = (typeof OBSERVED_EVIDENCE_CLASSES)[number];
