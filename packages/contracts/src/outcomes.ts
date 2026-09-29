import { z } from "zod/v4";
import {
  IdSchema,
  TimestampMsSchema,
  ProvenanceSchema,
  MetricPayloadSchema,
  EvidenceClassSchema,
  TenantScopeSchema,
} from "./primitives.js";
import { SubjectReferenceSchema, ContextReferenceSchema } from "./domain.js";

/**
 * OutcomeEvent — host-reported result after a decision or schedule
 * action. Append-oriented: corrections reference earlier records
 * (contracts.md #8); simulated/counterfactual outcomes are TYPED and
 * can never masquerade as observed outcomes (#9, ADR-004).
 */
export const OUTCOME_EVENT_TYPES = [
  "impression",
  "start",
  "completion",
  "abandonment",
  "seek",
  "skip",
  "save",
  "share",
  "purchase",
  "conversion",
  "explicit-feedback",
  "interruption-accept",
  "interruption-reject",
  "return",
  "resume",
  "context-transition",
  "correction",
  "custom",
] as const;
export const OutcomeEventTypeSchema = z.enum(OUTCOME_EVENT_TYPES);
export type OutcomeEventType = z.infer<typeof OutcomeEventTypeSchema>;

export const OutcomeEventSchema = z.object({
  schema: z.literal("reckon.outcome-event").default("reckon.outcome-event"),
  schemaVersion: z.string().default("0.1.0"),
  eventId: IdSchema,
  tenant: TenantScopeSchema,
  decisionId: IdSchema.optional(),
  experienceId: IdSchema.optional(),
  subject: SubjectReferenceSchema,
  eventType: OutcomeEventTypeSchema,
  customEventType: z.string().min(1).max(64).optional(),
  /** Occurrence time — caller-supplied for deterministic replay. */
  occurredAt: TimestampMsSchema,
  context: ContextReferenceSchema.optional(),
  /** Host evidence/provenance. */
  provenance: ProvenanceSchema.optional(),
  /** Value/metric payload. */
  metrics: MetricPayloadSchema.default({}),
  /** REQUIRED evidence class. `simulated`/`counterfactual` are typed
   *  separately from observed classes — the schema enforces the split. */
  evidenceClass: EvidenceClassSchema,
  /**
   * Corrections are append-oriented: a correction event references the
   * earlier record it corrects (never overwrites).
   */
  correctsEventId: IdSchema.optional(),
  idempotencyKey: IdSchema,
});
export type OutcomeEvent = z.infer<typeof OutcomeEventSchema>;

/**
 * Discriminator helper: observed-class outcomes usable as production
 * evidence vs research-class outcomes that can never be represented as
 * observed production evidence.
 */
export const OBSERVED_EVIDENCE_CLASSES = [
  "production-observed",
  "staging",
  "controlled-local",
] as const;
export const RESEARCH_EVIDENCE_CLASSES = ["simulated", "counterfactual", "fixture"] as const;

export const ObservedOutcomeEventSchema = OutcomeEventSchema.extend({
  evidenceClass: z.enum(OBSERVED_EVIDENCE_CLASSES),
});
export const ResearchOutcomeEventSchema = OutcomeEventSchema.extend({
  evidenceClass: z.enum(RESEARCH_EVIDENCE_CLASSES),
});
export type ObservedOutcomeEvent = z.infer<typeof ObservedOutcomeEventSchema>;
export type ResearchOutcomeEvent = z.infer<typeof ResearchOutcomeEventSchema>;
