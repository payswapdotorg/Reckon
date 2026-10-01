/**
 * W2-009 acceptance tests — organization search.
 *
 * Proves: capability matching over declared body capabilities
 * (required gates exclude with typed reasons — constraint/reward
 * separation, lock #21; preferred coverage scores), path selection
 * (min traversal cost, deterministic lexicographic tie-breaks, hop
 * bounds, unreachable exclusions), the decision-support ranking
 * (honest-evidence channels with per-candidate normalization and
 * evidence-sparsity confidence), and the BASELINE COMPARISON LAW
 * (lock #15): `searchWithBaseline` ALWAYS carries the single-agent
 * baseline row plus honest deltas — with explicit tests for BOTH
 * honest directions (the org ahead AND the single agent ahead; the
 * org as the only serviceable path AND as worthless overhead).
 * Also proves determinism (property-style: seeded random scenarios,
 * repeated invocation ⇒ digest-identical results) and the degenerate
 * regression (a one-body, no-edge organization degrades cleanly to
 * the single-agent path).
 */
import { describe, expect, it } from "vitest";
import {
  AgentBodySchema,
  AgentOrganizationSchema,
  contentDigest,
  type AgentBody,
  type AgentOrganization,
} from "@reckon/contracts";
import {
  createOrganizationSearch,
  DEFAULT_SEARCH_WEIGHTS,
  type OrganizationSearch,
  type OrganizationSearchRequest,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface BodySpec {
  roleId?: string;
  tools?: { toolId: string; name?: string }[];
  observations?: { observationId: string; kind: string }[];
  actions?: { actionId: string; kind: string }[];
  memoryInterfaces?: { memoryId: string; kind: string; access?: string }[];
  permissions?: { permissionId: string; capability: string }[];
  budgets?: { kind: string; limit: number }[];
  latencyLimits?: { hardMs: number; softMs?: number };
  evaluator?: { evaluatorId: string; version?: string };
}

function body(bodyId: string, spec: BodySpec = {}): AgentBody {
  return AgentBodySchema.parse({
    bodyId,
    role: { roleId: spec.roleId ?? "worker", description: `Body ${bodyId}` },
    ...(spec.tools !== undefined
      ? { tools: spec.tools.map((tool) => ({ toolId: tool.toolId, name: tool.name ?? tool.toolId })) }
      : {}),
    ...(spec.observations !== undefined ? { observations: spec.observations } : {}),
    ...(spec.actions !== undefined ? { actions: spec.actions } : {}),
    ...(spec.memoryInterfaces !== undefined
      ? {
          memoryInterfaces: spec.memoryInterfaces.map((memory) => ({
            memoryId: memory.memoryId,
            kind: memory.kind,
            access: memory.access ?? "read",
          })),
        }
      : {}),
    ...(spec.permissions !== undefined ? { permissions: spec.permissions } : {}),
    ...(spec.budgets !== undefined ? { budgets: spec.budgets } : {}),
    ...(spec.latencyLimits !== undefined ? { latencyLimits: spec.latencyLimits } : {}),
    ...(spec.evaluator !== undefined ? { evaluator: spec.evaluator } : {}),
  });
}

type EdgeSpec = { edgeId: string; from: string; to: string; kind?: "communicate" | "delegate" | "report" | "escalate" | "custom" };

/**
 * Builds an organization with EMPTY model assignments on purpose:
 * organization search executes nothing, so it must never require
 * model assignments (documented W2-009 behavior — the W2-008 runtime
 * requires them only for execution).
 */
function orgOf(
  bodies: AgentBody[],
  edges: EdgeSpec[] = [],
  organizationId = "org-test",
): AgentOrganization {
  return AgentOrganizationSchema.parse({
    organizationId,
    version: "1",
    bodies,
    edges: edges.map((edge) => ({
      edgeId: edge.edgeId,
      fromBodyId: edge.from,
      toBodyId: edge.to,
      kind: edge.kind ?? "delegate",
    })),
    modelAssignments: [],
    terminationRules: [{ kind: "task-complete" }],
  });
}

function engine(deps?: Parameters<typeof createOrganizationSearch>[0]): OrganizationSearch {
  const created = createOrganizationSearch(deps);
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

function run(
  org: AgentOrganization,
  request: OrganizationSearchRequest,
  deps?: Parameters<typeof createOrganizationSearch>[0],
) {
  const result = engine(deps).search(org, request);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function runBaseline(
  org: AgentOrganization,
  request: OrganizationSearchRequest,
  options?: { baseline?: { body: AgentBody } },
) {
  const result = engine().searchWithBaseline(org, request, options);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function request(requesterBodyId: string, overrides: Partial<OrganizationSearchRequest> = {}): OrganizationSearchRequest {
  return { requestId: "req-1", requesterBodyId, ...overrides };
}

function reasonCodesOf(value: { reasons: ReadonlyArray<{ code: string }> }): string[] {
  return value.reasons.map((reason) => reason.code);
}

// ---------------------------------------------------------------------------
// Capability matching
// ---------------------------------------------------------------------------

describe("W2-009 search: capability matching (required gates, preferred coverage)", () => {
  it("required tools are ALL-of: a body missing one is excluded with a typed reason, a complete body is eligible", () => {
    const organization = orgOf(
      [
        body("body-r", { roleId: "coordinator" }),
        body("body-s", { tools: [{ toolId: "tool-search" }, { toolId: "tool-summarize" }] }),
        body("body-p", { tools: [{ toolId: "tool-search" }] }),
      ],
      [
        { edgeId: "e-r-s", from: "body-r", to: "body-s" },
        { edgeId: "e-r-p", from: "body-r", to: "body-p" },
      ],
    );
    const result = run(organization, request("body-r", { required: { tools: ["tool-search", "tool-summarize"] } }));
    expect(result.ranked.map((candidate) => candidate.bodyId)).toEqual(["body-s"]);
    const partial = result.excluded.find((candidate) => candidate.bodyId === "body-p");
    if (!partial) throw new Error("body-p exclusion missing");
    expect(reasonCodesOf(partial)).toContain("TOOL_NOT_DECLARED");
    expect(partial.reasons.some((reason) => reason.message.includes("tool-summarize"))).toBe(true);
  });

  it("required roles are ANY-of; a non-matching role is a typed exclusion", () => {
    const organization = orgOf(
      [body("body-r", { roleId: "coordinator" }), body("body-a", { roleId: "analyst" }), body("body-w", { roleId: "worker" })],
      [
        { edgeId: "e-r-a", from: "body-r", to: "body-a" },
        { edgeId: "e-r-w", from: "body-r", to: "body-w" },
      ],
    );
    const result = run(organization, request("body-r", { required: { roles: ["analyst", "researcher"] } }));
    expect(result.ranked.map((candidate) => candidate.bodyId)).toEqual(["body-a"]);
    const worker = result.excluded.find((candidate) => candidate.bodyId === "body-w");
    if (!worker) throw new Error("body-w exclusion missing");
    expect(reasonCodesOf(worker)).toContain("ROLE_NOT_MATCHED");
  });

  it("observations and actions match by id OR by kind", () => {
    const organization = orgOf(
      [
        body("body-r", { roleId: "coordinator" }),
        body("body-o", {
          observations: [{ observationId: "obs-ctx", kind: "context" }],
          actions: [{ actionId: "act-sel", kind: "select" }],
        }),
      ],
      [{ edgeId: "e-r-o", from: "body-r", to: "body-o" }],
    );
    const byKindAndId = run(
      organization,
      request("body-r", { required: { observations: ["context"], actions: ["act-sel"] } }),
    );
    expect(byKindAndId.ranked.map((candidate) => candidate.bodyId)).toEqual(["body-o"]);

    const badObservation = run(organization, request("body-r", { required: { observations: ["outcome"] } }));
    expect(badObservation.ranked).toHaveLength(0);
    expect(reasonCodesOf(badObservation.excluded[0])).toContain("OBSERVATION_NOT_DECLARED");

    const badAction = run(organization, request("body-r", { required: { actions: ["queue"] } }));
    expect(badAction.ranked).toHaveLength(0);
    expect(reasonCodesOf(badAction.excluded[0])).toContain("ACTION_NOT_DECLARED");
  });

  it("required memory kinds and permission capabilities gate eligibility", () => {
    const organization = orgOf(
      [
        body("body-r", { roleId: "coordinator" }),
        body("body-m", {
          memoryInterfaces: [{ memoryId: "mem-1", kind: "shared" }],
          permissions: [
            { permissionId: "p-1", capability: "model-inference" },
            { permissionId: "p-2", capability: "tool" },
          ],
        }),
      ],
      [{ edgeId: "e-r-m", from: "body-r", to: "body-m" }],
    );
    const ok = run(
      organization,
      request("body-r", { required: { memoryKinds: ["shared"], capabilities: ["tool", "model-inference"] } }),
    );
    expect(ok.ranked.map((candidate) => candidate.bodyId)).toEqual(["body-m"]);

    const badMemory = run(organization, request("body-r", { required: { memoryKinds: ["persistent"] } }));
    expect(reasonCodesOf(badMemory.excluded[0])).toContain("MEMORY_KIND_NOT_DECLARED");

    const badCapability = run(organization, request("body-r", { required: { capabilities: ["network"] } }));
    expect(reasonCodesOf(badCapability.excluded[0])).toContain("CAPABILITY_NOT_GRANTED");
  });

  it("tools match by name as well as toolId", () => {
    const organization = orgOf(
      [body("body-r", { roleId: "coordinator" }), body("body-s", { tools: [{ toolId: "tool-x", name: "web-search" }] })],
      [{ edgeId: "e-r-s", from: "body-r", to: "body-s" }],
    );
    const result = run(organization, request("body-r", { required: { tools: ["web-search"] } }));
    expect(result.ranked.map((candidate) => candidate.bodyId)).toEqual(["body-s"]);
  });

  it("preferred coverage drives capabilityFit; no preferred declared ⇒ fit 1 (non-differentiating)", () => {
    const organization = orgOf(
      [
        body("body-r", { roleId: "coordinator" }),
        body("body-s", { tools: [{ toolId: "t-1" }, { toolId: "t-2" }] }),
        body("body-p", { tools: [{ toolId: "t-1" }] }),
      ],
      [
        { edgeId: "e-r-s", from: "body-r", to: "body-s" },
        { edgeId: "e-r-p", from: "body-r", to: "body-p" },
      ],
    );
    const preferred = run(organization, request("body-r", { preferred: { tools: ["t-1", "t-2"] } }));
    const fitS = preferred.ranked.find((candidate) => candidate.bodyId === "body-s");
    const fitP = preferred.ranked.find((candidate) => candidate.bodyId === "body-p");
    if (!fitS || !fitP) throw new Error("ranked candidates missing");
    expect(fitS.capabilityFit).toEqual({ value: 1, preferredMatched: 2, preferredTotal: 2 });
    expect(fitP.capabilityFit.value).toBeCloseTo(0.5, 12);
    expect(fitP.capabilityFit.preferredMatched).toBe(1);

    const noPreferred = run(organization, request("body-r", {}));
    for (const candidate of noPreferred.ranked) {
      expect(candidate.capabilityFit).toEqual({ value: 1, preferredMatched: 0, preferredTotal: 0 });
    }
  });

  it("requiresEvaluator excludes bodies without a declared evaluator", () => {
    const organization = orgOf(
      [
        body("body-r", { roleId: "coordinator" }),
        body("body-e", { evaluator: { evaluatorId: "ev-1" } }),
        body("body-n"),
      ],
      [
        { edgeId: "e-r-e", from: "body-r", to: "body-e" },
        { edgeId: "e-r-n", from: "body-r", to: "body-n" },
      ],
    );
    const result = run(organization, request("body-r", { constraints: { requiresEvaluator: true } }));
    expect(result.ranked.map((candidate) => candidate.bodyId)).toEqual(["body-e"]);
    const naked = result.excluded.find((candidate) => candidate.bodyId === "body-n");
    if (!naked) throw new Error("body-n exclusion missing");
    expect(reasonCodesOf(naked)).toContain("EVALUATOR_REQUIRED");
  });
});

// ---------------------------------------------------------------------------
// Path selection
// ---------------------------------------------------------------------------

describe("W2-009 search: path selection (min cost, deterministic tie-breaks)", () => {
  function diamond(): AgentOrganization {
    return orgOf(
      [
        body("body-r", { roleId: "coordinator" }),
        body("body-a", { tools: [{ toolId: "t-1" }] }),
        body("body-b", { tools: [{ toolId: "t-1" }] }),
        body("body-c", { tools: [{ toolId: "t-1" }] }),
      ],
      [
        { edgeId: "e-r-a", from: "body-r", to: "body-a" },
        { edgeId: "e-a-c", from: "body-a", to: "body-c" },
        { edgeId: "e-r-b", from: "body-r", to: "body-b" },
        { edgeId: "e-b-c", from: "body-b", to: "body-c" },
        { edgeId: "e-r-c", from: "body-r", to: "body-c" },
      ],
    );
  }

  it("default uniform costs ⇒ the fewest-hop path is selected", () => {
    const result = run(diamond(), request("body-r", { preferred: { tools: ["t-1"] } }));
    const candidateC = result.ranked.find((candidate) => candidate.bodyId === "body-c");
    if (!candidateC) throw new Error("body-c missing from ranked");
    expect(candidateC.path.hops).toBe(1);
    expect(candidateC.path.cost).toBe(1);
    expect(candidateC.path.edges.map((edge) => edge.edgeId)).toEqual(["e-r-c"]);
    expect(candidateC.path.value).toBeCloseTo(0.5, 12);
  });

  it("equal-cost path ties break on the lexicographically smallest edge-id sequence", () => {
    // Two parallel edges r→a: the LATER-declared e-r-a-1 must win
    // (lexicographic, not declaration order).
    const parallel = orgOf(
      [body("body-r", { roleId: "coordinator" }), body("body-a", { tools: [{ toolId: "t-1" }] })],
      [
        { edgeId: "e-r-a-2", from: "body-r", to: "body-a" },
        { edgeId: "e-r-a-1", from: "body-r", to: "body-a" },
      ],
    );
    const parallelResult = run(parallel, request("body-r", { preferred: { tools: ["t-1"] } }));
    expect(parallelResult.ranked[0].path.edges.map((edge) => edge.edgeId)).toEqual(["e-r-a-1"]);

    // Two equal-cost two-hop routes to body-c: ["e-r-a","e-a-c"] vs
    // ["e-r-b","e-b-c"] — the first sequence is lexicographically smaller.
    const noDirectOrg = AgentOrganizationSchema.parse({
      ...diamond(),
      edges: diamond().edges.filter((edge) => edge.edgeId !== "e-r-c"),
    });
    const result = run(noDirectOrg, request("body-r", { preferred: { tools: ["t-1"] } }));
    const candidateC = result.ranked.find((candidate) => candidate.bodyId === "body-c");
    if (!candidateC) throw new Error("body-c missing from ranked");
    expect(candidateC.path.hops).toBe(2);
    expect(candidateC.path.edges.map((edge) => edge.edgeId)).toEqual(["e-r-a", "e-a-c"]);
  });

  it("custom edge costs select the min-COST path over the min-hop path", () => {
    // r→c directly via a `communicate` edge (cost 5) vs r→a→c via two
    // `delegate` edges (cost 2): the two-hop path must win.
    const organization = orgOf(
      [
        body("body-r", { roleId: "coordinator" }),
        body("body-a", { tools: [{ toolId: "t-1" }] }),
        body("body-c", { tools: [{ toolId: "t-1" }] }),
      ],
      [
        { edgeId: "e-r-c", from: "body-r", to: "body-c", kind: "communicate" },
        { edgeId: "e-r-a", from: "body-r", to: "body-a", kind: "delegate" },
        { edgeId: "e-a-c", from: "body-a", to: "body-c", kind: "delegate" },
      ],
    );
    const result = run(organization, request("body-r", { preferred: { tools: ["t-1"] } }), {
      edgeCosts: { communicate: 5 },
    });
    const candidateC = result.ranked.find((candidate) => candidate.bodyId === "body-c");
    if (!candidateC) throw new Error("body-c missing from ranked");
    expect(candidateC.path.hops).toBe(2);
    expect(candidateC.path.cost).toBe(2);
    expect(candidateC.path.edges.map((edge) => edge.edgeId)).toEqual(["e-r-a", "e-a-c"]);
  });

  it("candidates unreachable over the directed graph are excluded as UNREACHABLE", () => {
    // Edge points TOWARD the requester: body-x is unreachable from body-r.
    const organization = orgOf(
      [body("body-r", { roleId: "coordinator", tools: [{ toolId: "t-1" }] }), body("body-x", { tools: [{ toolId: "t-1" }] })],
      [{ edgeId: "e-x-r", from: "body-x", to: "body-r" }],
    );
    const result = run(organization, request("body-r", { preferred: { tools: ["t-1"] } }));
    expect(result.ranked.map((candidate) => candidate.bodyId)).toEqual(["body-r"]);
    const unreachable = result.excluded.find((candidate) => candidate.bodyId === "body-x");
    if (!unreachable) throw new Error("body-x exclusion missing");
    expect(reasonCodesOf(unreachable)).toContain("UNREACHABLE");
  });

  it("the request-level maxHops constraint excludes paths beyond the bound", () => {
    // body-c sits two hops out with no alternative route.
    const organization = orgOf(
      [
        body("body-r", { roleId: "coordinator" }),
        body("body-a", { tools: [{ toolId: "t-1" }] }),
        body("body-c", { tools: [{ toolId: "t-1" }] }),
      ],
      [
        { edgeId: "e-r-a", from: "body-r", to: "body-a" },
        { edgeId: "e-a-c", from: "body-a", to: "body-c" },
      ],
    );
    const bounded = run(organization, request("body-r", { preferred: { tools: ["t-1"] }, constraints: { maxHops: 1 } }));
    expect(bounded.ranked.map((candidate) => candidate.bodyId).sort()).toEqual(["body-a", "body-r"]);
    const tooFar = bounded.excluded.find((candidate) => candidate.bodyId === "body-c");
    if (!tooFar) throw new Error("body-c exclusion missing");
    expect(reasonCodesOf(tooFar)).toContain("MAX_HOPS_EXCEEDED");

    const unbounded = run(organization, request("body-r", { preferred: { tools: ["t-1"] }, constraints: { maxHops: 2 } }));
    expect(unbounded.ranked.map((candidate) => candidate.bodyId)).toContain("body-c");
    expect(unbounded.ranked.find((candidate) => candidate.bodyId === "body-c")?.path.hops).toBe(2);
  });

  it("the requester itself is a candidate with the empty 0-hop path", () => {
    const organization = orgOf(
      [body("body-r", { roleId: "coordinator", tools: [{ toolId: "t-1" }] })],
      [],
    );
    const result = run(organization, request("body-r", { required: { tools: ["t-1"] } }));
    expect(result.ranked).toHaveLength(1);
    const requester = result.ranked[0];
    expect(requester.bodyId).toBe("body-r");
    expect(requester.path).toEqual({ value: 1, hops: 0, cost: 0, edges: [] });
  });
});

// ---------------------------------------------------------------------------
// Ranking (decision support, honest evidence)
// ---------------------------------------------------------------------------

describe("W2-009 search: ranking components (fit, budget, latency, evaluator health)", () => {
  it("budget headroom: h/(h+1) over the tightest declared budget; zero estimate ⇒ unbounded headroom", () => {
    const organization = orgOf(
      [
        body("body-r", { roleId: "coordinator" }),
        body("body-a", { tools: [{ toolId: "t-1" }], budgets: [{ kind: "cost", limit: 10 }] }),
        body("body-b", { tools: [{ toolId: "t-1" }], budgets: [{ kind: "cost", limit: 10 }, { kind: "cost", limit: 8 }] }),
        body("body-c", { tools: [{ toolId: "t-1" }], budgets: [{ kind: "cost", limit: 5 }] }),
        body("body-d", { tools: [{ toolId: "t-1" }] }),
      ],
      [
        { edgeId: "e-r-a", from: "body-r", to: "body-a" },
        { edgeId: "e-r-b", from: "body-r", to: "body-b" },
        { edgeId: "e-r-c", from: "body-r", to: "body-c" },
        { edgeId: "e-r-d", from: "body-r", to: "body-d" },
      ],
    );
    const result = run(organization, request("body-r", { preferred: { tools: ["t-1"] }, constraints: { demandEstimates: { cost: 5 } } }));

    const a = result.ranked.find((candidate) => candidate.bodyId === "body-a");
    if (!a?.budgetHeadroom) throw new Error("body-a budget channel missing");
    expect(a.budgetHeadroom.kinds).toEqual([{ kind: "cost", limit: 10, estimate: 5, headroom: 2 }]);
    expect(a.budgetHeadroom.value).toBeCloseTo(2 / 3, 12);

    // Tightest limit binds (8, not 10): headroom 1.6 ⇒ 1.6/2.6 = 8/13.
    const b = result.ranked.find((candidate) => candidate.bodyId === "body-b");
    if (!b?.budgetHeadroom) throw new Error("body-b budget channel missing");
    expect(b.budgetHeadroom.kinds[0].limit).toBe(8);
    expect(b.budgetHeadroom.value).toBeCloseTo(8 / 13, 12);

    // Exactly 1× headroom ⇒ 0.5.
    const c = result.ranked.find((candidate) => candidate.bodyId === "body-c");
    if (!c?.budgetHeadroom) throw new Error("body-c budget channel missing");
    expect(c.budgetHeadroom.value).toBeCloseTo(0.5, 12);

    // No declared budget of the estimated kind ⇒ channel UNEVALUATED.
    const d = result.ranked.find((candidate) => candidate.bodyId === "body-d");
    if (!d) throw new Error("body-d missing");
    expect(d.budgetHeadroom).toBeUndefined();

    // Zero estimate ⇒ unbounded headroom (null, never non-finite).
    const zero = run(organization, request("body-r", { preferred: { tools: ["t-1"] }, constraints: { demandEstimates: { cost: 0 } } }));
    const aZero = zero.ranked.find((candidate) => candidate.bodyId === "body-a");
    if (!aZero?.budgetHeadroom) throw new Error("zero-estimate channel missing");
    expect(aZero.budgetHeadroom.kinds[0].headroom).toBeNull();
    expect(aZero.budgetHeadroom.value).toBe(1);
  });

  it("multiple estimated kinds average their components", () => {
    const organization = orgOf(
      [
        body("body-r", { roleId: "coordinator" }),
        body("body-a", {
          tools: [{ toolId: "t-1" }],
          budgets: [
            { kind: "cost", limit: 10 },
            { kind: "tokens", limit: 1000 },
          ],
        }),
      ],
      [{ edgeId: "e-r-a", from: "body-r", to: "body-a" }],
    );
    const result = run(
      organization,
      request("body-r", { preferred: { tools: ["t-1"] }, constraints: { demandEstimates: { cost: 5, tokens: 100 } } }),
    );
    const a = result.ranked[0];
    if (!a.budgetHeadroom) throw new Error("budget channel missing");
    expect(a.budgetHeadroom.kinds.map((kind) => kind.kind)).toEqual(["cost", "tokens"]);
    expect(a.budgetHeadroom.value).toBeCloseTo((2 / 3 + 10 / 11) / 2, 12);
  });

  it("estimated demand above the tightest declared budget is a hard exclusion (BUDGET_INFEASIBLE)", () => {
    const organization = orgOf(
      [
        body("body-r", { roleId: "coordinator" }),
        body("body-a", { tools: [{ toolId: "t-1" }], budgets: [{ kind: "cost", limit: 4 }] }),
      ],
      [{ edgeId: "e-r-a", from: "body-r", to: "body-a" }],
    );
    const result = run(organization, request("body-r", { preferred: { tools: ["t-1"] }, constraints: { demandEstimates: { cost: 5 } } }));
    // body-a is excluded (5 > 4); the requester stays eligible (an
    // undeclared budget cannot abort it — the channel is unevaluated).
    expect(result.ranked.map((candidate) => candidate.bodyId)).toEqual(["body-r"]);
    expect(reasonCodesOf(result.excluded[0])).toContain("BUDGET_INFEASIBLE");
  });

  it("latency: value budget/(budget+hardMs); infeasible and undeclared are typed exclusions (fail-closed)", () => {
    const organization = orgOf(
      [
        body("body-r", { roleId: "coordinator" }),
        body("body-a", { tools: [{ toolId: "t-1" }], latencyLimits: { hardMs: 40 } }),
        body("body-b", { tools: [{ toolId: "t-1" }], latencyLimits: { hardMs: 150 } }),
        body("body-c", { tools: [{ toolId: "t-1" }] }),
      ],
      [
        { edgeId: "e-r-a", from: "body-r", to: "body-a" },
        { edgeId: "e-r-b", from: "body-r", to: "body-b" },
        { edgeId: "e-r-c", from: "body-r", to: "body-c" },
      ],
    );
    const result = run(organization, request("body-r", { preferred: { tools: ["t-1"] }, constraints: { maxLatencyMs: 100 } }));
    expect(result.ranked.map((candidate) => candidate.bodyId)).toEqual(["body-a"]);
    const a = result.ranked[0];
    if (!a.latency) throw new Error("latency channel missing");
    expect(a.latency).toEqual({ value: 100 / 140, hardMs: 40, budgetMs: 100 });
    const tooSlow = result.excluded.find((candidate) => candidate.bodyId === "body-b");
    if (!tooSlow) throw new Error("body-b exclusion missing");
    expect(reasonCodesOf(tooSlow)).toContain("LATENCY_INFEASIBLE");
    const undeclared = result.excluded.find((candidate) => candidate.bodyId === "body-c");
    if (!undeclared) throw new Error("body-c exclusion missing");
    expect(reasonCodesOf(undeclared)).toContain("LATENCY_UNDECLARED");

    // No declared latency budget ⇒ no gate and no channel.
    const ungated = run(organization, request("body-r", { preferred: { tools: ["t-1"] } }));
    expect(ungated.ranked.map((candidate) => candidate.bodyId).sort()).toEqual(["body-a", "body-b", "body-c", "body-r"]);
    for (const candidate of ungated.ranked) {
      expect(candidate.latency).toBeUndefined();
    }
  });

  it("evaluator health: host-supplied data flows through; missing data stays unevaluated", () => {
    const organization = orgOf(
      [
        body("body-r", { roleId: "coordinator" }),
        body("body-a", { tools: [{ toolId: "t-1" }], evaluator: { evaluatorId: "ev-1" } }),
        body("body-b", { tools: [{ toolId: "t-1" }], evaluator: { evaluatorId: "ev-unknown" } }),
      ],
      [
        { edgeId: "e-r-a", from: "body-r", to: "body-a" },
        { edgeId: "e-r-b", from: "body-r", to: "body-b" },
      ],
    );
    const result = run(
      organization,
      request("body-r", { preferred: { tools: ["t-1"] }, evaluatorHealth: { "ev-1": 0.9 } }),
    );
    const a = result.ranked.find((candidate) => candidate.bodyId === "body-a");
    if (!a?.evaluatorHealth) throw new Error("evaluator health channel missing");
    expect(a.evaluatorHealth).toEqual({ value: 0.9, evaluatorId: "ev-1" });
    const b = result.ranked.find((candidate) => candidate.bodyId === "body-b");
    if (!b) throw new Error("body-b missing");
    expect(b.evaluatorHealth).toBeUndefined();
  });

  it("per-candidate normalization over EVALUATED channels + evidence-sparsity confidence", () => {
    const organization = orgOf(
      [
        body("body-r", {
          roleId: "coordinator",
          tools: [{ toolId: "t-1" }, { toolId: "t-2" }],
          latencyLimits: { hardMs: 100 },
        }),
        body("body-mid", {}),
        body("body-x", {
          tools: [{ toolId: "t-1" }],
          budgets: [{ kind: "cost", limit: 10 }],
          latencyLimits: { hardMs: 50 },
          evaluator: { evaluatorId: "ev-good" },
        }),
      ],
      [
        { edgeId: "e-r-mid", from: "body-r", to: "body-mid" },
        { edgeId: "e-mid-x", from: "body-mid", to: "body-x" },
      ],
    );
    const result = run(
      organization,
      request("body-r", {
        preferred: { tools: ["t-1", "t-2"] },
        constraints: { maxLatencyMs: 100, demandEstimates: { cost: 5 } },
        evaluatorHealth: { "ev-good": 0.9 },
      }),
    );

    // body-mid has no declared latency limits ⇒ fail-closed exclusion.
    expect(result.ranked.map((candidate) => candidate.bodyId)).toEqual(["body-r", "body-x"]);

    const r = result.ranked[0];
    // 3 evaluated channels (fit, path, latency) of 5 ⇒ confidence 0.6.
    expect(r.confidence).toBeCloseTo(3 / 5, 12);
    expect(r.score).toBeCloseTo((1 * 1 + 0.5 * 1 + 0.25 * 0.5) / 1.75, 12);
    expect(r.budgetHeadroom).toBeUndefined();
    expect(r.evaluatorHealth).toBeUndefined();

    const x = result.ranked[1];
    // All 5 channels evaluated ⇒ confidence 1; the score normalizes over
    // ALL evaluated channels (not penalized by weight of absent ones —
    // it simply has more real evidence, which here scores lower).
    expect(x.confidence).toBe(1);
    expect(x.score).toBeCloseTo(
      (1 * 0.5 + 0.5 * (1 / 3) + 0.25 * (2 / 3) + 0.25 * (2 / 3) + 0.25 * 0.9) / 2.25,
      12,
    );
    expect(x.capabilityFit.value).toBeCloseTo(0.5, 12);
    expect(x.path.value).toBeCloseTo(1 / 3, 12);
    expect(x.budgetHeadroom?.value).toBeCloseTo(2 / 3, 12);
    expect(x.latency?.value).toBeCloseTo(2 / 3, 12);
    expect(x.evaluatorHealth?.value).toBe(0.9);
  });

  it("ordering is canonical: score DESC, then bodyId ASC (deterministic, no seed)", () => {
    const organization = orgOf(
      [
        body("body-r", { roleId: "coordinator" }),
        body("body-b", { tools: [{ toolId: "t-1" }] }),
        body("body-a", { tools: [{ toolId: "t-1" }] }),
        body("body-z", { tools: [{ toolId: "t-1" }, { toolId: "t-2" }] }),
      ],
      [
        { edgeId: "e-r-b", from: "body-r", to: "body-b" },
        { edgeId: "e-r-a", from: "body-r", to: "body-a" },
        { edgeId: "e-r-z", from: "body-r", to: "body-z" },
      ],
    );
    const result = run(organization, request("body-r", { preferred: { tools: ["t-1", "t-2"] } }));
    // body-z: fit 1, path 0.5 ⇒ (1 + 0.25)/1.5 — strictly best.
    // body-a and body-b are identical ⇒ equal scores ⇒ bodyId order.
    // body-r (the requester): fit 0, 0-hop path ⇒ (0 + 0.5)/1.5 — last.
    expect(result.ranked.map((candidate) => candidate.bodyId)).toEqual(["body-z", "body-a", "body-b", "body-r"]);
    expect(result.ranked[1].score).toBe(result.ranked[2].score);
  });

  it("custom weights change the ranking (documented injectable seam)", () => {
    const organization = orgOf(
      [
        body("body-r", { roleId: "coordinator" }),
        body("body-a", { tools: [{ toolId: "t-1" }] }),
        body("body-b", { tools: [{ toolId: "t-1" }, { toolId: "t-2" }] }),
      ],
      [
        { edgeId: "e-r-a", from: "body-r", to: "body-a" },
        { edgeId: "e-r-b", from: "body-r", to: "body-b" },
      ],
    );
    const fitHeavy = run(
      organization,
      request("body-r", { preferred: { tools: ["t-1", "t-2"] } }),
      { weights: { capabilityFit: 10 } },
    );
    expect(fitHeavy.ranked[0].bodyId).toBe("body-b");

    const pathHeavy = run(
      organization,
      request("body-r", { preferred: { tools: ["t-1", "t-2"] } }),
      { weights: { capabilityFit: 0.1, path: 10 } },
    );
    // body-r itself: fit 0 but the 0-hop path dominates ⇒ best.
    expect(pathHeavy.ranked[0].bodyId).toBe("body-r");
    expect(DEFAULT_SEARCH_WEIGHTS.capabilityFit).toBe(1);
  });

  it("search requires NO model assignments (it executes nothing)", () => {
    // orgOf deliberately builds modelAssignments: [] — the W2-008
    // runtime rejects that for EXECUTION; search must accept it.
    const organization = orgOf(
      [body("body-r", { roleId: "coordinator", tools: [{ toolId: "t-1" }] }), body("body-s", { tools: [{ toolId: "t-1" }] })],
      [{ edgeId: "e-r-s", from: "body-r", to: "body-s" }],
    );
    expect(organization.modelAssignments).toEqual([]);
    const result = run(organization, request("body-r", { required: { tools: ["t-1"] } }));
    expect(result.ranked).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// BASELINE COMPARISON LAW (lock #15) — the mandatory benchmark
// ---------------------------------------------------------------------------

describe("W2-009 search: single-agent baseline comparison (lock #15)", () => {
  it("the baseline row is ALWAYS present, with derivation and honest delta fields", () => {
    const organization = orgOf(
      [
        body("body-r", { roleId: "coordinator" }),
        body("body-s", { tools: [{ toolId: "t-1" }] }),
      ],
      [{ edgeId: "e-r-s", from: "body-r", to: "body-s" }],
    );
    const result = runBaseline(organization, request("body-r", { preferred: { tools: ["t-1"] } }));
    expect(result.baseline.organizationId).toBe("baseline-single-agent");
    expect(result.baseline.derivation).toBe("derived-union");
    expect(["org-only-path", "baseline-only-path", "both", "neither"]).toContain(result.delta.comparison);
    expect(result.delta.orgEligibleCount).toBe(result.search.ranked.length);
    // The baseline is the capability UNION: it holds t-1 even though
    // the requester does not, and never delegates (0-hop path).
    expect(result.baseline.status).toBe("eligible");
    if (result.baseline.status === "eligible") {
      expect(result.baseline.path).toEqual({ value: 1, hops: 0, cost: 0, edges: [] });
      expect(result.baseline.capabilityFit.value).toBe(1);
    }
  });

  it("HONEST DIRECTION — no decomposition benefit: the single-agent baseline outranks the org path", () => {
    // The org's specialist (body-s) fully covers the preferred tools but
    // sits one delegation hop away; the derived generalist holds the same
    // capabilities with NO delegation. The honest answer: the single
    // agent is better for this request — asserted, not assumed.
    const organization = orgOf(
      [
        body("body-r", { roleId: "coordinator", tools: [{ toolId: "t-a" }] }),
        body("body-s", { tools: [{ toolId: "t-a" }, { toolId: "t-b" }] }),
      ],
      [{ edgeId: "e-r-s", from: "body-r", to: "body-s" }],
    );
    const result = runBaseline(organization, request("body-r", { preferred: { tools: ["t-a", "t-b"] } }));

    expect(result.delta.comparison).toBe("both");
    const best = result.search.ranked[0];
    expect(best.bodyId).toBe("body-s");
    expect(best.score).toBeCloseTo(1.25 / 1.5, 12);
    expect(result.baseline.status).toBe("eligible");
    if (result.baseline.status !== "eligible") throw new Error("unreachable");
    expect(result.baseline.score).toBeCloseTo(1.5 / 1.5, 12);
    // The delta honestly records the org BELOW the single-agent baseline.
    expect(result.delta.bestOrgScore).toBeCloseTo(1.25 / 1.5, 12);
    expect(result.delta.baselineScore).toBe(1);
    expect(result.delta.scoreDelta ?? 0).toBeLessThan(0);
    expect(result.delta.scoreDelta).toBeCloseTo(1.25 / 1.5 - 1, 12);
    expect(result.delta.pathCostDelta).toBe(1);
    expect(result.delta.bestOrgHops).toBe(1);
  });

  it("HONEST DIRECTION — required specialized role: the org is the only serviceable path", () => {
    // The derived generalist cannot carry a specialized role contract
    // (a body has exactly one role), so the single-agent fallback is
    // excluded while the org's analyst is eligible.
    const organization = orgOf(
      [
        body("body-r", { roleId: "coordinator" }),
        body("body-x", { roleId: "analyst", tools: [{ toolId: "t-a" }] }),
      ],
      [{ edgeId: "e-r-x", from: "body-r", to: "body-x" }],
    );
    const result = runBaseline(organization, request("body-r", { required: { roles: ["analyst"] } }));

    expect(result.search.ranked.map((candidate) => candidate.bodyId)).toEqual(["body-x"]);
    expect(result.baseline.status).toBe("excluded");
    if (result.baseline.status === "eligible") throw new Error("unreachable");
    expect(reasonCodesOf(result.baseline)).toContain("ROLE_NOT_MATCHED");
    expect(result.delta.comparison).toBe("org-only-path");
    expect(result.delta.bestOrgScore).not.toBeUndefined();
    expect(result.delta.baselineScore).toBeUndefined();
    expect(result.delta.scoreDelta).toBeUndefined();
  });

  it("HONEST DIRECTION — preferred role specialization puts the org ahead on score", () => {
    // Soft (preferred) roles: the analyst body matches the preferred
    // role; the derived generalist does not — the org wins the score
    // honestly, with the delta recording the direction.
    const organization = orgOf(
      [
        body("body-r", { roleId: "coordinator", tools: [{ toolId: "t-a" }] }),
        body("body-x", { roleId: "analyst", tools: [{ toolId: "t-a" }] }),
      ],
      [{ edgeId: "e-r-x", from: "body-r", to: "body-x" }],
    );
    const result = runBaseline(organization, request("body-r", { preferred: { roles: ["analyst"] } }));

    expect(result.delta.comparison).toBe("both");
    const best = result.search.ranked[0];
    expect(best.bodyId).toBe("body-x");
    expect(best.capabilityFit.value).toBe(1);
    expect(best.score).toBeCloseTo(1.25 / 1.5, 12);
    expect(result.baseline.status).toBe("eligible");
    if (result.baseline.status !== "eligible") throw new Error("unreachable");
    expect(result.baseline.capabilityFit.value).toBe(0);
    expect(result.baseline.score).toBeCloseTo(0.5 / 1.5, 12);
    expect(result.delta.scoreDelta ?? 0).toBeGreaterThan(0);
    expect(result.delta.capabilityFitDelta).toBe(1);
  });

  it("an EXPLICIT host-supplied baseline is honored and participates in every channel", () => {
    const organization = orgOf(
      [
        body("body-r", { roleId: "coordinator", tools: [{ toolId: "t-a" }], latencyLimits: { hardMs: 60 } }),
        body("body-s", { tools: [{ toolId: "t-a" }, { toolId: "t-b" }], latencyLimits: { hardMs: 80 } }),
      ],
      [{ edgeId: "e-r-s", from: "body-r", to: "body-s" }],
    );
    const generalist = body("body-generalist", {
      roleId: "generalist",
      tools: [{ toolId: "t-a" }, { toolId: "t-b" }],
      budgets: [{ kind: "cost", limit: 20 }],
      latencyLimits: { hardMs: 50 },
      evaluator: { evaluatorId: "ev-good" },
    });
    const result = runBaseline(
      organization,
      request("body-r", {
        preferred: { tools: ["t-a", "t-b"] },
        constraints: { maxLatencyMs: 100, demandEstimates: { cost: 5 } },
        evaluatorHealth: { "ev-good": 0.9 },
      }),
      { baseline: { body: generalist } },
    );

    expect(result.baseline.derivation).toBe("explicit");
    expect(result.baseline.bodyId).toBe("body-generalist");
    expect(result.baseline.status).toBe("eligible");
    if (result.baseline.status !== "eligible") throw new Error("unreachable");
    expect(result.baseline.budgetHeadroom?.value).toBeCloseTo(0.8, 12);
    expect(result.baseline.latency?.value).toBeCloseTo(2 / 3, 12);
    expect(result.baseline.evaluatorHealth?.value).toBe(0.9);
    expect(result.baseline.confidence).toBe(1);
    expect(result.baseline.score).toBeCloseTo(
      (1 * 1 + 0.5 * 1 + 0.25 * 0.8 + 0.25 * (2 / 3) + 0.25 * 0.9) / 2.25,
      12,
    );
    expect(result.delta.comparison).toBe("both");
  });

  it("an explicit baseline missing a REQUIRED capability is excluded (org-only-path)", () => {
    const organization = orgOf(
      [
        body("body-r", { roleId: "coordinator" }),
        body("body-s", { tools: [{ toolId: "t-a" }] }),
      ],
      [{ edgeId: "e-r-s", from: "body-r", to: "body-s" }],
    );
    const weakGeneralist = body("body-weak", { roleId: "generalist" });
    const result = runBaseline(
      organization,
      request("body-r", { required: { tools: ["t-a"] } }),
      { baseline: { body: weakGeneralist } },
    );
    expect(result.baseline.status).toBe("excluded");
    if (result.baseline.status === "eligible") throw new Error("unreachable");
    expect(reasonCodesOf(result.baseline)).toContain("TOOL_NOT_DECLARED");
    expect(result.delta.comparison).toBe("org-only-path");
    expect(result.search.ranked.map((candidate) => candidate.bodyId)).toEqual(["body-s"]);
  });

  it("REGRESSION — a degenerate one-body, no-edge organization degrades cleanly to the single-agent path", () => {
    const solo = body("body-solo", { tools: [{ toolId: "t-a" }] });
    const organization = orgOf([solo], []);

    const eligible = runBaseline(organization, request("body-solo", { preferred: { tools: ["t-a"] } }));
    expect(eligible.search.ranked).toHaveLength(1);
    expect(eligible.search.ranked[0].bodyId).toBe("body-solo");
    expect(eligible.search.ranked[0].path).toEqual({ value: 1, hops: 0, cost: 0, edges: [] });
    // The derived union of ONE body is that body verbatim: the baseline
    // is the identical single-agent path — zero delta, no complexity.
    expect(eligible.baseline.bodyId).toBe("body-solo");
    expect(eligible.baseline.derivation).toBe("derived-union");
    expect(eligible.baseline.status).toBe("eligible");
    if (eligible.baseline.status !== "eligible") throw new Error("unreachable");
    expect(eligible.baseline.score).toBe(eligible.search.ranked[0].score);
    expect(eligible.delta.comparison).toBe("both");
    expect(eligible.delta.scoreDelta).toBe(0);
    expect(eligible.delta.capabilityFitDelta).toBe(0);
    expect(eligible.delta.pathCostDelta).toBe(0);
    expect(eligible.delta.bestOrgHops).toBe(0);

    // Degenerate and infeasible: still clean — no crash, typed exclusion.
    const infeasible = runBaseline(organization, request("body-solo", { required: { tools: ["t-z"] } }));
    expect(infeasible.search.ranked).toHaveLength(0);
    expect(infeasible.baseline.status).toBe("excluded");
    expect(infeasible.delta.comparison).toBe("neither");
    expect(infeasible.delta.scoreDelta).toBeUndefined();
  });

  it("the objective is provenance only — it never changes matching or ranking", () => {
    const organization = orgOf(
      [
        body("body-r", { roleId: "coordinator" }),
        body("body-s", { tools: [{ toolId: "t-1" }] }),
      ],
      [{ edgeId: "e-r-s", from: "body-r", to: "body-s" }],
    );
    const without = run(organization, request("body-r", { preferred: { tools: ["t-1"] } }));
    const withObjective = run(
      organization,
      request("body-r", {
        preferred: { tools: ["t-1"] },
        objective: { objectiveId: "obj-1", version: "1", kind: "discover", params: {} },
      }),
    );
    expect(contentDigest(withObjective)).toBe(contentDigest(without));
  });

  it("searchWithBaseline is deterministic across repeated invocation", () => {
    const organization = orgOf(
      [
        body("body-r", { roleId: "coordinator" }),
        body("body-a", { tools: [{ toolId: "t-1" }], budgets: [{ kind: "cost", limit: 10 }] }),
        body("body-b", { roleId: "analyst", tools: [{ toolId: "t-1" }], latencyLimits: { hardMs: 40 } }),
      ],
      [
        { edgeId: "e-r-a", from: "body-r", to: "body-a" },
        { edgeId: "e-r-b", from: "body-r", to: "body-b" },
      ],
    );
    const req = request("body-r", {
      preferred: { tools: ["t-1"], roles: ["analyst"] },
      constraints: { maxLatencyMs: 100, demandEstimates: { cost: 5 }, maxHops: 2 },
      evaluatorHealth: { "ev-1": 0.7 },
    });
    const once = runBaseline(organization, req);
    const twice = runBaseline(organization, req);
    expect(contentDigest(twice)).toBe(contentDigest(once));
  });
});

// ---------------------------------------------------------------------------
// Determinism (property-style)
// ---------------------------------------------------------------------------

/** Deterministic PRNG (mulberry32) — seeded randomness for the property test. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("W2-009 search: determinism (property-style)", () => {
  it("repeated invocation with the same engine AND fresh engines ⇒ digest-identical results", () => {
    const organization = orgOf(
      [
        body("body-r", { roleId: "coordinator" }),
        body("body-a", { tools: [{ toolId: "t-1" }], budgets: [{ kind: "cost", limit: 10 }] }),
        body("body-b", { roleId: "analyst", tools: [{ toolId: "t-1" }] }),
      ],
      [
        { edgeId: "e-r-a", from: "body-r", to: "body-a" },
        { edgeId: "e-a-b", from: "body-a", to: "body-b" },
      ],
    );
    const req = request("body-r", { preferred: { tools: ["t-1"] }, constraints: { demandEstimates: { cost: 5 } } });
    const searcher = engine();
    const first = searcher.search(organization, req);
    if (!first.ok) throw new Error(first.error.message);
    const second = searcher.search(organization, req);
    if (!second.ok) throw new Error(second.error.message);
    const third = engine().search(organization, req);
    if (!third.ok) throw new Error(third.error.message);
    expect(contentDigest(second.value)).toBe(contentDigest(first.value));
    expect(contentDigest(third.value)).toBe(contentDigest(first.value));
  });

  it("property: seeded random orgs + requests — same inputs ⇒ same result, with canonical invariants", () => {
    const rng = mulberry32(0x57329);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;
    const maybe = (probability: number): boolean => rng() < probability;
    const intBetween = (lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));
    const subset = <T>(items: readonly T[]): T[] => items.filter(() => maybe(0.4));

    const ROLES = ["coordinator", "worker", "analyst", "generalist"] as const;
    const TOOLS = ["t-a", "t-b", "t-c"] as const;
    const CAPS = ["tool", "observe", "model-inference", "memory"] as const;
    const MEM_KINDS = ["private", "shared", "persistent"] as const;
    const EDGE_KINDS = ["communicate", "delegate", "report", "escalate", "custom"] as const;
    const EVALUATORS = ["ev-1", "ev-2", "ev-3"] as const;
    const KNOWN_REASON_CODES = new Set([
      "ROLE_NOT_MATCHED",
      "TOOL_NOT_DECLARED",
      "OBSERVATION_NOT_DECLARED",
      "ACTION_NOT_DECLARED",
      "MEMORY_KIND_NOT_DECLARED",
      "CAPABILITY_NOT_GRANTED",
      "EVALUATOR_REQUIRED",
      "UNREACHABLE",
      "MAX_HOPS_EXCEEDED",
      "LATENCY_UNDECLARED",
      "LATENCY_INFEASIBLE",
      "BUDGET_INFEASIBLE",
    ]);

    for (let iteration = 0; iteration < 25; iteration += 1) {
      const bodyCount = intBetween(2, 6);
      const bodies: AgentBody[] = [];
      for (let i = 0; i < bodyCount; i += 1) {
        bodies.push(
          body(`body-${i}`, {
            roleId: pick(ROLES),
            tools: subset(TOOLS).map((toolId) => ({ toolId })),
            permissions: subset(CAPS).map((capability, index) => ({ permissionId: `p-${i}-${index}`, capability })),
            memoryInterfaces: subset(MEM_KINDS).map((kind, index) => ({ memoryId: `mem-${i}-${index}`, kind })),
            ...(maybe(0.5) ? { budgets: [{ kind: "cost", limit: intBetween(1, 20) }] } : {}),
            ...(maybe(0.5) ? { latencyLimits: { hardMs: intBetween(10, 200) } } : {}),
            ...(maybe(0.4) ? { evaluator: { evaluatorId: pick(EVALUATORS) } } : {}),
          }),
        );
      }
      const edgeCount = intBetween(0, bodyCount * 2);
      const edges: EdgeSpec[] = [];
      for (let i = 0; i < edgeCount; i += 1) {
        edges.push({
          edgeId: `e-${i}`,
          from: `body-${intBetween(0, bodyCount - 1)}`,
          to: `body-${intBetween(0, bodyCount - 1)}`,
          kind: pick(EDGE_KINDS),
        });
      }
      const organization = orgOf(bodies, edges, `org-prop-${iteration}`);

      const req = request("body-0", {
        ...(maybe(0.5) ? { required: { tools: subset(TOOLS), roles: subset(ROLES) } } : {}),
        ...(maybe(0.7) ? { preferred: { tools: subset(TOOLS), capabilities: subset(CAPS) } } : {}),
        constraints: {
          ...(maybe(0.4) ? { maxHops: intBetween(1, 4) } : {}),
          ...(maybe(0.3) ? { requiresEvaluator: true } : {}),
          ...(maybe(0.4) ? { maxLatencyMs: intBetween(50, 300) } : {}),
          ...(maybe(0.4) ? { demandEstimates: { cost: intBetween(0, 25) } } : {}),
        },
        evaluatorHealth: Object.fromEntries(subset(EVALUATORS).map((evaluatorId) => [evaluatorId, rng()])),
      });

      // Same graph + same request ⇒ same result — across deep-cloned
      // inputs and fresh engines (input mutation immunity included).
      const first = engine().search(JSON.parse(JSON.stringify(organization)) as AgentOrganization, req);
      const second = engine().search(JSON.parse(JSON.stringify(organization)) as AgentOrganization, req);
      if (!first.ok) throw new Error(first.error.message);
      if (!second.ok) throw new Error(second.error.message);
      expect(contentDigest(second.value)).toBe(contentDigest(first.value));

      const result = first.value;

      // Canonical invariants.
      expect(result.ranked.length + result.excluded.length).toBe(bodies.length);
      let previousScore = Number.POSITIVE_INFINITY;
      let previousBodyId = "";
      for (const candidate of result.ranked) {
        expect(candidate.score).toBeGreaterThanOrEqual(0);
        expect(candidate.score).toBeLessThanOrEqual(1);
        expect(Number.isFinite(candidate.path.cost)).toBe(true);
        expect(candidate.confidence).toBeGreaterThan(0);
        expect(candidate.confidence).toBeLessThanOrEqual(1);
        // Score non-increasing; equal scores ⇒ bodyId ascending.
        expect(candidate.score).toBeLessThanOrEqual(previousScore);
        if (candidate.score === previousScore) {
          expect(candidate.bodyId > previousBodyId).toBe(true);
        }
        previousScore = candidate.score;
        previousBodyId = candidate.bodyId;
      }
      for (const excludedCandidate of result.excluded) {
        expect(excludedCandidate.reasons.length).toBeGreaterThan(0);
        for (const reason of excludedCandidate.reasons) {
          expect(KNOWN_REASON_CODES.has(reason.code)).toBe(true);
        }
      }

      // The baseline comparison is deterministic too (every 5th case).
      if (iteration % 5 === 0) {
        const baselineFirst = engine().searchWithBaseline(organization, req);
        const baselineSecond = engine().searchWithBaseline(
          JSON.parse(JSON.stringify(organization)) as AgentOrganization,
          req,
        );
        if (!baselineFirst.ok) throw new Error(baselineFirst.error.message);
        if (!baselineSecond.ok) throw new Error(baselineSecond.error.message);
        expect(contentDigest(baselineSecond.value)).toBe(contentDigest(baselineFirst.value));
        // Lock #15: the baseline row is ALWAYS present.
        expect(baselineFirst.value.baseline.organizationId).toBe("baseline-single-agent");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Typed errors (validation)
// ---------------------------------------------------------------------------

describe("W2-009 search: typed errors", () => {
  const simpleOrg = orgOf(
    [body("body-r", { roleId: "coordinator", tools: [{ toolId: "t-1" }] })],
    [],
  );

  it("invalid organizations ⇒ typed INVALID_INPUT (schema issues, duplicate bodies, dangling edges)", () => {
    const searcher = engine();
    expect(searcher.search(null as never, request("body-r")).ok).toBe(false);
    expect(searcher.search({ organizationId: "x" } as never, request("body-r")).ok).toBe(false);

    const emptyBodies = searcher.search(
      { organizationId: "org-empty", bodies: [], edges: [], terminationRules: [{ kind: "task-complete" }] } as never,
      request("body-r"),
    );
    expect(emptyBodies.ok).toBe(false);

    const duplicate = searcher.search(
      orgOf([body("body-r"), body("body-r")]) as never,
      request("body-r"),
    );
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.error.message).toContain("duplicate body");

    const dangling = searcher.search(
      orgOf([body("body-r")], [{ edgeId: "e-1", from: "body-r", to: "ghost" }]) as never,
      request("body-r"),
    );
    expect(dangling.ok).toBe(false);
    if (!dangling.ok) expect(dangling.error.message).toContain("undeclared bodies");
  });

  it("an unknown requester body ⇒ typed error", () => {
    const searcher = engine();
    const result = searcher.search(simpleOrg, request("ghost"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("requester body ghost");

    const baselineResult = engine().searchWithBaseline(simpleOrg, request("ghost"));
    expect(baselineResult.ok).toBe(false);
  });

  it("invalid requests ⇒ typed errors with issue paths", () => {
    const searcher = engine();
    const cases: { request: unknown; pathIncludes: string }[] = [
      { request: { requesterBodyId: "body-r" }, pathIncludes: "requestId" },
      { request: { requestId: "r", requesterBodyId: "body-r", extra: 1 }, pathIncludes: "extra" },
      { request: { requestId: "r", requesterBodyId: "body-r", evaluatorHealth: { ev: -0.5 } }, pathIncludes: "evaluatorHealth" },
      {
        request: { requestId: "r", requesterBodyId: "body-r", constraints: { maxHops: 0 } },
        pathIncludes: "maxHops",
      },
      {
        request: { requestId: "r", requesterBodyId: "body-r", constraints: { demandEstimates: { cost: -1 } } },
        pathIncludes: "cost",
      },
      {
        request: { requestId: "r", requesterBodyId: "body-r", required: { memoryKinds: ["bogus"] } },
        pathIncludes: "memoryKinds",
      },
    ];
    for (const testCase of cases) {
      const result = searcher.search(simpleOrg, testCase.request as never);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_INPUT");
        expect(
          (result.error.issues ?? []).some((issue) => issue.path.includes(testCase.pathIncludes)),
        ).toBe(true);
      }
    }
    expect(searcher.search(simpleOrg, null as never).ok).toBe(false);
  });

  it("invalid engine deps ⇒ typed errors", () => {
    expect(createOrganizationSearch({ weights: { capabilityFit: -1 } }).ok).toBe(false);
    expect(createOrganizationSearch({ edgeCosts: { delegate: 0 } }).ok).toBe(false);
    expect(createOrganizationSearch({ maxHops: 1.5 } as never).ok).toBe(false);
    expect(createOrganizationSearch({ bogus: true } as never).ok).toBe(false);
    expect(createOrganizationSearch(null as never).ok).toBe(false);
    expect(createOrganizationSearch().ok).toBe(true);
  });

  it("invalid baseline options ⇒ typed errors", () => {
    const searcher = engine();
    const badBody = searcher.searchWithBaseline(simpleOrg, request("body-r"), {
      baseline: { body: { bodyId: "x" } as never },
    });
    expect(badBody.ok).toBe(false);

    const missingBody = searcher.searchWithBaseline(simpleOrg, request("body-r"), {
      baseline: {} as never,
    });
    expect(missingBody.ok).toBe(false);
  });
});
