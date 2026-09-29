import {
  CatalogItemSchema,
  CandidateSetSchema,
  ContextReferenceSchema,
  ExperienceSchema,
  HardConstraintSchema,
  RealizationSchema,
  ReplanTriggerSchema,
  TenantScopeSchema,
} from "@reckon/contracts";
import type { Parsed } from "./types.js";

/**
 * API-level request/response envelopes.
 *
 * The CONTRACT-VALIDATION LAW requires every request body to be validated
 * against the REAL zod schemas from @reckon/contracts (never re-declared by
 * hand). Some /v1 operations (plan replan, experience resolve) have no
 * single frozen request contract, so their envelopes are composed ONLY from
 * imported frozen schema objects using the schemas' own object utilities
 * (.omit / .extend / .optional / .array). No field type is hand-written.
 *
 * `reckon.api.replan-request` and `reckon.api.resolve-request` are
 * API-level labels (not CONTRACT_IDS registry entries); they appear only in
 * validation error `details.schema` and are flagged for TL3 review.
 */
const EmptyObject = TenantScopeSchema.omit({ tenantId: true, workspaceId: true });

/** POST /v1/plans/{id}/replan request: why to replan + optional fresh context/candidates. */
export const ReplanRequestSchema = EmptyObject.extend({
  trigger: ReplanTriggerSchema,
  context: ContextReferenceSchema.optional(),
  candidates: CandidateSetSchema.optional(),
});
export type ReplanRequest = Parsed<typeof ReplanRequestSchema>;

/** POST /v1/experiences/resolve request: catalog items + realizations to expand. */
export const ResolveRequestSchema = EmptyObject.extend({
  items: CatalogItemSchema.array().min(1),
  realizations: RealizationSchema.array(),
  constraints: HardConstraintSchema.array().optional(),
});
export type ResolveRequest = Parsed<typeof ResolveRequestSchema>;

/** POST /v1/experiences/resolve response: the expanded experiences. */
export const ResolveResponseSchema = EmptyObject.extend({
  experiences: ExperienceSchema.array(),
});
export type ResolveResponse = Parsed<typeof ResolveResponseSchema>;
