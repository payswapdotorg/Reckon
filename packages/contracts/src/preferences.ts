import { z } from "zod/v4";
import { IdSchema, TimestampMsSchema, UncertaintySchema, ProvenanceSchema, TenantScopeSchema } from "./primitives.js";
import { SubjectReferenceSchema } from "./domain.js";

/**
 * PreferenceDelta — a learned change to preference state with confidence,
 * provenance, scope, decay and model lineage (frozen architecture §3).
 */
export const PREFERENCE_UPDATE_OPS = [
  "set",
  "add",
  "multiply",
  "decay",
  "remove",
  "merge",
] as const;

export const PreferenceDeltaSchema = z.object({
  schema: z.literal("reckon.preference-delta").default("reckon.preference-delta"),
  schemaVersion: z.string().default("0.1.0"),
  deltaId: IdSchema,
  tenant: TenantScopeSchema,
  subject: SubjectReferenceSchema,
  /** Preference dimension/key (host vocabulary, opaque to core). */
  dimension: z.string().min(1).max(256),
  /** Update operation + value (old/new value or op payload). */
  op: z.enum(PREFERENCE_UPDATE_OPS),
  oldValue: z.union([z.number(), z.string(), z.boolean(), z.null()]).optional(),
  newValue: z.union([z.number(), z.string(), z.boolean(), z.null()]).optional(),
  value: z.union([z.number(), z.string(), z.boolean(), z.null()]).optional(),
  /** Scope/context conditions under which the delta applies. */
  scope: z
    .object({
      contextId: IdSchema.optional(),
      contextKind: z.string().min(1).max(64).optional(),
      /** Temporal validity window. */
      validFrom: TimestampMsSchema.optional(),
      validUntil: TimestampMsSchema.optional(),
    })
    .optional(),
  confidenceDelta: z.number().min(-1).max(1).optional(),
  resultingConfidence: z.number().min(0).max(1).optional(),
  uncertainty: UncertaintySchema.optional(),
  provenance: ProvenanceSchema.optional(),
  /** Expiry/decay semantics. */
  decay: z
    .object({
      halfLifeSeconds: z.number().positive().optional(),
      expiresAt: TimestampMsSchema.optional(),
    })
    .optional(),
  /** Model/version that produced this delta. */
  model: z.object({
    modelId: z.string().min(1).max(128),
    version: z.string().min(1).max(64),
  }),
  timestamp: TimestampMsSchema,
});
export type PreferenceDelta = z.infer<typeof PreferenceDeltaSchema>;
