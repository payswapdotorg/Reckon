/**
 * W2-007 acceptance tests — the Agent Body runtime.
 *
 * Proves: envelope enforcement (un-permitted tool blocked with typed
 * error; reflection beyond the envelope blocked), budget enforcement
 * (cost/tokens/calls/wall-clock — exhaustion mid-run aborts with a
 * partial-state report), latency enforcement (soft → degradation flag,
 * hard → DeadlineExceeded yield), model-neutrality (assignment is data;
 * no second model router), typed errors, and determinism digests.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AgentBodySchema,
  contentDigest,
  type AgentBody,
  type BudgetSpec,
  type ModelAssignment,
} from "@reckon/contracts";
import {
  createAgentBodyRuntime,
  createDeterministicTestExecutor,
  createStepClock,
  type AgentBodyRuntime,
  type BodyOperation,
} from "../src/index.js";

function makeBody(overrides: {
  permissions?: { permissionId: string; capability: "observe" | "read" | "write" | "tool" | "network" | "model-inference" | "memory" | "custom" }[];
  tools?: string[];
  observations?: string[];
  memoryInterfaces?: { memoryId: string; kind: "private" | "shared" | "ephemeral" | "persistent" | "custom"; access: "read" | "write" | "read-write" }[];
  actions?: string[];
  budgets?: BudgetSpec[];
  latencyLimits?: { softMs?: number; hardMs: number };
} = {}): AgentBody {
  return AgentBodySchema.parse({
    bodyId: "body-1",
    role: { roleId: "generalist", description: "Single generalist baseline" },
    tools: (overrides.tools ?? ["tool-1"]).map((toolId) => ({
      toolId,
      name: `tool-${toolId}`,
    })),
    observations: (overrides.observations ?? ["obs-1"]).map((observationId) => ({
      observationId,
      kind: "context",
    })),
    memoryInterfaces: overrides.memoryInterfaces ?? [{ memoryId: "mem-1", kind: "private", access: "read" }],
    actions: (overrides.actions ?? ["act-1"]).map((actionId) => ({
      actionId,
      kind: "select",
    })),
    permissions: (overrides.permissions ?? [
      { permissionId: "p-tool", capability: "tool" },
      { permissionId: "p-observe", capability: "observe" },
      { permissionId: "p-memory", capability: "memory" },
      { permissionId: "p-write", capability: "write" },
      { permissionId: "p-inference", capability: "model-inference" },
    ]).map((p) => ({ permissionId: p.permissionId, capability: p.capability })),
    budgets: overrides.budgets ?? [],
    ...(overrides.latencyLimits !== undefined ? { latencyLimits: overrides.latencyLimits } : {}),
  });
}

function makeAssignment(modelId = "model-x"): ModelAssignment {
  return { bodyId: "body-1", modelAdapterId: "adapter-neutral", modelId, version: "1" };
}

function runtimeWith(script: { operations: BodyOperation[]; output?: unknown; degradedOutput?: unknown }, clock?: { now(): number }, maxSteps?: number): AgentBodyRuntime {
  return createAgentBodyRuntime({
    executor: createDeterministicTestExecutor(script),
    ...(clock !== undefined ? { clock } : {}),
    ...(maxSteps !== undefined ? { maxSteps } : {}),
  });
}

describe("W2-007 instantiate: validation", () => {
  const runtime = runtimeWith({ operations: [] });

  it("creates a handle exposing the declared envelope and the model assignment as data", () => {
    const handle = runtime.instantiate(makeBody(), makeAssignment());
    if (!handle.ok) throw new Error(handle.error.message);
    expect(handle.value.bodyId).toBe("body-1");
    expect(handle.value.model).toEqual(makeAssignment());
    expect(handle.value.envelope).toEqual({
      tools: ["tool-1"],
      observations: ["obs-1"],
      memoryInterfaces: ["mem-1"],
      actions: ["act-1"],
    });
  });

  it("returns a typed error for an invalid body", () => {
    const result = runtime.instantiate({ nope: true } as never, makeAssignment());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });

  it("returns a typed error for an assignment targeting a different body (model-neutral data check)", () => {
    const result = runtime.instantiate(makeBody(), { ...makeAssignment(), bodyId: "body-OTHER" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });
});

describe("W2-007 envelope: permissions and declared surface", () => {
  it("blocks an un-permitted tool with a typed PERMISSION_DENIED error (op never executed)", () => {
    const runtime = runtimeWith({ operations: [{ kind: "tool", targetId: "tool-1" }] });
    const handle = runtime.instantiate(
      makeBody({ permissions: [{ permissionId: "p-observe", capability: "observe" }] }), // no "tool" permission
      makeAssignment(),
    );
    if (!handle.ok) throw new Error(handle.error.message);
    const result = handle.value.run({ taskId: "t-1" });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.status).toBe("blocked");
    if (result.value.status === "blocked") {
      expect(result.value.error.code).toBe("PERMISSION_DENIED");
      if (result.value.error.code === "PERMISSION_DENIED") {
        expect(result.value.error.capability).toBe("tool");
        expect(result.value.error.targetId).toBe("tool-1");
      }
    }
    expect(result.value.log).toHaveLength(0); // blocked op never entered the log
  });

  it("blocks reflection beyond the envelope (undeclared tool/observation/memory/action) with CAPABILITY_NOT_DECLARED", () => {
    const cases: { surface: "tool" | "observation" | "memory" | "action"; op: BodyOperation }[] = [
      { surface: "tool", op: { kind: "tool", targetId: "ghost-tool" } },
      { surface: "observation", op: { kind: "observe", targetId: "ghost-obs" } },
      { surface: "memory", op: { kind: "memory", targetId: "ghost-mem" } },
      { surface: "action", op: { kind: "action", targetId: "ghost-act" } },
    ];
    for (const { surface, op } of cases) {
      const runtime = runtimeWith({ operations: [op] });
      const handle = runtime.instantiate(makeBody(), makeAssignment());
      if (!handle.ok) throw new Error(handle.error.message);
      const result = handle.value.run({ taskId: `t-${surface}` });
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.status).toBe("blocked");
      if (result.value.status === "blocked") {
        expect(result.value.error.code).toBe("CAPABILITY_NOT_DECLARED");
        if (result.value.error.code === "CAPABILITY_NOT_DECLARED") {
          expect(result.value.error.surface).toBe(surface);
        }
      }
      expect(result.value.log).toHaveLength(0);
    }
  });

  it("blocks memory writes on a read-only interface (declared but not granted that access)", () => {
    const runtime = runtimeWith({ operations: [{ kind: "memory", targetId: "mem-1", access: "write" }] });
    const handle = runtime.instantiate(makeBody(), makeAssignment());
    if (!handle.ok) throw new Error(handle.error.message);
    const result = handle.value.run({ taskId: "t-1" });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.status).toBe("blocked");
    if (result.value.status === "blocked") {
      expect(result.value.error.code).toBe("PERMISSION_DENIED");
    }
  });

  it("allows memory writes on a read-write interface", () => {
    const runtime = runtimeWith({ operations: [{ kind: "memory", targetId: "mem-1", access: "write" }] });
    const handle = runtime.instantiate(
      makeBody({ memoryInterfaces: [{ memoryId: "mem-1", kind: "private", access: "read-write" }] }),
      makeAssignment(),
    );
    if (!handle.ok) throw new Error(handle.error.message);
    const result = handle.value.run({ taskId: "t-1" });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.status).toBe("completed");
    expect(result.value.log).toHaveLength(1);
  });

  it("blocks an action without the write permission", () => {
    const runtime = runtimeWith({ operations: [{ kind: "action", targetId: "act-1" }] });
    const handle = runtime.instantiate(
      makeBody({ permissions: [{ permissionId: "p-tool", capability: "tool" }] }),
      makeAssignment(),
    );
    if (!handle.ok) throw new Error(handle.error.message);
    const result = handle.value.run({ taskId: "t-1" });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.status).toBe("blocked");
    if (result.value.status === "blocked") {
      expect(result.value.error.code).toBe("PERMISSION_DENIED");
      if (result.value.error.code === "PERMISSION_DENIED") {
        expect(result.value.error.capability).toBe("write");
      }
    }
  });

  it("enforces the assigned model for inference — no second model router (model-neutral law)", () => {
    const runtime = runtimeWith({
      operations: [{ kind: "model-inference", targetId: "model-OTHER", usage: { tokens: 10 } }],
    });
    const handle = runtime.instantiate(makeBody(), makeAssignment("model-x"));
    if (!handle.ok) throw new Error(handle.error.message);
    const result = handle.value.run({ taskId: "t-1" });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.status).toBe("blocked");
    if (result.value.status === "blocked") {
      expect(result.value.error.code).toBe("PERMISSION_DENIED");
      expect(result.value.error.message).toContain("no second model router");
    }
  });

  it("allows inference on the assigned model and compute without any permission", () => {
    const runtime = runtimeWith({
      operations: [
        { kind: "model-inference", targetId: "model-x", usage: { tokens: 10 } },
        { kind: "compute", targetId: "internal" },
      ],
    });
    const handle = runtime.instantiate(makeBody(), makeAssignment("model-x"));
    if (!handle.ok) throw new Error(handle.error.message);
    const result = handle.value.run({ taskId: "t-1" });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.status).toBe("completed");
    expect(result.value.usage.tokens).toBe(10);
    expect(result.value.log).toHaveLength(2);
  });
});

describe("W2-007 budgets: exhaustion aborts mid-run with a partial-state report", () => {
  it("aborts on cost budget exhaustion — accepted ops stay in the log, the overflowing op does not", () => {
    const runtime = runtimeWith({
      operations: [
        { kind: "compute", targetId: "step-1", usage: { cost: 0.6 } },
        { kind: "compute", targetId: "step-2", usage: { cost: 0.6 } }, // 1.2 > 1.0 → abort BEFORE executing
        { kind: "compute", targetId: "step-3", usage: { cost: 0.1 } },
      ],
    });
    const handle = runtime.instantiate(
      makeBody({ budgets: [{ kind: "cost", limit: 1.0, currency: "USD" }] }),
      makeAssignment(),
    );
    if (!handle.ok) throw new Error(handle.error.message);
    const result = handle.value.run({ taskId: "t-1" });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.status).toBe("aborted");
    if (result.value.status === "aborted") {
      expect(result.value.error.code).toBe("BUDGET_EXHAUSTED");
      if (result.value.error.code === "BUDGET_EXHAUSTED") {
        expect(result.value.error.budgetKind).toBe("cost");
        expect(result.value.error.accumulated).toBe(0.6);
        expect(result.value.error.limit).toBe(1.0);
      }
    }
    // Partial-state report: step-1 accepted; step-2/3 never ran.
    expect(result.value.log.map((entry) => entry.operation.targetId)).toEqual(["step-1"]);
    expect(result.value.usage.cost).toBe(0.6);
    expect(result.value.usage.calls).toBe(1);
  });

  it("accepts usage that lands exactly ON the budget limit (boundary)", () => {
    const runtime = runtimeWith({
      operations: [
        { kind: "compute", targetId: "step-1", usage: { cost: 0.5 } },
        { kind: "compute", targetId: "step-2", usage: { cost: 0.5 } }, // exactly 1.0 — allowed
      ],
    });
    const handle = runtime.instantiate(
      makeBody({ budgets: [{ kind: "cost", limit: 1.0 }] }),
      makeAssignment(),
    );
    if (!handle.ok) throw new Error(handle.error.message);
    const result = handle.value.run({ taskId: "t-1" });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.status).toBe("completed");
    expect(result.value.usage.cost).toBe(1.0);
  });

  it("aborts on token budget exhaustion", () => {
    const runtime = runtimeWith({
      operations: [
        { kind: "model-inference", targetId: "model-x", usage: { tokens: 700 } },
        { kind: "model-inference", targetId: "model-x", usage: { tokens: 700 } },
      ],
    });
    const handle = runtime.instantiate(
      makeBody({ budgets: [{ kind: "tokens", limit: 1_000 }] }),
      makeAssignment(),
    );
    if (!handle.ok) throw new Error(handle.error.message);
    const result = handle.value.run({ taskId: "t-1" });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.status).toBe("aborted");
    if (result.value.status === "aborted") {
      expect(result.value.error.code).toBe("BUDGET_EXHAUSTED");
      if (result.value.error.code === "BUDGET_EXHAUSTED") {
        expect(result.value.error.budgetKind).toBe("tokens");
      }
    }
    expect(result.value.usage.tokens).toBe(700);
  });

  it("aborts on calls budget exhaustion (calls = accepted operations)", () => {
    const runtime = runtimeWith({
      operations: [
        { kind: "compute", targetId: "a" },
        { kind: "compute", targetId: "b" },
        { kind: "compute", targetId: "c" }, // 3rd call > limit 2 → abort
      ],
    });
    const handle = runtime.instantiate(
      makeBody({ budgets: [{ kind: "calls", limit: 2 }] }),
      makeAssignment(),
    );
    if (!handle.ok) throw new Error(handle.error.message);
    const result = handle.value.run({ taskId: "t-1" });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.status).toBe("aborted");
    if (result.value.status === "aborted") {
      expect(result.value.error.code).toBe("BUDGET_EXHAUSTED");
      if (result.value.error.code === "BUDGET_EXHAUSTED") {
        expect(result.value.error.budgetKind).toBe("calls");
        expect(result.value.error.accumulated).toBe(2);
      }
    }
    expect(result.value.log).toHaveLength(2);
  });

  it("aborts on wall-clock budget exhaustion using the injected deterministic clock", () => {
    // Step clock: start 0, +100ms per now() call. The runtime calls
    // now() once at start and once per iteration.
    const runtime = runtimeWith(
      {
        operations: [
          { kind: "compute", targetId: "a" }, // iter 1: elapsed 100
          { kind: "compute", targetId: "b" }, // iter 2: elapsed 200
          { kind: "compute", targetId: "c" }, // iter 3: elapsed 300 > 250 → abort
        ],
      },
      createStepClock(0, 100),
    );
    const handle = runtime.instantiate(
      makeBody({ budgets: [{ kind: "wall-clock-ms", limit: 250 }] }),
      makeAssignment(),
    );
    if (!handle.ok) throw new Error(handle.error.message);
    const result = handle.value.run({ taskId: "t-1" });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.status).toBe("aborted");
    if (result.value.status === "aborted") {
      expect(result.value.error.code).toBe("BUDGET_EXHAUSTED");
      if (result.value.error.code === "BUDGET_EXHAUSTED") {
        expect(result.value.error.budgetKind).toBe("wall-clock-ms");
        expect(result.value.error.accumulated).toBe(300);
      }
    }
    expect(result.value.log).toHaveLength(2); // a and b accepted
  });

  it("aborts on custom budget exhaustion", () => {
    const runtime = runtimeWith({
      operations: [
        { kind: "compute", targetId: "a", usage: { custom: { gpuSeconds: 6 } } },
        { kind: "compute", targetId: "b", usage: { custom: { gpuSeconds: 6 } } },
      ],
    });
    const handle = runtime.instantiate(
      makeBody({ budgets: [{ kind: "custom", customKind: "gpuSeconds", limit: 10 }] }),
      makeAssignment(),
    );
    if (!handle.ok) throw new Error(handle.error.message);
    const result = handle.value.run({ taskId: "t-1" });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.status).toBe("aborted");
    if (result.value.status === "aborted" && result.value.error.code === "BUDGET_EXHAUSTED") {
      expect(result.value.error.budgetKind).toBe("custom");
      expect(result.value.error.customKind).toBe("gpuSeconds");
    }
  });

  it("aborts via the runtime step-limit safety valve (not a body budget)", () => {
    const endless = {
      executorId: "endless",
      step: () => ({ kind: "operation" as const, operation: { kind: "compute" as const, targetId: "x" } }),
    };
    const runtime = createAgentBodyRuntime({ executor: endless, maxSteps: 5 });
    const handle = runtime.instantiate(makeBody(), makeAssignment());
    if (!handle.ok) throw new Error(handle.error.message);
    const result = handle.value.run({ taskId: "t-1" });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.status).toBe("aborted");
    if (result.value.status === "aborted") {
      expect(result.value.error.code).toBe("STEP_LIMIT_EXCEEDED");
    }
    expect(result.value.log).toHaveLength(5);
  });
});

describe("W2-007 latency: soft degrades, hard yields", () => {
  it("flags degradation when the soft deadline passes (executor falls back)", () => {
    // start 0, step 100ms: iter1 elapsed 100 > soft 150? no. iter2 elapsed 200 > 150 → degraded.
    const runtime = runtimeWith(
      {
        operations: [
          { kind: "compute", targetId: "a" },
          { kind: "compute", targetId: "b" },
        ],
        output: "full-answer",
        degradedOutput: "cached-answer",
      },
      createStepClock(0, 100),
    );
    const handle = runtime.instantiate(
      makeBody({ latencyLimits: { softMs: 150, hardMs: 10_000 } }),
      makeAssignment(),
    );
    if (!handle.ok) throw new Error(handle.error.message);
    const result = handle.value.run({ taskId: "t-1" });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.status).toBe("completed");
    if (result.value.status === "completed") {
      expect(result.value.degraded).toBe(true);
      expect(result.value.output).toBe("cached-answer"); // executor degraded
    }
  });

  it("yields with a typed DeadlineExceeded error when the hard deadline passes (partial state)", () => {
    // iter1 elapsed 100, iter2 elapsed 200, iter3 elapsed 300 > hard 250 → yield.
    const runtime = runtimeWith(
      {
        operations: [
          { kind: "compute", targetId: "a" },
          { kind: "compute", targetId: "b" },
          { kind: "compute", targetId: "c" },
          { kind: "compute", targetId: "d" },
        ],
        output: "never",
      },
      createStepClock(0, 100),
    );
    const handle = runtime.instantiate(
      makeBody({ latencyLimits: { softMs: 150, hardMs: 250 } }),
      makeAssignment(),
    );
    if (!handle.ok) throw new Error(handle.error.message);
    const result = handle.value.run({ taskId: "t-1" });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.status).toBe("yielded");
    if (result.value.status === "yielded") {
      expect(result.value.error.code).toBe("DEADLINE_EXCEEDED");
      if (result.value.error.code === "DEADLINE_EXCEEDED") {
        expect(result.value.error.hardMs).toBe(250);
        expect(result.value.error.elapsedMs).toBe(300);
      }
      expect(result.value.degraded).toBe(true);
    }
    expect(result.value.log.map((e) => e.operation.targetId)).toEqual(["a", "b"]); // partial state
  });

  it("completes normally under the deadlines with degraded=false", () => {
    const runtime = runtimeWith(
      {
        operations: [{ kind: "compute", targetId: "a" }],
        output: "ok",
      },
      createStepClock(0, 10),
    );
    const handle = runtime.instantiate(
      makeBody({ latencyLimits: { softMs: 1_000, hardMs: 10_000 } }),
      makeAssignment(),
    );
    if (!handle.ok) throw new Error(handle.error.message);
    const result = handle.value.run({ taskId: "t-1" });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.status).toBe("completed");
    if (result.value.status === "completed") {
      expect(result.value.degraded).toBe(false);
      expect(result.value.output).toBe("ok");
    }
  });
});

describe("W2-007 typed errors and determinism", () => {
  const runtime = runtimeWith({ operations: [{ kind: "compute", targetId: "a" }], output: 42 });

  it("returns a typed INVALID_INPUT error for a malformed task", () => {
    const handle = runtime.instantiate(makeBody(), makeAssignment());
    if (!handle.ok) throw new Error(handle.error.message);
    const bad = handle.value.run({ taskId: "" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("INVALID_INPUT");

    const worse = handle.value.run(null as never);
    expect(worse.ok).toBe(false);
  });

  it("returns a typed INVALID_INPUT error for non-serializable task input (deterministic run ids)", () => {
    const handle = runtime.instantiate(makeBody(), makeAssignment());
    if (!handle.ok) throw new Error(handle.error.message);
    const result = handle.value.run({ taskId: "t-1", input: { fn: () => 1 } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });

  it("blocks a malformed executor operation with a typed error (never a raw throw)", () => {
    const malformed = runtimeWith({ operations: [{ kind: "banana", targetId: "x" } as never] });
    const handle = malformed.instantiate(makeBody(), makeAssignment());
    if (!handle.ok) throw new Error(handle.error.message);
    const result = handle.value.run({ taskId: "t-1" });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.status).toBe("blocked");
    if (result.value.status === "blocked") {
      expect(result.value.error.code).toBe("INVALID_INPUT");
    }
  });

  it("produces byte-identical run results (same digest) for identical inputs and clocks", () => {
    const makeRun = () => {
      const rt = createAgentBodyRuntime({
        executor: createDeterministicTestExecutor({
          operations: [
            { kind: "tool", targetId: "tool-1", usage: { cost: 0.1, tokens: 5 } },
            { kind: "model-inference", targetId: "model-x", usage: { tokens: 20 } },
          ],
          output: { answer: "done" },
        }),
        clock: createStepClock(1_000, 50),
      });
      const handle = rt.instantiate(makeBody(), makeAssignment());
      if (!handle.ok) throw new Error(handle.error.message);
      const result = handle.value.run({ taskId: "t-1", input: { q: "hello" } });
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    };
    const a = makeRun();
    const b = makeRun();
    expect(a.runId).toBe(b.runId);
    expect(contentDigest(a)).toBe(contentDigest(b));
  });

  it("carries the model assignment verbatim (data, never a routing decision)", () => {
    const handle = runtime.instantiate(makeBody(), {
      bodyId: "body-1",
      modelAdapterId: "any-adapter",
      modelId: "any-model",
      version: "9",
    });
    if (!handle.ok) throw new Error(handle.error.message);
    const result = handle.value.run({ taskId: "t-1" });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.model).toEqual({
      bodyId: "body-1",
      modelAdapterId: "any-adapter",
      modelId: "any-model",
      version: "9",
    });
  });
});

describe("W2-007 model-neutral law: no provider SDK imports anywhere in this package", () => {
  it("has no provider SDK imports in any source file", () => {
    const srcDir = join(__dirname, "..", "src");
    const forbidden =
      /from\s+["'](openai|anthropic|@anthropic-ai|@google\/generative-ai|@azure\/openai|cohere|mistral|groq)[^"']*["']/i;
    const files = readdirSync(srcDir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(join(srcDir, file), "utf8");
      expect(forbidden.test(source), `${file} must not import a provider SDK`).toBe(false);
    }
  });
});
