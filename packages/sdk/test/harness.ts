/**
 * SDK test harness (controlled-local evidence class).
 *
 * Spins the REAL apps/api fastify application in-process (buildServer from
 * the actual repository source — never a hand-rolled fake) with deterministic
 * handler ports, and adapts it to the SDK's injectable fetch seam via
 * light-my-request (app.inject). The full route pipeline — bearer-key auth,
 * scope enforcement, tenant law, zod validation, idempotent replay, typed
 * error envelopes — is exercised for real on every SDK call.
 */
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../../apps/api/src/index.js";
import type { HandlerPorts } from "../../../apps/api/src/ports.js";
import type { ApiConfig } from "../../../apps/api/src/config.js";
import type { StaticKeyConfig } from "../../../apps/api/src/auth.js";
import {
  createInMemoryWebhookSystem,
  ManualWebhookClock,
  InMemoryWebhookSystem,
} from "../../../apps/api/src/webhooks/in-memory.js";
import type { WebhookHttpClient, WebhookHttpResponse } from "../../../apps/api/src/webhooks/ports.js";
import { generateSecretKey } from "@reckon/contracts";
import { createInjectFetch } from "../src/testing.js";
import type {
  CandidateSetInput,
  CatalogItemInput,
  DecisionRequestInput,
  ExperiencePlanInput,
  FetchLike,
  OutcomeEventInput,
  PreferenceDeltaInput,
  RealizationInput,
  ResolveRequestInput,
} from "../src/client.js";
import type {
  CandidateSet,
  CatalogItem,
  DecisionRequest,
  DecisionResult,
  ExperiencePlan,
  OutcomeEvent,
  PreferenceDelta,
  Realization,
} from "@reckon/contracts";
import {
  DecisionResultSchema,
  ExperiencePlanSchema,
  ExperienceSchema,
} from "@reckon/contracts";

const ALL_RUNTIME_SCOPES = ["decisions", "outcomes", "plans", "catalog"] as const;

export const TENANT_A = "sdk-tenant-a";
export const TENANT_B = "sdk-tenant-b";
export const TENANT_C = "sdk-tenant-c";

/**
 * S2-003/S2-004: generated sk_test_/sk_live_ keys for the mode matrix.
 * Generated at RUNTIME (never string literals — the secret-scanner law:
 * test fixtures must not contain realistic long alphanumeric runs
 * after the sk_/whsec_ prefixes). Tenant A, every scope.
 */
export const SDK_TEST_KEY = generateSecretKey("test");
export const SDK_LIVE_KEY = generateSecretKey("live");

export const SDK_KEYS: readonly StaticKeyConfig[] = [
  { apiKey: "sdk-alpha", tenantId: TENANT_A, scopes: [...ALL_RUNTIME_SCOPES] },
  { apiKey: "sdk-beta", tenantId: TENANT_B, scopes: ["decisions"] },
  { apiKey: "sdk-gamma", tenantId: TENANT_C, scopes: ["outcomes"] },
  { apiKey: SDK_TEST_KEY, tenantId: TENANT_A, scopes: ["decisions", "outcomes", "plans", "catalog", "webhooks"] },
  { apiKey: SDK_LIVE_KEY, tenantId: TENANT_A, scopes: ["decisions", "outcomes", "plans", "catalog", "webhooks"] },
];

export interface HarnessState {
  decisionCalls: number;
  outcomeCalls: number;
  preferenceCalls: number;
  planCreateCalls: number;
  replanCalls: number;
  catalogItemCalls: number;
  realizationCalls: number;
  candidateCalls: number;
  resolveCalls: number;
  outcomeTenants: string[];
  decisions: Map<string, DecisionResult>;
}

export function newHarnessState(): HarnessState {
  return {
    decisionCalls: 0,
    outcomeCalls: 0,
    preferenceCalls: 0,
    planCreateCalls: 0,
    replanCalls: 0,
    catalogItemCalls: 0,
    realizationCalls: 0,
    candidateCalls: 0,
    resolveCalls: 0,
    outcomeTenants: [],
    decisions: new Map<string, DecisionResult>(),
  };
}

/** Deterministic wired handler ports (the injectable seams of the real API). */
export function deterministicHandlers(state: HarnessState): HandlerPorts {
  const plansById = new Map<string, ExperiencePlan>();
  return {
    integrationHandler: {
      listAdapters: async () => [],
    },
    researchHandler: {
      enqueue: async (job) => ({
        jobId: job.jobId,
        kind: job.kind,
        state: "queued" as const,
        payload: job.payload ?? null,
        resultRef: null,
        createdAt: 0,
        updatedAt: 0,
      }),
      get: async () => null,
      list: async () => [],
    },
    agentHandler: {
      createBody: async (body) => body,
      getBody: async () => null,
      listBodies: async () => [],
      createOrganization: async (organization) => organization,
      getOrganization: async () => null,
      listOrganizations: async () => [],
    },
    decisionHandler: {
      decide: async (request: DecisionRequest, auth) => {
        state.decisionCalls += 1;
        const first = request.candidates.candidates[0];
        const result = DecisionResultSchema.parse({
          decisionId: `dec-${auth.tenantId}-${request.idempotencyKey}`,
          requestId: request.requestId,
          tenant: request.tenant,
          action: "SUGGEST",
          // A real selected experience (built from the first candidate) so
          // the S2-004 ?expand[]=selectedExperience.item surface has
          // something to expand on the harness.
          selectedExperience:
            first === undefined
              ? undefined
              : {
                  experienceId: "exp-1",
                  itemId: first.itemId,
                  realizationId: first.realizationIds[0] ?? "real-1",
                  format: { kind: "full", params: {} },
                },
          uncertainty: { confidence: 0.72, method: "ensemble" },
          policy: { policyId: request.policySelector.policyId, version: request.policySelector.version },
          scheduleDelta: { action: "SUGGEST", enqueue: ["exp-1"] },
          reasons: [{ code: "stub", message: "deterministic harness decision" }],
          at: request.at ?? 1_000,
        });
        state.decisions.set(`${auth.tenantId}|${result.decisionId}`, result);
        return result;
      },
    },
    decisionStore: {
      get: async (tenantId: string, decisionId: string) => state.decisions.get(`${tenantId}|${decisionId}`) ?? null,
    },
    outcomeIngest: {
      ingest: async (event: OutcomeEvent, auth) => {
        state.outcomeCalls += 1;
        state.outcomeTenants.push(auth.tenantId);
        return event;
      },
    },
    preferenceIngest: {
      ingest: async (delta: PreferenceDelta) => {
        state.preferenceCalls += 1;
        return delta;
      },
    },
    planHandler: {
      create: async (plan: ExperiencePlan) => {
        state.planCreateCalls += 1;
        plansById.set(plan.planId, plan);
        return plan;
      },
      get: async (planId: string) => plansById.get(planId) ?? null,
      history: async (planId: string) => {
        const plan = plansById.get(planId);
        return plan === undefined ? [] : [{ plan, version: plan.version, reason: null }];
      },
      listRecent: async (_auth, limit) =>
        // Newest-first (the documented stable order every list route
        // promises) — the harness inserts in creation order, so serve
        // the reverse.
        [...plansById.values()].reverse().slice(0, limit ?? 20),
      replan: async (planId: string, request: { trigger: string }, auth) => {
        state.replanCalls += 1;
        return ExperiencePlanSchema.parse({
          planId,
          version: 1,
          tenant: { tenantId: auth.tenantId },
          subject: { kind: "user", ref: "user-9" },
          objective: { objectiveId: "obj-1", kind: "relax" },
          attentionPolicy: { policyId: "ap-1", style: "mindful" },
          queuedExperiences: [],
          replanTriggers: [request.trigger],
          createdAt: 0,
          updatedAt: 1,
        });
      },
    },
    catalogItemIngest: {
      ingest: async (item: CatalogItem) => {
        state.catalogItemCalls += 1;
        return item;
      },
    },
    // S2-001: catalog read port for response expansion — the SDK harness
    // does not exercise expansions, so the reader answers empty (null).
    catalogReader: {
      getItem: async () => null,
      getRealization: async () => null,
    },
    realizationIngest: {
      ingest: async (realization: Realization) => {
        state.realizationCalls += 1;
        return realization;
      },
    },
    candidatesHandler: {
      submit: async (set: CandidateSet) => {
        state.candidateCalls += 1;
        return set;
      },
    },
    experienceResolver: {
      resolve: async (request: { realizations: Realization[] }) => {
        state.resolveCalls += 1;
        return {
          experiences: request.realizations.map((r) =>
            ExperienceSchema.parse({
              experienceId: `exp-${r.itemId}-${r.realizationId}`,
              itemId: r.itemId,
              realizationId: r.realizationId,
              format: { kind: "full", params: {} },
            }),
          ),
        };
      },
    },
    // S2-002: webhook surface — the SDK harness does not exercise
    // webhooks, so the port answers empty/absent (nulls / empty lists).
    webhookHandler: {
      createEndpoint: async () => {
        throw new Error("webhook endpoints are not exercised by the SDK harness");
      },
      listEndpoints: async () => [],
      getEndpoint: async () => null,
      deleteEndpoint: async () => null,
      getEvent: async () => null,
      replayEvent: async () => null,
      listDeliveries: async () => [],
    },
  };
}

export interface SdkTestHarness {
  readonly app: FastifyInstance;
  readonly fetch: FetchLike;
  readonly state: HarnessState;
  /** Present when the harness was built with the in-memory webhook system. */
  readonly webhooks?: InMemoryWebhookSystem;
  readonly webhookClock?: ManualWebhookClock;
  readonly webhookClient?: RecordingWebhookClient;
}

/** Harness config: the ApiConfig passthrough plus webhook-system wiring. */
export interface HarnessOptions extends Omit<Partial<ApiConfig>, "webhooks"> {
  /**
   * S2-004: mount the REAL in-memory webhook system through the real
   * composition path (config.webhooks) — endpoint CRUD, event
   * retention, replay and the delivery log all become real, backed by
   * a recording outbound client (default: 200 in 1ms) and a manual
   * clock (seeded at build time) so signature timestamps stay inside
   * the tolerance window.
   */
  readonly webhooks?: boolean;
}

/** Build the real API app + the inject-based fetch for the SDK. */
export function buildHarness(options: HarnessOptions = {}): SdkTestHarness {
  const state = newHarnessState();
  const { webhooks: wireWebhooks, ...config } = options;
  // Handler overrides merge over the deterministic defaults (top-level
  // port granularity — enough for e.g. a real catalogReader in the
  // expansion test).
  const handlers: HandlerPorts = {
    ...deterministicHandlers(state),
    ...(config.handlers ?? {}),
  };
  // buildServer forbids mounting config.webhooks together with
  // handlers.webhookHandler — the system IS the handler when wired.
  const handlerConfig = wireWebhooks === true ? omitWebhookHandler(handlers) : handlers;

  if (wireWebhooks === true) {
    // Seed the manual clock at the REAL build time: delivery signatures
    // carry t = clock/1000 and the SDK verify helper defaults nowMs to
    // Date.now() — seeding keeps |now - t| inside the 300s tolerance.
    const clock = new ManualWebhookClock(Date.now());
    const client = new RecordingWebhookClient();
    const system = createInMemoryWebhookSystem({
      httpClient: client,
      clock: () => clock.now(),
    });
    const app = buildServer({
      apiVersion: "test",
      keys: [...SDK_KEYS],
      handlers: handlerConfig,
      clock: () => clock.now(),
      webhooks: system,
      ...configWithoutHandlers(config),
    });
    return { app, fetch: createInjectFetch(app), state, webhooks: system, webhookClock: clock, webhookClient: client };
  }

  const app = buildServer({
    apiVersion: "test",
    keys: [...SDK_KEYS],
    handlers,
    ...configWithoutHandlers(config),
  });
  return { app, fetch: createInjectFetch(app), state };
}

function omitWebhookHandler(handlers: HandlerPorts): HandlerPorts {
  const { webhookHandler: _omitted, ...rest } = handlers;
  return rest as HandlerPorts;
}

function configWithoutHandlers(config: Partial<ApiConfig>): Partial<ApiConfig> {
  const { handlers: _omitted, ...rest } = config;
  return rest;
}

/**
 * S2-004: a RECORDING outbound webhook client (mirrors the S2-002 API
 * test helper) — every delivery POST is captured with the exact bytes +
 * signature headers the engine signed, so SDK tests can assert the
 * signature verifies against the issued secret.
 */
export interface RecordedWebhookCall {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly rawBody: string;
}

export class RecordingWebhookClient implements WebhookHttpClient {
  readonly calls: RecordedWebhookCall[] = [];
  readonly #respond: (call: RecordedWebhookCall, index: number) => WebhookHttpResponse;

  constructor(
    respond: (call: RecordedWebhookCall, index: number) => WebhookHttpResponse = () => ({
      statusCode: 200,
      latencyMs: 1,
    }),
  ) {
    this.#respond = respond;
  }

  async post(url: string, headers: Record<string, string>, rawBody: string): Promise<WebhookHttpResponse> {
    const call = { url, headers, rawBody };
    this.calls.push(call);
    return this.#respond(call, this.calls.length - 1);
  }

  get count(): number {
    return this.calls.length;
  }

  last(): RecordedWebhookCall | undefined {
    return this.calls[this.calls.length - 1];
  }
}

/* --------------------------- request fixtures --------------------------- */

let idSequence = 0;
function freshId(prefix: string): string {
  idSequence += 1;
  return `${prefix}-${idSequence}`;
}

export function decisionRequestInput(overrides: Record<string, unknown> = {}): DecisionRequestInput {
  return {
    requestId: "req-1",
    tenant: { tenantId: TENANT_A },
    subject: { kind: "user", ref: "user-9" },
    objective: { objectiveId: "obj-1", kind: "relax" },
    attentionPolicy: { policyId: "ap-1", style: "balanced" },
    context: { contextId: "ctx-1" },
    candidates: {
      setId: "cs-1",
      candidates: [{ itemId: "item-1", realizationIds: ["real-1"], source: "host-retrieval" }],
    },
    policySelector: { policyId: "greedy-v1", version: "1" },
    idempotencyKey: freshId("idem"),
    ...overrides,
  } as DecisionRequestInput;
}

export function outcomeEventInput(overrides: Record<string, unknown> = {}): OutcomeEventInput {
  return {
    eventId: freshId("ev"),
    tenant: { tenantId: TENANT_A },
    subject: { kind: "user", ref: "user-9" },
    eventType: "completion",
    occurredAt: 2_000,
    metrics: { watchRatio: 0.9 },
    evidenceClass: "production-observed",
    decisionId: "dec-known-1",
    experienceId: "exp-1",
    idempotencyKey: freshId("outcome"),
    ...overrides,
  } as OutcomeEventInput;
}

export function preferenceDeltaInput(overrides: Record<string, unknown> = {}): PreferenceDeltaInput {
  return {
    deltaId: freshId("delta"),
    tenant: { tenantId: TENANT_A },
    subject: { kind: "user", ref: "user-9" },
    dimension: "genre.scifi",
    op: "add",
    value: 0.25,
    model: { modelId: "m-1", version: "3" },
    timestamp: 5_000,
    ...overrides,
  } as PreferenceDeltaInput;
}

export function planInput(overrides: Record<string, unknown> = {}): ExperiencePlanInput {
  return {
    planId: freshId("plan"),
    tenant: { tenantId: TENANT_A },
    subject: { kind: "user", ref: "user-9" },
    objective: { objectiveId: "obj-1", kind: "relax" },
    attentionPolicy: { policyId: "ap-1", style: "mindful" },
    queuedExperiences: [
      {
        experienceId: "exp-1",
        itemId: "item-1",
        realizationId: "real-1",
        format: { kind: "full", params: {} },
      },
    ],
    replanTriggers: ["context-changed"],
    createdAt: 0,
    updatedAt: 1,
    ...overrides,
  } as ExperiencePlanInput;
}

export function catalogItemInput(overrides: Record<string, unknown> = {}): CatalogItemInput {
  return { itemId: freshId("item"), kind: "media", labels: ["scifi"], attributes: { year: 2024 }, ...overrides } as CatalogItemInput;
}

export function realizationInput(overrides: Record<string, unknown> = {}): RealizationInput {
  return { realizationId: freshId("real"), itemId: "item-1", kind: "stream", constraints: {}, ...overrides } as RealizationInput;
}

export function candidateSetInput(overrides: Record<string, unknown> = {}): CandidateSetInput {
  return {
    setId: freshId("cs"),
    candidates: [{ itemId: "item-1", realizationIds: ["real-1"], source: "host-retrieval" }],
    ...overrides,
  } as CandidateSetInput;
}

export function resolveRequestInput(overrides: Record<string, unknown> = {}): ResolveRequestInput {
  return {
    items: [{ itemId: "item-1", kind: "media" }],
    realizations: [{ realizationId: "real-1", itemId: "item-1", kind: "stream" }],
    ...overrides,
  } as ResolveRequestInput;
}
