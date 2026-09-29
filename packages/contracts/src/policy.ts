import { z } from "zod/v4";
import { TimestampMsSchema } from "./primitives.js";

/**
 * Constraints are separate from reward (contracts.md #7, architecture-lock #21).
 * Hard constraints gate eligibility; reward terms shape preference among
 * eligible experiences and are versioned, host-declared objectives.
 */

/**
 * A hard constraint. `kind` is a closed neutral vocabulary; parameters are
 * opaque to the kernel and interpreted by the constraint evaluator.
 */
export const HardConstraintSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("time-window"),
    /** Epoch ms window during which the experience is eligible. */
    fromMs: TimestampMsSchema.optional(),
    untilMs: TimestampMsSchema.optional(),
  }),
  z.object({
    kind: z.literal("min-duration"),
    seconds: z.number().nonnegative(),
  }),
  z.object({
    kind: z.literal("max-duration"),
    seconds: z.number().nonnegative(),
  }),
  z.object({
    kind: z.literal("format-required"),
    format: z.string().min(1).max(64),
  }),
  z.object({
    kind: z.literal("format-forbidden"),
    format: z.string().min(1).max(64),
  }),
  z.object({
    kind: z.literal("locale-required"),
    locale: z.string().min(2).max(35),
  }),
  z.object({
    kind: z.literal("device-class-required"),
    deviceClass: z.string().min(1).max(32),
  }),
  z.object({
    kind: z.literal("max-cost"),
    /** Hard ceiling on inference/delivery cost for this decision. */
    cost: z.number().nonnegative(),
    currency: z.string().length(3).optional(),
  }),
  z.object({
    kind: z.literal("max-latency"),
    latencyMs: z.number().nonnegative(),
  }),
  z.object({
    kind: z.literal("catalog-rule"),
    /** Host catalog rule id — evaluated host-side, verified by adapter. */
    ruleId: z.string().min(1).max(128),
  }),
  z.object({
    kind: z.literal("policy-rights"),
    /** Host policy/rights gate id — MUST pass before delivery. */
    gateId: z.string().min(1).max(128),
  }),
  z.object({
    kind: z.literal("custom"),
    /** Adapter-private hard constraint; kernel treats as opaque gate. */
    constraintId: z.string().min(1).max(128),
    params: z.record(z.string(), z.unknown()).default({}),
  }),
]);
export type HardConstraint = z.infer<typeof HardConstraintSchema>;

/**
 * A soft reward term. Engagement is NOT assumed to be the objective
 * (architecture-lock #22); every term is host-declared and versioned.
 */
export const RewardTermSchema = z.object({
  termId: z.string().min(1).max(128),
  version: z.string().min(1).max(64).default("1"),
  kind: z.enum([
    "satisfaction-proxy",
    "task-success",
    "qualified-engagement",
    "conversion",
    "revenue",
    "retention",
    "discovery-value",
    "serendipity",
    "continuity",
    "interruption-regret",
    "inference-cost",
    "latency",
    "bandwidth",
    "policy-risk",
    "custom",
  ]),
  customKind: z.string().min(1).max(64).optional(),
  weight: z.number().finite(),
  params: z.record(z.string(), z.unknown()).default({}),
});
export type RewardTerm = z.infer<typeof RewardTermSchema>;

/** A declared, versioned reward (objective function) — host-owned. */
export const RewardSpecSchema = z.object({
  rewardId: z.string().min(1).max(128),
  version: z.string().min(1).max(64).default("1"),
  terms: z.array(RewardTermSchema).min(1),
});
export type RewardSpec = z.infer<typeof RewardSpecSchema>;
