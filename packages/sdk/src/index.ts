/**
 * @reckon/sdk — the host-integration SDK for the Reckon API (W3-002).
 *
 * Laws: no LLM anywhere; no internal database schema leakage (public types
 * are the frozen @reckon/contracts types only); every request and response
 * is validated against the real frozen zod contracts; every failure
 * surfaces as a typed ReckonSdkError (never a raw fetch failure).
 *
 * Usage:
 * ```ts
 * import { createReckonClient } from "@reckon/sdk";
 *
 * const reckon = createReckonClient({
 *   baseUrl: "https://reckon.example.com",
 *   apiKey: process.env.RECKON_API_KEY!,
 * });
 *
 * const result = await reckon.decisions.request({
 *   requestId: "req-1",
 *   tenant: { tenantId: "my-tenant" },
 *   subject: { kind: "user", ref: "user-9" },
 *   objective: { objectiveId: "obj-1", kind: "relax" },
 *   attentionPolicy: { policyId: "ap-1", style: "balanced" },
 *   context: { contextId: "ctx-1" },
 *   candidates: { setId: "cs-1", candidates: [{ itemId: "item-1", source: "host-retrieval" }] },
 *   policySelector: { policyId: "greedy-v1" },
 *   idempotencyKey: "idem-1",
 * });
 * ```
 */
export {
  createReckonClient,
  isReckonSdkError,
  ResolveRequestSchema,
  ResolveResponseSchema,
  ReplanRequestSchema,
} from "./client.js";
export type {
  AgentBody,
  AgentBodyInput,
  ResearchJobInput,
  ResearchJobState,
  ResearchJobView,
  AgentOrganization,
  AgentOrganizationInput,
  CallOptions,
  CandidateSetInput,
  CatalogItemInput,
  DecisionRequestInput,
  ExperiencePlanInput,
  PlanVersionEntry,
  FetchLike,
  FetchRequestInit,
  OutcomeEventInput,
  PreferenceDeltaInput,
  RealizationInput,
  ReckonClient,
  ReckonClientOptions,
  ReplanRequestInput,
  ResolveRequestInput,
  ResolveResponse,
  ResolveResult,
} from "./client.js";
export { createInjectFetch } from "./testing.js";

export {
  mapServerError,
  ReckonAuthError,
  ReckonConfigError,
  ReckonIdempotencyConflictError,
  ReckonNotFoundError,
  ReckonNotWiredError,
  ReckonResponseContractError,
  ReckonScopeError,
  ReckonServerError,
  ReckonSdkError,
  ReckonTenantMismatchError,
  ReckonTransportError,
  ReckonValidationError,
  SDK_CLIENT_ERROR_CODES,
  SDK_SERVER_ERROR_CODES,
  toSdkValidationIssues,
} from "./errors.js";
export type {
  ReckonSdkErrorOptions,
  SdkClientErrorCode,
  SdkErrorCode,
  SdkServerErrorCode,
  SdkValidationIssue,
} from "./errors.js";

// Contract types are re-exported for consumer convenience (types ONLY —
// frozen public contracts, never internal persistence shapes).
export type {
  CandidateSet,
  CatalogItem,
  DecisionRequest,
  DecisionResult,
  Experience,
  ExperiencePlan,
  OutcomeEvent,
  PreferenceDelta,
  Realization,
  ScheduleAction,
  ScheduleDelta,
  SubjectReference,
  TenantScope,
} from "@reckon/contracts";
