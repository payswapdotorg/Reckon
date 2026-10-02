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
  AgentBodySchema,
  AgentOrganizationSchema,
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
  PreferenceDeltaSchema,
  RealizationSchema,
  ReplanTriggerSchema,
  TenantScopeSchema,
} from "@reckon/contracts";
import type {
  CandidateSet,
  CatalogItem,
  DecisionResult,
  Experience,
  ExperiencePlan,
  OutcomeEvent,
  PreferenceDelta,
  Realization,
  AgentBody,
  AgentOrganization,
} from "@reckon/contracts";
// Re-export the frozen agent contract types so the SDK surface is
// self-contained for consumers (UI-007).
export type { AgentBody, AgentOrganization } from "@reckon/contracts";

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
export type AgentOrganizationInput = z.input<typeof AgentOrganizationSchema>;
export type CatalogItemInput = z.input<typeof CatalogItemSchema>;
export type RealizationInput = z.input<typeof RealizationSchema>;
export type CandidateSetInput = z.input<typeof CandidateSetSchema>;

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
  /** Injectable transport (default: global fetch). */
  readonly fetchImpl?: FetchLike;
  /** Idempotency-Key generator for header-keyed operations (default: crypto.randomUUID). */
  readonly idGenerator?: () => string;
  /** Headers sent on every request (e.g. X-Reckon-Tenant). */
  readonly defaultHeaders?: Record<string, string>;
}

export interface ReckonClient {
  readonly decisions: {
    /** POST /v1/decisions — request the next best action/experience. */
    request(request: DecisionRequestInput): Promise<DecisionResult>;
    /** GET /v1/decisions/{decisionId} — tenant-scoped lookup. */
    get(decisionId: string): Promise<DecisionResult>;
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
}

/* ------------------------------------------------------------------ *
 * Client construction                                                  *
 * ------------------------------------------------------------------ */

const CONTENT_TYPE_JSON = "application/json";

/** The frozen wire error-envelope shape (apps/api ERROR-MODEL LAW). */
interface ErrorEnvelopeShape {
  error?: { code?: unknown; message?: unknown; details?: unknown };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseOrIssues<T>(schema: Parseable<T>, input: unknown): { ok: true; data: T } | { ok: false; issues: readonly SdkValidationIssue[] } {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, issues: toSdkValidationIssues(result.error) };
}

export function createReckonClient(options: ReckonClientOptions): ReckonClient {
  if (!isNonEmptyString(options.baseUrl)) {
    throw new ReckonConfigError("createReckonClient: baseUrl must be a non-empty string");
  }
  if (!isNonEmptyString(options.apiKey)) {
    throw new ReckonConfigError("createReckonClient: apiKey must be a non-empty string");
  }
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl: FetchLike =
    options.fetchImpl ?? ((url, init) => fetch(url, { method: init.method, headers: init.headers, body: init.body }));
  const idGenerator = options.idGenerator ?? (() => crypto.randomUUID());
  const defaultHeaders = { ...(options.defaultHeaders ?? {}) };

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
   * The single request pipeline: request validation → fetch → JSON decode →
   * typed error mapping (never raw failures) → response contract validation.
   */
  async function request<B, R>(spec: {
    method: "GET" | "POST";
    path: string;
    requestSchema?: Parseable<B>;
    requestBody?: unknown;
    responseSchema: Parseable<R>;
    responseContract: string;
    headers?: Record<string, string>;
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
    const headers: Record<string, string> = {
      authorization: `Bearer ${options.apiKey}`,
      "content-type": CONTENT_TYPE_JSON,
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
      const envelope = json as ErrorEnvelopeShape;
      const error = envelope?.error;
      const code = typeof error?.code === "string" ? (error.code as SdkServerErrorCode) : undefined;
      const message = typeof error?.message === "string" && error.message.length > 0 ? error.message : `request to ${spec.path} failed with status ${response.status}`;
      if (code === undefined) {
        throw new ReckonTransportError("SDK_UNEXPECTED_ERROR_SHAPE", `error response from ${spec.path} does not carry the typed error envelope (status ${response.status})`, { statusCode: response.status, details: json });
      }
      throw mapServerError(code, message, { statusCode: response.status, details: error?.details });
    }

    const parsedResponse = parseOrIssues(spec.responseSchema, json);
    if (!parsedResponse.ok) {
      throw new ReckonResponseContractError(
        `2xx response from ${spec.path} failed ${spec.responseContract} validation — the server violates the frozen contract`,
        { issues: parsedResponse.issues, statusCode: response.status },
      );
    }
    return parsedResponse.data;
  }

  return {
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
      get: async (decisionId) =>
        request<unknown, DecisionResult>({
          method: "GET",
          path: `/v1/decisions/${encodeURIComponent(decisionId)}`,
          responseSchema: DecisionResultSchema,
          responseContract: "reckon.decision-result",
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
  };
}

/** Type guard for callers that want to discriminate SDK failures by code. */
export function isReckonSdkError(value: unknown): value is ReckonSdkError {
  return value instanceof ReckonSdkError;
}
