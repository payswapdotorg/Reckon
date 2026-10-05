/**
 * @reckon/api — public surface for tests and later waves.
 *
 * The runnable composition root is src/main.ts (wires env config and the
 * NotWired defaults). buildServer() here is the injectable composition
 * root used by tests and hosts.
 */
export { buildServer } from "./server.js";
export { loadConfigFromEnv, parseApiKeyList, keyStoreFrom, DEFAULT_API_VERSION } from "./config.js";
export type { ApiConfig } from "./config.js";
export { KeyStore, mintKeyConfig } from "./auth.js";
export type { KeyAuthenticator, StaticKeyConfig } from "./auth.js";
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
export { transportBackedOutcomeIngest, wireOutcomeTransport } from "./outcome-transport.js";
export type {
  OutcomeTransportWiring,
  OutcomeTransportWiringOptions,
} from "./outcome-transport.js";
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
export { PgObservabilitySink } from "./pg-observability.js";
