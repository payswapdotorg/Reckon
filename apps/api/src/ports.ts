import type {
  AgentBody,
  AgentOrganization,
  CandidateSet,
  CatalogItem,
  DecisionRequest,
  DecisionResult,
  ExperiencePlan,
  OutcomeEvent,
  PreferenceDelta,
  Realization,
} from "@reckon/contracts";
import { notWired } from "./errors.js";
import type { ReplanRequest, ResolveRequest, ResolveResponse } from "./envelopes.js";
import type { AuthContext } from "./types.js";

/**
 * Handler PORTS (NO-LLM LAW: the API is pure plumbing; the decision kernel
 * is Worker 2's lane). Every port is injectable through buildServer; where
 * a real implementation is not mounted, the deterministic NotWired default
 * below responds with typed 501 semantics. Real identity/catalog/rights
 * authorities stay with the host (architecture locks #4, #6).
 *
 * Port signatures deliberately take the AuthContext (tenant from the API
 * key) so implementations are tenant-aware by construction.
 */
export interface DecisionHandler {
  decide(request: DecisionRequest, auth: AuthContext): Promise<DecisionResult>;
}

/** Tenant-scoped by interface: lookups filter on the authenticated tenant. */
export interface DecisionStore {
  get(tenantId: string, decisionId: string): Promise<DecisionResult | null>;
}

export interface OutcomeIngestHandler {
  ingest(event: OutcomeEvent, auth: AuthContext): Promise<OutcomeEvent>;
}

export interface PreferenceIngestHandler {
  ingest(delta: PreferenceDelta, auth: AuthContext): Promise<PreferenceDelta>;
}

/** One replan-history entry: the plan, the authoritative row version and the recorded replan reason. */
export interface StoredPlanVersionView {
  readonly plan: ExperiencePlan;
  readonly version: number;
  readonly reason: string | null;
}

export interface PlanHandler {
  create(plan: ExperiencePlan, auth: AuthContext): Promise<ExperiencePlan>;
  replan(planId: string, request: ReplanRequest, auth: AuthContext): Promise<ExperiencePlan>;
  /** Latest version of one plan, or null when unknown (P1/UI-005 read surface). */
  get(planId: string, auth: AuthContext): Promise<ExperiencePlan | null>;
  /** Full version chain of one plan (asc) — the replan history (with reasons). */
  history(planId: string, auth: AuthContext): Promise<readonly StoredPlanVersionView[]>;
  /** Latest version of each plan, newest first (bounded). */
  listRecent(auth: AuthContext, limit?: number): Promise<readonly ExperiencePlan[]>;
}

/** Agent declaration surface (UI-007): bodies + organizations, tenant from AUTH (catalog pattern — the frozen contracts carry no tenant field). */
export interface AgentHandler {
  createBody(body: AgentBody, auth: AuthContext): Promise<AgentBody>;
  getBody(bodyId: string, auth: AuthContext): Promise<AgentBody | null>;
  listBodies(auth: AuthContext, limit?: number): Promise<readonly AgentBody[]>;
  createOrganization(organization: AgentOrganization, auth: AuthContext): Promise<AgentOrganization>;
  getOrganization(organizationId: string, auth: AuthContext): Promise<AgentOrganization | null>;
  listOrganizations(auth: AuthContext, limit?: number): Promise<readonly AgentOrganization[]>;
}

export interface CatalogItemIngestHandler {
  ingest(item: CatalogItem, auth: AuthContext): Promise<CatalogItem>;
}

export interface RealizationIngestHandler {
  ingest(realization: Realization, auth: AuthContext): Promise<Realization>;
}

export interface CandidatesHandler {
  submit(set: CandidateSet, auth: AuthContext): Promise<CandidateSet>;
}

export interface ExperienceResolveHandler {
  resolve(request: ResolveRequest, auth: AuthContext): Promise<ResolveResponse>;
}

export interface HandlerPorts {
  agentHandler: AgentHandler;
  decisionHandler: DecisionHandler;
  decisionStore: DecisionStore;
  outcomeIngest: OutcomeIngestHandler;
  preferenceIngest: PreferenceIngestHandler;
  planHandler: PlanHandler;
  catalogItemIngest: CatalogItemIngestHandler;
  realizationIngest: RealizationIngestHandler;
  candidatesHandler: CandidatesHandler;
  experienceResolver: ExperienceResolveHandler;
}

export type PartialHandlerPorts = Partial<HandlerPorts>;

/** Deterministic NotWired defaults: every port answers 501 NOT_WIRED. */
export function notWiredDefaults(): HandlerPorts {
  return {
    agentHandler: {
      createBody: async () => notWired("AgentHandler", "createBody"),
      getBody: async () => notWired("AgentHandler", "getBody"),
      listBodies: async () => notWired("AgentHandler", "listBodies"),
      createOrganization: async () => notWired("AgentHandler", "createOrganization"),
      getOrganization: async () => notWired("AgentHandler", "getOrganization"),
      listOrganizations: async () => notWired("AgentHandler", "listOrganizations"),
    },
    decisionHandler: { decide: async () => notWired("DecisionHandler", "decide") },
    decisionStore: { get: async () => notWired("DecisionStore", "get") },
    outcomeIngest: { ingest: async () => notWired("OutcomeIngestHandler", "ingest") },
    preferenceIngest: { ingest: async () => notWired("PreferenceIngestHandler", "ingest") },
    planHandler: {
      create: async () => notWired("PlanHandler", "create"),
      replan: async () => notWired("PlanHandler", "replan"),
      get: async () => notWired("PlanHandler", "get"),
      history: async () => notWired("PlanHandler", "history"),
      listRecent: async () => notWired("PlanHandler", "listRecent"),
    },
    catalogItemIngest: { ingest: async () => notWired("CatalogItemIngestHandler", "ingest") },
    realizationIngest: { ingest: async () => notWired("RealizationIngestHandler", "ingest") },
    candidatesHandler: { submit: async () => notWired("CandidatesHandler", "submit") },
    experienceResolver: { resolve: async () => notWired("ExperienceResolveHandler", "resolve") },
  };
}
