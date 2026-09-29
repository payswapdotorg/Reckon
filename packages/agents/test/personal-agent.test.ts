/**
 * W2-006 acceptance tests — the Personal Agent runtime.
 *
 * Proves: one logical agent managing N device bodies via the W2-007
 * body runtime; DEFAULT-DENY cross-device isolation (no implicit
 * sharing, even within one logical agent); grant-enabled sharing
 * (explicit pool scope, wildcard, capability flag); revocation stops
 * future use; ADR-003 consent surface (location/attention as permission
 * FLAGS only — raw values never cross); budget/latency enforcement
 * passthrough to bodies (identical to running the W2-007 handle
 * directly, digest-verified); deterministic behavior; typed errors.
 */
import { describe, expect, it } from "vitest";
import {
  AgentBodySchema,
  canonicalJson,
  contentDigest,
  ContextSnapshotSchema,
  PreferenceDeltaSchema,
  type AgentBody,
  type BudgetSpec,
  type ContextSnapshot,
  type ModelAssignment,
  type PreferenceDelta,
} from "@reckon/contracts";
import {
  createAgentBodyRuntime,
  createDeterministicTestExecutor,
  createInMemoryStateSync,
  createPersonalAgentRuntime,
  createStepClock,
  permittedSignalsFrom,
  type AgentBodyRuntime,
  type AgentInstanceHandle,
  type BodyExecutor,
  type BodyOperation,
  type BodyRunState,
  type BodyStep,
  type CrossDeviceLearningGrant,
  type TestScript,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AGENT = "agent-user-1";

function deviceBody(bodyId: string, overrides: { budgets?: BudgetSpec[]; latency?: { softMs?: number; hardMs: number } } = {}): AgentBody {
  return AgentBodySchema.parse({
    bodyId,
    role: { roleId: "device-body", description: `Device body ${bodyId}` },
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
    budgets: overrides.budgets ?? [],
    ...(overrides.latency !== undefined ? { latencyLimits: overrides.latency } : {}),
  });
}

function assignment(bodyId: string, modelId = "model-neutral-1"): ModelAssignment {
  return { bodyId, modelAdapterId: "adapter-neutral", modelId, version: "1" };
}

function delta(deltaId: string, dimension: string): PreferenceDelta {
  return PreferenceDeltaSchema.parse({
    deltaId,
    tenant: { tenantId: "t-1" },
    subject: { kind: "user", ref: "user-9" },
    dimension,
    op: "add",
    value: 0.3,
    model: { modelId: "pref-model-1", version: "1" },
    timestamp: 1_000,
  });
}

function grant(overrides: Partial<CrossDeviceLearningGrant> = {}): CrossDeviceLearningGrant {
  return {
    grantId: "grant-1",
    agentId: AGENT,
    capabilities: { derivedLearningDeltas: true },
    bodyScope: ["body-a", "body-b"],
    grantedAt: 2_000,
    ...overrides,
  };
}

/** A bodyId-dispatching executor (test infrastructure): each body gets
 *  its own deterministic script. */
function dispatchingExecutor(scripts: Record<string, TestScript>): BodyExecutor {
  const perBody = new Map<string, BodyExecutor>();
  for (const [bodyId, script] of Object.entries(scripts)) {
    perBody.set(bodyId, createDeterministicTestExecutor(script));
  }
  return {
    executorId: "dispatching-test-executor",
    step(state: BodyRunState): BodyStep {
      const executor = perBody.get(state.model.bodyId);
      if (executor === undefined) {
        return { kind: "done", output: null };
      }
      return executor.step(state);
    },
  };
}

function simpleOperation(bodyId: string): BodyOperation {
  return { kind: "tool", targetId: `${bodyId}-tool`, usage: { tokens: 10 } };
}

/** Build the standard two-body personal agent (shared executor seam,
 *  deterministic zero-step clock so run digests are comparable). */
function twoBodyAgent(
  scriptA: TestScript = { operations: [], output: "done-a" },
  scriptB: TestScript = { operations: [], output: "done-b" },
  bodyRuntime?: AgentBodyRuntime,
) {
  const runtime =
    bodyRuntime ??
    createAgentBodyRuntime({
      executor: dispatchingExecutor({ "body-a": scriptA, "body-b": scriptB }),
      clock: createStepClock(1_000, 0), // zero-step: elapsed is always 0 (deterministic)
    });
  const agent = createPersonalAgentRuntime(AGENT, { bodyRuntime: runtime });
  if (!agent.ok) throw new Error(agent.error.message);
  const a = agent.value.registerBody(deviceBody("body-a"), assignment("body-a"));
  const b = agent.value.registerBody(deviceBody("body-b"), assignment("body-b"));
  if (!a.ok || !b.ok) throw new Error("registration failed");
  return { agent: agent.value, handleA: a.value, handleB: b.value };
}

// ---------------------------------------------------------------------------
// Logical identity + registration
// ---------------------------------------------------------------------------

describe("W2-006 personal agent: one logical agent, N device bodies", () => {
  it("registers multiple device bodies under one logical identity via the W2-007 runtime", () => {
    const { agent } = twoBodyAgent();
    expect(agent.agentId).toBe(AGENT);
    expect(agent.bodyIds()).toEqual(["body-a", "body-b"]);
  });

  it("rejects duplicate body registration (typed error)", () => {
    const { agent } = twoBodyAgent();
    const result = agent.registerBody(deviceBody("body-a"), assignment("body-a"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });

  it("propagates W2-007 validation errors (invalid body / mismatched assignment)", () => {
    const runtime = createAgentBodyRuntime({ executor: dispatchingExecutor({}) });
    const agent = createPersonalAgentRuntime(AGENT, { bodyRuntime: runtime });
    if (!agent.ok) throw new Error(agent.error.message);
    const invalidBody = agent.value.registerBody({ nope: true } as never, assignment("body-x"));
    expect(invalidBody.ok).toBe(false);
    const mismatched = agent.value.registerBody(deviceBody("body-x"), assignment("body-y"));
    expect(mismatched.ok).toBe(false);
  });

  it("rejects an invalid agentId (typed error)", () => {
    const runtime = createAgentBodyRuntime({ executor: dispatchingExecutor({}) });
    const result = createPersonalAgentRuntime("", { bodyRuntime: runtime });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Budget / latency enforcement passthrough (W2-007 full force)
// ---------------------------------------------------------------------------

describe("W2-006 personal agent: budget/latency enforcement passthrough", () => {
  it("runs tasks on bodies and returns the W2-007 result verbatim (digest-identical to a direct handle run)", () => {
    const scriptA: TestScript = {
      operations: [simpleOperation("body-a"), simpleOperation("body-a")],
      output: "done-a",
    };
    const { agent, handleA } = twoBodyAgent(scriptA);
    const task = { taskId: "task-1", input: { question: "what next?" } };
    const viaAgent = agent.runOnBody("body-a", task);
    const direct = handleA.run(task);
    if (!viaAgent.ok || !direct.ok) throw new Error("expected ok");
    expect(contentDigest(viaAgent.value)).toBe(contentDigest(direct.value));
    expect(viaAgent.value.status).toBe("completed");
    expect(viaAgent.value.usage.calls).toBe(2);
  });

  it("budget enforcement applies through the personal agent (calls budget aborts mid-run)", () => {
    // body-a has a calls budget of 2 but its script declares 3 operations.
    const scriptA: TestScript = {
      operations: [
        simpleOperation("body-a"),
        simpleOperation("body-a"),
        simpleOperation("body-a"),
      ],
    };
    const runtime = createAgentBodyRuntime({ executor: dispatchingExecutor({ "body-a": scriptA }) });
    const agent = createPersonalAgentRuntime(AGENT, { bodyRuntime: runtime });
    if (!agent.ok) throw new Error(agent.error.message);
    const registered = agent.value.registerBody(
      deviceBody("body-a", { budgets: [{ kind: "calls", limit: 2 }] }),
      assignment("body-a"),
    );
    if (!registered.ok) throw new Error(registered.error.message);
    const result = agent.value.runOnBody("body-a", { taskId: "task-2" });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.status).toBe("aborted");
    if (result.value.status === "aborted" && result.value.error.code === "BUDGET_EXHAUSTED") {
      expect(result.value.error.budgetKind).toBe("calls");
      expect(result.value.error.limit).toBe(2);
    }
  });

  it("latency enforcement applies through the personal agent (hard deadline yields)", () => {
    const clock = createStepClock(0, 50); // 50ms per clock call
    const runtime = createAgentBodyRuntime({
      executor: dispatchingExecutor({
        "body-a": { operations: Array.from({ length: 20 }, () => simpleOperation("body-a")) },
      }),
      clock,
    });
    const agent = createPersonalAgentRuntime(AGENT, { bodyRuntime: runtime });
    if (!agent.ok) throw new Error(agent.error.message);
    const registered = agent.value.registerBody(
      deviceBody("body-a", { latency: { hardMs: 200 } }),
      assignment("body-a"),
    );
    if (!registered.ok) throw new Error(registered.error.message);
    const result = agent.value.runOnBody("body-a", { taskId: "task-3" });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.status).toBe("yielded");
    if (result.value.status === "yielded") {
      expect(result.value.error.code).toBe("DEADLINE_EXCEEDED");
    }
  });

  it("unknown bodyId ⇒ typed error", () => {
    const { agent } = twoBodyAgent();
    const result = agent.runOnBody("body-zzz", { taskId: "task-4" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });
});

// ---------------------------------------------------------------------------
// Default-deny cross-device isolation + grant-enabled sharing
// ---------------------------------------------------------------------------

describe("W2-006 personal agent: default-deny cross-device isolation", () => {
  it("a body NEVER sees another body's deltas without an explicit grant (no implicit sharing)", () => {
    const { agent } = twoBodyAgent();
    const recorded = agent.recordLearningDelta("body-a", delta("delta-1", "genre.fantasy"));
    if (!recorded.ok) throw new Error(recorded.error.message);

    const visibleToB = agent.visibleDeltas("body-b");
    if (!visibleToB.ok) throw new Error(visibleToB.error.message);
    expect(visibleToB.value).toHaveLength(0); // DEFAULT DENY

    const visibleToA = agent.visibleDeltas("body-a");
    if (!visibleToA.ok) throw new Error(visibleToA.error.message);
    expect(visibleToA.value.map((d) => d.delta.deltaId)).toEqual(["delta-1"]); // own local state

    expect(agent.crossDeviceSharingStatus("body-b")).toEqual({ sharing: false });
    expect(agent.crossDeviceSharingStatus("body-a")).toEqual({ sharing: false });
  });

  it("an explicit grant enables sharing within its body pool (symmetric)", () => {
    const { agent } = twoBodyAgent();
    agent.recordLearningDelta("body-a", delta("delta-1", "genre.fantasy"));
    agent.recordLearningDelta("body-b", delta("delta-2", "topic.history"));

    const added = agent.addGrant(grant());
    if (!added.ok) throw new Error(added.error.message);

    const visibleToB = agent.visibleDeltas("body-b");
    if (!visibleToB.ok) throw new Error(visibleToB.error.message);
    expect(visibleToB.value.map((d) => d.delta.deltaId)).toEqual(["delta-2", "delta-1"]);

    const visibleToA = agent.visibleDeltas("body-a");
    if (!visibleToA.ok) throw new Error(visibleToA.error.message);
    expect(visibleToA.value.map((d) => d.delta.deltaId)).toEqual(["delta-1", "delta-2"]);

    expect(agent.crossDeviceSharingStatus("body-b")).toEqual({ sharing: true, grantId: "grant-1" });
  });

  it("bodies OUTSIDE the grant pool stay isolated (pool scope)", () => {
    const runtime = createAgentBodyRuntime({
      executor: dispatchingExecutor({
        "body-a": { operations: [] },
        "body-b": { operations: [] },
        "body-c": { operations: [] },
      }),
      clock: createStepClock(1_000, 0),
    });
    const agent = createPersonalAgentRuntime(AGENT, { bodyRuntime: runtime });
    if (!agent.ok) throw new Error(agent.error.message);
    for (const id of ["body-a", "body-b", "body-c"]) {
      const registered = agent.value.registerBody(deviceBody(id), assignment(id));
      if (!registered.ok) throw new Error(registered.error.message);
    }
    agent.value.recordLearningDelta("body-a", delta("delta-1", "genre.fantasy"));
    // The pool covers only body-a and body-c.
    const added = agent.value.addGrant(grant({ bodyScope: ["body-a", "body-c"] }));
    if (!added.ok) throw new Error(added.error.message);

    const visibleToC = agent.value.visibleDeltas("body-c");
    if (!visibleToC.ok) throw new Error(visibleToC.error.message);
    expect(visibleToC.value.map((d) => d.delta.deltaId)).toEqual(["delta-1"]); // pool member sees the pool

    const visibleToB = agent.value.visibleDeltas("body-b");
    if (!visibleToB.ok) throw new Error(visibleToB.error.message);
    expect(visibleToB.value).toHaveLength(0); // outside the pool: isolated
  });

  it("a grant whose pool contains only the pulling body shares nothing (source must be in the pool)", () => {
    const { agent } = twoBodyAgent();
    agent.recordLearningDelta("body-a", delta("delta-1", "genre.fantasy"));
    const added = agent.addGrant(grant({ bodyScope: ["body-b"] }));
    if (!added.ok) throw new Error(added.error.message);
    const visibleToB = agent.visibleDeltas("body-b");
    if (!visibleToB.ok) throw new Error(visibleToB.error.message);
    expect(visibleToB.value).toHaveLength(0);
  });

  it('a "*" scope covers every body', () => {
    const { agent } = twoBodyAgent();
    agent.recordLearningDelta("body-a", delta("delta-1", "genre.fantasy"));
    const added = agent.addGrant(grant({ bodyScope: "*" }));
    if (!added.ok) throw new Error(added.error.message);
    const visibleToB = agent.visibleDeltas("body-b");
    if (!visibleToB.ok) throw new Error(visibleToB.error.message);
    expect(visibleToB.value.map((d) => d.delta.deltaId)).toEqual(["delta-1"]);
  });

  it("a grant without the derivedLearningDeltas capability does not authorize anything", () => {
    const { agent } = twoBodyAgent();
    agent.recordLearningDelta("body-a", delta("delta-1", "genre.fantasy"));
    const added = agent.addGrant(grant({ capabilities: { derivedLearningDeltas: false } }));
    if (!added.ok) throw new Error(added.error.message);
    const visibleToB = agent.visibleDeltas("body-b");
    if (!visibleToB.ok) throw new Error(visibleToB.error.message);
    expect(visibleToB.value).toHaveLength(0);
    expect(agent.crossDeviceSharingStatus("body-b").sharing).toBe(false);
  });

  it("revocation stops future use (ADR-003): the pool goes silent again", () => {
    const { agent } = twoBodyAgent();
    agent.recordLearningDelta("body-a", delta("delta-1", "genre.fantasy"));
    agent.addGrant(grant());
    const beforeRevoke = agent.visibleDeltas("body-b");
    if (!beforeRevoke.ok) throw new Error(beforeRevoke.error.message);
    expect(beforeRevoke.value).toHaveLength(1);

    const revoked = agent.revokeGrant("grant-1", 3_000);
    if (!revoked.ok) throw new Error(revoked.error.message);
    expect(revoked.value.revokedAt).toBe(3_000);

    const visibleToB = agent.visibleDeltas("body-b");
    if (!visibleToB.ok) throw new Error(visibleToB.error.message);
    expect(visibleToB.value).toHaveLength(0); // back to default deny
    expect(agent.crossDeviceSharingStatus("body-b").sharing).toBe(false);
  });

  it("revoking an unknown or already-revoked grant ⇒ typed errors", () => {
    const { agent } = twoBodyAgent();
    expect(agent.revokeGrant("nope", 1).ok).toBe(false);
    agent.addGrant(grant());
    expect(agent.revokeGrant("grant-1", 1).ok).toBe(true);
    expect(agent.revokeGrant("grant-1", 2).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Grant validation (explicit object, agent-scoped)
// ---------------------------------------------------------------------------

describe("W2-006 personal agent: grant validation", () => {
  it("a grant for a DIFFERENT agent is rejected (typed error)", () => {
    const { agent } = twoBodyAgent();
    const result = agent.addGrant(grant({ agentId: "agent-other" }));
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === "INVALID_INPUT") {
      expect(result.error.issues?.some((i) => i.path === "agentId")).toBe(true);
    }
  });

  it("duplicate grantIds are rejected", () => {
    const { agent } = twoBodyAgent();
    agent.addGrant(grant());
    const result = agent.addGrant(grant());
    expect(result.ok).toBe(false);
  });

  it("missing grantedAt / empty pool / malformed capabilities ⇒ typed errors", () => {
    const { agent } = twoBodyAgent();
    expect(agent.addGrant(grant({ grantedAt: undefined as never })).ok).toBe(false);
    expect(agent.addGrant(grant({ bodyScope: [] })).ok).toBe(false);
    expect(agent.addGrant(grant({ capabilities: {} as never })).ok).toBe(false);
    expect(agent.addGrant(grant({ grantId: "" })).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Derived-delta recording (sync surface)
// ---------------------------------------------------------------------------

describe("W2-006 personal agent: state-sync surface", () => {
  it("records only contract-valid derived learning deltas (raw/invalid payloads are typed errors)", () => {
    const { agent } = twoBodyAgent();
    const invalid = agent.recordLearningDelta("body-a", { deltaId: "x" } as never);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.code).toBe("INVALID_INPUT");

    const unknownBody = agent.recordLearningDelta("body-zzz", delta("d", "dim"));
    expect(unknownBody.ok).toBe(false);
  });

  it("the in-memory adapter is injectable (declared port; TEST INFRASTRUCTURE)", () => {
    const stateSync = createInMemoryStateSync();
    const runtime = createAgentBodyRuntime({
      executor: dispatchingExecutor({ "body-a": { operations: [] } }),
      clock: createStepClock(1_000, 0),
    });
    const agent = createPersonalAgentRuntime(AGENT, { bodyRuntime: runtime, stateSync });
    if (!agent.ok) throw new Error(agent.error.message);
    const registered = agent.value.registerBody(deviceBody("body-a"), assignment("body-a"));
    if (!registered.ok) throw new Error(registered.error.message);
    const recorded = agent.value.recordLearningDelta("body-a", delta("delta-9", "dim.x"));
    if (!recorded.ok) throw new Error(recorded.error.message);
    // The adapter's own record/all surface (storage only — no consent logic).
    expect(stateSync.all()).toHaveLength(1);
    expect(stateSync.all()[0].originBodyId).toBe("body-a");
  });
});

// ---------------------------------------------------------------------------
// ADR-003 consent surface: flags only, never raw values
// ---------------------------------------------------------------------------

describe("W2-006 personal agent: ADR-003 consent surface", () => {
  it("permittedSignalsFrom returns FLAGS ONLY — no raw location or attention values cross", () => {
    const snapshot = ContextSnapshotSchema.parse({
      contextId: "ctx-1",
      at: 1_000,
      attention: { availableMs: 123_456, quality: "partial" },
      fatigue: { repetitionLevel: 0.4, recentInterruptions: 1 },
      location: { coarse: "accra-gh", permitted: true },
      activity: ["commuting"],
    }) as ContextSnapshot;

    const signals = permittedSignalsFrom(snapshot);
    expect(signals).toEqual({ locationPermitted: true, attentionObservationPermitted: false });

    // The flags surface is provably raw-value-free: the canonical JSON
    // of the flags contains no snapshot value payloads.
    const serialized = canonicalJson(signals);
    expect(serialized).not.toContain("123456");
    expect(serialized).not.toContain("accra");
    expect(serialized).not.toContain("commuting");
    expect(Object.keys(signals)).toEqual(["locationPermitted", "attentionObservationPermitted"]);
  });

  it("absent location ⇒ locationPermitted false; raw attention values never imply attention permission", () => {
    const snapshot = ContextSnapshotSchema.parse({
      contextId: "ctx-2",
      at: 1_000,
      attention: { availableMs: 999_999 },
    }) as ContextSnapshot;
    const signals = permittedSignalsFrom(snapshot);
    expect(signals.locationPermitted).toBe(false);
    expect(signals.attentionObservationPermitted).toBe(false);
  });

  it("consent flags are recorded per body and retrievable; malformed flags ⇒ typed error", () => {
    const { agent } = twoBodyAgent();
    const signals = { locationPermitted: true, attentionObservationPermitted: false };
    const run = agent.runOnBody("body-a", { taskId: "task-c" }, signals);
    if (!run.ok) throw new Error(run.error.message);
    const view = agent.consentViewFor("body-a");
    if (!view.ok) throw new Error(view.error.message);
    expect(view.value).toEqual(signals);

    const bad = agent.runOnBody("body-a", { taskId: "task-c2" }, { locationPermitted: "yes" } as never);
    expect(bad.ok).toBe(false);

    const unknown = agent.consentViewFor("body-zzz");
    expect(unknown.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("W2-006 personal agent: determinism", () => {
  it("the same operation sequence on fresh runtimes ⇒ digest-identical state", () => {
    function scenario() {
      const { agent } = twoBodyAgent();
      agent.recordLearningDelta("body-a", delta("delta-1", "genre.fantasy"));
      agent.recordLearningDelta("body-b", delta("delta-2", "topic.history"));
      agent.addGrant(grant());
      agent.revokeGrant("grant-1", 3_000);
      agent.addGrant(grant({ grantId: "grant-2", bodyScope: "*" }));
      const visibleA = agent.visibleDeltas("body-a");
      const visibleB = agent.visibleDeltas("body-b");
      if (!visibleA.ok || !visibleB.ok) throw new Error("expected ok");
      return {
        visibleA: visibleA.value,
        visibleB: visibleB.value,
        grants: agent.grants(),
        status: agent.crossDeviceSharingStatus("body-a"),
      };
    }
    const first = scenario();
    const second = scenario();
    expect(contentDigest(first)).toBe(contentDigest(second));
  });

  it("runs are deterministic given the same executor scripts and tasks (injected step clock)", () => {
    const script: TestScript = { operations: [simpleOperation("body-a")], output: { answer: 42 } };
    const clock1 = createStepClock(5_000, 10);
    const clock2 = createStepClock(5_000, 10);
    const results = [clock1, clock2].map((clock) => {
      const runtime = createAgentBodyRuntime({ executor: dispatchingExecutor({ "body-a": script }), clock });
      const agent = createPersonalAgentRuntime(AGENT, { bodyRuntime: runtime });
      if (!agent.ok) throw new Error(agent.error.message);
      const registered = agent.value.registerBody(deviceBody("body-a"), assignment("body-a"));
      if (!registered.ok) throw new Error(registered.error.message);
      const run = agent.value.runOnBody("body-a", { taskId: "task-det" });
      if (!run.ok) throw new Error(run.error.message);
      return run.value;
    });
    expect(contentDigest(results[0])).toBe(contentDigest(results[1]));
  });
});
