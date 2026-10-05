/**
 * @reckon/sdk — the host-integration SDK for the Reckon API (W3-002;
 * hardened to the full S2-001/S2-002/S2-003/S2-004 platform surface).
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
  AdapterDeclarationView,
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
  ExpandedDecisionResult,
  ExpandOptions,
  FetchLike,
  FetchRequestInit,
  ListOptions,
  OutcomeEventInput,
  PageOf,
  PlanPage,
  PreferenceDeltaInput,
  RealizationInput,
  ReckonClient,
  ReckonClientOptions,
  ReplanRequestInput,
  ResolveRequestInput,
  ResolveResponse,
  ResolveResult,
  WebhookDeliveryListOptions,
  WebhookDeliveryPage,
  WebhookEndpointCreateInput,
  WebhookEndpointPage,
} from "./client.js";
export {
  ExpandedDecisionResultSchema,
  PlanPageSchema,
  WebhookDeliveryPageSchema,
  WebhookEndpointPageSchema,
} from "./client.js";
export { createInjectFetch } from "./testing.js";

export {
  mapServerError,
  ReckonAuthError,
  ReckonConfigError,
  ReckonIdempotencyConflictError,
  ReckonModeMismatchError,
  ReckonNotFoundError,
  ReckonNotWiredError,
  ReckonRateLimitError,
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

// S2-004 — the webhook helpers: ONE canonical algorithm (the
// @reckon/contracts reference implementation), re-exported plus the
// docs-named `verifyWebhook` alias the portal snippets import.
export {
  generateWebhookSigningSecret,
  signWebhookPayload,
  verifyReckonSignature,
  verifyWebhook,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_SIGNATURE_HEADER_CANONICAL,
  WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
  WebhookEventTypeSchema,
  ReckonEventSchema,
} from "./webhooks.js";
export type {
  ReckonEvent,
  WebhookDeliveryView,
  WebhookEndpointCreated,
  WebhookEndpointCreate,
  WebhookEndpointView,
  WebhookEventType,
  WebhookReplayResponse,
  WebhookSigningSecret,
  WebhookUrl,
} from "./webhooks.js";

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
