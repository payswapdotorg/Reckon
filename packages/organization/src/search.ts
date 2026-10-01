/**
 * W2-009 — organization search.
 *
 * A deterministic, model-neutral search layer over the Agent
 * Organization runtime's graph (W2-008): given an organization (bodies
 * + communication/delegation edges) and a request, it answers — with
 * NO model call, NO executor, NO I/O and NO wall-clock —
 *
 *   1. which bodies can service the request (capability match over
 *      DECLARED body capabilities: roles, tools, observations,
 *      actions, memory kinds, permission capabilities);
 *   2. the delegation/communication path from the requesting body to
 *      each candidate (min traversal cost over the graph — with the
 *      default uniform edge costs, the fewest hops; deterministic
 *      lexicographic tie-break on edge-id sequences);
 *   3. the decision-support ranking of candidates (capability fit,
 *      path cost, budget headroom, latency, evaluator health).
 *
 * LAWS enforced here:
 *
 * - NO-LLM LAW (architecture-lock #6 / ADR-002): pure synchronous
 *   deterministic TypeScript. Nothing in this module touches a model
 *   adapter, an executor, the filesystem, the network or a clock.
 *   The request's `objective` is carried as provenance ONLY —
 *   semantic objective→role matching would require a model, so it is
 *   never attempted (the capability query IS the objective's
 *   executable form for search purposes).
 *
 * - BASELINE COMPARISON LAW (architecture-lock #15 / worker-2
 *   handoff): `searchWithBaseline` ALWAYS returns the single-agent
 *   baseline row plus deltas against the organization search path —
 *   the return type has no baseline-free shape. The deltas are
 *   HONEST: they can show the organization ahead, behind, or
 *   infeasible either way. Organization complexity is never assumed
 *   to be better; the system must be able to discover that no
 *   multi-agent decomposition is superior for a given request.
 *
 * - CONSTRAINT/REWARD SEPARATION (architecture-lock #21): required
 *   capabilities and constraint gates (hop bound, evaluator
 *   requirement, declared-latency compatibility, declared-budget
 *   feasibility) EXCLUDE candidates with typed reasons — excluded
 *   candidates are never scored. Soft components (preferred-coverage
 *   fit, path value, budget headroom, latency value, evaluator
 *   health) only rank among ELIGIBLE candidates.
 *
 * - HONEST EVIDENCE (the W2-002 policy-engine pattern): soft
 *   components are computed ONLY from declared data (request-side and
 *   body-side). A channel with no declared evidence on both sides is
 *   UNEVALUATED for that candidate: it contributes to neither the
 *   score's numerator nor its denominator (per-candidate
 *   normalization over EVALUATED channels) and is disclosed through
 *   an evidence-sparsity `confidence` (evaluated channels / 5, method
 *   "organization-search.evidence-sparsity.v1"). Neutral values are
 *   never fabricated. In particular the derived single-agent
 *   baseline (a capability union of the org's bodies) declares NO
 *   budgets / latency limits / evaluator — those channels are
 *   unevaluated for it, never invented.
 *
 * - DETERMINISM: same organization + same request + same engine
 *   configuration ⇒ digest-identical result. No wall-clock, no
 *   randomness, and — unlike the W2-008 runtime's seeded delegation
 *   tie-breaks, which exist for load distribution — no seed is
 *   needed at all: search ordering is canonical (score DESC, then
 *   bodyId ASC in UTF-16 code units; equal-cost paths tie-break on
 *   the lexicographically smallest edge-id sequence; excluded
 *   candidates keep body-declaration order).
 *
 * Graph representation: this module consumes the SAME frozen
 * `AgentOrganization` contract the W2-008 runtime executes, but
 * performs no execution. Model assignments are NOT required here
 * (they are execution data); org-level `wall-clock-ms` budgets are
 * runtime-clock concerns (no wall-clock in search); org-level
 * `consensus`/`custom` termination rules remain host-evaluated
 * declarations (documented by the W2-008 kernel — evaluator
 * enforcement at run time is a host concern, not a search concern).
 */
import {
  AgentBodySchema,
  AgentOrganizationSchema,
  ObjectiveSchema,
  type AgentBody,
  type AgentOrganization,
  type DelegationEdge,
  type MemoryInterface,
  type Objective,
  type Permission,
} from "@reckon/contracts";
import type { Result } from "./errors.js";
import { invalidInput } from "./errors.js";

// ---------------------------------------------------------------------------
// Constants (documented defaults)
// ---------------------------------------------------------------------------

/** Neutral memory-interface kinds (frozen AgentBody contract). */
const MEMORY_KINDS: readonly MemoryInterface["kind"][] = [
  "private",
  "shared",
  "ephemeral",
  "persistent",
  "custom",
];

/** Neutral permission capabilities (frozen AgentBody contract). */
const PERMISSION_CAPABILITIES: readonly Permission["capability"][] = [
  "observe",
  "read",
  "write",
  "tool",
  "network",
  "model-inference",
  "memory",
  "custom",
];

/** Edge kinds traversable by search (frozen DelegationEdge contract). */
const EDGE_KINDS: readonly DelegationEdge["kind"][] = [
  "communicate",
  "delegate",
  "report",
  "escalate",
  "custom",
];

/**
 * Metered budget kinds usable as search decision support. `wall-clock-ms`
 * budgets are runtime-clock enforcement (the W2-007 body runtime enforces
 * them with an injected clock) and are deliberately NOT part of search —
 * there is no wall-clock in search.
 */
const METERED_KINDS: readonly ("cost" | "tokens" | "calls")[] = ["cost", "tokens", "calls"];

/**
 * Default ranking weights (documented, configurable via engine deps):
 * the capability match dominates; delegation/communication path cost
 * carries half weight; each evidence channel (budget headroom, latency,
 * evaluator health) carries a quarter weight. All components live in
 * [0,1], so the weighted normalized score lives in [0,1].
 */
export interface SearchWeights {
  capabilityFit: number;
  path: number;
  budgetHeadroom: number;
  latency: number;
  evaluatorHealth: number;
}

export const DEFAULT_SEARCH_WEIGHTS: SearchWeights = {
  capabilityFit: 1,
  path: 0.5,
  budgetHeadroom: 0.25,
  latency: 0.25,
  evaluatorHealth: 0.25,
};

/**
 * Default per-edge-kind traversal costs (documented): uniform 1 ⇒ the
 * min-cost path IS the fewest-hop path. Custom costs turn the search
 * into a general min-cost path selection (e.g. make `communicate`
 * expensive relative to `delegate`).
 */
export type EdgeCostMap = Record<DelegationEdge["kind"], number>;

export const DEFAULT_EDGE_COSTS: EdgeCostMap = {
  communicate: 1,
  delegate: 1,
  report: 1,
  escalate: 1,
  custom: 1,
};

/**
 * Default search horizon (max hops from the requester). Mirrors the
 * W2-008 runtime's DEFAULT_MAX_DEPTH delegation bound.
 */
export const DEFAULT_MAX_SEARCH_HOPS = 8;

const UNCERTAINTY_METHOD = "organization-search.evidence-sparsity.v1";

// ---------------------------------------------------------------------------
// Request input types (what callers pass)
// ---------------------------------------------------------------------------

/**
 * A capability query. Match semantics (documented):
 * - `roles` is ANY-of (a body has exactly one role contract; the query
 *   lists acceptable roles);
 * - `tools` / `observations` / `actions` / `memoryKinds` /
 *   `capabilities` are ALL-of (every referenced capability must be
 *   declared/granted by the body);
 * - `tools` refs match a declared tool's `toolId` OR `name`;
 *   `observations` refs match an `observationId` OR observation `kind`;
 *   `actions` refs match an `actionId` OR action `kind`.
 */
export interface CapabilityQueryInput {
  roles?: string[];
  tools?: string[];
  observations?: string[];
  actions?: string[];
  memoryKinds?: MemoryInterface["kind"][];
  capabilities?: Permission["capability"][];
}

/**
 * Hard constraints (lock #21: constraints gate eligibility; they never
 * score). All fail-closed where declared on the request side:
 * - `maxHops` — the selected min-cost path must not exceed this many
 *   delegation/communication edges;
 * - `requiresEvaluator` — the candidate must declare an evaluator;
 * - `maxLatencyMs` — the candidate must declare `latencyLimits`
 *   (fail-closed: an undeclared body cannot evidence the deadline) with
 *   `hardMs` at or below the budget;
 * - `demandEstimates` — for every metered kind the request estimates,
 *   the candidate's TIGHTEST declared budget of that kind must be at or
 *   above the estimate (the W2-007 envelope aborts a body that exceeds
 *   a declared budget, so pre-declared infeasibility is a constraint).
 */
export interface SearchConstraintsInput {
  maxHops?: number;
  requiresEvaluator?: boolean;
  maxLatencyMs?: number;
  demandEstimates?: DemandEstimatesInput;
}

export interface DemandEstimatesInput {
  cost?: number;
  tokens?: number;
  calls?: number;
}

/**
 * An organization search request. `objective` is caller-declared
 * provenance carried through validation (frozen ObjectiveSchema) but
 * NEVER semantically matched — model-neutral law (no LLM). The
 * capability queries are the objective's executable form.
 */
export interface OrganizationSearchRequest {
  requestId: string;
  requesterBodyId: string;
  objective?: Objective;
  required?: CapabilityQueryInput;
  preferred?: CapabilityQueryInput;
  constraints?: SearchConstraintsInput;
  /** Host-supplied evaluator health data, keyed by evaluatorId, in [0,1]. */
  evaluatorHealth?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** One edge of a selected path, in traversal order. */
export interface PathEdge {
  edgeId: string;
  fromBodyId: string;
  toBodyId: string;
  kind: DelegationEdge["kind"];
}

export interface CandidatePath {
  /** Path value in [0,1]: `1 / (1 + cost)` (monotone decreasing in
   *  traversal cost; a self-service path costs 0 ⇒ value 1). */
  value: number;
  /** Number of edges on the selected path. */
  hops: number;
  /** Total traversal cost of the selected path. */
  cost: number;
  /** The selected path's edges, in traversal order. */
  edges: PathEdge[];
}

export interface CapabilityFitDetail {
  /** Preferred-coverage value in [0,1] (1 when nothing is preferred —
   *  the channel is then simply non-differentiating, not absent). */
  value: number;
  preferredMatched: number;
  preferredTotal: number;
}

export interface BudgetHeadroomKindDetail {
  kind: "cost" | "tokens" | "calls";
  /** The TIGHTEST declared limit of this kind on the body. */
  limit: number;
  estimate: number;
  /** `limit / estimate`, or null when the estimate is 0 (unbounded
   *  headroom — never serialized as a non-finite number). */
  headroom: number | null;
}

export interface BudgetHeadroomDetail {
  /** Mean over the evaluated kinds of `headroom / (headroom + 1)`
   *  (monotone increasing in headroom; 0.5 at exactly 1× headroom). */
  value: number;
  kinds: BudgetHeadroomKindDetail[];
}

export interface LatencyDetail {
  /** `budgetMs / (budgetMs + hardMs)` (monotone decreasing in the
   *  declared hard deadline; 0.5 when hardMs equals the budget —
   *  eligible candidates always have hardMs ≤ budgetMs). */
  value: number;
  hardMs: number;
  budgetMs: number;
}

export interface EvaluatorHealthDetail {
  /** Host-supplied health in [0,1] for the body's declared evaluator. */
  value: number;
  evaluatorId: string;
}

/** An eligible, scored, deterministically ranked candidate. */
export interface RankedCandidate {
  bodyId: string;
  roleId: string;
  /** Weighted normalized score over the EVALUATED channels, in [0,1]. */
  score: number;
  /** Evaluated soft channels / 5 (evidence sparsity, honest-evidence
   *  law — never a fabricated confidence). */
  confidence: number;
  capabilityFit: CapabilityFitDetail;
  path: CandidatePath;
  budgetHeadroom?: BudgetHeadroomDetail;
  latency?: LatencyDetail;
  evaluatorHealth?: EvaluatorHealthDetail;
}

/** A gate-failing candidate with typed reasons (never scored — lock #21). */
export interface ExcludedCandidate {
  bodyId: string;
  roleId: string;
  reasons: { code: string; message: string }[];
}

export interface OrganizationSearchResult {
  organizationId: string;
  requestId: string;
  requesterBodyId: string;
  /** Eligible candidates, ordered score DESC then bodyId ASC. */
  ranked: RankedCandidate[];
  /** Gate-failing bodies, in body-declaration order. */
  excluded: ExcludedCandidate[];
}

// ---------------------------------------------------------------------------
// Baseline comparison types (BASELINE COMPARISON LAW, lock #15)
// ---------------------------------------------------------------------------

export type BaselineDerivation = "explicit" | "derived-union";

/**
 * The single-agent baseline row — ALWAYS present in a
 * `searchWithBaseline` result. Evaluated by running the SAME request
 * through the SAME search machinery over a one-body, no-edge
 * organization (`organizationId: "baseline-single-agent"` — the same
 * baseline organization shape the W2-008 runtime compares topologies
 * against).
 */
export type BaselineEvaluation =
  | {
      organizationId: "baseline-single-agent";
      bodyId: string;
      derivation: BaselineDerivation;
      status: "eligible";
      score: number;
      confidence: number;
      capabilityFit: CapabilityFitDetail;
      /** Structurally the empty path: a single agent never delegates. */
      path: CandidatePath;
      budgetHeadroom?: BudgetHeadroomDetail;
      latency?: LatencyDetail;
      evaluatorHealth?: EvaluatorHealthDetail;
    }
  | {
      organizationId: "baseline-single-agent";
      bodyId: string;
      derivation: BaselineDerivation;
      status: "excluded";
      reasons: { code: string; message: string }[];
    };

/**
 * Honest deltas between the org search path and the single-agent
 * fallback of the SAME request. Every field is optional-presence
 * truthfully: an absent score field means that side found no eligible
 * candidate. The deltas can show either direction — organization
 * complexity is never assumed to be better.
 */
export interface BaselineDelta {
  comparison: "org-only-path" | "baseline-only-path" | "both" | "neither";
  orgEligibleCount: number;
  bestOrgScore?: number;
  bestOrgCapabilityFit?: number;
  bestOrgPathCost?: number;
  bestOrgHops?: number;
  baselineScore?: number;
  baselineCapabilityFit?: number;
  /** bestOrgScore - baselineScore (present iff both sides eligible). */
  scoreDelta?: number;
  /** bestOrgCapabilityFit - baselineCapabilityFit. */
  capabilityFitDelta?: number;
  /**
   * bestOrgPathCost minus the baseline's structurally-zero path cost
   * (a single agent never delegates) — the delegation/communication
   * overhead the organization adds for this request.
   */
  pathCostDelta?: number;
}

export interface SearchWithBaselineResult {
  /** (a) the organization search path. */
  search: OrganizationSearchResult;
  /** (b) the single-agent fallback row — ALWAYS present (lock #15). */
  baseline: BaselineEvaluation;
  delta: BaselineDelta;
}

export interface SearchWithBaselineOptions {
  /**
   * The host-supplied generalist baseline body. When omitted the
   * baseline is DERIVED (documented):
   *   - an organization with exactly ONE body: that body verbatim (the
   *     union of one body is the body — role, budgets, latency limits
   *     and evaluator all real);
   *   - otherwise: the capability UNION of all bodies (one hypothetical
   *     generalist holding every tool / observation / action / memory
   *     interface / permission capability any body declares) with role
   *     contract "generalist" and NO budgets / latency limits /
   *     evaluator — none of the org's per-body declarations honestly
   *     transfer to a hypothetical merged body, so those channels stay
   *     unevaluated (honest-evidence law) rather than invented.
   * The derived union is the STRONGEST capability-only single-agent
   * counterfactual — conservative toward "no decomposition benefit",
   * the direction the baseline law protects. Note the derived generalist
   * cannot carry specialized role contracts (a body has exactly one
   * role): role-sensitive requests should supply an explicit baseline.
   */
  baseline?: { body: AgentBody };
}

// ---------------------------------------------------------------------------
// Engine construction (injectable seam)
// ---------------------------------------------------------------------------

export interface OrganizationSearchDeps {
  /** Partial ranking weights (defaults: DEFAULT_SEARCH_WEIGHTS). */
  weights?: Partial<SearchWeights>;
  /** Partial per-edge-kind traversal costs (defaults: DEFAULT_EDGE_COSTS). */
  edgeCosts?: Partial<EdgeCostMap>;
  /** Search horizon in hops (default: DEFAULT_MAX_SEARCH_HOPS). */
  maxHops?: number;
}

export interface OrganizationSearch {
  search(org: AgentOrganization, request: OrganizationSearchRequest): Result<OrganizationSearchResult>;
  /**
   * Run the SAME request through (a) the organization search path and
   * (b) the single-agent fallback, and record the honest deltas
   * (BASELINE COMPARISON LAW, lock #15). The baseline row is ALWAYS
   * present — the return type has no baseline-free shape.
   */
  searchWithBaseline(
    org: AgentOrganization,
    request: OrganizationSearchRequest,
    options?: SearchWithBaselineOptions,
  ): Result<SearchWithBaselineResult>;
}

interface EngineConfig {
  weights: SearchWeights;
  edgeCosts: EdgeCostMap;
  maxHops: number;
}

/**
 * Factory. The engine is pure data configuration — no executor, no
 * clock, no I/O (organization search never executes bodies).
 */
export function createOrganizationSearch(deps?: OrganizationSearchDeps): Result<OrganizationSearch> {
  const config = validateEngineDeps(deps);
  if (!config.ok) return config;
  return {
    ok: true,
    value: {
      search(org, request) {
        return runSearch(org, request, config.value);
      },
      searchWithBaseline(org, request, options) {
        return runSearchWithBaseline(org, request, options ?? {}, config.value);
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Validation (typed issues, never raw throws — house style)
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function checkUnknownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      issues.push({
        path: path.length > 0 ? `${path}.${key}` : key,
        message: `unknown key "${key}" (allowed: ${allowed.join(", ")})`,
      });
    }
  }
  return issues;
}

function validateStringArray(
  value: unknown,
  path: string,
): { ok: true; value: string[] } | { ok: false; issues: { path: string; message: string }[] } {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value)) {
    return { ok: false, issues: [{ path, message: `${path} must be an array of strings` }] };
  }
  const out: string[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    if (typeof item !== "string" || item.length < 1 || item.length > 128) {
      return {
        ok: false,
        issues: [{ path: `${path}[${i}]`, message: `${path}[${i}] must be a non-empty string (max 128 chars)` }],
      };
    }
    out.push(item);
  }
  return { ok: true, value: out };
}

function validateEnumArray<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): { ok: true; value: T[] } | { ok: false; issues: { path: string; message: string }[] } {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value)) {
    return { ok: false, issues: [{ path, message: `${path} must be an array` }] };
  }
  const out: T[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    if (typeof item !== "string" || !allowed.includes(item as T)) {
      return {
        ok: false,
        issues: [{ path: `${path}[${i}]`, message: `${path}[${i}] must be one of ${allowed.join(", ")}` }],
      };
    }
    out.push(item as T);
  }
  return { ok: true, value: out };
}

function validateNumber(
  value: unknown,
  path: string,
  opts: { min: number; exclusiveMin?: boolean; integer?: boolean },
): { ok: true; value: number } | { ok: false; issues: { path: string; message: string }[] } {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, issues: [{ path, message: `${path} must be a finite number` }] };
  }
  if (opts.integer && !Number.isInteger(value)) {
    return { ok: false, issues: [{ path, message: `${path} must be an integer` }] };
  }
  if (opts.exclusiveMin ? value <= opts.min : value < opts.min) {
    return {
      ok: false,
      issues: [{ path, message: `${path} must be ${opts.exclusiveMin ? ">" : ">="} ${opts.min}` }],
    };
  }
  return { ok: true, value };
}

function validateEngineDeps(deps?: OrganizationSearchDeps): Result<EngineConfig> {
  if (deps === undefined) {
    return { ok: true, value: { weights: { ...DEFAULT_SEARCH_WEIGHTS }, edgeCosts: { ...DEFAULT_EDGE_COSTS }, maxHops: DEFAULT_MAX_SEARCH_HOPS } };
  }
  if (!isObject(deps)) {
    return invalidInput("createOrganizationSearch: deps must be an object");
  }
  const issues: { path: string; message: string }[] = [
    ...checkUnknownKeys(deps, ["weights", "edgeCosts", "maxHops"], ""),
  ];

  const weights: SearchWeights = { ...DEFAULT_SEARCH_WEIGHTS };
  if (deps.weights !== undefined) {
    if (!isObject(deps.weights)) {
      return invalidInput("createOrganizationSearch: deps.weights must be an object");
    }
    issues.push(...checkUnknownKeys(deps.weights, Object.keys(DEFAULT_SEARCH_WEIGHTS), "weights"));
    for (const key of Object.keys(DEFAULT_SEARCH_WEIGHTS) as (keyof SearchWeights)[]) {
      const raw = (deps.weights as Partial<SearchWeights>)[key];
      if (raw === undefined) continue;
      const checked = validateNumber(raw, `weights.${key}`, { min: 0 });
      if (!checked.ok) {
        issues.push(...checked.issues);
        continue;
      }
      weights[key] = checked.value;
    }
  }

  const edgeCosts: EdgeCostMap = { ...DEFAULT_EDGE_COSTS };
  if (deps.edgeCosts !== undefined) {
    if (!isObject(deps.edgeCosts)) {
      return invalidInput("createOrganizationSearch: deps.edgeCosts must be an object");
    }
    issues.push(...checkUnknownKeys(deps.edgeCosts, [...EDGE_KINDS], "edgeCosts"));
    for (const kind of EDGE_KINDS) {
      const raw = (deps.edgeCosts as Partial<EdgeCostMap>)[kind];
      if (raw === undefined) continue;
      // Positive (not zero): zero-cost edge cycles would make "the"
      // min-cost path ill-defined under tie-breaks.
      const checked = validateNumber(raw, `edgeCosts.${kind}`, { min: 0, exclusiveMin: true });
      if (!checked.ok) {
        issues.push(...checked.issues);
        continue;
      }
      edgeCosts[kind] = checked.value;
    }
  }

  let maxHops = DEFAULT_MAX_SEARCH_HOPS;
  if (deps.maxHops !== undefined) {
    const checked = validateNumber(deps.maxHops, "maxHops", { min: 1, integer: true });
    if (!checked.ok) {
      issues.push(...checked.issues);
    } else {
      maxHops = checked.value;
    }
  }

  if (issues.length > 0) {
    return invalidInput("createOrganizationSearch: invalid deps", issues);
  }
  return { ok: true, value: { weights, edgeCosts, maxHops } };
}

/** Validated org: frozen schema + the same structural checks the
 *  W2-008 runtime makes (duplicate bodies, edges to undeclared
 *  bodies). Model assignments are NOT required — search executes
 *  nothing. */
function validateOrg(orgInput: unknown): Result<{ org: AgentOrganization }> {
  if (!isObject(orgInput)) {
    return invalidInput("search: org must be an object");
  }
  const parsed = AgentOrganizationSchema.safeParse(orgInput);
  if (!parsed.success) {
    return invalidInput(
      "search: invalid agent organization",
      parsed.error.issues.map((i) => ({ path: `org.${i.path.join(".")}`, message: i.message })),
    );
  }
  const org = parsed.data;
  const bodyIds = new Set<string>();
  for (const body of org.bodies) {
    if (bodyIds.has(body.bodyId)) {
      return invalidInput(`search: duplicate body ${body.bodyId}`);
    }
    bodyIds.add(body.bodyId);
  }
  for (const edge of org.edges) {
    if (!bodyIds.has(edge.fromBodyId) || !bodyIds.has(edge.toBodyId)) {
      return invalidInput(
        `search: edge ${edge.edgeId} references undeclared bodies (${edge.fromBodyId} → ${edge.toBodyId})`,
      );
    }
  }
  return { ok: true, value: { org } };
}

interface NormalizedQuery {
  roles: string[];
  tools: string[];
  observations: string[];
  actions: string[];
  memoryKinds: MemoryInterface["kind"][];
  capabilities: Permission["capability"][];
}

interface NormalizedRequest {
  requestId: string;
  requesterBodyId: string;
  objective?: Objective;
  required: NormalizedQuery;
  preferred: NormalizedQuery;
  requiresEvaluator: boolean;
  maxHops?: number;
  maxLatencyMs?: number;
  demand: { cost?: number; tokens?: number; calls?: number };
  evaluatorHealth: Record<string, number>;
}

function validateQuery(value: unknown, path: string): Result<NormalizedQuery> {
  if (value === undefined || value === null) {
    return { ok: true, value: { roles: [], tools: [], observations: [], actions: [], memoryKinds: [], capabilities: [] } };
  }
  if (!isObject(value)) {
    return invalidInput(`search: ${path} must be an object`);
  }
  const issues: { path: string; message: string }[] = [
    ...checkUnknownKeys(value, ["roles", "tools", "observations", "actions", "memoryKinds", "capabilities"], path),
  ];
  const parts: Partial<NormalizedQuery> = {};
  for (const key of ["roles", "tools", "observations", "actions"] as const) {
    const checked = validateStringArray(value[key], `${path}.${key}`);
    if (!checked.ok) {
      issues.push(...checked.issues);
    } else {
      parts[key] = checked.value;
    }
  }
  const memoryKinds = validateEnumArray(value["memoryKinds"], `${path}.memoryKinds`, MEMORY_KINDS);
  if (!memoryKinds.ok) {
    issues.push(...memoryKinds.issues);
  } else {
    parts.memoryKinds = memoryKinds.value;
  }
  const capabilities = validateEnumArray(value["capabilities"], `${path}.capabilities`, PERMISSION_CAPABILITIES);
  if (!capabilities.ok) {
    issues.push(...capabilities.issues);
  } else {
    parts.capabilities = capabilities.value;
  }
  if (issues.length > 0) {
    return invalidInput(`search: invalid ${path} capability query`, issues);
  }
  return {
    ok: true,
    value: {
      roles: parts.roles ?? [],
      tools: parts.tools ?? [],
      observations: parts.observations ?? [],
      actions: parts.actions ?? [],
      memoryKinds: parts.memoryKinds ?? [],
      capabilities: parts.capabilities ?? [],
    },
  };
}

function validateRequest(requestInput: unknown): Result<NormalizedRequest> {
  if (!isObject(requestInput)) {
    return invalidInput("search: request must be an object");
  }
  const issues: { path: string; message: string }[] = [
    ...checkUnknownKeys(
      requestInput,
      ["requestId", "requesterBodyId", "objective", "required", "preferred", "constraints", "evaluatorHealth"],
      "request",
    ),
  ];

  const requestId = requestInput["requestId"];
  if (typeof requestId !== "string" || requestId.length < 1 || requestId.length > 128) {
    issues.push({ path: "request.requestId", message: "request.requestId must be a non-empty string (max 128 chars)" });
  }
  const requesterBodyId = requestInput["requesterBodyId"];
  if (typeof requesterBodyId !== "string" || requesterBodyId.length < 1 || requesterBodyId.length > 128) {
    issues.push({ path: "request.requesterBodyId", message: "request.requesterBodyId must be a non-empty string (max 128 chars)" });
  }

  let objective: Objective | undefined;
  if (requestInput["objective"] !== undefined) {
    const parsedObjective = ObjectiveSchema.safeParse(requestInput["objective"]);
    if (!parsedObjective.success) {
      issues.push(
        ...parsedObjective.error.issues.map((i) => ({
          path: `request.objective.${i.path.join(".")}`,
          message: i.message,
        })),
      );
    } else {
      objective = parsedObjective.data;
    }
  }

  const required = validateQuery(requestInput["required"], "request.required");
  if (!required.ok) {
    issues.push(...(required.error.issues ?? []));
  }
  const preferred = validateQuery(requestInput["preferred"], "request.preferred");
  if (!preferred.ok) {
    issues.push(...(preferred.error.issues ?? []));
  }

  let requiresEvaluator = false;
  let maxHops: number | undefined;
  let maxLatencyMs: number | undefined;
  const demand: { cost?: number; tokens?: number; calls?: number } = {};
  if (requestInput["constraints"] !== undefined) {
    const rawConstraints = requestInput["constraints"];
    if (!isObject(rawConstraints)) {
      issues.push({ path: "request.constraints", message: "request.constraints must be an object" });
    } else {
      issues.push(...checkUnknownKeys(rawConstraints, ["maxHops", "requiresEvaluator", "maxLatencyMs", "demandEstimates"], "request.constraints"));
      if (rawConstraints["requiresEvaluator"] !== undefined && typeof rawConstraints["requiresEvaluator"] !== "boolean") {
        issues.push({ path: "request.constraints.requiresEvaluator", message: "request.constraints.requiresEvaluator must be a boolean" });
      } else {
        requiresEvaluator = rawConstraints["requiresEvaluator"] === true;
      }
      if (rawConstraints["maxHops"] !== undefined) {
        const checked = validateNumber(rawConstraints["maxHops"], "request.constraints.maxHops", { min: 1, integer: true });
        if (!checked.ok) {
          issues.push(...checked.issues);
        } else {
          maxHops = checked.value;
        }
      }
      if (rawConstraints["maxLatencyMs"] !== undefined) {
        const checked = validateNumber(rawConstraints["maxLatencyMs"], "request.constraints.maxLatencyMs", { min: 0, exclusiveMin: true });
        if (!checked.ok) {
          issues.push(...checked.issues);
        } else {
          maxLatencyMs = checked.value;
        }
      }
      if (rawConstraints["demandEstimates"] !== undefined) {
        const rawDemand = rawConstraints["demandEstimates"];
        if (!isObject(rawDemand)) {
          issues.push({ path: "request.constraints.demandEstimates", message: "request.constraints.demandEstimates must be an object" });
        } else {
          issues.push(...checkUnknownKeys(rawDemand, ["cost", "tokens", "calls"], "request.constraints.demandEstimates"));
          for (const kind of METERED_KINDS) {
            const raw = rawDemand[kind];
            if (raw === undefined) continue;
            const checked = validateNumber(raw, `request.constraints.demandEstimates.${kind}`, {
              min: 0,
              ...(kind === "calls" ? { integer: true } : {}),
            });
            if (!checked.ok) {
              issues.push(...checked.issues);
            } else {
              demand[kind] = checked.value;
            }
          }
        }
      }
    }
  }

  const evaluatorHealth: Record<string, number> = {};
  if (requestInput["evaluatorHealth"] !== undefined) {
    const rawHealth = requestInput["evaluatorHealth"];
    if (!isObject(rawHealth)) {
      issues.push({ path: "request.evaluatorHealth", message: "request.evaluatorHealth must be an object of numbers in [0,1]" });
    } else {
      for (const [evaluatorId, health] of Object.entries(rawHealth)) {
        if (typeof health !== "number" || !Number.isFinite(health) || health < 0 || health > 1) {
          issues.push({ path: `request.evaluatorHealth.${evaluatorId}`, message: `request.evaluatorHealth.${evaluatorId} must be a number in [0,1]` });
        } else {
          evaluatorHealth[evaluatorId] = health;
        }
      }
    }
  }

  if (issues.length > 0 || !required.ok || !preferred.ok) {
    return invalidInput("search: invalid request", issues);
  }

  return {
    ok: true,
    value: {
      requestId: requestId as string,
      requesterBodyId: requesterBodyId as string,
      ...(objective !== undefined ? { objective } : {}),
      required: required.value,
      preferred: preferred.value,
      requiresEvaluator,
      ...(maxHops !== undefined ? { maxHops } : {}),
      ...(maxLatencyMs !== undefined ? { maxLatencyMs } : {}),
      demand,
      evaluatorHealth,
    },
  };
}

// ---------------------------------------------------------------------------
// Capability matching (pure, over declared capabilities)
// ---------------------------------------------------------------------------

function bodyHasTool(body: AgentBody, ref: string): boolean {
  return body.tools.some((tool) => tool.toolId === ref || tool.name === ref);
}

function bodyHasObservation(body: AgentBody, ref: string): boolean {
  return body.observations.some((obs) => obs.observationId === ref || obs.kind === ref);
}

function bodyHasAction(body: AgentBody, ref: string): boolean {
  return body.actions.some((action) => action.actionId === ref || action.kind === ref);
}

function bodyHasMemoryKind(body: AgentBody, kind: MemoryInterface["kind"]): boolean {
  return body.memoryInterfaces.some((memory) => memory.kind === kind);
}

function grantedCapabilities(body: AgentBody): Set<Permission["capability"]> {
  return new Set(body.permissions.map((permission) => permission.capability));
}

/** Required-gate evaluation (lock #21: gates exclude, never score). */
function matchRequired(body: AgentBody, required: NormalizedQuery): { code: string; message: string }[] {
  const reasons: { code: string; message: string }[] = [];
  if (required.roles.length > 0 && !required.roles.includes(body.role.roleId)) {
    reasons.push({
      code: "ROLE_NOT_MATCHED",
      message: `body ${body.bodyId} has role ${body.role.roleId}; required roles are [${required.roles.join(", ")}]`,
    });
  }
  for (const ref of required.tools) {
    if (!bodyHasTool(body, ref)) {
      reasons.push({ code: "TOOL_NOT_DECLARED", message: `tool ${ref} is not declared by body ${body.bodyId} (by toolId or name)` });
    }
  }
  for (const ref of required.observations) {
    if (!bodyHasObservation(body, ref)) {
      reasons.push({ code: "OBSERVATION_NOT_DECLARED", message: `observation ${ref} is not declared by body ${body.bodyId} (by observationId or kind)` });
    }
  }
  for (const ref of required.actions) {
    if (!bodyHasAction(body, ref)) {
      reasons.push({ code: "ACTION_NOT_DECLARED", message: `action ${ref} is not declared by body ${body.bodyId} (by actionId or kind)` });
    }
  }
  for (const kind of required.memoryKinds) {
    if (!bodyHasMemoryKind(body, kind)) {
      reasons.push({ code: "MEMORY_KIND_NOT_DECLARED", message: `memory kind ${kind} is not declared by body ${body.bodyId}` });
    }
  }
  const granted = grantedCapabilities(body);
  for (const capability of required.capabilities) {
    if (!granted.has(capability)) {
      reasons.push({ code: "CAPABILITY_NOT_GRANTED", message: `capability ${capability} is not granted to body ${body.bodyId}` });
    }
  }
  return reasons;
}

/** Preferred-coverage counting (soft — the capabilityFit channel). */
function preferredCoverage(body: AgentBody, preferred: NormalizedQuery): { matched: number; total: number } {
  let matched = 0;
  let total = 0;
  for (const ref of preferred.roles) {
    total += 1;
    if (body.role.roleId === ref) matched += 1;
  }
  for (const ref of preferred.tools) {
    total += 1;
    if (bodyHasTool(body, ref)) matched += 1;
  }
  for (const ref of preferred.observations) {
    total += 1;
    if (bodyHasObservation(body, ref)) matched += 1;
  }
  for (const ref of preferred.actions) {
    total += 1;
    if (bodyHasAction(body, ref)) matched += 1;
  }
  for (const kind of preferred.memoryKinds) {
    total += 1;
    if (bodyHasMemoryKind(body, kind)) matched += 1;
  }
  const granted = grantedCapabilities(body);
  for (const capability of preferred.capabilities) {
    total += 1;
    if (granted.has(capability)) matched += 1;
  }
  return { matched, total };
}

// ---------------------------------------------------------------------------
// Path selection (min traversal cost, deterministic tie-breaks)
// ---------------------------------------------------------------------------

interface PathLabel {
  cost: number;
  hops: number;
  edges: DelegationEdge[];
}

/** Lexicographic comparison of edge-id sequences (UTF-16 code units). */
function compareSequences(a: string[], b: string[]): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length - b.length;
}

function sequenceOf(label: PathLabel): string[] {
  return label.edges.map((edge) => edge.edgeId);
}

/**
 * Single-source min-cost path labels from the requester over the
 * directed edge graph (Dijkstra; positive edge costs). Deterministic
 * tie-breaks: settle the unsettled node with the minimal
 * (cost, edge-id sequence) label; relax into a node only when the
 * candidate label is strictly lower cost, or equal cost with a
 * lexicographically smaller edge-id sequence. Labels beyond the hop
 * horizon are never created. Note: two labels of EQUAL cost can never
 * be prefix-related (positive edge costs), so the lexicographic order
 * is extension-stable and the first relaxation of an equal label is
 * kept deterministically.
 */
function shortestPathLabels(
  org: AgentOrganization,
  requesterBodyId: string,
  edgeCosts: EdgeCostMap,
  maxHops: number,
): Map<string, PathLabel> {
  const adjacency = new Map<string, DelegationEdge[]>();
  for (const body of org.bodies) adjacency.set(body.bodyId, []);
  for (const edge of org.edges) {
    const list = adjacency.get(edge.fromBodyId);
    if (list !== undefined) list.push(edge); // edge-declaration order
  }

  const labels = new Map<string, PathLabel>([[requesterBodyId, { cost: 0, hops: 0, edges: [] }]]);
  const settled = new Set<string>();
  const nodeIds = org.bodies.map((body) => body.bodyId);

  for (;;) {
    let bestId: string | null = null;
    let bestLabel: PathLabel | null = null;
    for (const id of nodeIds) {
      if (settled.has(id)) continue;
      const label = labels.get(id);
      if (label === undefined) continue;
      if (
        bestLabel === null ||
        label.cost < bestLabel.cost ||
        (label.cost === bestLabel.cost && compareSequences(sequenceOf(label), sequenceOf(bestLabel)) < 0)
      ) {
        bestId = id;
        bestLabel = label;
      }
    }
    if (bestId === null || bestLabel === null) break;
    settled.add(bestId);
    if (bestLabel.hops >= maxHops) continue; // horizon: do not extend
    for (const edge of adjacency.get(bestId) ?? []) {
      const nextCost = bestLabel.cost + edgeCosts[edge.kind];
      const nextLabel: PathLabel = {
        cost: nextCost,
        hops: bestLabel.hops + 1,
        edges: [...bestLabel.edges, edge],
      };
      const existing = labels.get(edge.toBodyId);
      if (
        existing === undefined ||
        nextCost < existing.cost ||
        (nextCost === existing.cost && compareSequences(sequenceOf(nextLabel), sequenceOf(existing)) < 0)
      ) {
        labels.set(edge.toBodyId, nextLabel);
      }
    }
  }
  return labels;
}

function toCandidatePath(label: PathLabel): CandidatePath {
  return {
    value: 1 / (1 + label.cost),
    hops: label.hops,
    cost: label.cost,
    edges: label.edges.map((edge) => ({
      edgeId: edge.edgeId,
      fromBodyId: edge.fromBodyId,
      toBodyId: edge.toBodyId,
      kind: edge.kind,
    })),
  };
}

// ---------------------------------------------------------------------------
// The search core (pure)
// ---------------------------------------------------------------------------

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

interface BudgetChannelOutcome {
  channel?: BudgetHeadroomDetail;
  reasons: { code: string; message: string }[];
}

/**
 * Budget feasibility (hard gate) + headroom channel (soft score) over
 * the request's demand estimates and the body's TIGHTEST declared
 * metered budgets. The tightest limit binds because the W2-007 body
 * runtime aborts when ANY declared budget of a kind is exceeded.
 */
function budgetChannel(body: AgentBody, demand: { cost?: number; tokens?: number; calls?: number }): BudgetChannelOutcome {
  const reasons: { code: string; message: string }[] = [];
  const kinds: BudgetHeadroomKindDetail[] = [];
  const components: number[] = [];
  for (const kind of METERED_KINDS) {
    const estimate = demand[kind];
    if (estimate === undefined) continue;
    const budgetsOfKind = body.budgets.filter((budget) => budget.kind === kind);
    if (budgetsOfKind.length === 0) continue;
    const tightest = Math.min(...budgetsOfKind.map((budget) => budget.limit));
    if (estimate > tightest) {
      reasons.push({
        code: "BUDGET_INFEASIBLE",
        message: `estimated ${kind} demand ${estimate} exceeds the tightest declared ${kind} budget ${tightest} of body ${body.bodyId}`,
      });
      continue;
    }
    const headroom = estimate === 0 ? null : tightest / estimate;
    kinds.push({ kind, limit: tightest, estimate, headroom });
    components.push(estimate === 0 ? 1 : (tightest / estimate) / (tightest / estimate + 1));
  }
  if (kinds.length === 0) {
    return { reasons };
  }
  const value = components.reduce((sum, component) => sum + component, 0) / components.length;
  return { channel: { value, kinds }, reasons };
}

function searchCore(
  org: AgentOrganization,
  request: NormalizedRequest,
  config: EngineConfig,
): OrganizationSearchResult {
  const labels = shortestPathLabels(org, request.requesterBodyId, config.edgeCosts, config.maxHops);
  const ranked: RankedCandidate[] = [];
  const excluded: ExcludedCandidate[] = [];

  for (const body of org.bodies) {
    const reasons: { code: string; message: string }[] = [];

    // --- Hard gates (lock #21: constraints exclude, never score). ---
    reasons.push(...matchRequired(body, request.required));
    if (request.requiresEvaluator && body.evaluator === undefined) {
      reasons.push({
        code: "EVALUATOR_REQUIRED",
        message: `body ${body.bodyId} declares no evaluator and the request requires one`,
      });
    }

    const label = labels.get(body.bodyId);
    if (label === undefined) {
      reasons.push({
        code: "UNREACHABLE",
        message: `no delegation/communication path from requester ${request.requesterBodyId} to body ${body.bodyId} within the ${config.maxHops}-hop search horizon`,
      });
    } else if (request.maxHops !== undefined && label.hops > request.maxHops) {
      reasons.push({
        code: "MAX_HOPS_EXCEEDED",
        message: `shortest path from requester ${request.requesterBodyId} to body ${body.bodyId} uses ${label.hops} hops (bound ${request.maxHops})`,
      });
    }

    if (request.maxLatencyMs !== undefined) {
      if (body.latencyLimits === undefined) {
        // Fail-closed: an undeclared latency limit cannot evidence the
        // request's deadline (same fail-closed law as W2-002 gates).
        reasons.push({
          code: "LATENCY_UNDECLARED",
          message: `request declares maxLatencyMs ${request.maxLatencyMs} but body ${body.bodyId} declares no latency limits (cannot evidence the deadline)`,
        });
      } else if (body.latencyLimits.hardMs > request.maxLatencyMs) {
        reasons.push({
          code: "LATENCY_INFEASIBLE",
          message: `body ${body.bodyId} hard deadline ${body.latencyLimits.hardMs}ms exceeds the request latency budget ${request.maxLatencyMs}ms`,
        });
      }
    }

    const budget = budgetChannel(body, request.demand);
    reasons.push(...budget.reasons);

    if (reasons.length > 0) {
      excluded.push({ bodyId: body.bodyId, roleId: body.role.roleId, reasons });
      continue;
    }

    // --- Soft channels (honest evidence: declared data only). ---
    const coverage = preferredCoverage(body, request.preferred);
    const capabilityFit: CapabilityFitDetail = {
      value: coverage.total > 0 ? coverage.matched / coverage.total : 1,
      preferredMatched: coverage.matched,
      preferredTotal: coverage.total,
    };
    const path = toCandidatePath(label as PathLabel);

    const latency =
      request.maxLatencyMs !== undefined && body.latencyLimits !== undefined
        ? {
            value: request.maxLatencyMs / (request.maxLatencyMs + body.latencyLimits.hardMs),
            hardMs: body.latencyLimits.hardMs,
            budgetMs: request.maxLatencyMs,
          }
        : undefined;

    const evaluatorHealth =
      body.evaluator !== undefined && request.evaluatorHealth[body.evaluator.evaluatorId] !== undefined
        ? {
            value: clamp01(request.evaluatorHealth[body.evaluator.evaluatorId]),
            evaluatorId: body.evaluator.evaluatorId,
          }
        : undefined;

    // Fixed channel order (capabilityFit, path, budgetHeadroom,
    // latency, evaluatorHealth) — deterministic floating-point sums.
    const evaluated: { weight: number; value: number }[] = [
      { weight: config.weights.capabilityFit, value: capabilityFit.value },
      { weight: config.weights.path, value: path.value },
    ];
    if (budget.channel !== undefined) evaluated.push({ weight: config.weights.budgetHeadroom, value: budget.channel.value });
    if (latency !== undefined) evaluated.push({ weight: config.weights.latency, value: latency.value });
    if (evaluatorHealth !== undefined) evaluated.push({ weight: config.weights.evaluatorHealth, value: evaluatorHealth.value });

    const weightSum = evaluated.reduce((sum, channel) => sum + channel.weight, 0);
    const score =
      weightSum > 0 ? evaluated.reduce((sum, channel) => sum + channel.weight * channel.value, 0) / weightSum : 0;

    ranked.push({
      bodyId: body.bodyId,
      roleId: body.role.roleId,
      score,
      confidence: evaluated.length / 5,
      capabilityFit,
      path,
      ...(budget.channel !== undefined ? { budgetHeadroom: budget.channel } : {}),
      ...(latency !== undefined ? { latency } : {}),
      ...(evaluatorHealth !== undefined ? { evaluatorHealth } : {}),
    });
  }

  // Canonical ordering: score DESC, then bodyId ASC (UTF-16 code
  // units) — deterministic stable tie-breaking (W2-002 pattern).
  ranked.sort((a, b) => {
    if (a.score !== b.score) return a.score > b.score ? -1 : 1;
    return a.bodyId < b.bodyId ? -1 : a.bodyId > b.bodyId ? 1 : 0;
  });

  return {
    organizationId: org.organizationId,
    requestId: request.requestId,
    requesterBodyId: request.requesterBodyId,
    ranked,
    excluded,
  };
}

function runSearch(
  orgInput: unknown,
  requestInput: unknown,
  config: EngineConfig,
): Result<OrganizationSearchResult> {
  const parsedOrg = validateOrg(orgInput);
  if (!parsedOrg.ok) return parsedOrg;
  const parsedRequest = validateRequest(requestInput);
  if (!parsedRequest.ok) return parsedRequest;
  const org = parsedOrg.value.org;
  const request = parsedRequest.value;
  if (!org.bodies.some((body) => body.bodyId === request.requesterBodyId)) {
    return invalidInput(`search: requester body ${request.requesterBodyId} is not declared in organization ${org.organizationId}`);
  }
  return { ok: true, value: searchCore(org, request, config) };
}

// ---------------------------------------------------------------------------
// Single-agent baseline (BASELINE COMPARISON LAW, lock #15)
// ---------------------------------------------------------------------------

/**
 * Derive the single-agent baseline body (documented): the capability
 * UNION of the organization's bodies — verbatim for a one-body org;
 * for N > 1 a generalist holding every declared tool / observation /
 * action / memory interface / permission capability, with NO budgets,
 * latency limits or evaluator (no invented evidence).
 */
function deriveGeneralistBody(org: AgentOrganization): Result<AgentBody> {
  if (org.bodies.length === 1) {
    return { ok: true, value: org.bodies[0] };
  }
  const tools: AgentBody["tools"] = [];
  const seenToolIds = new Set<string>();
  const observations: AgentBody["observations"] = [];
  const seenObservationIds = new Set<string>();
  const actions: AgentBody["actions"] = [];
  const seenActionIds = new Set<string>();
  const memoryInterfaces: AgentBody["memoryInterfaces"] = [];
  const seenMemoryIds = new Set<string>();
  const permissions: AgentBody["permissions"] = [];
  const seenCapabilities = new Set<Permission["capability"]>();
  for (const body of org.bodies) {
    for (const tool of body.tools) {
      if (!seenToolIds.has(tool.toolId)) {
        seenToolIds.add(tool.toolId);
        tools.push(tool);
      }
    }
    for (const observation of body.observations) {
      if (!seenObservationIds.has(observation.observationId)) {
        seenObservationIds.add(observation.observationId);
        observations.push(observation);
      }
    }
    for (const action of body.actions) {
      if (!seenActionIds.has(action.actionId)) {
        seenActionIds.add(action.actionId);
        actions.push(action);
      }
    }
    for (const memory of body.memoryInterfaces) {
      if (!seenMemoryIds.has(memory.memoryId)) {
        seenMemoryIds.add(memory.memoryId);
        memoryInterfaces.push(memory);
      }
    }
    for (const permission of body.permissions) {
      if (!seenCapabilities.has(permission.capability)) {
        seenCapabilities.add(permission.capability);
        permissions.push(permission);
      }
    }
  }
  const parsed = AgentBodySchema.safeParse({
    schema: "reckon.agent-body",
    schemaVersion: "0.1.0",
    bodyId: "baseline-generalist",
    version: "1",
    role: {
      roleId: "generalist",
      description: `Derived single-agent baseline: capability union of the ${org.bodies.length} bodies in organization ${org.organizationId} (W2-009 organization search)`,
    },
    tools,
    observations,
    memoryInterfaces,
    actions,
    permissions,
  });
  if (!parsed.success) {
    return invalidInput(
      "searchWithBaseline: derived generalist body failed schema validation",
      parsed.error.issues.map((i) => ({ path: `baseline.${i.path.join(".")}`, message: i.message })),
    );
  }
  return { ok: true, value: parsed.data };
}

/** The one-body, no-edge baseline organization (W2-008 shape). */
function baselineOrganizationOf(body: AgentBody): Result<AgentOrganization> {
  const parsed = AgentOrganizationSchema.safeParse({
    schema: "reckon.agent-organization",
    schemaVersion: "0.1.0",
    organizationId: "baseline-single-agent",
    version: "1",
    bodies: [body],
    edges: [],
    modelAssignments: [], // search executes nothing — no assignments needed
    terminationRules: [{ kind: "task-complete" }],
  });
  if (!parsed.success) {
    return invalidInput(
      "searchWithBaseline: baseline organization failed schema validation",
      parsed.error.issues.map((i) => ({ path: `baselineOrg.${i.path.join(".")}`, message: i.message })),
    );
  }
  return { ok: true, value: parsed.data };
}

function runSearchWithBaseline(
  orgInput: unknown,
  requestInput: unknown,
  options: SearchWithBaselineOptions,
  config: EngineConfig,
): Result<SearchWithBaselineResult> {
  const parsedOrg = validateOrg(orgInput);
  if (!parsedOrg.ok) return parsedOrg;
  const parsedRequest = validateRequest(requestInput);
  if (!parsedRequest.ok) return parsedRequest;
  const org = parsedOrg.value.org;
  const request = parsedRequest.value;
  if (!org.bodies.some((body) => body.bodyId === request.requesterBodyId)) {
    return invalidInput(`searchWithBaseline: requester body ${request.requesterBodyId} is not declared in organization ${org.organizationId}`);
  }

  // (a) The organization search path.
  const search = searchCore(org, request, config);

  // (b) The single-agent fallback: the SAME request through the SAME
  // machinery over a one-body, no-edge organization.
  let baselineBody: AgentBody;
  let derivation: BaselineDerivation;
  if (options.baseline !== undefined) {
    if (!isObject(options.baseline)) {
      return invalidInput("searchWithBaseline: options.baseline must be an object");
    }
    if (options.baseline.body === undefined || options.baseline.body === null) {
      return invalidInput("searchWithBaseline: options.baseline.body is required");
    }
    const parsedBody = AgentBodySchema.safeParse(options.baseline.body);
    if (!parsedBody.success) {
      return invalidInput(
        "searchWithBaseline: invalid baseline body",
        parsedBody.error.issues.map((i) => ({ path: `baseline.body.${i.path.join(".")}`, message: i.message })),
      );
    }
    baselineBody = parsedBody.data;
    derivation = "explicit";
  } else {
    const derived = deriveGeneralistBody(org);
    if (!derived.ok) return derived;
    baselineBody = derived.value;
    derivation = "derived-union";
  }
  const baselineOrg = baselineOrganizationOf(baselineBody);
  if (!baselineOrg.ok) return baselineOrg;

  const baselineRequest: NormalizedRequest = {
    ...request,
    requesterBodyId: baselineBody.bodyId,
  };
  const baselineSearch = searchCore(baselineOrg.value, baselineRequest, config);

  // The baseline org has exactly one body: one row, eligible or excluded.
  let baseline: BaselineEvaluation;
  if (baselineSearch.ranked.length > 0) {
    const row = baselineSearch.ranked[0];
    baseline = {
      organizationId: "baseline-single-agent",
      bodyId: row.bodyId,
      derivation,
      status: "eligible",
      score: row.score,
      confidence: row.confidence,
      capabilityFit: row.capabilityFit,
      path: row.path,
      ...(row.budgetHeadroom !== undefined ? { budgetHeadroom: row.budgetHeadroom } : {}),
      ...(row.latency !== undefined ? { latency: row.latency } : {}),
      ...(row.evaluatorHealth !== undefined ? { evaluatorHealth: row.evaluatorHealth } : {}),
    };
  } else {
    const row = baselineSearch.excluded[0];
    baseline = {
      organizationId: "baseline-single-agent",
      bodyId: baselineBody.bodyId,
      derivation,
      status: "excluded",
      reasons: row !== undefined ? row.reasons : [],
    };
  }

  // Honest deltas (either direction — never assumed).
  const best = search.ranked[0];
  const eligibleBaseline = baseline.status === "eligible" ? baseline : undefined;
  const orgEligible = search.ranked.length > 0;
  const comparison: BaselineDelta["comparison"] =
    orgEligible && eligibleBaseline !== undefined
      ? "both"
      : orgEligible
        ? "org-only-path"
        : eligibleBaseline !== undefined
          ? "baseline-only-path"
          : "neither";

  const delta: BaselineDelta = {
    comparison,
    orgEligibleCount: search.ranked.length,
    ...(best !== undefined
      ? {
          bestOrgScore: best.score,
          bestOrgCapabilityFit: best.capabilityFit.value,
          bestOrgPathCost: best.path.cost,
          bestOrgHops: best.path.hops,
        }
      : {}),
    ...(eligibleBaseline !== undefined
      ? {
          baselineScore: eligibleBaseline.score,
          baselineCapabilityFit: eligibleBaseline.capabilityFit.value,
        }
      : {}),
    ...(best !== undefined && eligibleBaseline !== undefined
      ? {
          scoreDelta: best.score - eligibleBaseline.score,
          capabilityFitDelta: best.capabilityFit.value - eligibleBaseline.capabilityFit.value,
        }
      : {}),
    ...(best !== undefined ? { pathCostDelta: best.path.cost } : {}),
  };

  return { ok: true, value: { search, baseline, delta } };
}

/** Exposed for tests/artifacts: the evidence-sparsity method id. */
export const SEARCH_UNCERTAINTY_METHOD = UNCERTAINTY_METHOD;
