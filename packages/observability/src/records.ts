/**
 * @reckon/observability record types (W3-004).
 *
 * CALIBRATION LAW (append-only evidence): records are immutable, carry a
 * `contentDigest` over their own content (excluding the digest field),
 * and are never rewritten — historical evidence stays historical.
 *
 * Records cover the worker-3 handoff list: decision latency,
 * policy/model version, uncertainty, cost, outcome linkage
 * (outcome eventId ↔ decision id), integration capability, errors, and
 * scheduler actions.
 */
import type {
  CostMetadata,
  EvidenceClass,
  Id,
  ScheduleAction,
  TenantScope,
  TimestampMs,
  Uncertainty,
} from "@reckon/contracts";

export const OBSERVABILITY_RECORD_KINDS = [
  "decision",
  "outcome-linkage",
  "scheduler-action",
  "integration-capability",
  "error",
] as const;
export type ObservabilityRecordKind = (typeof OBSERVABILITY_RECORD_KINDS)[number];

/** Fields present on every record. */
export interface ObservabilityRecordCommon {
  readonly recordId: Id;
  /** When the record was emitted (injected-clock time, deterministic). */
  readonly recordedAt: TimestampMs;
  /** Honest evidence-class label for the record's provenance. */
  readonly evidenceClass: EvidenceClass;
  /** sha256 content digest over this record WITHOUT the digest field. */
  readonly contentDigest: string;
}

/** Decision record: latency, policy version, uncertainty, cost, outcome. */
export interface DecisionObservabilityRecord extends ObservabilityRecordCommon {
  readonly kind: "decision";
  readonly tenant: TenantScope;
  /** Absent when the decision handler failed before producing a result. */
  readonly decisionId?: Id;
  readonly requestId: Id;
  readonly action?: ScheduleAction;
  /** Policy (and model, when the policy encodes it) version lineage. */
  readonly policy?: { readonly policyId: string; readonly version: string };
  /** Per-request latency, computed from the injected clock. */
  readonly latencyMs: number;
  readonly latencySource: "injected-clock";
  readonly uncertainty?: Uncertainty;
  readonly cost?: CostMetadata;
  readonly status: "ok" | "error";
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

/** Outcome linkage record: outcome eventId ↔ decision id. */
export interface OutcomeLinkageObservabilityRecord extends ObservabilityRecordCommon {
  readonly kind: "outcome-linkage";
  readonly tenant: TenantScope;
  readonly eventId: Id;
  /** The LINKAGE: which decision this outcome is evidence for. */
  readonly decisionId?: Id;
  readonly experienceId?: Id;
  readonly eventType: string;
  /** Evidence class of the OUTCOME EVENT (typed, never re-labeled). */
  readonly outcomeEvidenceClass: EvidenceClass;
  /** True iff the event carries a decisionId (linked evidence). */
  readonly linked: boolean;
  /** Transport delivery status when recorded through the W3-003 seam. */
  readonly transportStatus?: "delivered" | "duplicate" | "buffered" | "failed";
}

/** Scheduler action record (architecture-lock #11 actions). */
export interface SchedulerActionObservabilityRecord extends ObservabilityRecordCommon {
  readonly kind: "scheduler-action";
  readonly tenant: TenantScope;
  readonly source: "decision" | "plan-create" | "plan-replan";
  readonly action: ScheduleAction;
  readonly decisionId?: Id;
  readonly planId?: Id;
  readonly enqueuedCount: number;
  readonly dequeuedCount: number;
  /** The interrupted/ended experience (resumeCheckpoint), if any. */
  readonly interruptedExperienceId?: Id;
}

/** Integration capability record: is a capability wired and usable. */
export interface IntegrationCapabilityObservabilityRecord extends ObservabilityRecordCommon {
  readonly kind: "integration-capability";
  readonly integration: string;
  readonly capability: string;
  readonly available: boolean;
  readonly detail?: string;
}

/** Error record (route/handler/transport/sink/sdk scopes). */
export interface ErrorObservabilityRecord extends ObservabilityRecordCommon {
  readonly kind: "error";
  /** Absent when the failure predates authentication (e.g. 401). */
  readonly tenant?: TenantScope;
  readonly scope: string;
  readonly code: string;
  readonly message: string;
  readonly route?: string;
}

export type ObservabilityRecord =
  | DecisionObservabilityRecord
  | OutcomeLinkageObservabilityRecord
  | SchedulerActionObservabilityRecord
  | IntegrationCapabilityObservabilityRecord
  | ErrorObservabilityRecord;
