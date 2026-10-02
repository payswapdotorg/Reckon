/**
 * UI-007 — agent view model: §12 field mapping + layered graph layout.
 * Laws under test: honest "not provided" for absent fields; Kahn-style
 * layering of the delegation DAG; cyclic graphs degrade without crashing.
 */
import { describe, expect, it } from "vitest";
import { AgentBodySchema, AgentOrganizationSchema } from "@reckon/contracts";
import { bodyFacts, modelAssignmentsByBody, orgGraph } from "../src/lib/agent-view.js";

function makeBody(overrides: Record<string, unknown> = {}) {
  return AgentBodySchema.parse({
    schema: "reckon.agent-body",
    schemaVersion: "0.1.0",
    bodyId: "body-1",
    version: "1",
    role: { roleId: "critic", description: "Reviews outputs." },
    observations: [],
    tools: [],
    permissions: [],
    memoryInterfaces: [],
    actions: [],
    budgets: [],
    ...overrides,
  });
}

function makeOrg(overrides: Record<string, unknown> = {}) {
  return AgentOrganizationSchema.parse({
    schema: "reckon.agent-organization",
    schemaVersion: "0.1.0",
    organizationId: "org-1",
    version: "1",
    bodies: [
      makeBody({ bodyId: "gen", role: { roleId: "generalist", description: "Root." } }),
      makeBody({ bodyId: "res", role: { roleId: "researcher", description: "Finds." } }),
      makeBody({ bodyId: "cri", role: { roleId: "critic", description: "Reviews." } }),
    ],
    edges: [
      { edgeId: "e1", fromBodyId: "gen", toBodyId: "res", kind: "delegate" },
      { edgeId: "e2", fromBodyId: "gen", toBodyId: "cri", kind: "communicate" },
      { edgeId: "e3", fromBodyId: "res", toBodyId: "cri", kind: "report" },
    ],
    memoryTopology: { sharedMemories: [], privateMemories: [] },
    modelAssignments: [
      { bodyId: "gen", modelAdapterId: "router-1", modelId: "m-base" },
      { bodyId: "res", modelAdapterId: "router-1", modelId: "m-research" },
    ],
    budgets: [],
    terminationRules: [{ kind: "task-complete" }],
    ...overrides,
  });
}

describe("bodyFacts — the §12 field list", () => {
  it("carries role/evaluator/latency honestly; absent fields state not-provided", () => {
    const facts = bodyFacts(makeBody());
    const byLabel = new Map(facts.map((f) => [f.label, f.value]));
    expect(byLabel.get("role")).toContain("critic — Reviews outputs.");
    expect(byLabel.get("evaluator")).toBe("not provided");
    expect(byLabel.get("latency limits")).toBe("not provided");
    expect(byLabel.get("tools")).toBe("none declared");
  });

  it("budgets + latency + evaluator render verbatim when declared", () => {
    const facts = bodyFacts(
      makeBody({
        budgets: [{ kind: "tokens", limit: 4000 }],
        latencyLimits: { softMs: 500, hardMs: 2000 },
        evaluator: { evaluatorId: "ev-1", version: "2" },
      }),
    );
    const byLabel = new Map(facts.map((f) => [f.label, f.value]));
    expect(byLabel.get("budget")).toContain("tokens 4000");
    expect(byLabel.get("latency limits")).toBe("soft 500ms · hard 2000ms");
    expect(byLabel.get("evaluator")).toBe("ev-1 v2");
  });
});

describe("orgGraph — layered delegation layout", () => {
  it("generalist column 0; descendants layer right of their predecessors", () => {
    const graph = orgGraph(makeOrg());
    const byId = new Map(graph.nodes.map((n) => [n.bodyId, n]));
    const col = (id: string) => byId.get(id)!.x;
    expect(col("gen")).toBeLessThan(col("res"));
    expect(col("gen")).toBeLessThan(col("cri"));
    expect(graph.edges.map((e) => e.kind)).toEqual(["delegate", "communicate", "report"]);
    expect(graph.nodes.map((n) => n.roleId)).toContain("generalist");
  });

  it("edges referencing unknown bodies are dropped, not crashed", () => {
    const org = makeOrg({
      edges: [{ edgeId: "e-ghost", fromBodyId: "ghost", toBodyId: "gen", kind: "delegate" }],
    });
    const graph = orgGraph(org);
    expect(graph.edges.map((e) => e.edgeId)).toEqual([]);
  });

  it("cyclic graphs degrade to an extra column instead of hanging", () => {
    const org = makeOrg({
      edges: [
        { edgeId: "e-a", fromBodyId: "res", toBodyId: "cri", kind: "delegate" },
        { edgeId: "e-b", fromBodyId: "cri", toBodyId: "res", kind: "delegate" },
      ],
    });
    const graph = orgGraph(org);
    expect(graph.nodes).toHaveLength(3);
  });
});

describe("modelAssignmentsByBody", () => {
  it("keys by bodyId; unassigned bodies absent", () => {
    const map = modelAssignmentsByBody(makeOrg());
    expect(map.get("gen")).toMatchObject({ modelId: "m-base", modelAdapterId: "router-1" });
    expect(map.has("cri")).toBe(false);
  });
});
