/**
 * W2-008 acceptance tests — the Agent Organization runtime.
 *
 * Proves: delegation lineage integrity (parent/root chains, every
 * record reachable from the root), message passing via the W2-007
 * envelope machinery (undeclared routes are typed failures, not
 * silent), the BASELINE COMPARISON LAW (the single-agent baseline row
 * is ALWAYS present in every compareTopologies result — lock #15),
 * determinism (identical runs ⇒ digest-identical results; seeded
 * tie-breaks are stable per seed and vary across seeds), failure
 * isolation (a dead/looping body is bounded by the step limit and does
 * NOT wedge the organization; deadline and budget bounds terminate the
 * run), and typed errors for invalid organizations.
 */
import { describe, expect, it } from "vitest";
import {
  AgentBodySchema,
  AgentOrganizationSchema,
  contentDigest,
  type AgentBody,
  type AgentOrganization,
  type ModelAssignment,
} from "@reckon/contracts";
import {
  createDeterministicTestExecutor,
  createStepClock,
  type BodyExecutor,
  type BodyOperation,
  type BodyRunState,
  type BodyStep,
  type TestScript,
} from "../../agents/src/index.js";
import {
  createOrganizationRuntime,
  metricsOf,
  type DelegationRecord,
  type OrganizationRuntime,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function body(bodyId: string, roleId = "worker", budgets: unknown[] = []): AgentBody {
  return AgentBodySchema.parse({
    bodyId,
    role: { roleId, description: `Body ${bodyId} (${roleId})` },
    tools: [{ toolId: `${bodyId}-tool`, name: "tool" }],
    observations: [{ observationId: `${bodyId}-obs`, kind: "context" }],
    memoryInterfaces: [{ memoryId: `${bodyId}-mem`, kind: "private", access: "read" }],
    actions: [{ actionId: `${bodyId}-act`, kind: "select" }],
    permissions: [
      { permissionId: "p-tool", capability: "tool" },
      { permissionId: "p-observe", capability: "observe" },
      { permissionId: "p-memory", capability: "memory" },
      { permissionId: "p-write", capability: "write" },
      { permissionId: "p-inference", capability: "model-inference" },
    ],
    budgets,
  });
}

function assignment(bodyId: string): ModelAssignment {
  return { bodyId, modelAdapterId: "adapter-neutral", modelId: `model-${bodyId}`, version: "1" };
}

function org(
  overrides: {
    organizationId?: string;
    bodies?: AgentBody[];
    edges?: { edgeId: string; from: string; to: string; kind?: "communicate" | "delegate" | "report" | "escalate" | "custom" }[];
    terminationRules?: unknown[];
    budgets?: unknown[];
  } = {},
): AgentOrganization {
  const bodies = overrides.bodies ?? [body("body-a", "coordinator"), body("body-b", "worker"), body("body-c", "worker")];
  return AgentOrganizationSchema.parse({
    organizationId: overrides.organizationId ?? "org-1",
    version: "1",
    bodies,
    edges:
      overrides.edges?.map((e) => ({
        edgeId: e.edgeId,
        fromBodyId: e.from,
        toBodyId: e.to,
        ...(e.kind !== undefined ? { kind: e.kind } : {}),
      })) ??
      [
        { edgeId: "e-a-b", fromBodyId: "body-a", toBodyId: "body-b", kind: "delegate" },
        { edgeId: "e-a-c", fromBodyId: "body-a", toBodyId: "body-c", kind: "delegate" },
      ],
    modelAssignments: bodies.map((b) => assignment(b.bodyId)),
    terminationRules: overrides.terminationRules ?? [{ kind: "task-complete" }],
    ...(overrides.budgets !== undefined ? { budgets: overrides.budgets } : {}),
  });
}

/** A bodyId-dispatching executor (test infrastructure). */
function dispatchingExecutor(scripts: Record<string, TestScript>): BodyExecutor {
  const perBody = new Map<string, BodyExecutor>();
  for (const [bodyId, script] of Object.entries(scripts)) {
    perBody.set(bodyId, createDeterministicTestExecutor(script));
  }
  return {
    executorId: "org-test-executor",
    step(state: BodyRunState): BodyStep {
      const executor = perBody.get(state.model.bodyId);
      if (executor === undefined) return { kind: "done", output: null };
      return executor.step(state);
    },
  };
}

function operation(bodyId: string): BodyOperation {
  return { kind: "tool", targetId: `${bodyId}-tool`, usage: { tokens: 5, cost: 0.01 } };
}

function makeRuntime(executor: BodyExecutor, clock?: { now(): number }, limits?: { maxStepsPerBody?: number; maxDepth?: number }): OrganizationRuntime {
  const runtime = createOrganizationRuntime({
    executor,
    clock: clock ?? createStepClock(0, 1),
    ...(limits !== undefined ? { limits } : {}),
  });
  if (!runtime.ok) throw new Error(runtime.error.message);
  return runtime.value;
}

// ---------------------------------------------------------------------------
// Lineage integrity + message passing
// ---------------------------------------------------------------------------

describe("W2-008 organization: delegation lineage integrity", () => {
  it("root → delegate → delegate chains link parentRecordId/rootRecordId (every record reaches the root)", () => {
    // body-a delegates to body-b; body-b delegates back to body-a
    // (report edge); depth-bounded chain.
    const organization = org({
      bodies: [body("body-a", "coordinator"), body("body-b", "worker")],
      edges: [
        { edgeId: "e-a-b", from: "body-a", to: "body-b", kind: "delegate" },
        { edgeId: "e-b-a", from: "body-b", to: "body-a", kind: "report" },
      ],
    });
    const scripts: Record<string, TestScript> = {
      "body-a": {
        operations: [],
        output: { delegate: [{ toBodyId: "body-b", kind: "delegate", payload: { q: 1 } }] },
      },
      "body-b": {
        operations: [],
        output: { delegate: [{ toBodyId: "body-a", kind: "report", payload: { a: 2 } }] },
      },
    };
    const runtime = makeRuntime(dispatchingExecutor(scripts));
    const result = runtime.runOrganization(organization, { taskId: "task-1", input: { ask: "summarize" } });
    if (!result.ok) throw new Error(result.error.message);
    const records = result.value.records;

    // body-a delegates to b; b reports to a; a delegates again... the
    // depth bound (default 8) eventually stops the ping-pong.
    expect(records.length).toBeGreaterThan(3);
    const root = records.find((r) => r.kind === "root");
    if (!root) throw new Error("root record missing");
    expect(root.parentRecordId).toBeNull();
    expect(root.toBodyId).toBe("body-a");

    // Every record's parent exists and the chain reaches the root.
    const byId = new Map(records.map((r) => [r.recordId, r]));
    for (const record of records) {
      expect(record.rootRecordId).toBe(root.recordId);
      if (record.parentRecordId === null) {
        expect(record.recordId).toBe(root.recordId);
      } else {
        expect(byId.has(record.parentRecordId)).toBe(true);
        // walk to the root
        let cursor: DelegationRecord | undefined = record;
        let steps = 0;
        while (cursor && cursor.parentRecordId !== null && steps < 100) {
          cursor = byId.get(cursor.parentRecordId);
          steps += 1;
        }
        expect(cursor?.recordId).toBe(root.recordId);
      }
    }
    // Depth increments along the chain.
    const child = records.find((r) => r.fromBodyId === "body-a" && r.toBodyId === "body-b");
    if (!child) throw new Error("delegation record missing");
    expect(child.depth).toBe(1);
    expect(child.parentRecordId).toBe(root.recordId);
    expect(child.edgeId).toBe("e-a-b");
    // Message payloads flow through the body task input (envelope machinery).
    expect(child.status).toBe("completed");
  });

  it("a directive without a declared edge is a typed failure record (no silent routing)", () => {
    const organization = org({
      bodies: [body("body-a", "coordinator"), body("body-b", "worker")],
      edges: [], // no edges at all
    });
    const scripts: Record<string, TestScript> = {
      "body-a": {
        operations: [],
        output: { delegate: [{ toBodyId: "body-b", kind: "delegate" }] },
      },
      "body-b": { operations: [], output: "b" },
    };
    const runtime = makeRuntime(dispatchingExecutor(scripts));
    const result = runtime.runOrganization(organization, { taskId: "task-2" });
    if (!result.ok) throw new Error(result.error.message);
    const failed = result.value.records.find((r) => r.status === "edge-not-declared");
    if (!failed) throw new Error("expected an edge-not-declared record");
    expect(failed.error?.code).toBe("EDGE_NOT_DECLARED");
    // Failure isolation: the org completed despite the failed routing.
    expect(result.value.status).toBe("completed");
    expect(result.value.termination).toBe("task-complete");
  });

  it("directives naming unknown bodies / roles and malformed entries are typed failures", () => {
    const organization = org();
    const scripts: Record<string, TestScript> = {
      "body-a": {
        operations: [],
        output: {
          delegate: [
            { toBodyId: "ghost", kind: "delegate" }, // unknown body
            { toRoleId: "no-such-role", kind: "delegate" }, // unknown role
            { kind: "delegate" }, // neither target
            { toBodyId: "body-b", toRoleId: "worker", kind: "delegate" }, // both targets
            "not-an-object", // malformed entry
          ],
        },
      },
      "body-b": { operations: [], output: "b" },
      "body-c": { operations: [], output: "c" },
    };
    const runtime = makeRuntime(dispatchingExecutor(scripts));
    const result = runtime.runOrganization(organization, { taskId: "task-3" });
    if (!result.ok) throw new Error(result.error.message);
    const statuses = result.value.records.map((r) => r.status);
    expect(statuses).toContain("unknown-target-body");
    expect(statuses).toContain("unknown-target-role");
    expect(result.value.records.filter((r) => r.status === "malformed-directive").length).toBe(3);
    expect(result.value.status).toBe("completed");
  });

  it("role-targeted delegation picks an eligible body via the SEEDED tie-break (stable per seed)", () => {
    const organization = org(); // body-b and body-c share role "worker", both reachable by delegate edges
    const scripts: Record<string, TestScript> = {
      "body-a": {
        operations: [],
        output: { delegate: [{ toRoleId: "worker", kind: "delegate" }] },
      },
      "body-b": { operations: [], output: "b" },
      "body-c": { operations: [], output: "c" },
    };
    const runtime = makeRuntime(dispatchingExecutor(scripts));

    const withSeed = (seed: string) => {
      const result = runtime.runOrganization(organization, { taskId: "task-4" }, { seed });
      if (!result.ok) throw new Error(result.error.message);
      const child = result.value.records.find((r) => r.fromBodyId === "body-a" && r.status === "completed");
      if (!child) throw new Error("no delegation record");
      return child.toBodyId;
    };

    // Stable per seed.
    expect(withSeed("seed-1")).toBe(withSeed("seed-1"));
    expect(withSeed("seed-1")).toBe(withSeed("seed-1"));
    // Across different seeds the pick may vary — at least two distinct
    // picks must appear over a handful of seeds (seeded tie-breaks are
    // real, not a constant order).
    const picks = new Set(["seed-1", "seed-2", "seed-3", "seed-4", "seed-5"].map(withSeed));
    expect(picks.size).toBeGreaterThanOrEqual(2);
  });

  it("the root output surfaces the directive result / leaf output of the entry body", () => {
    const scripts: Record<string, TestScript> = {
      "body-a": {
        operations: [],
        output: { result: { answer: 42 }, delegate: [{ toBodyId: "body-b", kind: "delegate" }] },
      },
      "body-b": { operations: [], output: "b-done" },
      "body-c": { operations: [], output: "c-done" },
    };
    const runtime = makeRuntime(dispatchingExecutor(scripts));
    const result = runtime.runOrganization(org(), { taskId: "task-5" });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.output).toEqual({ answer: 42 });
  });

  it("bodies run through the W2-007 envelope: usage accumulates from run results", () => {
    const scripts: Record<string, TestScript> = {
      "body-a": {
        operations: [operation("body-a"), operation("body-a")],
        output: { delegate: [{ toBodyId: "body-b", kind: "delegate" }] },
      },
      "body-b": { operations: [operation("body-b")], output: "b-done" },
      "body-c": { operations: [], output: "c-done" },
    };
    const runtime = makeRuntime(dispatchingExecutor(scripts));
    const result = runtime.runOrganization(org(), { taskId: "task-6" });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.messagesProcessed).toBe(2);
    expect(result.value.usage.calls).toBe(3); // 2 ops on a + 1 op on b
    expect(result.value.usage.tokens).toBe(15);
    expect(result.value.usage.cost).toBeCloseTo(0.03, 12);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("W2-008 organization: determinism", () => {
  it("same org + task + fresh identical clocks + same seed ⇒ digest-identical runs", () => {
    const scripts: Record<string, TestScript> = {
      "body-a": {
        operations: [operation("body-a")],
        output: { delegate: [{ toRoleId: "worker", kind: "delegate" }] },
      },
      "body-b": { operations: [operation("body-b")], output: "b" },
      "body-c": { operations: [], output: "c" },
    };
    const organization = org();
    const run = () => {
      const runtime = makeRuntime(dispatchingExecutor(scripts), createStepClock(0, 1));
      const result = runtime.runOrganization(organization, { taskId: "task-det", input: { x: 1 } }, { seed: "s" });
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    };
    expect(contentDigest(run())).toBe(contentDigest(run()));
  });

  it("the clock is REQUIRED (no system clock — typed error when missing)", () => {
    const runtime = createOrganizationRuntime({
      executor: dispatchingExecutor({}),
      clock: undefined as never,
    });
    expect(runtime.ok).toBe(false);
    if (!runtime.ok) {
      expect(runtime.error.code).toBe("INVALID_INPUT");
      expect(runtime.error.message).toContain("clock");
    }
  });
});

// ---------------------------------------------------------------------------
// Failure isolation (bounded timeouts)
// ---------------------------------------------------------------------------

describe("W2-008 organization: failure isolation", () => {
  it("a dead (never-finishing) body is bounded by the step limit and does NOT wedge the organization", () => {
    // body-b loops forever (never returns done); body-c is healthy.
    // The org-level maxStepsPerBody bound cuts body-b off.
    const deadLoop: TestScript = { operations: Array.from({ length: 50 }, () => operation("body-b")) };
    const scripts: Record<string, TestScript> = {
      "body-a": {
        operations: [],
        output: {
          delegate: [
            { toBodyId: "body-b", kind: "delegate" },
            { toBodyId: "body-c", kind: "delegate" },
          ],
        },
      },
      "body-b": deadLoop,
      "body-c": { operations: [operation("body-c")], output: "c-done" },
    };
    const runtime = makeRuntime(dispatchingExecutor(scripts), createStepClock(0, 1), {
      maxStepsPerBody: 10, // bounded timeout: body-b is cut off fast
    });
    const result = runtime.runOrganization(org(), { taskId: "task-dead" });
    if (!result.ok) throw new Error(result.error.message);

    const dead = result.value.records.find((r) => r.toBodyId === "body-b");
    if (!dead) throw new Error("dead body record missing");
    expect(dead.status).toBe("aborted");
    expect(dead.error?.code).toBe("STEP_LIMIT_EXCEEDED");

    const healthy = result.value.records.find((r) => r.toBodyId === "body-c");
    if (!healthy) throw new Error("healthy body record missing");
    expect(healthy.status).toBe("completed");

    // The organization completed despite the dead body.
    expect(result.value.status).toBe("completed");
    expect(result.value.termination).toBe("task-complete");
    expect(result.value.messagesProcessed).toBe(3); // root + b + c
  });

  it("a body blocked by the envelope (permission denied) is recorded and the org continues", () => {
    // body-c declares NO permissions: its tool operation is denied.
    const nakedBody = AgentBodySchema.parse({
      bodyId: "body-c",
      role: { roleId: "worker", description: "no permissions" },
      tools: [{ toolId: "body-c-tool", name: "tool" }],
      permissions: [],
    });
    const organization = org({
      bodies: [body("body-a", "coordinator"), body("body-b", "worker"), nakedBody],
    });
    const scripts: Record<string, TestScript> = {
      "body-a": {
        operations: [],
        output: {
          delegate: [
            { toBodyId: "body-b", kind: "delegate" },
            { toBodyId: "body-c", kind: "delegate" },
          ],
        },
      },
      "body-b": { operations: [], output: "b-done" },
      "body-c": { operations: [operation("body-c")], output: "never" },
    };
    const runtime = makeRuntime(dispatchingExecutor(scripts));
    const result = runtime.runOrganization(organization, { taskId: "task-blocked" });
    if (!result.ok) throw new Error(result.error.message);
    const blocked = result.value.records.find((r) => r.toBodyId === "body-c");
    if (!blocked) throw new Error("blocked record missing");
    expect(blocked.status).toBe("blocked");
    expect(result.value.status).toBe("completed");
  });

  it("the org deadline termination rule bounds the run (clock-based; remaining messages recorded)", () => {
    const scripts: Record<string, TestScript> = {
      "body-a": {
        operations: [operation("body-a"), operation("body-a"), operation("body-a"), operation("body-a")],
        output: { delegate: [{ toBodyId: "body-b", kind: "delegate" }] },
      },
      "body-b": { operations: [operation("body-b"), operation("body-b")], output: "b-done" },
      "body-c": { operations: [], output: "c-done" },
    };
    const organization = org({
      bodies: [body("body-a", "coordinator"), body("body-b", "worker"), body("body-c", "worker")],
      terminationRules: [{ kind: "deadline", deadlineMs: 10 }],
    });
    // step clock: 5ms per call — the root run alone consumes enough
    // clock calls to pass the deadline before the next dispatch.
    const runtime = makeRuntime(dispatchingExecutor(scripts), createStepClock(0, 5));
    const result = runtime.runOrganization(organization, { taskId: "task-deadline" });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.status).toBe("terminated-early");
    expect(result.value.termination).toBe("deadline");
    expect(result.value.records.some((r) => r.status === "deadline-exceeded")).toBe(true);
  });

  it("org budgets bound the run (accumulated usage across body runs)", () => {
    const scripts: Record<string, TestScript> = {
      "body-a": {
        operations: [operation("body-a")],
        output: { delegate: [{ toBodyId: "body-b", kind: "delegate" }, { toBodyId: "body-c", kind: "delegate" }] },
      },
      "body-b": { operations: [operation("body-b"), operation("body-b")], output: "b" },
      "body-c": { operations: [operation("body-c"), operation("body-c")], output: "c" },
    };
    const organization = org({
      bodies: [body("body-a", "coordinator"), body("body-b", "worker"), body("body-c", "worker")],
      terminationRules: [{ kind: "task-complete" }, { kind: "budget-exhausted", budgetId: "org-calls" }],
      budgets: [{ kind: "calls", limit: 2 }],
    });
    const runtime = makeRuntime(dispatchingExecutor(scripts), createStepClock(0, 1));
    const result = runtime.runOrganization(organization, { taskId: "task-budget" });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.status).toBe("terminated-early");
    expect(result.value.termination).toBe("budget-exhausted");
    expect(result.value.usage.calls).toBeLessThanOrEqual(3); // bounded
    expect(result.value.records.some((r) => r.status === "budget-exhausted")).toBe(true);
    // completed records still exist — the org did real work before stopping
    expect(result.value.records.some((r) => r.status === "completed")).toBe(true);
  });

  it("the max-depth rule records depth-exceeded delegations and completes", () => {
    // Ping-pong delegation with max-depth 1: only depth-1 delegations run.
    const organization = org({
      bodies: [body("body-a", "coordinator"), body("body-b", "worker")],
      edges: [
        { edgeId: "e-a-b", from: "body-a", to: "body-b", kind: "delegate" },
        { edgeId: "e-b-a", from: "body-b", to: "body-a", kind: "delegate" },
      ],
      terminationRules: [{ kind: "max-depth", maxDepth: 1 }],
    });
    const scripts: Record<string, TestScript> = {
      "body-a": { operations: [], output: { delegate: [{ toBodyId: "body-b", kind: "delegate" }] } },
      "body-b": { operations: [], output: { delegate: [{ toBodyId: "body-a", kind: "delegate" }] } },
    };
    const runtime = makeRuntime(dispatchingExecutor(scripts));
    const result = runtime.runOrganization(organization, { taskId: "task-depth" });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.records.some((r) => r.status === "depth-exceeded")).toBe(true);
    // The depth-exceeded record carries the ATTEMPTED depth (2);
    // every EXECUTED delegation stays within the bound.
    const executedDepths = result.value.records
      .filter((r) => r.status !== "depth-exceeded")
      .map((r) => r.depth);
    expect(Math.max(...executedDepths)).toBeLessThanOrEqual(1);
    expect(result.value.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// Typed errors (validation)
// ---------------------------------------------------------------------------

describe("W2-008 organization: typed errors", () => {
  it("invalid organization schema ⇒ typed INVALID_INPUT", () => {
    const runtime = makeRuntime(dispatchingExecutor({}));
    const result = runtime.runOrganization({ organizationId: "x" } as never, { taskId: "t" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });

  it("edges referencing undeclared bodies ⇒ typed error", () => {
    const organization = org({
      bodies: [body("body-a", "coordinator")],
      edges: [{ edgeId: "e-a-b", from: "body-a", to: "body-b", kind: "delegate" }],
    });
    const runtime = makeRuntime(dispatchingExecutor({}));
    const result = runtime.runOrganization(organization, { taskId: "t" });
    expect(result.ok).toBe(false);
  });

  it("bodies without model assignments ⇒ typed error (model assignment is data)", () => {
    const organization = AgentOrganizationSchema.parse({
      organizationId: "org-2",
      bodies: [body("body-a", "coordinator")],
      edges: [],
      modelAssignments: [],
      terminationRules: [{ kind: "task-complete" }],
    });
    const runtime = makeRuntime(dispatchingExecutor({}));
    const result = runtime.runOrganization(organization, { taskId: "t" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("model assignment");
  });

  it("invalid task / unknown entry body ⇒ typed errors", () => {
    const runtime = makeRuntime(dispatchingExecutor({}));
    expect(runtime.runOrganization(org(), null as never).ok).toBe(false);
    expect(runtime.runOrganization(org(), { taskId: "" }).ok).toBe(false);
    expect(runtime.runOrganization(org(), { taskId: "t" }, { entryBodyId: "ghost" }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BASELINE COMPARISON LAW (lock #15)
// ---------------------------------------------------------------------------

describe("W2-008 organization: baseline comparison law", () => {
  const scripts: Record<string, TestScript> = {
    "body-a": {
      operations: [operation("body-a")],
      output: { result: { answer: "a" }, delegate: [{ toBodyId: "body-b", kind: "delegate" }] },
    },
    "body-b": { operations: [operation("body-b")], output: "b" },
    "body-c": { operations: [], output: "c" },
    "body-generalist": { operations: [operation("body-generalist")], output: { result: { answer: "g" } } },
  };
  const executor = dispatchingExecutor(scripts);

  function twoTopologies(): AgentOrganization[] {
    const generalist = body("body-generalist", "generalist");
    return [
      org({
        organizationId: "org-pipeline",
        bodies: [body("body-a", "coordinator"), body("body-b", "worker")],
        edges: [{ edgeId: "e-a-b", from: "body-a", to: "body-b", kind: "delegate" }],
      }),
      org({
        organizationId: "org-redundant",
        bodies: [generalist, body("body-b", "worker"), body("body-c", "worker")],
        edges: [
          { edgeId: "e-g-b", from: "body-generalist", to: "body-b", kind: "delegate" },
          { edgeId: "e-g-c", from: "body-generalist", to: "body-c", kind: "delegate" },
        ],
      }),
    ];
  }

  it("compareTopologies ALWAYS returns the single-agent baseline row alongside the topology rows", () => {
    const runtime = makeRuntime(executor);
    const comparison = runtime.compareTopologies({ taskId: "task-cmp" }, twoTopologies());
    if (!comparison.ok) throw new Error(comparison.error.message);
    // BASELINE COMPARISON LAW: the baseline row is present.
    expect(comparison.value.baseline.organizationId).toBe("baseline-single-agent");
    expect(comparison.value.topologies.map((t) => t.organizationId)).toEqual([
      "org-pipeline",
      "org-redundant",
    ]);
    // The baseline really RAN the same task (it used a body + messages).
    expect(comparison.value.baseline.messages).toBe(1);
    expect(comparison.value.baseline.bodiesUsed).toBe(1);
    expect(comparison.value.baseline.delegations).toBe(0);
    // Topology rows carry their own metrics.
    expect(comparison.value.topologies[0].delegations).toBe(1);
    expect(comparison.value.topologies[0].messages).toBe(2);
  });

  it("an explicit generalist baseline body is used when provided", () => {
    const runtime = makeRuntime(executor);
    const generalist = body("body-generalist", "generalist");
    const comparison = runtime.compareTopologies(
      { taskId: "task-cmp2" },
      [org({ organizationId: "org-x", bodies: [body("body-a", "coordinator")], edges: [] })],
      { baseline: { body: generalist, assignment: assignment("body-generalist") } },
    );
    if (!comparison.ok) throw new Error(comparison.error.message);
    expect(comparison.value.baseline.messages).toBe(1);
    expect(comparison.value.baseline.outputDigest).toBe(contentDigest({ answer: "g" }));
  });

  it("empty topologies with an explicit baseline still yields the baseline row; without any baseline ⇒ typed error", () => {
    const runtime = makeRuntime(executor);
    const generalist = body("body-generalist", "generalist");
    const withBaseline = runtime.compareTopologies(
      { taskId: "task-cmp3" },
      [],
      { baseline: { body: generalist, assignment: assignment("body-generalist") } },
    );
    if (!withBaseline.ok) throw new Error(withBaseline.error.message);
    expect(withBaseline.value.topologies).toEqual([]);
    expect(withBaseline.value.baseline.organizationId).toBe("baseline-single-agent");

    const withoutBaseline = runtime.compareTopologies({ taskId: "task-cmp4" }, []);
    expect(withoutBaseline.ok).toBe(false);
    if (!withoutBaseline.ok) {
      expect(withoutBaseline.error.message).toContain("baseline");
    }
  });

  it("comparison metrics are deterministic (identical calls ⇒ digest-identical rows)", () => {
    const run = () => {
      const runtime = makeRuntime(executor);
      const comparison = runtime.compareTopologies({ taskId: "task-cmp-det" }, twoTopologies(), { seed: "s" });
      if (!comparison.ok) throw new Error(comparison.error.message);
      return comparison.value;
    };
    expect(contentDigest(run())).toBe(contentDigest(run()));
  });

  it("metricsOf summarizes a run (bodies/messages/delegations/failures)", () => {
    const runtime = makeRuntime(executor);
    const result = runtime.runOrganization(twoTopologies()[0], { taskId: "task-metrics" });
    if (!result.ok) throw new Error(result.error.message);
    const metrics = metricsOf(result.value);
    expect(metrics.organizationId).toBe("org-pipeline");
    expect(metrics.bodiesUsed).toBe(2);
    expect(metrics.messages).toBe(2);
    expect(metrics.delegations).toBe(1);
    expect(metrics.failedRecords).toBe(0);
    expect(metrics.termination).toBe("task-complete");
  });
});
