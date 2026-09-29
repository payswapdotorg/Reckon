import { z } from "zod/v4";
import { IdSchema, TimestampMsSchema } from "./primitives.js";
import {
  ObjectiveSchema,
  AttentionPolicySchema,
} from "./domain.js";
import { ExperienceSchema } from "./experience.js";

/**
 * ExperiencePlan — a continuously revisable sequence of future
 * experiences (contracts.md): current experience, queued experiences,
 * planning horizon, replan triggers, interruption policy, resume
 * checkpoints, objective, attention policy.
 */
export const REPLAN_TRIGGERS = [
  "context-changed",
  "objective-changed",
  "candidate-unavailable",
  "new-candidate",
  "user-feedback",
  "fatigue-signal",
  "outcome-observed",
  "budget-exhausted",
  "host-request",
  "custom",
] as const;
export const ReplanTriggerSchema = z.enum(REPLAN_TRIGGERS);
export type ReplanTrigger = z.infer<typeof ReplanTriggerSchema>;

export const ResumeCheckpointSchema = z.object({
  experienceId: IdSchema,
  /** Host-interpreted resume token (opaque to core). */
  resumeToken: z.string().min(1).max(1024),
  /** Best-effort resume position (host-interpreted). */
  position: z.record(z.string(), z.unknown()).default({}),
  savedAt: TimestampMsSchema,
});
export type ResumeCheckpoint = z.infer<typeof ResumeCheckpointSchema>;

export const InterruptionPolicyRefSchema = z.object({
  policyId: z.string().min(1).max(128),
  version: z.string().min(1).max(64).default("1"),
});
export type InterruptionPolicyRef = z.infer<typeof InterruptionPolicyRefSchema>;

export const ExperiencePlanSchema = z.object({
  schema: z.literal("reckon.experience-plan").default("reckon.experience-plan"),
  schemaVersion: z.string().default("0.1.0"),
  planId: IdSchema,
  version: z.number().int().nonnegative().default(0),
  tenant: z.object({ tenantId: IdSchema, workspaceId: IdSchema.optional() }),
  subject: z.object({
    kind: z.enum(["user", "audience", "account", "session"]),
    ref: z.string().min(1).max(512),
  }),
  objective: ObjectiveSchema,
  attentionPolicy: AttentionPolicySchema,
  currentExperience: ExperienceSchema.optional(),
  queuedExperiences: z.array(ExperienceSchema).default([]),
  /** Planning horizon (seconds or item count). */
  planningHorizon: z
    .object({
      seconds: z.number().positive().optional(),
      maxItems: z.number().int().positive().optional(),
    })
    .optional(),
  /** Events that trigger re-planning. */
  replanTriggers: z.array(ReplanTriggerSchema).default([]),
  /** Interruption policy reference (ranking never auto-interrupts). */
  interruptionPolicy: InterruptionPolicyRefSchema.optional(),
  /** Saved resume points for interrupted experiences. */
  resumeCheckpoints: z.array(ResumeCheckpointSchema).default([]),
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
});
export type ExperiencePlan = z.infer<typeof ExperiencePlanSchema>;
