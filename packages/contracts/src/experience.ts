import { z } from "zod/v4";
import {
  IdSchema,
  TimestampMsSchema,
  DurationSchema,
  LocaleSchema,
} from "./primitives.js";
import { ObjectiveSchema } from "./domain.js";
import { HardConstraintSchema } from "./policy.js";

/**
 * Experience — a concrete presentation of an item/realization
 * (frozen architecture §3): item + realization + format + duration +
 * timing + context + objective + constraints.
 */
export const FORMAT_KINDS = [
  "full",
  "clip",
  "segment",
  "audio-only",
  "text-summary",
  "translated",
  "dubbed",
  "subtitled",
  "interactive",
  "card",
  "banner",
  "notification",
  "email",
  "push",
  "in-feed",
  "interstitial",
  "custom",
] as const;

export const FormatDescriptorSchema = z.object({
  kind: z.enum(FORMAT_KINDS),
  customKind: z.string().min(1).max(64).optional(),
  /** Format parameters (resolution, length seconds, summary length…) — opaque. */
  params: z.record(z.string(), z.unknown()).default({}),
});
export type FormatDescriptor = z.infer<typeof FormatDescriptorSchema>;

export const ExperienceSchema = z.object({
  schema: z.literal("reckon.experience").default("reckon.experience"),
  schemaVersion: z.string().default("0.1.0"),
  experienceId: IdSchema,
  itemId: IdSchema,
  realizationId: IdSchema,
  format: FormatDescriptorSchema,
  locale: LocaleSchema.optional(),
  duration: DurationSchema.optional(),
  /** Timing constraints for when this experience may be presented. */
  timing: z
    .object({
      earliestMs: TimestampMsSchema.optional(),
      latestMs: TimestampMsSchema.optional(),
      availabilityWindow: z
        .object({ fromMs: TimestampMsSchema, untilMs: TimestampMsSchema })
        .optional(),
    })
    .optional(),
  /** Objective fit metadata — how well this experience serves the objective. */
  objectiveFit: z
    .object({
      objective: ObjectiveSchema.optional(),
      fitScore: z.number().min(0).max(1).optional(),
      notes: z.array(z.string().min(1).max(256)).default([]),
    })
    .optional(),
  /** Device/context requirements (screen, audio, bandwidth…). */
  requirements: z
    .object({
      deviceClass: z.array(z.string().min(1).max(32)).default([]),
      requiresScreen: z.boolean().optional(),
      requiresAudio: z.boolean().optional(),
      minBandwidth: z.enum(["low", "medium", "high"]).optional(),
    })
    .optional(),
  /** Transformation requirements (host-executed: transcode, translate…). */
  transformations: z
    .array(
      z.object({
        kind: z.string().min(1).max(64),
        params: z.record(z.string(), z.unknown()).default({}),
      })
    )
    .default([]),
  /** Hard constraints gating this experience (separate from reward). */
  constraints: z.array(HardConstraintSchema).default([]),
});
export type Experience = z.infer<typeof ExperienceSchema>;
