/**
 * @reckon/sdk — typed host-integration client over the frozen Reckon
 * contracts (W3-002).
 *
 * LAWS implemented here:
 * - NO-LLM LAW (architecture-lock #6): the client is pure plumbing over
 *   HTTP + zod; nothing here requires or calls any model.
 * - NO-SCHEMA-LEAK LAW: the public surface exposes ONLY frozen contract
 *   types (`@reckon/contracts`); no internal database/persistence shape is
 *   imported or re-exported.
 * - CONTRACT-VALIDATION LAW: every request is validated against a REAL
 *   imported frozen schema before it is sent, and every response is
 *   validated against a REAL frozen schema before it is returned; envelope
 *   schemas are composed ONLY from imported frozen schema objects (same
 *   composition pattern as apps/api/src/envelopes.ts — no hand-written
 *   field types).
 * - ERROR-MODEL LAW: every failure surfaces as a typed ReckonSdkError; raw
 *   fetch/network failures and non-envelope bodies never escape.
 */
import {
  AccountKeyCreatedSchema,
  AccountKeySchema,
  AccountSessionResponseSchema,
  CreateKeyRequestSchema,
  LoginRequestSchema,
  SessionTokenSchema,
  SignupRequestSchema,
  AgentBodySchema,
  AgentOrganizationSchema,
  ApiVersionSchema,
  CandidateSetSchema,
  CatalogItemSchema,
  ContextReferenceSchema,
  DecisionRequestSchema,
  DecisionResultSchema,
  ExperiencePlanSchema,
  ExperienceSchema,
  HardConstraintSchema,
  IdSchema,
  OutcomeEventSchema,
  PaginationMetaSchema,
  PreferenceDeltaSchema,
  RealizationSchema,
  ReckonEventSchema,
  ReplanTriggerSchema,
  TenantScopeSchema,
  WebhookDeliveryViewSchema,
  WebhookEndpointCreateSchema,
  WebhookEndpointCreatedSchema,
  WebhookEndpointViewSchema,
  WebhookReplayResponseSchema,
  X_RECKON_MODE_HEADER,
  X_RECKON_VERSION_HEADER,
} from "@reckon/contracts";
import type {
  Account,
  AccountKey,
  AccountKeyCreated,
  AccountSessionResponse,
  CandidateSet,
  CatalogItem,
  DecisionResult,
  Experience,
  ExperiencePlan,
  OutcomeEvent,
  PreferenceDelta,
  Realization,
  ReckonEvent,
  AgentBody,
  AgentOrganization,
  WebhookDeliveryView,
  WebhookEndpointCreated,
  WebhookEndpointView,
  WebhookReplayResponse,
} from "@reckon/contracts";
// Re-export the frozen agent contract types so the SDK surface is
// self-contained for consumers (UI-007).
export type { AgentBody, AgentOrganization } from "@reckon/contracts";
// S2-004: the canonical webhook helpers live in ./webhooks.ts (re-exports
// of the @reckon/contracts reference implementation + the docs-named
// `verifyWebhook` alias).
export {
  verifyWebhook,
  verifyReckonSignature,
  signWebhookPayload,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_SIGNATURE_HEADER_CANONICAL,
  WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
} from "./webhooks.js";

import { z } from "zod/v4";
import { ReckonConfigError } from "./errors.js";
import { ReckonResponseContractError } from "./errors.js";
import { ReckonSdkError } from "./errors.js";
import { ReckonTransportError } from "./errors.js";
import { ReckonValidationError } from "./errors.js";
import { mapServerError } from "./errors.js";
import { toSdkValidationIssues } from "./errors.js";
import type { SdkServerErrorCode, SdkValidationIssue } from "./errors.js";

/**
 * Structural view of a zod schema's safeParse (same trick as
 * apps/src/types.ts Validator) so the SDK validates against the REAL
 * imported contract schemas without coupling its types to zod internals.
 */
interface Parseable<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: unknown };
}

/* ------------------------------------------------------------------ *
 * Public input/output types — all derived from the frozen contracts. *
 * ------------------------------------------------------------------ */

/** Request inputs accept the frozen contracts' own optional/defaulted shape. */
export type DecisionRequestInput = z.input<typeof DecisionRequestSchema>;
export type OutcomeEventInput = z.input<typeof OutcomeEventSchema>;
export type PreferenceDeltaInput = z.input<typeof PreferenceDeltaSchema>;
export type ExperiencePlanInput = z.input<typeof ExperiencePlanSchema>;
export type AgentBodyInput = z.input<typeof AgentBodySchema>;

/** Adapter declaration view (GET /v1/integrations/adapters) — the §14 capability cards' data. */
export interface AdapterDeclarationView {
  readonly adapterId: string;
  readonly domain: string;
  readonly contractVersion: string;
  readonly supportedCapabilities: readonly string[];
  readonly unsupportedCapabilities: readonly string[];
  readonly authorizationRequirements: readonly {
    resource: string;
    requirement: string;
    enforcedBy: string;
  }[];
  readonly limits: {
    maxItemsPerImport: number;
    maxRealizationsPerItem: number;
    maxCandidatesPerSet: number;
    mappingLatencyBudgetMs: number;
  };
  readonly liveVerification: { status: string; evidenceClass: string; note: string };
  readonly provenance: Record<string, string>;
  readonly failureSemantics: Record<string, string>;
}

/** Research job states (API-level envelope over the durable queue). */
export const RESEARCH_JOB_STATES = ["queued", "leased", "done", "failed"] as const;
export type ResearchJobState = (typeof RESEARCH_JOB_STATES)[number];

/** POST /v1/research/jobs input (payload opaque to the API). */
export interface ResearchJobInput {
  readonly jobId: string;
  readonly kind: string;
  readonly payload?: unknown;
}

/** Research job view (GET surface). */
export interface ResearchJobView {
  readonly jobId: string;
  readonly kind: string;
  readonly state: ResearchJobState;
  readonly payload: unknown;
  readonly resultRef: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}
export type AgentOrganizationInput = z.input<typeof AgentOrganizationSchema>;
export type CatalogItemInput = z.input<typeof CatalogItemSchema>;
export type RealizationInput = z.input<typeof RealizationSchema>;
export type CandidateSetInput = z.input<typeof CandidateSetSchema>;

/* ------------------------------------------------------------------ *
 * TL6-001 — self-serve account surface (session-token auth)           *
 * ------------------------------------------------------------------ */

/** POST /v1/account/signup input (email, password min 8, fullName, workspaceName). */
export type SignupInput = z.input<typeof SignupRequestSchema>;
/** POST /v1/account/login input (email + password). */
export type LoginInput = z.input<typeof LoginRequestSchema>;
/** POST /v1/account/keys input (which kind of key to mint). */
export type CreateAccountKeyInput = z.input<typeof CreateKeyRequestSchema>;

/** The account-keys list envelope ({ keys: [...] }). */
const AccountKeyListSchema = z.object({ keys: z.array(AccountKeySchema) });

/** A 204 no-content response parses as void — the schema only ever sees a non-204 body. */
const VoidResponseSchema = z.undefined();

/**
 * API-level request/response envelopes for the routes that have no single
 * frozen request contract (plan replan, experience resolve). Composed ONLY
 * from imported frozen schema objects — mirrors apps/api/src/envelopes.ts.
 */
const NoTenant = TenantScopeSchema.omit({ tenantId: true, workspaceId: true });

export const ReplanRequestSchema = NoTenant.extend({
  trigger: ReplanTriggerSchema,
  context: ContextReferenceSchema.optional(),
  candidates: CandidateSetSchema.optional(),
});
export type ReplanRequestInput = z.input<typeof ReplanRequestSchema>;

const AdapterDeclarationViewSchema = z.object({
  adapterId: IdSchema,
  domain: z.string(),
  contractVersion: z.string(),
  supportedCapabilities: z.array(z.string()),
  unsupportedCapabilities: z.array(z.string()),
  authorizationRequirements: z.array(
    z.object({ resource: z.string(), requirement: z.string(), enforcedBy: z.string() }),
  ),
  limits: z.object({
    maxItemsPerImport: z.number(),
    maxRealizationsPerItem: z.number(),
    maxCandidatesPerSet: z.number(),
    mappingLatencyBudgetMs: z.number(),
  }),
  liveVerification: z.object({
    status: z.string(),
    evidenceClass: z.string(),
    note: z.string(),
  }),
  provenance: z.record(z.string(), z.string()),
  failureSemantics: z.record(z.string(), z.string()),
});

const AdapterListSchema = z.object({ adapters: z.array(AdapterDeclarationViewSchema) });

const ResearchJobViewSchema = z.object({
  jobId: IdSchema,
  kind: IdSchema,
  state: z.enum(RESEARCH_JOB_STATES),
  payload: z.unknown(),
  resultRef: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

/** Response wrapper for the research-jobs collection route. */
const ResearchJobListSchema = z.object({ jobs: z.array(ResearchJobViewSchema) });

/** Response wrapper for the agent-body collection route. */
const AgentBodyListSchema = z.object({ bodies: z.array(AgentBodySchema) });

/** Response wrapper for the agent-organization collection route. */
const AgentOrganizationListSchema = z.object({ organizations: z.array(AgentOrganizationSchema) });

/** Response wrapper for the plans read collection routes ({plans: [...]}). */
const PlanCollectionSchema = z.object({ plans: z.array(ExperiencePlanSchema) });

/** One replan-history entry (GET /v1/plans/{id}/history): the plan, its authoritative row version and the recorded replan reason. */
export interface PlanVersionEntry {
  readonly plan: ExperiencePlan;
  readonly version: number;
  readonly reason: string | null;
}

/** Response wrapper for the version-chain route. */
const PlanHistorySchema = z.object({
  versions: z.array(
    z.object({
      plan: ExperiencePlanSchema,
      version: z.number().int().nonnegative(),
      reason: z.string().nullable(),
    }),
  ),
});

export const ResolveRequestSchema = NoTenant.extend({
  items: CatalogItemSchema.array().min(1),
  realizations: RealizationSchema.array(),
  constraints: HardConstraintSchema.array().optional(),
});
export type ResolveRequestInput = z.input<typeof ResolveRequestSchema>;

/** The /v1/experiences/resolve success envelope (schema echo + experiences). */
export const ResolveResponseSchema = z.object({
  schema: z.string().min(1),
  schemaVersion: z.string().min(1),
  experiences: ExperienceSchema.array(),
});
export type ResolveResponse = z.output<typeof ResolveResponseSchema>;

/** SDK-shaped resolve result: just the contract-validated experiences. */
export interface ResolveResult {
  readonly experiences: readonly Experience[];
}

/* ------------------------------------------------------------------ *
 * S2-004 — hardened-API surface types                                   *
 * ------------------------------------------------------------------ */

/** POST /v1/webhooks/endpoints input (url, optional description, eventTypes filter; empty filter = every event). */
export type WebhookEndpointCreateInput = z.input<typeof WebhookEndpointCreateSchema>;

/** Cursor-paginated list options (limit 1..100 default 20; startingAfter is the previous page's next_cursor). */
export interface ListOptions extends CallOptions {
  /** Page size — the server clamps to 1..100 (default 20). */
  readonly limit?: number;
  /** The previous page's `next_cursor` (an object id); omit for the first page. */
  readonly startingAfter?: string;
}

/** Delivery-log list options: pagination + the endpoint_id / event_id filters. */
export interface WebhookDeliveryListOptions extends ListOptions {
  /** Only deliveries to this endpoint. */
  readonly endpointId?: string;
  /** Only deliveries of this event. */
  readonly eventId?: string;
}

/**
 * Page envelope shared by every cursor-paginated list: the collection
 * plus the frozen PaginationMeta fields exactly as the wire carries them
 * (`has_more` + `next_cursor` — feed `next_cursor` back as
 * `startingAfter`). Composed ONLY from imported frozen schema objects.
 */
/** GET /v1/plans page: { plans, has_more, next_cursor }. */
export const PlanPageSchema = z.object({
  plans: z.array(ExperiencePlanSchema),
  ...PaginationMetaSchema.shape,
});
export type PlanPage = z.output<typeof PlanPageSchema>;

/** GET /v1/webhooks/endpoints page: { endpoints, has_more, next_cursor }. */
export const WebhookEndpointPageSchema = z.object({
  endpoints: z.array(WebhookEndpointViewSchema),
  ...PaginationMetaSchema.shape,
});
export type WebhookEndpointPage = z.output<typeof WebhookEndpointPageSchema>;

/** GET /v1/webhooks/deliveries page: { deliveries, has_more, next_cursor }. */
export const WebhookDeliveryPageSchema = z.object({
  deliveries: z.array(WebhookDeliveryViewSchema),
  ...PaginationMetaSchema.shape,
});
export type WebhookDeliveryPage = z.output<typeof WebhookDeliveryPageSchema>;

/** GET /v1/webhooks/events/{id} + GET /v1/decisions/{id} options with `?expand[]` paths. */
export interface ExpandOptions extends CallOptions {
  /**
   * `?expand[]` paths this route's allowlist supports (documented per
   * route; unknown paths are a typed 400 naming `expand[i]`). Today:
   * decisions detail — `selectedExperience.item`.
   */
  readonly expand?: readonly string[];
}

/**
 * The decision detail surface with expansions applied: the frozen
 * DecisionResult plus the embedded catalog item on the selected
 * experience (`?expand[]=selectedExperience.item`; the embedded item is
 * `null` when absent — the honest-absence expansion). Composed from the
 * frozen ExperienceSchema + CatalogItemSchema, mirroring the API route's
 * own composition.
 */
export const ExpandedDecisionResultSchema = DecisionResultSchema.extend({
  selectedExperience: ExperienceSchema.extend({
    item: CatalogItemSchema.nullable().optional(),
  }).optional(),
});
export type ExpandedDecisionResult = z.output<typeof ExpandedDecisionResultSchema>;

/** The shape every auto-paginating iterator pages over (normalized page view). */
export interface PageOf<T> {
  readonly items: readonly T[];
  readonly has_more: boolean;
  readonly next_cursor: string | null;
}

/* ------------------------------------------------------------------ *
 * Transport seam                                                      *
 * ------------------------------------------------------------------ */

/** Minimal fetch shape the SDK needs — injectable for in-process testing. */
export interface FetchRequestInit {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
}

export type FetchLike = (url: string, init: FetchRequestInit) => Promise<Response>;

/** Per-call options (idempotency + advisory headers). */
export interface CallOptions {
  /**
   * Explicit Idempotency-Key header value for operations whose frozen
   * contract carries no body-level idempotencyKey (catalog, plans,
   * preferences, resolve). When omitted, the client generates one via the
   * configured idGenerator.
   */
  readonly idempotencyKey?: string;
  /** Additional headers (advisory X-Reckon-Tenant, correlation ids, …). */
  readonly headers?: Record<string, string>;
}

export interface ReckonClientOptions {
  /** API origin, e.g. "https://reckon.example.com". The /v1 paths are appended. */
  readonly baseUrl: string;
  /** Bearer API key (tenant identity comes EXCLUSIVELY from the key). */
  readonly apiKey: string;
  /**
   * S2-001: pin the API version — sent as X-Reckon-Version on every
   * request (must be a registered, non-retired version of the target
   * deployment; the pinned default is used when omitted). Format:
   * semver (X.Y.Z) or calendar date (YYYY-MM-DD).
   */
  readonly apiVersion?: string;
  /** Injectable transport (default: global fetch). */
  readonly fetchImpl?: FetchLike;
  /** Idempotency-Key generator for header-keyed operations (default: crypto.randomUUID). */
  readonly idGenerator?: () => string;
  /** Headers sent on every request (e.g. X-Reckon-Tenant). */
  readonly defaultHeaders?: Record<string, string>;
}

export interface ReckonClient {
  /**
   * S2-003: the mode (`live` | `test`) of the key that served the most
   * recent response, from the X-Reckon-Mode header the API sets on
   * every authenticated response (success or typed error). Undefined
   * before the first response.
   */
  lastResponseMode(): "live" | "test" | undefined;
  readonly decisions: {
    /** POST /v1/decisions — request the next best action/experience. */
    request(request: DecisionRequestInput): Promise<DecisionResult>;
    /**
     * GET /v1/decisions/{decisionId} — tenant-scoped lookup. Supports
     * `?expand[]` (today: `selectedExperience.item` embeds the catalog
     * item; the embedded item is null when absent).
     */
    get(decisionId: string, options?: ExpandOptions): Promise<ExpandedDecisionResult>;
  };
  readonly outcomes: {
    /** POST /v1/outcomes — append a host-observed outcome event. */
    append(event: OutcomeEventInput): Promise<OutcomeEvent>;
  };
  readonly preferences: {
    /** POST /v1/preferences/events — append a preference delta. */
    appendDelta(delta: PreferenceDeltaInput, options?: CallOptions): Promise<PreferenceDelta>;
  };
  readonly plans: {
    /** POST /v1/plans — create/replace an experience plan. */
    create(plan: ExperiencePlanInput, options?: CallOptions): Promise<ExperiencePlan>;
    /** POST /v1/plans/{planId}/replan — replan an existing plan. */
    replan(planId: string, request: ReplanRequestInput, options?: CallOptions): Promise<ExperiencePlan>;
    /** GET /v1/plans/{planId} — latest version of one plan (404 when unknown). */
    get(planId: string, options?: CallOptions): Promise<ExperiencePlan>;
    /** GET /v1/plans/{planId}/history — full version chain (asc) with replan reasons. */
    history(planId: string, options?: CallOptions): Promise<readonly PlanVersionEntry[]>;
    /** GET /v1/plans?limit=N — recent plans (latest version each, newest first). */
    listRecent(options?: CallOptions & { readonly limit?: number }): Promise<readonly ExperiencePlan[]>;
    /**
     * S2-004: GET /v1/plans?limit&starting_after — one explicit cursor
     * page ({plans, has_more, next_cursor}).
     */
    listPage(options?: ListOptions): Promise<PlanPage>;
    /**
     * S2-004: auto-paginating async iterator over EVERY plan (follows
     * next_cursor page by page; `for await (const plan of reckon.plans.list())`).
     */
    list(options?: ListOptions): AsyncIterable<ExperiencePlan>;
  };
  readonly integrations: {
    /** GET /v1/integrations/adapters — the adapter declarations (static product truth). */
    listAdapters(options?: CallOptions): Promise<readonly AdapterDeclarationView[]>;
  };
  readonly research: {
    /** POST /v1/research/jobs — enqueue a research job (FIFO lease semantics). */
    enqueueJob(job: ResearchJobInput, options?: CallOptions): Promise<ResearchJobView>;
    /** GET /v1/research/jobs/{jobId} — one job (404 when unknown). */
    getJob(jobId: string, options?: CallOptions): Promise<ResearchJobView>;
    /** GET /v1/research/jobs?limit&state — recent jobs, newest first. */
    listJobs(options?: CallOptions & { readonly limit?: number; readonly state?: ResearchJobState }): Promise<readonly ResearchJobView[]>;
  };
  readonly agents: {
    /** POST /v1/agents/bodies — create or version-append an Agent Body declaration. */
    createBody(body: AgentBodyInput, options?: CallOptions): Promise<AgentBody>;
    /** GET /v1/agents/bodies/{bodyId} — latest stored declaration (404 when unknown). */
    getBody(bodyId: string, options?: CallOptions): Promise<AgentBody>;
    /** GET /v1/agents/bodies?limit=N — latest declaration per body, newest first. */
    listBodies(options?: CallOptions & { readonly limit?: number }): Promise<readonly AgentBody[]>;
    /** POST /v1/agents/organizations — create or version-append an Agent Organization. */
    createOrganization(organization: AgentOrganizationInput, options?: CallOptions): Promise<AgentOrganization>;
    /** GET /v1/agents/organizations/{id} — latest stored declaration (404 when unknown). */
    getOrganization(organizationId: string, options?: CallOptions): Promise<AgentOrganization>;
    /** GET /v1/agents/organizations?limit=N — latest declaration per organization. */
    listOrganizations(options?: CallOptions & { readonly limit?: number }): Promise<readonly AgentOrganization[]>;
  };
  readonly catalog: {
    /** POST /v1/catalog/items — upsert a host catalog item. */
    upsertItem(item: CatalogItemInput, options?: CallOptions): Promise<CatalogItem>;
    /** POST /v1/catalog/realizations — upsert a delivery realization. */
    upsertRealization(realization: RealizationInput, options?: CallOptions): Promise<Realization>;
  };
  readonly candidates: {
    /** POST /v1/candidates — submit a retrieval candidate set. */
    submit(set: CandidateSetInput, options?: CallOptions): Promise<CandidateSet>;
  };
  readonly experiences: {
    /** POST /v1/experiences/resolve — expand items/realizations into experiences. */
    resolve(request: ResolveRequestInput, options?: CallOptions): Promise<ResolveResult>;
  };
  /** S2-002/S2-004: the /v1/webhooks route family (scope: webhooks). */
  readonly webhookEndpoints: {
    /**
     * POST /v1/webhooks/endpoints — register an endpoint. The response
     * carries the ONE-TIME `whsec_…` signing secret (issued at creation,
     * never returned again — store it immediately).
     */
    create(endpoint: WebhookEndpointCreateInput, options?: CallOptions): Promise<WebhookEndpointCreated>;
    /** GET /v1/webhooks/endpoints?limit&starting_after — one cursor page. */
    listPage(options?: ListOptions): Promise<WebhookEndpointPage>;
    /** Auto-paginating async iterator over every endpoint (follows next_cursor). */
    list(options?: ListOptions): AsyncIterable<WebhookEndpointView>;
    /** GET /v1/webhooks/endpoints/{endpointId} — the endpoint view (404 when unknown). */
    get(endpointId: string, options?: CallOptions): Promise<WebhookEndpointView>;
    /** DELETE /v1/webhooks/endpoints/{endpointId} — delete; returns the deleted view (404 when unknown). */
    delete(endpointId: string, options?: CallOptions): Promise<WebhookEndpointView>;
  };
  readonly webhookEvents: {
    /** GET /v1/webhooks/events/{eventId} — a stored thin event (30-day retention; 404 when unknown). */
    get(eventId: string, options?: CallOptions): Promise<ReckonEvent>;
    /**
     * POST /v1/webhooks/events/{eventId}/replay — re-deliver the SAME
     * event id to every currently-matching endpoint (at-least-once;
     * receivers dedupe on event.id). Returns the event + the replay
     * deliveries it created.
     */
    replay(eventId: string, options?: CallOptions): Promise<WebhookReplayResponse>;
  };
  readonly webhookDeliveries: {
    /** GET /v1/webhooks/deliveries?limit&starting_after&endpoint_id&event_id — the delivery log, one cursor page. */
    listPage(options?: WebhookDeliveryListOptions): Promise<WebhookDeliveryPage>;
    /** Auto-paginating async iterator over every delivery (accepts the endpoint_id/event_id filters). */
    list(options?: WebhookDeliveryListOptions): AsyncIterable<WebhookDeliveryView>;
  };
  /**
   * TL6-001: the self-serve account surface. These routes are
   * SESSION-authenticated: each method takes the session token (from
   * signup/login) as its auth parameter — the client's apiKey is NOT
   * used for this family.
   */
  readonly account: {
    /** POST /v1/account/signup — 201: the account + its FIRST session (token shown once). */
    signup(request: SignupInput, options?: CallOptions): Promise<AccountSessionResponse>;
    /** POST /v1/account/login — 200: a fresh session (token shown once; 401 on bad credentials). */
    login(request: LoginInput, options?: CallOptions): Promise<AccountSessionResponse>;
    /** POST /v1/account/logout — 204; the session token is revoked. */
    logout(sessionToken: string, options?: CallOptions): Promise<void>;
    /** GET /v1/account/keys — the account's keys, newest first (metadata only; secrets are never re-shown). */
    listAccountKeys(sessionToken: string, options?: CallOptions): Promise<readonly AccountKey[]>;
    /** POST /v1/account/keys — mint a key; the RAW key appears in the response EXACTLY ONCE. */
    createAccountKey(
      sessionToken: string,
      request: CreateAccountKeyInput,
      options?: CallOptions,
    ): Promise<AccountKeyCreated>;
    /** DELETE /v1/account/keys/{keyId} — revoke (204); the key stops authenticating immediately. */
    revokeAccountKey(sessionToken: string, keyId: string, options?: CallOptions): Promise<void>;
  };
}

/* ------------------------------------------------------------------ *
 * Client construction                                                  *
 * ------------------------------------------------------------------ */

const CONTENT_TYPE_JSON = "application/json";

/** The frozen wire error-envelope shape (apps/api ERROR-MODEL LAW). */
interface ErrorEnvelopeShape {
  error?: { code?: unknown; message?: unknown; details?: unknown; class?: unknown; param?: unknown; doc_url?: unknown };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseOrIssues<T>(schema: Parseable<T>, input: unknown): { ok: true; data: T } | { ok: false; issues: readonly SdkValidationIssue[] } {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, issues: toSdkValidationIssues(result.error) };
}

/** Compose the hardened-list query string (limit / starting_after / endpoint_id / event_id / expand[]). */
function listQueryString(params: {
  limit?: number;
  startingAfter?: string;
  endpointId?: string;
  eventId?: string;
  expand?: readonly string[];
} = {}): string {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.startingAfter !== undefined) query.set("starting_after", params.startingAfter);
  if (params.endpointId !== undefined) query.set("endpoint_id", params.endpointId);
  if (params.eventId !== undefined) query.set("event_id", params.eventId);
  if (params.expand !== undefined) {
    for (const path of params.expand) query.append("expand[]", path);
  }
  const qs = query.toString();
  return qs.length > 0 ? `?${qs}` : "";
}

/**
 * The auto-paginating iterator core (S2-004): yields every item of every
 * page, following `next_cursor` until `has_more` is false. Pages are
 * fetched lazily — one request per page, newest-first stable order.
 */
async function* autoPaginate<T>(
  fetchPage: (startingAfter: string | undefined) => Promise<PageOf<T>>,
): AsyncGenerator<T, void, void> {
  let cursor: string | undefined = undefined;
  for (;;) {
    const page = await fetchPage(cursor);
    for (const item of page.items) {
      yield item;
    }
    if (!page.has_more || page.next_cursor === null) return;
    cursor = page.next_cursor;
  }
}

export function createReckonClient(options: ReckonClientOptions): ReckonClient {
  if (!isNonEmptyString(options.baseUrl)) {
    throw new ReckonConfigError("createReckonClient: baseUrl must be a non-empty string");
  }
  if (!isNonEmptyString(options.apiKey)) {
    throw new ReckonConfigError("createReckonClient: apiKey must be a non-empty string");
  }
  // S2-001: a pinned apiVersion must be well-formed before it is ever
  // sent (the server rejects unregistered versions with a typed 400 —
  // the client only guards the format, never the registry).
  if (options.apiVersion !== undefined) {
    const parsedVersion = ApiVersionSchema.safeParse(options.apiVersion);
    if (!parsedVersion.success) {
      throw new ReckonConfigError(
        "createReckonClient: apiVersion must be a semver (X.Y.Z) or calendar date (YYYY-MM-DD) string",
        { issues: toSdkValidationIssues(parsedVersion.error) },
      );
    }
  }
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl: FetchLike =
    options.fetchImpl ?? ((url, init) => fetch(url, { method: init.method, headers: init.headers, body: init.body }));
  const idGenerator = options.idGenerator ?? (() => crypto.randomUUID());
  const defaultHeaders = { ...(options.defaultHeaders ?? {}) };

  /** S2-003: mode of the key that served the most recent response (X-Reckon-Mode). */
  let lastMode: "live" | "test" | undefined;

  /** Record the S2-003 mode marker carried by every authenticated response. */
  function noteResponseMode(response: Response): "live" | "test" | undefined {
    const headerMode = response.headers.get(X_RECKON_MODE_HEADER);
    if (headerMode === "live" || headerMode === "test") {
      lastMode = headerMode;
      return headerMode;
    }
    return undefined;
  }

  /** Generate (or take) the Idempotency-Key header for header-keyed routes. */
  function headerIdempotencyKey(explicit: string | undefined): string {
    const key = explicit ?? idGenerator();
    const parsed = IdSchema.safeParse(key);
    if (!parsed.success) {
      throw new ReckonConfigError(
        "idempotency key is not a valid Reckon id (1-128 chars, url-safe); check the idGenerator or CallOptions.idempotencyKey",
        { issues: toSdkValidationIssues(parsed.error) },
      );
    }
    return parsed.data;
  }

  /**
   * TL6-001: session-token auth for the /v1/account family — the bearer
   * credential is the reckonsess_ token (validated before it is sent);
   * it overrides the client's apiKey header for these calls only.
   */
  function sessionAuthHeaders(sessionToken: string, options?: CallOptions): Record<string, string> {
    const parsed = SessionTokenSchema.safeParse(sessionToken);
    if (!parsed.success) {
      throw new ReckonConfigError(
        "session token is not a well-formed reckonsess_… token (issued once at signup or login)",
        { issues: toSdkValidationIssues(parsed.error) },
      );
    }
    return {
      authorization: `Bearer ${sessionToken}`,
      ...(options?.idempotencyKey !== undefined
        ? { "idempotency-key": headerIdempotencyKey(options.idempotencyKey) }
        : {}),
      ...(options?.headers ?? {}),
    };
  }

  /**
   * The single request pipeline: request validation → fetch → JSON decode →
   * typed error mapping (never raw failures) → response contract validation.
   *
   * TL6-001: `allowNoContent` supports the 204-no-content routes
   * (account logout / key revoke): a 204 carries no body and no
   * content-type, so it resolves to `undefined` without JSON parsing;
   * any OTHER 2xx status still runs the full contract validation.
   */
  async function request<B, R>(spec: {
    method: "GET" | "POST" | "DELETE";
    path: string;
    requestSchema?: Parseable<B>;
    requestBody?: unknown;
    responseSchema: Parseable<R>;
    responseContract: string;
    headers?: Record<string, string>;
    allowNoContent?: boolean;
  }): Promise<R> {
    let bodyToSend: B | undefined;
    if (spec.requestSchema !== undefined && spec.requestBody !== undefined) {
      const parsed = parseOrIssues(spec.requestSchema, spec.requestBody);
      if (!parsed.ok) {
        throw new ReckonValidationError("SDK_REQUEST_INVALID", `request failed ${spec.responseContract} validation before it was sent`, {
          issues: parsed.issues,
        });
      }
      bodyToSend = parsed.data;
    }

    const url = `${baseUrl}${spec.path}`;
    // Content-Type rides only requests that carry a JSON body — a
    // bodyless GET/DELETE must not claim one (fastify's body parser
    // rejects an empty body declared as application/json).
    const headers: Record<string, string> = {
      authorization: `Bearer ${options.apiKey}`,
      ...(bodyToSend !== undefined ? { "content-type": CONTENT_TYPE_JSON } : {}),
      ...(options.apiVersion !== undefined ? { [X_RECKON_VERSION_HEADER]: options.apiVersion } : {}),
      ...defaultHeaders,
      ...(spec.headers ?? {}),
    };

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: spec.method,
        headers,
        body: bodyToSend !== undefined ? JSON.stringify(bodyToSend) : undefined,
      });
    } catch (cause) {
      throw new ReckonTransportError("SDK_TRANSPORT_ERROR", `request to ${spec.path} failed at the transport layer`, { cause, statusCode: undefined });
    }

    // TL6-001: a 204 carries no body and no content-type — resolve void.
    if (spec.allowNoContent === true && response.status === 204) {
      noteResponseMode(response);
      return undefined as R;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes(CONTENT_TYPE_JSON)) {
      throw new ReckonTransportError("SDK_TRANSPORT_ERROR", `response from ${spec.path} is not application/json (content-type: ${contentType || "none"}, status ${response.status})`, { statusCode: response.status });
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (cause) {
      throw new ReckonTransportError("SDK_TRANSPORT_ERROR", `response body from ${spec.path} is not valid JSON (status ${response.status})`, { cause, statusCode: response.status });
    }

    if (!response.ok) {
      // S2-003: the mode marker rides typed errors too — a failed test-mode
      // request is still identifiable as test traffic.
      const mode = noteResponseMode(response);
      const envelope = json as ErrorEnvelopeShape;
      const error = envelope?.error;
      const code = typeof error?.code === "string" ? (error.code as SdkServerErrorCode) : undefined;
      const message = typeof error?.message === "string" && error.message.length > 0 ? error.message : `request to ${spec.path} failed with status ${response.status}`;
      const retryAfterRaw = response.headers.get("retry-after");
      const retryAfterSeconds = retryAfterRaw !== null && /^\d+$/.test(retryAfterRaw) ? Number(retryAfterRaw) : undefined;
      const wireOptions = {
        statusCode: response.status,
        details: error?.details,
        ...(typeof error?.class === "string" ? { errorClass: error.class } : {}),
        ...(typeof error?.param === "string" ? { param: error.param } : {}),
        ...(typeof error?.doc_url === "string" ? { docUrl: error.doc_url } : {}),
        ...(mode !== undefined ? { mode } : {}),
        ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
        ...(response.headers.get("idempotent-replayed") === "true" ? { idempotentReplayed: true } : {}),
      };
      if (code === undefined) {
        throw new ReckonTransportError("SDK_UNEXPECTED_ERROR_SHAPE", `error response from ${spec.path} does not carry the typed error envelope (status ${response.status})`, wireOptions);
      }
      throw mapServerError(code, message, wireOptions);
    }

    noteResponseMode(response);
    const parsedResponse = parseOrIssues(spec.responseSchema, json);
    if (!parsedResponse.ok) {
      throw new ReckonResponseContractError(
        `2xx response from ${spec.path} failed ${spec.responseContract} validation — the server violates the frozen contract`,
        { issues: parsedResponse.issues, statusCode: response.status },
      );
    }
    return parsedResponse.data;
  }

  const client: ReckonClient = {
    lastResponseMode: () => lastMode,
    decisions: {
      request: async (input) =>
        request<z.output<typeof DecisionRequestSchema>, DecisionResult>({
          method: "POST",
          path: "/v1/decisions",
          requestSchema: DecisionRequestSchema,
          requestBody: input,
          responseSchema: DecisionResultSchema,
          responseContract: "reckon.decision-request → reckon.decision-result",
        }),
      get: async (decisionId, callOptions) =>
        request<unknown, ExpandedDecisionResult>({
          method: "GET",
          path: `/v1/decisions/${encodeURIComponent(decisionId)}${listQueryString({ expand: callOptions?.expand })}`,
          // The expanded surface is a superset of the frozen base contract
          // (item is optional/nullable) so it validates both responses.
          responseSchema: ExpandedDecisionResultSchema,
          responseContract: "reckon.decision-result (+ ?expand[] embeddings)",
          headers: { ...(callOptions?.headers ?? {}) },
        }),
    },
    outcomes: {
      append: async (event) =>
        request<z.output<typeof OutcomeEventSchema>, OutcomeEvent>({
          method: "POST",
          path: "/v1/outcomes",
          requestSchema: OutcomeEventSchema,
          requestBody: event,
          responseSchema: OutcomeEventSchema,
          responseContract: "reckon.outcome-event",
        }),
    },
    preferences: {
      appendDelta: async (delta, callOptions) =>
        request<z.output<typeof PreferenceDeltaSchema>, PreferenceDelta>({
          method: "POST",
          path: "/v1/preferences/events",
          requestSchema: PreferenceDeltaSchema,
          requestBody: delta,
          responseSchema: PreferenceDeltaSchema,
          responseContract: "reckon.preference-delta",
          headers: {
            "idempotency-key": headerIdempotencyKey(callOptions?.idempotencyKey),
            ...(callOptions?.headers ?? {}),
          },
        }),
    },
    plans: {
      create: async (plan, callOptions) =>
        request<z.output<typeof ExperiencePlanSchema>, ExperiencePlan>({
          method: "POST",
          path: "/v1/plans",
          requestSchema: ExperiencePlanSchema,
          requestBody: plan,
          responseSchema: ExperiencePlanSchema,
          responseContract: "reckon.experience-plan",
          headers: {
            "idempotency-key": headerIdempotencyKey(callOptions?.idempotencyKey),
            ...(callOptions?.headers ?? {}),
          },
        }),
      replan: async (planId, replanRequest, callOptions) =>
        request<z.output<typeof ReplanRequestSchema>, ExperiencePlan>({
          method: "POST",
          path: `/v1/plans/${encodeURIComponent(planId)}/replan`,
          requestSchema: ReplanRequestSchema,
          requestBody: replanRequest,
          responseSchema: ExperiencePlanSchema,
          responseContract: "reckon.api.replan-request → reckon.experience-plan",
          headers: {
            "idempotency-key": headerIdempotencyKey(callOptions?.idempotencyKey),
            ...(callOptions?.headers ?? {}),
          },
        }),
      get: async (planId, callOptions) =>
        request<unknown, ExperiencePlan>({
          method: "GET",
          path: `/v1/plans/${encodeURIComponent(planId)}`,
          responseSchema: ExperiencePlanSchema,
          responseContract: "reckon.experience-plan",
          headers: { ...(callOptions?.headers ?? {}) },
        }),
      history: async (planId, callOptions) =>
        (await request<unknown, { versions: PlanVersionEntry[] }>({
          method: "GET",
          path: `/v1/plans/${encodeURIComponent(planId)}/history`,
          responseSchema: PlanHistorySchema,
          responseContract: "reckon.experience-plan (version chain)",
          headers: { ...(callOptions?.headers ?? {}) },
        })).versions,
      listRecent: async (callOptions) =>
        (await request<unknown, { plans: ExperiencePlan[] }>({
          method: "GET",
          path: `/v1/plans${callOptions?.limit !== undefined ? `?limit=${encodeURIComponent(String(callOptions.limit))}` : ""}`,
          responseSchema: PlanCollectionSchema,
          responseContract: "reckon.experience-plan (recent plans)",
          headers: { ...(callOptions?.headers ?? {}) },
        })).plans,
      listPage: async (callOptions) =>
        request<unknown, PlanPage>({
          method: "GET",
          path: `/v1/plans${listQueryString(callOptions)}`,
          responseSchema: PlanPageSchema,
          responseContract: "reckon.experience-plan (cursor page)",
          headers: { ...(callOptions?.headers ?? {}) },
        }),
      list: (callOptions) =>
        autoPaginate<ExperiencePlan>((startingAfter) =>
          client.plans
            .listPage({ ...callOptions, startingAfter })
            .then((page) => ({ items: page.plans, has_more: page.has_more, next_cursor: page.next_cursor })),
        ),
    },
    integrations: {
      listAdapters: async (callOptions) =>
        (await request<unknown, { adapters: AdapterDeclarationView[] }>({
          method: "GET",
          path: "/v1/integrations/adapters",
          responseSchema: AdapterListSchema,
          responseContract: "reckon.api.adapter-declaration (static product truth)",
          headers: { ...(callOptions?.headers ?? {}) },
        })).adapters,
    },
    research: {
      enqueueJob: async (job, callOptions) =>
        request<ResearchJobInput, ResearchJobView>({
          method: "POST",
          path: "/v1/research/jobs",
          requestSchema: z.object({ jobId: IdSchema, kind: IdSchema, payload: z.unknown().optional() }) as never,
          requestBody: job,
          responseSchema: ResearchJobViewSchema,
          responseContract: "reckon.api.research-job",
          headers: {
            "idempotency-key": headerIdempotencyKey(callOptions?.idempotencyKey),
            ...(callOptions?.headers ?? {}),
          },
        }),
      getJob: async (jobId, callOptions) =>
        request<unknown, ResearchJobView>({
          method: "GET",
          path: `/v1/research/jobs/${encodeURIComponent(jobId)}`,
          responseSchema: ResearchJobViewSchema,
          responseContract: "reckon.api.research-job",
          headers: { ...(callOptions?.headers ?? {}) },
        }),
      listJobs: async (callOptions) => {
        const params = new URLSearchParams();
        if (callOptions?.limit !== undefined) params.set("limit", String(callOptions.limit));
        if (callOptions?.state !== undefined) params.set("state", callOptions.state);
        const qs = params.toString();
        return (await request<unknown, { jobs: ResearchJobView[] }>({
          method: "GET",
          path: `/v1/research/jobs${qs ? `?${qs}` : ""}`,
          responseSchema: ResearchJobListSchema,
          responseContract: "reckon.api.research-job (recent jobs)",
          headers: { ...(callOptions?.headers ?? {}) },
        })).jobs;
      },
    },
    agents: {
      createBody: async (body, callOptions) =>
        request<z.output<typeof AgentBodySchema>, AgentBody>({
          method: "POST",
          path: "/v1/agents/bodies",
          requestSchema: AgentBodySchema,
          requestBody: body,
          responseSchema: AgentBodySchema,
          responseContract: "reckon.agent-body",
          headers: {
            "idempotency-key": headerIdempotencyKey(callOptions?.idempotencyKey),
            ...(callOptions?.headers ?? {}),
          },
        }),
      getBody: async (bodyId, callOptions) =>
        request<unknown, AgentBody>({
          method: "GET",
          path: `/v1/agents/bodies/${encodeURIComponent(bodyId)}`,
          responseSchema: AgentBodySchema,
          responseContract: "reckon.agent-body",
          headers: { ...(callOptions?.headers ?? {}) },
        }),
      listBodies: async (callOptions) =>
        (await request<unknown, { bodies: AgentBody[] }>({
          method: "GET",
          path: `/v1/agents/bodies${callOptions?.limit !== undefined ? `?limit=${encodeURIComponent(String(callOptions.limit))}` : ""}`,
          responseSchema: AgentBodyListSchema,
          responseContract: "reckon.agent-body (recent bodies)",
          headers: { ...(callOptions?.headers ?? {}) },
        })).bodies,
      createOrganization: async (organization, callOptions) =>
        request<z.output<typeof AgentOrganizationSchema>, AgentOrganization>({
          method: "POST",
          path: "/v1/agents/organizations",
          requestSchema: AgentOrganizationSchema,
          requestBody: organization,
          responseSchema: AgentOrganizationSchema,
          responseContract: "reckon.agent-organization",
          headers: {
            "idempotency-key": headerIdempotencyKey(callOptions?.idempotencyKey),
            ...(callOptions?.headers ?? {}),
          },
        }),
      getOrganization: async (organizationId, callOptions) =>
        request<unknown, AgentOrganization>({
          method: "GET",
          path: `/v1/agents/organizations/${encodeURIComponent(organizationId)}`,
          responseSchema: AgentOrganizationSchema,
          responseContract: "reckon.agent-organization",
          headers: { ...(callOptions?.headers ?? {}) },
        }),
      listOrganizations: async (callOptions) =>
        (await request<unknown, { organizations: AgentOrganization[] }>({
          method: "GET",
          path: `/v1/agents/organizations${callOptions?.limit !== undefined ? `?limit=${encodeURIComponent(String(callOptions.limit))}` : ""}`,
          responseSchema: AgentOrganizationListSchema,
          responseContract: "reckon.agent-organization (recent organizations)",
          headers: { ...(callOptions?.headers ?? {}) },
        })).organizations,
    },
    catalog: {
      upsertItem: async (item, callOptions) =>
        request<z.output<typeof CatalogItemSchema>, CatalogItem>({
          method: "POST",
          path: "/v1/catalog/items",
          requestSchema: CatalogItemSchema,
          requestBody: item,
          responseSchema: CatalogItemSchema,
          responseContract: "reckon.catalog-item",
          headers: {
            "idempotency-key": headerIdempotencyKey(callOptions?.idempotencyKey),
            ...(callOptions?.headers ?? {}),
          },
        }),
      upsertRealization: async (realization, callOptions) =>
        request<z.output<typeof RealizationSchema>, Realization>({
          method: "POST",
          path: "/v1/catalog/realizations",
          requestSchema: RealizationSchema,
          requestBody: realization,
          responseSchema: RealizationSchema,
          responseContract: "reckon.realization",
          headers: {
            "idempotency-key": headerIdempotencyKey(callOptions?.idempotencyKey),
            ...(callOptions?.headers ?? {}),
          },
        }),
    },
    candidates: {
      submit: async (set, callOptions) =>
        request<z.output<typeof CandidateSetSchema>, CandidateSet>({
          method: "POST",
          path: "/v1/candidates",
          requestSchema: CandidateSetSchema,
          requestBody: set,
          responseSchema: CandidateSetSchema,
          responseContract: "reckon.candidate-set",
          headers: {
            "idempotency-key": headerIdempotencyKey(callOptions?.idempotencyKey),
            ...(callOptions?.headers ?? {}),
          },
        }),
    },
    experiences: {
      resolve: async (resolveRequest, callOptions) =>
        request<z.output<typeof ResolveRequestSchema>, ResolveResponse>({
          method: "POST",
          path: "/v1/experiences/resolve",
          requestSchema: ResolveRequestSchema,
          requestBody: resolveRequest,
          responseSchema: ResolveResponseSchema,
          responseContract: "reckon.api.resolve-request → reckon.experience",
          headers: {
            "idempotency-key": headerIdempotencyKey(callOptions?.idempotencyKey),
            ...(callOptions?.headers ?? {}),
          },
        }).then((parsed) => ({ experiences: parsed.experiences })),
    },
    webhookEndpoints: {
      create: async (endpoint, callOptions) =>
        request<z.output<typeof WebhookEndpointCreateSchema>, WebhookEndpointCreated>({
          method: "POST",
          path: "/v1/webhooks/endpoints",
          requestSchema: WebhookEndpointCreateSchema,
          requestBody: endpoint,
          responseSchema: WebhookEndpointCreatedSchema,
          responseContract: "reckon.api.webhook-endpoint-create → reckon.api.webhook-endpoint (+ one-time secret)",
          headers: {
            "idempotency-key": headerIdempotencyKey(callOptions?.idempotencyKey),
            ...(callOptions?.headers ?? {}),
          },
        }),
      listPage: async (callOptions) =>
        request<unknown, WebhookEndpointPage>({
          method: "GET",
          path: `/v1/webhooks/endpoints${listQueryString(callOptions)}`,
          responseSchema: WebhookEndpointPageSchema,
          responseContract: "reckon.api.webhook-endpoint (cursor page)",
          headers: { ...(callOptions?.headers ?? {}) },
        }),
      list: (callOptions) =>
        autoPaginate<WebhookEndpointView>((startingAfter) =>
          client.webhookEndpoints
            .listPage({ ...callOptions, startingAfter })
            .then((page) => ({ items: page.endpoints, has_more: page.has_more, next_cursor: page.next_cursor })),
        ),
      get: async (endpointId, callOptions) =>
        request<unknown, WebhookEndpointView>({
          method: "GET",
          path: `/v1/webhooks/endpoints/${encodeURIComponent(endpointId)}`,
          responseSchema: WebhookEndpointViewSchema,
          responseContract: "reckon.api.webhook-endpoint",
          headers: { ...(callOptions?.headers ?? {}) },
        }),
      delete: async (endpointId, callOptions) =>
        request<unknown, WebhookEndpointView>({
          method: "DELETE",
          path: `/v1/webhooks/endpoints/${encodeURIComponent(endpointId)}`,
          responseSchema: WebhookEndpointViewSchema,
          responseContract: "reckon.api.webhook-endpoint (deleted view)",
          headers: { ...(callOptions?.headers ?? {}) },
        }),
    },
    webhookEvents: {
      get: async (eventId, callOptions) =>
        request<unknown, ReckonEvent>({
          method: "GET",
          path: `/v1/webhooks/events/${encodeURIComponent(eventId)}`,
          responseSchema: ReckonEventSchema,
          responseContract: "reckon.api.webhook-event",
          headers: { ...(callOptions?.headers ?? {}) },
        }),
      replay: async (eventId, callOptions) =>
        request<{ [k: string]: never }, WebhookReplayResponse>({
          method: "POST",
          path: `/v1/webhooks/events/${encodeURIComponent(eventId)}/replay`,
          // The frozen replay body is the empty object (no fields — the
          // idempotency digest stays deterministic over the route key).
          requestSchema: z.object({}),
          requestBody: {},
          responseSchema: WebhookReplayResponseSchema,
          responseContract: "reckon.api.webhook-event-replay",
          headers: {
            "idempotency-key": headerIdempotencyKey(callOptions?.idempotencyKey),
            ...(callOptions?.headers ?? {}),
          },
        }),
    },
    webhookDeliveries: {
      listPage: async (callOptions) =>
        request<unknown, WebhookDeliveryPage>({
          method: "GET",
          path: `/v1/webhooks/deliveries${listQueryString(callOptions)}`,
          responseSchema: WebhookDeliveryPageSchema,
          responseContract: "reckon.api.webhook-delivery (cursor page)",
          headers: { ...(callOptions?.headers ?? {}) },
        }),
      list: (callOptions) =>
        autoPaginate<WebhookDeliveryView>((startingAfter) =>
          client.webhookDeliveries
            .listPage({ ...callOptions, startingAfter })
            .then((page) => ({ items: page.deliveries, has_more: page.has_more, next_cursor: page.next_cursor })),
        ),
    },
    // TL6-001: the self-serve account surface — session-token auth via the
    // per-method sessionToken parameter; every response is zod-parsed
    // against the frozen account contracts.
    account: {
      signup: async (signupRequest, callOptions) =>
        request<z.output<typeof SignupRequestSchema>, AccountSessionResponse>({
          method: "POST",
          path: "/v1/account/signup",
          requestSchema: SignupRequestSchema,
          requestBody: signupRequest,
          responseSchema: AccountSessionResponseSchema,
          responseContract: "reckon.api.account-session-response (signup)",
          headers: {
            ...(callOptions?.idempotencyKey !== undefined
              ? { "idempotency-key": headerIdempotencyKey(callOptions.idempotencyKey) }
              : {}),
            ...(callOptions?.headers ?? {}),
          },
        }),
      login: async (loginRequest, callOptions) =>
        request<z.output<typeof LoginRequestSchema>, AccountSessionResponse>({
          method: "POST",
          path: "/v1/account/login",
          requestSchema: LoginRequestSchema,
          requestBody: loginRequest,
          responseSchema: AccountSessionResponseSchema,
          responseContract: "reckon.api.account-session-response (login)",
          headers: {
            ...(callOptions?.idempotencyKey !== undefined
              ? { "idempotency-key": headerIdempotencyKey(callOptions.idempotencyKey) }
              : {}),
            ...(callOptions?.headers ?? {}),
          },
        }),
      logout: async (sessionToken, callOptions) => {
        await request<unknown, void>({
          method: "POST",
          path: "/v1/account/logout",
          responseSchema: VoidResponseSchema,
          responseContract: "reckon.api.account-logout (204 no content)",
          allowNoContent: true,
          headers: sessionAuthHeaders(sessionToken, callOptions),
        });
      },
      listAccountKeys: async (sessionToken, callOptions) =>
        (
          await request<unknown, { keys: AccountKey[] }>({
            method: "GET",
            path: "/v1/account/keys",
            responseSchema: AccountKeyListSchema,
            responseContract: "reckon.api.account-key (list)",
            headers: sessionAuthHeaders(sessionToken, callOptions),
          })
        ).keys,
      createAccountKey: async (sessionToken, keyRequest, callOptions) =>
        request<z.output<typeof CreateKeyRequestSchema>, AccountKeyCreated>({
          method: "POST",
          path: "/v1/account/keys",
          requestSchema: CreateKeyRequestSchema,
          requestBody: keyRequest,
          responseSchema: AccountKeyCreatedSchema,
          responseContract: "reckon.api.account-key-created (raw key shown once)",
          headers: sessionAuthHeaders(sessionToken, callOptions),
        }),
      revokeAccountKey: async (sessionToken, keyId, callOptions) => {
        await request<unknown, void>({
          method: "DELETE",
          path: `/v1/account/keys/${encodeURIComponent(keyId)}`,
          responseSchema: VoidResponseSchema,
          responseContract: "reckon.api.account-key (revoke, 204 no content)",
          allowNoContent: true,
          headers: sessionAuthHeaders(sessionToken, callOptions),
        });
      },
    },
  };
  return client;
}

/** Type guard for callers that want to discriminate SDK failures by code. */
export function isReckonSdkError(value: unknown): value is ReckonSdkError {
  return value instanceof ReckonSdkError;
}
