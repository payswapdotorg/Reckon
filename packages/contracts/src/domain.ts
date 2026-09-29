import { z } from "zod/v4";
import { IdSchema, RefSchema, TimestampMsSchema, ProvenanceSchema } from "./primitives.js";

/**
 * Domain vocabulary (frozen architecture §3). Provider-neutral: no YouTube /
 * TikTok / WebFlix / commerce-provider vocabulary may appear here.
 */

/** The user, audience, account or anonymous session being optimized. */
export const SubjectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), subjectId: IdSchema }),
  z.object({ kind: z.literal("audience"), audienceId: IdSchema }),
  z.object({ kind: z.literal("account"), accountId: IdSchema }),
  z.object({ kind: z.literal("session"), sessionId: IdSchema }),
]);
export type Subject = z.infer<typeof SubjectSchema>;

/** Host-owned catalog item: media, product, ad, article, notification, offer. */
export const CatalogItemSchema = z.object({
  schema: z.literal("reckon.catalog-item").default("reckon.catalog-item"),
  schemaVersion: z.string().default("0.1.0"),
  itemId: IdSchema,
  /** Domain-neutral kind: media | commerce | advertising | notification | article | other. */
  kind: z.enum(["media", "commerce", "advertising", "notification", "article", "other"]),
  /** Host-defined labels; core never branches on these. */
  labels: z.array(z.string().min(1).max(128)).default([]),
  /** Host-defined attributes payload (opaque to the core). */
  attributes: z.record(z.string(), z.unknown()).default({}),
  availableFrom: TimestampMsSchema.optional(),
  availableUntil: TimestampMsSchema.optional(),
});
export type CatalogItem = z.infer<typeof CatalogItemSchema>;

/** A way the item can actually be delivered: source, provider, player,
 *  locale, format, channel, device or other host capability. */
export const RealizationSchema = z.object({
  schema: z.literal("reckon.realization").default("reckon.realization"),
  schemaVersion: z.string().default("0.1.0"),
  realizationId: IdSchema,
  itemId: IdSchema,
  /** Delivery surface: file/stream source, provider, channel, etc. (host vocabulary). */
  kind: z.string().min(1).max(64),
  locale: z.string().optional(),
  /** Estimated delivery characteristics, host-supplied. */
  constraints: z.record(z.string(), z.unknown()).default({}),
});
export type Realization = z.infer<typeof RealizationSchema>;

/**
 * Context snapshot — typed point-in-time description of relevant state.
 * Sensitive raw sensor data is NOT required by the core; location only
 * when explicitly permitted and necessary (ADR-003).
 */
export const ContextSnapshotSchema = z.object({
  schema: z.literal("reckon.context-snapshot").default("reckon.context-snapshot"),
  schemaVersion: z.string().default("0.1.0"),
  contextId: IdSchema,
  at: TimestampMsSchema,
  time: z
    .object({
      localTime: z.string().optional(),
      timezone: z.string().optional(),
      dayPart: z.enum(["morning", "afternoon", "evening", "night", "unknown"]).optional(),
    })
    .optional(),
  device: z
    .object({
      class: z.enum(["phone", "tablet", "desktop", "tv", "vehicle", "audio", "other", "unknown"]).optional(),
      screenAvailable: z.boolean().optional(),
      audioRoute: z.enum(["none", "speaker", "headphones", "vehicle", "other", "unknown"]).optional(),
    })
    .optional(),
  network: z
    .object({
      class: z.enum(["offline", "metered", "wifi", "cellular", "unknown"]).optional(),
      bandwidthHint: z.enum(["low", "medium", "high", "unknown"]).optional(),
    })
    .optional(),
  /** Host-supplied activity signals (opaque to core). */
  activity: z.array(z.string().min(1).max(64)).default([]),
  /** Estimated available attention. */
  attention: z
    .object({
      availableMs: z.number().nonnegative().optional(),
      quality: z.enum(["full", "partial", "background", "interrupted", "unknown"]).optional(),
    })
    .optional(),
  session: z
    .object({
      sessionId: IdSchema.optional(),
      positionInSession: z.number().int().nonnegative().optional(),
    })
    .optional(),
  /** Fatigue / repetition / interruption state signals. */
  fatigue: z
    .object({
      repetitionLevel: z.number().min(0).max(1).optional(),
      recentInterruptions: z.number().int().nonnegative().optional(),
    })
    .optional(),
  /** Location ONLY when explicitly permitted (ADR-003); coarse by default. */
  location: z
    .object({
      coarse: z.string().min(1).max(64).optional(),
      permitted: z.literal(true),
    })
    .optional(),
  /** Additional host-supplied context keys (opaque to core). */
  extra: z.record(z.string(), z.unknown()).default({}),
});
export type ContextSnapshot = z.infer<typeof ContextSnapshotSchema>;

/** Declared user/audience objective (Intent). Host-declared, versioned. */
export const ObjectiveSchema = z.object({
  objectiveId: IdSchema,
  version: z.string().min(1).max(64).default("1"),
  /** Domain-neutral objective kinds; host may extend via `custom`. */
  kind: z.enum([
    "learn",
    "relax",
    "discover",
    "catch-up",
    "shop",
    "find-gift",
    "compare",
    "complete-task",
    "be-entertained",
    "stay-informed",
    "custom",
  ]),
  customKind: z.string().min(1).max(64).optional(),
  /** Host-defined parameters (opaque to core). */
  params: z.record(z.string(), z.unknown()).default({}),
});
export type Objective = z.infer<typeof ObjectiveSchema>;

/**
 * Attention policy — how aggressively Reckon may consume attention.
 * Examples: mindful, balanced, immersive, custom.
 */
export const AttentionPolicySchema = z.object({
  policyId: IdSchema,
  version: z.string().min(1).max(64).default("1"),
  style: z.enum(["mindful", "balanced", "immersive", "custom"]),
  customStyle: z.string().min(1).max(64).optional(),
  /** Host-side limits (opaque params, e.g. maxInterruptionsPerHour). */
  params: z.record(z.string(), z.unknown()).default({}),
});
export type AttentionPolicy = z.infer<typeof AttentionPolicySchema>;

/** Reference to a candidate supplied by a host retrieval system. */
export const CandidateReferenceSchema = z.object({
  itemId: IdSchema,
  /** Optional preferred realization(s); resolver may expand others. */
  realizationIds: z.array(IdSchema).default([]),
  /** Retrieval provenance (which source proposed this candidate). */
  source: z.string().min(1).max(64),
  /** Retrieval score/rank hint from the host (never the decision). */
  rankHint: z.number().optional(),
  scoreHint: z.number().optional(),
});
export type CandidateReference = z.infer<typeof CandidateReferenceSchema>;

/** The eligible candidate set from host retrieval + approved exploration. */
export const CandidateSetSchema = z.object({
  setId: IdSchema,
  candidates: z.array(CandidateReferenceSchema).min(1),
  provenance: ProvenanceSchema.optional(),
});
export type CandidateSet = z.infer<typeof CandidateSetSchema>;

/** Reference into a context snapshot by id. */
export const ContextReferenceSchema = z.object({ contextId: IdSchema });
export type ContextReference = z.infer<typeof ContextReferenceSchema>;

/** Loose reference to any host entity by kind + id. */
export const SubjectReferenceSchema = z.object({
  kind: z.enum(["user", "audience", "account", "session"]),
  ref: RefSchema,
});
export type SubjectReference = z.infer<typeof SubjectReferenceSchema>;
