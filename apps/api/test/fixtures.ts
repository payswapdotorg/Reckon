import { expect } from "vitest";
import { buildServer } from "../src/server.js";
import type { ApiConfig } from "../src/config.js";
import type { StaticKeyConfig } from "../src/auth.js";
import { KeyStore } from "../src/auth.js";
import type { HandlerPorts } from "../src/ports.js";
import type {
  CandidateSet,
  CatalogItem,
  DecisionRequest,
  DecisionResult,
  ExperiencePlan,
  OutcomeEvent,
  PreferenceDelta,
  Realization,
  TenantScope,
} from "@reckon/contracts";
import {
  DecisionResultSchema,
  ExperiencePlanSchema,
  ExperienceSchema,
} from "@reckon/contracts";
import type { FastifyInstance } from "fastify";

/**
 * Test fixtures: static keys, valid contract bodies per route, and server
 * builders (default = all NotWired; stub = wired deterministic handlers
 * for success-shape tests). Tests use fastify.inject only — no sockets.
 */

const ALL_RUNTIME_SCOPES = ["decisions", "outcomes", "plans", "catalog"] as const;

export const TEST_KEYS: StaticKeyConfig[] = [
  { apiKey: "test-key-alpha", tenantId: "tenant-a", scopes: [...ALL_RUNTIME_SCOPES] },
  { apiKey: "test-key-beta", tenantId: "tenant-b", scopes: ["decisions"] },
  { apiKey: "test-key-gamma", tenantId: "tenant-c", scopes: ["catalog"] },
  { apiKey: "test-key-ws", tenantId: "tenant-a", workspaceId: "ws-1", scopes: [...ALL_RUNTIME_SCOPES] },
  { apiKey: "test-key-research", tenantId: "tenant-r", scopes: ["research"] },
];

export const ALPHA = "test-key-alpha";
export const BETA = "test-key-beta";
export const GAMMA = "test-key-gamma";
export const WS_KEY = "test-key-ws";
export const RESEARCH_KEY = "test-key-research";

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
}

export function stubHandlers(state: StubState): HandlerPorts {
  const plansById = new Map<string, ExperiencePlan>();
  return {
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
      listRecent: async (_auth, limit) => [...plansById.values()].slice(0, limit ?? 20),
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

/** Seed a tenant-scoped decision into the stub store. */
export function seedDecision(
  state: StubState,
  tenantId: string,
  decisionId: string,
): DecisionResult {
  const decision = DecisionResultSchema.parse({
    decisionId,
    requestId: "req-1",
    tenant: { tenantId },
    action: "HOLD",
    policy: { policyId: "greedy-v1", version: "1" },
    at: 1_234,
  });
  state.decisions.set(`${tenantId}|${decisionId}`, decision);
  return decision;
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

/** Assert the ONE typed error envelope shape (ERROR-MODEL LAW). */
export function expectErrorEnvelope(status: number, body: unknown, code: string): void {
  expect(status).toBeGreaterThanOrEqual(400);
  expect(body).toBeDefined();
  const envelope = body as { error?: Record<string, unknown> };
  expect(envelope.error).toBeDefined();
  const keys = Object.keys(envelope.error ?? {}).sort();
  expect(keys).toContain("code");
  expect(keys).toContain("message");
  expect(["code", "details", "message"]).toEqual(expect.arrayContaining(keys));
  expect(envelope.error?.code).toBe(code);
  expect(typeof envelope.error?.message).toBe("string");
  expect((envelope.error?.message as string).length).toBeGreaterThan(0);
}

/** KeyStore that never retains the raw key (hashed at rest). */
export function keyStoreForTest(keys: StaticKeyConfig[]): KeyStore {
  return new KeyStore(keys);
}
