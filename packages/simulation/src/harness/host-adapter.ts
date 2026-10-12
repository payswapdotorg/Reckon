/**
 * SimulationHostAdapter — the seam a SYNTHETIC HOST implements to be
 * measured by the harness (SIM-001).
 *
 * The host owns its authorities (identity, catalog, context, outcomes,
 * rights, delivery) per the architecture laws — the harness never
 * fabricates them. The host's glue declaration (`glue`) is HONEST and
 * host-declared: functions / LOC of host-side integration code plus
 * custom-adapter LOC. The harness measures what it CAN observe (API
 * operations, SDK methods, latency, failures, loop completion) and
 * records the declaration for what only the host can know.
 *
 * Every callback receives the loop step (1-based) and, where relevant,
 * the current virtual time — hosts must NEVER read wall time.
 */
import type {
  AttentionPolicy,
  CandidateSet,
  CatalogItem,
  DecisionResult,
  Experience,
  HardConstraint,
  Objective,
  OutcomeEvent,
  PreferenceDelta,
  Realization,
  RewardSpec,
  SubjectReference,
  TenantScope,
} from "@reckon/contracts";
import type {
  ReckonCompleteCapabilityManifestContentInput,
  HostGlueMeasurement,
} from "@reckon/contracts";
import type {
  CatalogItemInput,
  CandidateSetInput,
  ExperienceInput,
  OutcomeEventInput,
  PreferenceDeltaInput,
  RealizationInput,
  RewardSpecInput,
} from "./port.js";

/** Host-owned catalog source (the connect phase ingests these). */
export interface HostCatalogSource {
  readonly items: readonly CatalogItemInput[];
  readonly realizations: readonly RealizationInput[];
}

/** Per-step host inputs for one decision request. */
export interface HostDecisionInputs {
  /** Host context reference — the host is the context authority. */
  readonly contextId: string;
  readonly tenant: TenantScope;
  readonly subject: SubjectReference;
  readonly objective: Objective;
  readonly attentionPolicy: AttentionPolicy;
  readonly candidates: CandidateSetInput;
  readonly constraints?: readonly HardConstraint[];
  readonly policySelector: { readonly policyId: string; readonly version?: string };
  /**
   * SIM-003 (integration cases): the currently-active experience, when one
   * is playing/being-configured host-side. Carried on the decision request
   * (`currentExperience`) so the deciding side can CONTINUE / SWITCH /
   * INTERRUPT / RESUME rather than only QUEUE. Omitted ⇒ identical request
   * shape to SIM-001 (byte-compat law for existing runs).
   */
  readonly currentExperience?: ExperienceInput;
  /**
   * SIM-003: reference to the host's current experience-plan state, when a
   * rolling plan exists (media queues, itineraries, pacing plans…). Echoed
   * by the deciding side into `scheduleDelta.planId`.
   */
  readonly planId?: string;
  /**
   * SIM-003: the host's declared, versioned reward (competing objectives —
   * marketplace buyer value vs revenue vs policy risk, ad user value vs
   * commercial value…). Constraints stay separate from reward (lock #21).
   */
  readonly reward?: RewardSpecInput;
}

/** The host's reaction to a decision result. */
export interface HostDecisionReaction {
  /** Did the host present the selected experience? */
  readonly presented: boolean;
}

/**
 * The synthetic host adapter. `hostAdapterId` is the REPLAY identity —
 * together with the seed and manifest checksum it determines a run.
 */
export interface SimulationHostAdapter {
  /** Replay identity (must be stable across runs of the same adapter). */
  readonly hostAdapterId: string;
  readonly hostSystem: {
    readonly hostId: string;
    readonly name: string;
    readonly version: string;
  };
  /** Honest host-declared glue measurement. */
  readonly glue: HostGlueMeasurement;
  /** The host's capability manifest content (statuses, evidence, ops, methods). */
  readonly manifestContent: ReckonCompleteCapabilityManifestContentInput;
  /** Host-owned catalog source, connected once before the loop. */
  readonly catalog: HostCatalogSource;

  /** Per-step decision inputs (retrieval, objective, policy, context ref). */
  provideDecisionInputs(step: number): HostDecisionInputs;

  /** Consume a decision result; the reaction drives the outcome phase. */
  consumeDecision(step: number, result: DecisionResult): HostDecisionReaction;

  /**
   * Provide the outcome event for a presented decision. `nowMs` is the
   * virtual clock — hosts use it for `occurredAt` (never wall time).
   */
  provideOutcome(
    step: number,
    result: DecisionResult,
    reaction: HostDecisionReaction,
    nowMs: number,
  ): OutcomeEventInput;

  /** Optional per-step preference delta (omitted → no delta call). */
  providePreferenceDelta?(step: number, result: DecisionResult, nowMs: number): PreferenceDeltaInput | undefined;
}

/** Convenience type re-exports for adapter authors. */
export type {
  CatalogItem,
  CandidateSet,
  OutcomeEvent,
  PreferenceDelta,
  Realization,
  RewardSpec,
  CatalogItemInput,
  RealizationInput,
  ExperienceInput,
  RewardSpecInput,
  SubjectReference,
  TenantScope,
  DecisionResult,
};
/** SIM-001 convenience alias — the manifest-content input a synthetic host declares. */
export type { ReckonCompleteCapabilityManifestContentInput as SimulationManifestContentInput } from "@reckon/contracts";
