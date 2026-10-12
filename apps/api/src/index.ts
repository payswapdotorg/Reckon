/**
 * @reckon/api — public surface for tests and later waves.
 *
 * The runnable composition root is src/main.ts (wires env config and the
 * NotWired defaults). buildServer() here is the injectable composition
 * root used by tests and hosts.
 */
export { buildServer } from "./server.js";
export {
  loadConfigFromEnv,
  parseApiKeyList,
  parseTierRateLimits,
  keyStoreFrom,
  DEFAULT_API_VERSION,
} from "./config.js";
export type { ApiConfig, TierRateLimits } from "./config.js";
export { KeyStore, LayeredKeyAuthenticator, mintKeyConfig } from "./auth.js";
export type { KeyAuthenticator, StaticKeyConfig, AccountKeyLookup } from "./auth.js";
// TL6-001: the self-serve account route family (session-authenticated).
export { registerAccountRoutes } from "./routes/account.js";
export type { AccountRouteDeps } from "./routes/account.js";
export { InMemoryIdempotencyStore } from "./idempotency.js";
export type {
  IdempotencyStore,
  InMemoryIdempotencyStoreOptions,
  StoredIdempotent,
  StoredIdempotentResponse,
} from "./idempotency.js";
export { ApiError, ConfigError, ERROR_CODES, errorEnvelope, notWired, setDocsBaseUrl } from "./errors.js";
export type { ErrorCode, ErrorEnvelope } from "./errors.js";
export { ROUTE_SCOPES } from "./types.js";
export type { AuthContext, Parsed, SafeParseResult, SchemaIssue, Scope, Validator } from "./types.js";
export { notWiredDefaults } from "./ports.js";
export type {
  AdRetrievalHandler,
  CandidatesHandler,
  CatalogItemIngestHandler,
  CatalogReader,
  DecisionHandler,
  DecisionStore,
  ExperienceResolveHandler,
  HandlerPorts,
  OutcomeIngestHandler,
  PartialHandlerPorts,
  PlanHandler,
  PreferenceIngestHandler,
  RealizationIngestHandler,
} from "./ports.js";
export { ReplanRequestSchema, ResolveRequestSchema, ResolveResponseSchema } from "./envelopes.js";
export type { ReplanRequest, ResolveRequest, ResolveResponse } from "./envelopes.js";
// S2-001 developer-platform surface.
export { DEFAULT_API_VERSION_REGISTRY, assertRegistryCoherent, resolveRequestVersion } from "./versioning.js";
export type { ResolvedApiVersion } from "./versioning.js";
export { createRateLimiter } from "./rate-limit.js";
export type { RateLimiterConfig, RequestRateLimiter } from "./rate-limit.js";
export { fetchSizeFor, paginationMeta, parsePaginationParams, slicePage } from "./pagination.js";
export type { Page, ParsedPaginationParams } from "./pagination.js";
export { parseExpansion, wantsExpand, wantsNestedExpand } from "./expansion.js";
export type { ExpandPath } from "./expansion.js";
// S2-003 test-mode surface (canned scenarios, mode-scoped state, mode markers).
export {
  TEST_MODE_PROVENANCE_SYSTEM,
  TestModeDecisionStore,
  assertNoTestHintsInLiveMode,
  cannedDecision,
  crossModeMismatch,
  executeTestModeDecision,
  markTestMode,
  probeLiveDecision,
  resolveTestScenario,
} from "./test-mode.js";
export type { ResolvedScenario } from "./test-mode.js";
export { transportBackedOutcomeIngest, wireOutcomeTransport } from "./outcome-transport.js";
export type {
  OutcomeTransportWiring,
  OutcomeTransportWiringOptions,
} from "./outcome-transport.js";
// S2-002 webhook surface.
export type {
  WebhookCreateEndpointRequest,
  WebhookHandler,
  WebhookReplayResult,
} from "./ports.js";
export type {
  InMemoryWebhookSystemOptions,
  StoredWebhookDelivery,
  StoredWebhookEndpoint,
  WebhookDeliveryFilter,
  WebhookDeliveryStore,
  WebhookEndpointStore,
  WebhookEventStore,
  WebhookHttpClient,
  WebhookHttpResponse,
  WebhookSystem,
} from "./webhooks/ports.js";
export {
  InMemoryWebhookDeliveryStore,
  InMemoryWebhookEndpointStore,
  InMemoryWebhookEventStore,
  ManualWebhookClock,
  createInMemoryWebhookSystem,
} from "./webhooks/in-memory.js";
export { FetchWebhookHttpClient } from "./webhooks/http.js";
export {
  webhookEmittingDecisionHandler,
  webhookEmittingOutcomeIngest,
  webhookEmittingPreferenceIngest,
} from "./webhooks/emitter.js";
export { observedDecisionHandler, observedOutcomeIngest, recordRouteErrorSafely } from "./observability.js";
export type { ObservationDeps } from "./observability.js";
export type { ObservabilityConfig } from "./config.js";
export {
  buildProductionServer,
  createRuntimeDecisionHandler,
  createRuntimeExperienceResolver,
  createRuntimePlanHandler,
  CompositionError,
} from "./composition.js";
export type {
  ProductionComposition,
  ProductionCompositionOptions,
  CompositionClock,
} from "./composition.js";
// AD-003: the ad-retrieval engine — the runtime handler factory over the
// AD-002 store port + the host/provider availability-channel seam for
// the available lane, plus the deterministic lexical term extractor.
export {
  AdAvailabilitySupplySchema,
  createRuntimeAdRetrievalHandler,
  extractAdQueryTerms,
} from "./ad-retrieval.js";
export type {
  AdAvailabilityChannel,
  AdAvailabilitySupply,
  AdRetrievalRuntimeOptions,
} from "./ad-retrieval.js";
// AD-004: the ad-selection composition — ad-lane catalog truth for ad
// candidates declared in a DecisionRequest (the decision-path companion
// to AD-003's retrieval), plus the ad-encounter memory capture (observed
// outcome events → Personal Ad Memory through the AD-002 store port).
export {
  AD_SELECTION_SOURCES,
  createAdSelectionSource,
  isAdCandidateSource,
} from "./ad-selection.js";
export type {
  AdSelectionResolveInput,
  AdSelectionSource,
  AdSelectionTruth,
} from "./ad-selection.js";
export { createAdEncounterCapture, createAdEncounterResolver } from "./ad-memory-capture.js";
export type {
  AdEncounterCapturePolicy,
  AdEncounterCaptureResult,
  AdEncounterContext,
  AdEncounterResolver,
} from "./ad-memory-capture.js";
export { PgObservabilitySink } from "./pg-observability.js";
