import { z } from "zod/v4";
import {
  IdSchema,
  TimestampMsSchema,
  UncertaintySchema,
  ProvenanceSchema,
  CostMetadataSchema,
  TenantScopeSchema,
} from "./primitives.js";
import {
  SubjectReferenceSchema,
  ContextReferenceSchema,
  CandidateSetSchema,
  ObjectiveSchema,
  AttentionPolicySchema,
} from "./domain.js";
import { ExperienceSchema } from "./experience.js";
import { HardConstraintSchema, RewardSpecSchema } from "./policy.js";

/**
 * Scheduler actions (architecture-lock #11). The scheduler may HOLD,
 * CONTINUE, QUEUE, SUGGEST, SWITCH, INTERRUPT or RESUME (plus END).
 */
export const SCHEDULE_ACTIONS = [
  "HOLD",
  "CONTINUE",
  "QUEUE",
  "SUGGEST",
  "SWITCH",
  "INTERRUPT",
  "RESUME",
  "END",
] as const;
export const ScheduleActionSchema = z.enum(SCHEDULE_ACTIONS);
export type ScheduleAction = z.infer<typeof ScheduleActionSchema>;

/**
 * DecisionRequest — the typed request for the next best action or
 * experience (contracts.md). Tenant scope is explicit; idempotency key
 * is required; policy/version selector names the deciding policy.
 */
export const DecisionRequestSchema = z.object({
  schema: z.literal("reckon.decision-request").default("reckon.decision-request"),
  schemaVersion: z.string().default("0.1.0"),
  requestId: IdSchema,
  tenant: TenantScopeSchema,
  subject: SubjectReferenceSchema,
  objective: ObjectiveSchema,
  attentionPolicy: AttentionPolicySchema,
  context: ContextReferenceSchema,
  candidates: CandidateSetSchema,
  constraints: z.array(HardConstraintSchema).default([]),
  reward: RewardSpecSchema.optional(),
  /** Current experience, if one is active (drives switch decisions). */
  currentExperience: ExperienceSchema.optional(),
  /** Current plan state reference, if a plan exists. */
  planId: IdSchema.optional(),
  /** Policy/version selector: which deciding policy to apply. */
  policySelector: z.object({
    policyId: z.string().min(1).max(128),
    version: z.string().min(1).max(64).default("1"),
    /** Optional experiment arm override (research runtime only). */
    experimentArm: z.string().min(1).max(64).optional(),
  }),
  /** Caller-supplied for deterministic replay where it matters. */
  at: TimestampMsSchema.optional(),
  idempotencyKey: IdSchema,
});
export type DecisionRequest = z.infer<typeof DecisionRequestSchema>;

/** Summary of an alternative (non-selected) experience. */
export const AlternativeSummarySchema = z.object({
  experienceId: IdSchema,
  score: z.number().optional(),
  uncertainty: UncertaintySchema.optional(),
  reason: z.string().min(1).max(512).optional(),
  excludedBy: z.string().min(1).max(128).optional(),
});
export type AlternativeSummary = z.infer<typeof AlternativeSummarySchema>;

/** Schedule delta — changes to the plan ordered by this decision. */
export const ScheduleDeltaSchema = z.object({
  action: ScheduleActionSchema,
  planId: IdSchema.optional(),
  /** Experiences added to the queue (in order). */
  enqueue: z.array(IdSchema).default([]),
  /** Experiences removed from the queue. */
  dequeue: z.array(IdSchema).default([]),
  /** Resume checkpoint for the interrupted/ended experience, if any. */
  resumeCheckpoint: z
    .object({
      experienceId: IdSchema,
      /** Host-interpreted resume token (opaque to core). */
      resumeToken: z.string().min(1).max(1024),
    })
    .optional(),
});
export type ScheduleDelta = z.infer<typeof ScheduleDeltaSchema>;

/**
 * DecisionResult — the decision reply. Carries confidence/uncertainty
 * metadata, reasons suitable for the host, provenance, latency/cost.
 */
export const DecisionResultSchema = z.object({
  schema: z.literal("reckon.decision-result").default("reckon.decision-result"),
  schemaVersion: z.string().default("0.1.0"),
  decisionId: IdSchema,
  requestId: IdSchema,
  tenant: TenantScopeSchema,
  action: ScheduleActionSchema,
  selectedExperience: ExperienceSchema.optional(),
  alternatives: z.array(AlternativeSummarySchema).default([]),
  uncertainty: UncertaintySchema.optional(),
  policy: z.object({
    policyId: z.string().min(1).max(128),
    version: z.string().min(1).max(64),
  }),
  scheduleDelta: ScheduleDeltaSchema.optional(),
  /** Human/host-readable reasons. */
  reasons: z
    .array(
      z.object({
        code: z.string().min(1).max(64),
        message: z.string().min(1).max(1024),
      })
    )
    .default([]),
  provenance: ProvenanceSchema.optional(),
  latency: CostMetadataSchema.optional(),
  at: TimestampMsSchema,
});
export type DecisionResult = z.infer<typeof DecisionResultSchema>;
