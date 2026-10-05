import { expect } from "vitest";
import { buildServer } from "../src/server.js";
import type { ApiConfig } from "../src/config.js";
import type { StaticKeyConfig } from "../src/auth.js";
import { KeyStore } from "../src/auth.js";
import type { HandlerPorts } from "../src/ports.js";
import { createInMemoryWebhookSystem } from "../src/webhooks/in-memory.js";
import type { WebhookHttpClient } from "../src/webhooks/ports.js";
import type { AuthContext } from "../src/types.js";
import type {
  CatalogItem,
  CandidateSet,
  DecisionRequest,
  DecisionResult,
  ExperiencePlan,
  OutcomeEvent,
  PreferenceDelta,
  Realization,
  TenantScope,
} from "@reckon/contracts";
import {
  CatalogItemSchema,
  DecisionResultSchema,
  ExperiencePlanSchema,
  ExperienceSchema,
  generatePublishableKey,
  generateSecretKey,
  type ErrorClass,
} from "@reckon/contracts";
import { ERROR_CLASSES } from "@reckon/contracts";
import type { FastifyInstance } from "fastify";

/**
 * Test fixtures: static keys, valid contract bodies per route, and server
 * builders (default = all NotWired; stub = wired deterministic handlers
 * for success-shape tests). Tests use fastify.inject only — no sockets.
 */

const ALL_RUNTIME_SCOPES = ["decisions", "outcomes", "plans", "catalog"] as const;

/**
 * S2-001 key fixtures: the legacy opaque keys (kept — the transition
 * accepts them) plus generated new-format keys: sk_live (tenant-a),
 * sk_test (tenant-t, all scopes) and a pk_live publishable key that is
 * configured but must never authenticate an API route.
 */
const SK_LIVE = generateSecretKey("live");
const SK_TEST = generateSecretKey("test");
const PK_LIVE = generatePublishableKey("live");

export const TEST_KEYS: StaticKeyConfig[] = [
  { apiKey: "test-key-alpha", tenantId: "tenant-a", scopes: [...ALL_RUNTIME_SCOPES] },
  { apiKey: "test-key-beta", tenantId: "tenant-b", scopes: ["decisions"] },
  { apiKey: "test-key-gamma", tenantId: "tenant-c", scopes: ["catalog"] },
  { apiKey: "test-key-ws", tenantId: "tenant-a", workspaceId: "ws-1", scopes: [...ALL_RUNTIME_SCOPES] },
  { apiKey: "test-key-research", tenantId: "tenant-r", scopes: ["research"] },
  { apiKey: "test-key-agents", tenantId: "tenant-a", scopes: ["agents"] },
  // S2-002: webhook-scoped keys (CRUD/replay/log surface for two tenants).
  { apiKey: "test-key-webhooks", tenantId: "tenant-a", scopes: ["webhooks"] },
  { apiKey: "test-key-webhooks-b", tenantId: "tenant-b", scopes: ["webhooks"] },
  { apiKey: SK_LIVE, tenantId: "tenant-a", scopes: [...ALL_RUNTIME_SCOPES] },
  { apiKey: SK_TEST, tenantId: "tenant-t", scopes: [...ALL_RUNTIME_SCOPES] },
  { apiKey: PK_LIVE, tenantId: "tenant-a", scopes: [...ALL_RUNTIME_SCOPES] },
];

export const ALPHA = "test-key-alpha";
export const BETA = "test-key-beta";
export const GAMMA = "test-key-gamma";
export const WS_KEY = "test-key-ws";
export const RESEARCH_KEY = "test-key-research";
export const AGENTS_KEY = "test-key-agents";
export const WEBHOOKS_KEY = "test-key-webhooks";
export const WEBHOOKS_KEY_B = "test-key-webhooks-b";
export const NEW_SK_LIVE = SK_LIVE;
export const NEW_SK_TEST = SK_TEST;
export const NEW_PK_LIVE = PK_LIVE;
export const TENANT_T = "tenant-t";

export const TENANT_A = "tenant-a";
export const TENANT_B = "tenant-b";
export const TENANT_C = "tenant-c";

let sequence = 0;
/** Fresh idempotency key per call so tests never collide on the replay map. */
export function freshIdem(prefix = "idem"): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

export const tenantA: TenantScope = { tenantId: TENANT_A };

const experience = {
  experienceId: "exp-1",
  itemId: "item-1",
  realizationId: "real-1",
  format: { kind: "full" as const, params: {} },
};

export function validDecisionRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
    idempotencyKey: freshIdem(),
    ...overrides,
  };
}

export function validOutcomeEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventId: "ev-1",
    tenant: { tenantId: TENANT_A },
    subject: { kind: "user", ref: "user-9" },
    eventType: "completion",
    occurredAt: 2_000,
    evidenceClass: "production-observed",
    idempotencyKey: freshIdem("outcome"),
    ...overrides,
  };
}

export function validPreferenceDelta(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    deltaId: "delta-1",
    tenant: { tenantId: TENANT_A },
    subject: { kind: "user", ref: "user-9" },
    dimension: "genre.scifi",
    op: "add",
    value: 0.25,
    model: { modelId: "m-1", version: "3" },
    timestamp: 5_000,
    ...overrides,
  };
}

export function validPlan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    planId: "plan-1",
    tenant: { tenantId: TENANT_A },
    subject: { kind: "user", ref: "user-9" },
    objective: { objectiveId: "obj-1", kind: "relax" },
    attentionPolicy: { policyId: "ap-1", style: "mindful" },
    queuedExperiences: [experience],
    replanTriggers: ["context-changed", "user-feedback"],
    createdAt: 0,
    updatedAt: 1,
    ...overrides,
  };
}

export function validReplanRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { trigger: "context-changed", ...overrides };
}

export function validCatalogItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { itemId: "item-1", kind: "media", labels: ["scifi"], attributes: { year: 2024 } , ...overrides };
}

export function validRealization(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { realizationId: "real-1", itemId: "item-1", kind: "stream", constraints: {} , ...overrides };
}

export function validCandidateSet(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    setId: "cs-1",
    candidates: [{ itemId: "item-1", realizationIds: ["real-1"], source: "host-retrieval" }],
    ...overrides,
  };
}

export function validResolveRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    items: [{ itemId: "item-1", kind: "media" }],
    realizations: [{ realizationId: "real-1", itemId: "item-1", kind: "stream" }],
    ...overrides,
  };
}

/** The full app config used by every test server. */
export function testConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return { keys: TEST_KEYS, ...overrides };
}

/** Default server: real key map + all NotWired handler ports. */
export function buildDefaultServer(overrides: Partial<ApiConfig> = {}): FastifyInstance {
  return buildServer(testConfig(overrides));
}

export interface StubState {
  decisionCalls: number;
  outcomeCalls: number;
  preferenceCalls: number;
  planCreateCalls: number;
  replanCalls: number;
  catalogItemCalls: number;
  realizationCalls: number;
  candidateCalls: number;
  resolveCalls: number;
  /** tenant ids observed by the outcome ingest port (proves auth flow). */
  outcomeTenants: string[];
  decisions: Map<string, DecisionResult>;
  /** In-memory catalog for the expansion reader (tenant|itemId → item). */
  catalogItems: Map<string, CatalogItem>;
  /** Modes observed by handler ports (proves key-mode propagation). */
  observedModes: string[];
  /** The tenant scopes the catalog reader observed (proves tenant scoping). */
  catalogReaderTenants: string[];
}

export function stubHandlers(state: StubState): HandlerPorts {
  const plansById = new Map<string, ExperiencePlan>();
  // S2-002: the stub webhook surface = the REAL in-memory system with a
  // deterministic always-2xx outbound client (webhook route tests build
  // their own systems with recording/failing clients).
  const webhookClient: WebhookHttpClient = {
    post: async () => ({ statusCode: 200, latencyMs: 0 }),
  };
  const webhookHandler = createInMemoryWebhookSystem({ httpClient: webhookClient });
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
        state.observedModes.push(auth.mode);
        return DecisionResultSchema.parse({
          decisionId: `dec-${auth.tenantId}-${request.idempotencyKey}`,
          requestId: request.requestId,
          tenant: request.tenant,
          action: "SUGGEST",
          policy: { policyId: request.policySelector.policyId, version: request.policySelector.version },
          at: request.at ?? 1_000,
          reasons: [{ code: "stub", message: "stub decision for tests" }],
        });
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
      ingest: async (delta: PreferenceDelta, auth: AuthContext) => {
        state.preferenceCalls += 1;
        // S2-003: mode propagation to delegated (non-canned) handler
        // routes is proven here — the test-mode decision path is canned
        // and never reaches mounted handlers.
        state.observedModes.push(auth.mode);
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
      listRecent: async (_auth, limit) => [...plansById.values()].reverse().slice(0, limit ?? 20),
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
      ingest: async (item: CatalogItem, auth) => {
        state.catalogItemCalls += 1;
        state.catalogItems.set(`${auth.tenantId}|${item.itemId}`, item);
        return item;
      },
    },
    // S2-001: expansion reader over the same in-memory catalog the ingest
    // stub writes — tenant-scoped reads, and it records observed tenants
    // so tests can prove the TENANT LAW holds on expansion reads.
    catalogReader: {
      getItem: async (tenant, itemId) => {
        state.catalogReaderTenants.push(tenant.tenantId);
        return state.catalogItems.get(`${tenant.tenantId}|${itemId}`) ?? null;
      },
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
    webhookHandler,
  };
}

export function newStubState(): StubState {
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
    catalogItems: new Map<string, CatalogItem>(),
    observedModes: [],
    catalogReaderTenants: [],
  };
}

export interface StubServer {
  app: FastifyInstance;
  state: StubState;
}

/** Stub server: real key map + deterministic wired handlers on every port. */
export function buildStubServer(overrides: Partial<ApiConfig> = {}): StubServer {
  const state = newStubState();
  const app = buildServer(testConfig({ ...overrides, handlers: stubHandlers(state) }));
  return { app, state };
}

/** Seed a tenant-scoped decision into the stub store (with optional field overrides). */
export function seedDecision(
  state: StubState,
  tenantId: string,
  decisionId: string,
  overrides: Record<string, unknown> = {},
): DecisionResult {
  const decision = DecisionResultSchema.parse({
    decisionId,
    requestId: "req-1",
    tenant: { tenantId },
    action: "HOLD",
    policy: { policyId: "greedy-v1", version: "1" },
    at: 1_234,
    ...overrides,
  });
  state.decisions.set(`${tenantId}|${decisionId}`, decision);
  return decision;
}

/**
 * Seed a tenant-scoped catalog item into the stub store (expansion reads).
 * Accepts the schema INPUT shape (labels/attributes/schema defaults optional).
 */
export function seedCatalogItem(
  state: StubState,
  tenantId: string,
  item: Record<string, unknown>,
): CatalogItem {
  const parsed = CatalogItemSchema.parse(item);
  state.catalogItems.set(`${tenantId}|${parsed.itemId}`, parsed);
  return parsed;
}

export function authHeaders(key: string, extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${key}`, "content-type": "application/json", ...extra };
}

export function idemHeader(key: string, extra: Record<string, string> = {}): Record<string, string> {
  return authHeaders(ALPHA, { "idempotency-key": key, ...extra });
}

export interface InjectedResponse {
  status: number;
  body: unknown;
  headers: Record<string, unknown>;
}

/** The method union accepted by light-my-request's inject options. */
type InjectMethod =
  | "GET" | "get" | "POST" | "post" | "PUT" | "put" | "DELETE" | "delete"
  | "PATCH" | "patch" | "HEAD" | "head" | "OPTIONS" | "options";

export async function injectJson(
  app: FastifyInstance,
  method: string,
  url: string,
  options: { payload?: unknown; headers?: Record<string, string> } = {},
): Promise<InjectedResponse> {
  const res = await app.inject({
    method: method as InjectMethod,
    url,
    payload: options.payload as Record<string, unknown> | undefined,
    headers: options.headers,
  });
  let body: unknown;
  try {
    body = res.json();
  } catch {
    body = res.body;
  }
  return { status: res.statusCode, body, headers: res.headers as Record<string, unknown> };
}

/**
 * Assert the ONE typed error envelope shape (ERROR-MODEL LAW, S2-001):
 * { error: { class, code, message, param?, doc_url?, details? } } — the
 * Stripe-style class is mandatory and must be one of the frozen five;
 * code/message stay mandatory as before.
 */
export function expectErrorEnvelope(
  status: number,
  body: unknown,
  code: string,
  errorClass?: ErrorClass,
): void {
  expect(status).toBeGreaterThanOrEqual(400);
  expect(body).toBeDefined();
  const envelope = body as { error?: Record<string, unknown> };
  expect(envelope.error).toBeDefined();
  const keys = Object.keys(envelope.error ?? {}).sort();
  expect(keys).toContain("class");
  expect(keys).toContain("code");
  expect(keys).toContain("message");
  expect(["class", "code", "details", "doc_url", "message", "param"]).toEqual(
    expect.arrayContaining(keys),
  );
  expect(ERROR_CLASSES).toContain(envelope.error?.class);
  if (errorClass !== undefined) expect(envelope.error?.class).toBe(errorClass);
  expect(envelope.error?.code).toBe(code);
  expect(typeof envelope.error?.message).toBe("string");
  expect((envelope.error?.message as string).length).toBeGreaterThan(0);
}

/** KeyStore that never retains the raw key (hashed at rest). */
export function keyStoreForTest(keys: StaticKeyConfig[]): KeyStore {
  return new KeyStore(keys);
}
