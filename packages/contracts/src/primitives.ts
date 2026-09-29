import { z } from "zod/v4";

/**
 * Primitive types shared by every Reckon contract.
 *
 * Locked rules encoded here:
 * - IDs are immutable opaque strings (contracts.md #2).
 * - Timestamps are caller-supplied where deterministic replay matters
 *   (contracts.md #4) — represented as epoch milliseconds (integer).
 * - Tenant scope is explicit on every request-scoped contract (#5).
 * - Provider-specific types never leak into core contracts (#6).
 */

/** Opaque, immutable identifier. Non-empty, <= 128 chars. */
export const IdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "id must be url-safe and non-empty");
export type Id = z.infer<typeof IdSchema>;

/** Free-form reference to a host-owned entity (looser than Id). */
export const RefSchema = z.string().min(1).max(512);
export type Ref = z.infer<typeof RefSchema>;

/** Epoch milliseconds. Caller-supplied for deterministic replay. */
export const TimestampMsSchema = z
  .number()
  .int()
  .nonnegative()
  .max(9_007_199_254_740_991);
export type TimestampMs = z.infer<typeof TimestampMsSchema>;

/** ISO-8601 duration string (e.g. "PT4M13S"), or whole seconds. */
export const DurationSchema = z.union([z.number().nonnegative(), z.string().regex(/^P(?!$)/)]);
export type Duration = z.infer<typeof DurationSchema>;

/** Explicit tenant / workspace scope. Required on request paths. */
export const TenantScopeSchema = z.object({
  tenantId: IdSchema,
  workspaceId: IdSchema.optional(),
});
export type TenantScope = z.infer<typeof TenantScopeSchema>;

/**
 * Provenance record — who/what produced a value. Provider-specific
 * vocabulary stays inside `system` as an opaque string; the core never
 * branches on it.
 */
export const ProvenanceSchema = z.object({
  system: z.string().min(1).max(64),
  version: z.string().min(1).max(64).optional(),
  correlationId: IdSchema.optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

/**
 * Uncertainty metadata — Reckon must never claim the objectively best
 * future choice; ranked/selected decisions carry confidence metadata.
 */
export const UncertaintySchema = z.object({
  confidence: z.number().min(0).max(1).optional(),
  /** e.g. posterior sd, bootstrap interval, or ensemble spread. */
  spread: z.number().nonnegative().optional(),
  /** Model disagreement score (0 = unanimous). */
  disagreement: z.number().min(0).max(1).optional(),
  /** Out-of-distribution score (higher = more OOD). */
  oodScore: z.number().min(0).max(1).optional(),
  method: z.string().min(1).max(64).optional(),
});
export type Uncertainty = z.infer<typeof UncertaintySchema>;

/** Cost/latency metadata attached to results. */
export const CostMetadataSchema = z.object({
  latencyMsP50: z.number().nonnegative().optional(),
  latencyMsP95: z.number().nonnegative().optional(),
  inferenceCost: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
});
export type CostMetadata = z.infer<typeof CostMetadataSchema>;

/**
 * Evidence class tags (AGENTS.md). Fixture evidence must remain
 * explicitly labeled as fixture evidence; simulated/counterfactual
 * output can never masquerade as observed production evidence
 * (contracts.md #9, architecture-lock #20).
 */
export const EVIDENCE_CLASSES = [
  "fixture",
  "controlled-local",
  "staging",
  "production-observed",
  "simulated",
  "counterfactual",
] as const;
export const EvidenceClassSchema = z.enum(EVIDENCE_CLASSES);
export type EvidenceClass = z.infer<typeof EvidenceClassSchema>;

/** A key/value metric payload on outcome events. Values are numbers. */
export const MetricPayloadSchema = z.record(z.string().min(1).max(128), z.number());
export type MetricPayload = z.infer<typeof MetricPayloadSchema>;

/** BCP-47 language tag. */
export const LocaleSchema = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);
export type Locale = z.infer<typeof LocaleSchema>;
