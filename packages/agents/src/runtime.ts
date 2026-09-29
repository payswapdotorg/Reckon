/**
 * W2-007 — the Agent Body runtime.
 *
 * THE MODEL-NEUTRAL LAW (ADR-002, lock #16): Agent Bodies are capability
 * envelopes; `ModelAssignment` is DATA carried on the instance — never
 * code, never a routing decision. No provider SDK is imported anywhere;
 * model-inference operations must name the ASSIGNED model (no second
 * model router).
 *
 * THE ENVELOPE LAW: the body's declared `actions`/`observations`/
 * `tools`/`memoryInterfaces` are the ONLY surface an instance exposes.
 * Operations referencing undeclared targets are typed
 * `CAPABILITY_NOT_DECLARED` errors (reflection beyond the envelope is
 * denied). Declared-but-unpermitted operations are typed
 * `PERMISSION_DENIED` errors.
 *
 * THE BUDGET LAW: per-execution enforcement of cost/tokens/wall-clock/
 * calls budgets (`BUDGET_EXHAUSTED`, aborting with a partial-state
 * report) and latency limits (`softMs` → degradation flag, `hardMs` →
 * `DEADLINE_EXCEEDED` yield).
 *
 * Determinism: with an injected deterministic clock and a deterministic
 * executor, the same inputs produce byte-identical run results.
 *
 * Permission mapping (documented): tool → "tool", observe → "observe",
 * memory → "memory" (plus interface access match), action → "write",
 * model-inference → "model-inference" (plus assigned-model match),
 * compute → no permission required. Permission `scope` semantics are
 * host/adapter-owned (opaque to the core, per the contract).
 */
import {
  AgentBodySchema,
  canonicalJson,
  contentDigest,
  ModelAssignmentSchema,
  type AgentBody,
  type Id,
  type MemoryInterface,
  type ModelAssignment,
  type Permission,
} from "@reckon/contracts";
import type { Result } from "./errors.js";
import { invalidInput, type AgentRuntimeError, type BudgetExhaustedError } from "./errors.js";
import type {
  BodyOperation,
  BodyTask,
  RunUsage,
  AcceptedOperation,
  BodyRunResult,
  BodyExecutor,
  UsageReport,
} from "./contracts.js";
import { createStepClock } from "./contracts.js";

export { createStepClock };

/** The clock port. Inject a deterministic clock for reproducible runs
 *  (tests, research replay); the default is the system clock. */
export interface Clock {
  now(): number;
}

export function createSystemClock(): Clock {
  return { now: () => Date.now() };
}

/** Default runtime safety valve against non-terminating executors.
 *  This is NOT a body budget — bodies declare their own `calls`
 *  budgets; this bound only protects the host loop. */
export const DEFAULT_MAX_STEPS = 10_000;

export interface AgentBodyRuntimeDeps {
  /** The injected executor that performs the body's work. Wave 1 ships
   *  only the DeterministicTestExecutor (test infrastructure); real
   *  executors arrive in later waves. */
  executor: BodyExecutor;
  clock?: Clock;
  maxSteps?: number;
}

/** Read-only view of the body's declared surface (the envelope). */
export interface EnvelopeView {
  tools: string[];
  observations: string[];
  memoryInterfaces: string[];
  actions: string[];
}

export interface AgentInstanceHandle {
  bodyId: Id;
  /** The model assignment — DATA (model-neutral law). */
  model: ModelAssignment;
  /** The declared surface (the ONLY surface this instance exposes). */
  envelope: EnvelopeView;
  /** Execute a task under the envelope's enforcement. */
  run(task: BodyTask): Result<BodyRunResult>;
}

export interface AgentBodyRuntime {
  instantiate(body: AgentBody, assignment: ModelAssignment): Result<AgentInstanceHandle>;
}

/** Factory for the runtime. One executor is bound per runtime in wave 1
 *  (multi-executor registries arrive with real executors). */
export function createAgentBodyRuntime(deps: AgentBodyRuntimeDeps): AgentBodyRuntime {
  const clock = deps.clock ?? createSystemClock();
  const maxSteps = deps.maxSteps ?? DEFAULT_MAX_STEPS;

  return {
    instantiate(body: AgentBody, assignment: ModelAssignment): Result<AgentInstanceHandle> {
      const parsedBody = AgentBodySchema.safeParse(body);
      if (!parsedBody.success) {
        return invalidInput(
          "instantiate: invalid agent body",
          parsedBody.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        );
      }
      const parsedAssignment = ModelAssignmentSchema.safeParse(assignment);
      if (!parsedAssignment.success) {
        return invalidInput(
          "instantiate: invalid model assignment",
          parsedAssignment.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        );
      }
      if (parsedAssignment.data.bodyId !== parsedBody.data.bodyId) {
        return invalidInput(
          `instantiate: model assignment targets body ${parsedAssignment.data.bodyId} but the body is ${parsedBody.data.bodyId}`,
        );
      }
      const validBody = parsedBody.data;
      const model = parsedAssignment.data;

      const envelope: EnvelopeView = {
        tools: validBody.tools.map((t) => t.toolId),
        observations: validBody.observations.map((o) => o.observationId),
        memoryInterfaces: validBody.memoryInterfaces.map((m) => m.memoryId),
        actions: validBody.actions.map((a) => a.actionId),
      };

      const toolsById = new Map(validBody.tools.map((t) => [t.toolId, t] as const));
      const observationsById = new Map(validBody.observations.map((o) => [o.observationId, o] as const));
      const memoriesById = new Map(validBody.memoryInterfaces.map((m) => [m.memoryId, m] as const));
      const actionsById = new Map(validBody.actions.map((a) => [a.actionId, a] as const));
      const grantedCapabilities = new Set(validBody.permissions.map((p) => p.capability));

      return {
        ok: true,
        value: {
          bodyId: validBody.bodyId,
          model,
          envelope,
          run(task: BodyTask): Result<BodyRunResult> {
            return runBody(task, {
              body: validBody,
              model,
              executor: deps.executor,
              clock,
              maxSteps,
              toolsById,
              observationsById,
              memoriesById,
              actionsById,
              grantedCapabilities,
            });
          },
        },
      };
    },
  };
}

interface RunContext {
  body: AgentBody;
  model: ModelAssignment;
  executor: BodyExecutor;
  clock: Clock;
  maxSteps: number;
  toolsById: Map<string, { toolId: string }>;
  observationsById: Map<string, { observationId: string }>;
  memoriesById: Map<string, MemoryInterface>;
  actionsById: Map<string, { actionId: string }>;
  grantedCapabilities: Set<Permission["capability"]>;
}

function safeDigest(value: unknown): string | null {
  try {
    return contentDigest(value);
  } catch {
    return null;
  }
}

function emptyUsage(): RunUsage {
  return { cost: 0, tokens: 0, calls: 0, wallClockMs: 0, custom: {} };
}

/** Execute one task under full envelope enforcement. */
function runBody(task: BodyTask, ctx: RunContext): Result<BodyRunResult> {
  if (task === null || typeof task !== "object" || typeof task.taskId !== "string" || task.taskId.length < 1) {
    return invalidInput("run: task must be { taskId: string, input?: unknown }");
  }
  const runSeed = safeDigest({
    bodyId: ctx.body.bodyId,
    model: ctx.model,
    taskId: task.taskId,
    input: task.input ?? null,
  });
  if (runSeed === null) {
    return invalidInput("run: task input is not canonical-serializable (deterministic run ids require it)");
  }
  const runId = `run-${runSeed.slice(0, 24)}`;

  const base = {
    runId,
    taskId: task.taskId,
    model: ctx.model,
    executorId: ctx.executor.executorId,
  };

  const usage = emptyUsage();
  const log: AcceptedOperation[] = [];
  const budgets = ctx.body.budgets;
  const latency = ctx.body.latencyLimits;
  const startMs = ctx.clock.now();
  let degraded = false;
  let lastElapsed = 0;

  for (let stepIndex = 0; ; stepIndex++) {
    const now = ctx.clock.now();
    const elapsed = now - startMs;
    lastElapsed = elapsed;

    // Runtime safety valve (host protection, not a body budget).
    if (stepIndex >= ctx.maxSteps) {
      return {
        ok: true,
        value: {
          ...base,
          status: "aborted",
          degraded,
          error: {
            code: "STEP_LIMIT_EXCEEDED",
            message: `executor exceeded the runtime step limit ${ctx.maxSteps}`,
            steps: stepIndex,
            limit: ctx.maxSteps,
          },
          usage: { ...usage, wallClockMs: lastElapsed, custom: { ...usage.custom } },
          log: [...log],
        },
      };
    }

    // Hard deadline: the body must yield (typed DeadlineExceeded).
    if (latency && elapsed > latency.hardMs) {
      return {
        ok: true,
        value: {
          ...base,
          status: "yielded",
          degraded: true,
          error: {
            code: "DEADLINE_EXCEEDED",
            message: `hard deadline ${latency.hardMs}ms exceeded at ${elapsed}ms; yielding`,
            elapsedMs: elapsed,
            hardMs: latency.hardMs,
          },
          usage: { ...usage, wallClockMs: lastElapsed, custom: { ...usage.custom } },
          log: [...log], // partial-state report
        },
      };
    }

    // Wall-clock budget (clock-driven, deterministic with an injected clock).
    const wallBudget = budgets.find((b) => b.kind === "wall-clock-ms");
    if (wallBudget && elapsed > wallBudget.limit) {
      return {
        ok: true,
        value: {
          ...base,
          status: "aborted",
          degraded,
          error: {
            code: "BUDGET_EXHAUSTED",
            message: `wall-clock budget ${wallBudget.limit}ms exhausted at ${elapsed}ms`,
            budgetKind: "wall-clock-ms",
            accumulated: elapsed,
            limit: wallBudget.limit,
          },
          usage: { ...usage, wallClockMs: lastElapsed, custom: { ...usage.custom } },
          log: [...log], // partial-state report
        },
      };
    }

    // Soft deadline: degradation flag (the executor sees it and may
    // degrade — e.g. fall back to a cached answer).
    if (latency?.softMs !== undefined && elapsed > latency.softMs) {
      degraded = true;
    }

    const step = ctx.executor.step({
      stepIndex,
      degraded,
      task,
      model: ctx.model,
      log,
    });

    if (step.kind === "done") {
      return {
        ok: true,
        value: {
          ...base,
          status: "completed",
          degraded,
          output: step.output,
          usage: { ...usage, wallClockMs: lastElapsed, custom: { ...usage.custom } },
          log: [...log],
        },
      };
    }

    const op = step.operation;

    // Structural validation of the declared operation.
    const opIssues = validateOperation(op);
    if (opIssues.length > 0) {
      return {
        ok: true,
        value: {
          ...base,
          status: "blocked",
          degraded,
          error: { code: "INVALID_INPUT", message: `executor declared a malformed operation: ${opIssues.join("; ")}` },
          usage: { ...usage, wallClockMs: lastElapsed, custom: { ...usage.custom } },
          log: [...log],
        },
      };
    }

    // Envelope: declared-surface checks (reflection beyond the envelope
    // is a typed error).
    const declaredError = checkDeclared(op, ctx);
    if (declaredError) {
      return {
        ok: true,
        value: { ...base, status: "blocked", degraded, error: declaredError, usage: { ...usage, wallClockMs: lastElapsed, custom: { ...usage.custom } }, log: [...log] },
      };
    }

    // Envelope: permission checks (deny un-permitted capability).
    const permissionError = checkPermission(op, ctx);
    if (permissionError) {
      return {
        ok: true,
        value: { ...base, status: "blocked", degraded, error: permissionError, usage: { ...usage, wallClockMs: lastElapsed, custom: { ...usage.custom } }, log: [...log] },
      };
    }

    // Metered budgets: project the usage this operation would add and
    // abort BEFORE executing when a budget would be exceeded.
    const opUsage: UsageReport = op.usage ?? {};
    const projectedCost = usage.cost + (opUsage.cost ?? 0);
    const projectedTokens = usage.tokens + (opUsage.tokens ?? 0);
    const projectedCalls = usage.calls + 1;
    const projectedCustom = { ...usage.custom };
    for (const [kind, value] of Object.entries(opUsage.custom ?? {})) {
      projectedCustom[kind] = (projectedCustom[kind] ?? 0) + value;
    }

    for (const budget of budgets) {
      if (budget.kind === "cost" && projectedCost > budget.limit) {
        return abortedByBudget(base, budget, usage, degraded, lastElapsed, log, usage.cost, projectedCost);
      }
      if (budget.kind === "tokens" && projectedTokens > budget.limit) {
        return abortedByBudget(base, budget, usage, degraded, lastElapsed, log, usage.tokens, projectedTokens);
      }
      if (budget.kind === "calls" && projectedCalls > budget.limit) {
        return abortedByBudget(base, budget, usage, degraded, lastElapsed, log, usage.calls, projectedCalls);
      }
      if (budget.kind === "custom" && budget.customKind !== undefined) {
        const projected = projectedCustom[budget.customKind] ?? 0;
        if (projected > budget.limit) {
          return abortedByBudget(
            base,
            budget,
            usage,
            degraded,
            lastElapsed,
            log,
            usage.custom[budget.customKind] ?? 0,
            projected,
          );
        }
      }
    }

    // Accept: meter and log.
    usage.cost = projectedCost;
    usage.tokens = projectedTokens;
    usage.calls = projectedCalls;
    usage.custom = projectedCustom;
    log.push({ index: stepIndex, operation: op, elapsedMs: elapsed });
  }
}

function abortedByBudget(
  base: { runId: string; taskId: string; model: ModelAssignment; executorId: string },
  budget: { kind: string; customKind?: string; limit: number },
  usage: RunUsage,
  degraded: boolean,
  lastElapsed: number,
  log: AcceptedOperation[],
  /** Consumed so far (accepted operations only). */
  accumulated: number,
  /** What the rejected operation would have brought the total to. */
  projected: number,
): { ok: true; value: BodyRunResult } {
  const error: BudgetExhaustedError = {
    code: "BUDGET_EXHAUSTED",
    message: `${budget.kind} budget ${budget.limit} exhausted (accumulated ${accumulated}; rejected operation would reach ${projected})`,
    budgetKind: budget.kind as never,
    ...(budget.customKind !== undefined ? { customKind: budget.customKind } : {}),
    accumulated,
    limit: budget.limit,
  };
  return {
    ok: true,
    value: {
      ...base,
      status: "aborted",
      degraded,
      error,
      usage: { ...usage, wallClockMs: lastElapsed, custom: { ...usage.custom } },
      log: [...log], // partial-state report: accepted operations so far
    },
  };
}

function validateOperation(op: unknown): string[] {
  const issues: string[] = [];
  if (op === null || typeof op !== "object") {
    return ["operation must be an object"];
  }
  const o = op as Record<string, unknown>;
  const kinds = ["tool", "observe", "memory", "action", "model-inference", "compute"];
  if (typeof o["kind"] !== "string" || !kinds.includes(o["kind"])) {
    issues.push(`kind must be one of ${kinds.join(", ")}`);
  }
  if (typeof o["targetId"] !== "string" || o["targetId"].length < 1) {
    issues.push("targetId must be a non-empty string");
  }
  if (o["access"] !== undefined && o["access"] !== "read" && o["access"] !== "write") {
    issues.push("access must be read | write");
  }
  const usage = o["usage"];
  if (usage !== undefined) {
    if (usage === null || typeof usage !== "object" || Array.isArray(usage)) {
      issues.push("usage must be an object");
    } else {
      const u = usage as Record<string, unknown>;
      for (const key of ["cost", "tokens"]) {
        if (u[key] !== undefined && (typeof u[key] !== "number" || !Number.isFinite(u[key]) || (u[key] as number) < 0)) {
          issues.push(`usage.${key} must be a finite non-negative number`);
        }
      }
      if (u["custom"] !== undefined) {
        if (u["custom"] === null || typeof u["custom"] !== "object" || Array.isArray(u["custom"])) {
          issues.push("usage.custom must be an object of numbers");
        } else {
          for (const [k, v] of Object.entries(u["custom"] as Record<string, unknown>)) {
            if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
              issues.push(`usage.custom.${k} must be a finite non-negative number`);
            }
          }
        }
      }
    }
  }
  return issues;
}

function checkDeclared(op: BodyOperation, ctx: RunContext): AgentRuntimeError | null {
  switch (op.kind) {
    case "tool":
      if (!ctx.toolsById.has(op.targetId)) {
        return {
          code: "CAPABILITY_NOT_DECLARED",
          message: `tool ${op.targetId} is not declared on body ${ctx.body.bodyId} (beyond the envelope)`,
          surface: "tool",
          targetId: op.targetId,
        };
      }
      return null;
    case "observe":
      if (!ctx.observationsById.has(op.targetId)) {
        return {
          code: "CAPABILITY_NOT_DECLARED",
          message: `observation ${op.targetId} is not declared on body ${ctx.body.bodyId} (beyond the envelope)`,
          surface: "observation",
          targetId: op.targetId,
        };
      }
      return null;
    case "memory":
      if (!ctx.memoriesById.has(op.targetId)) {
        return {
          code: "CAPABILITY_NOT_DECLARED",
          message: `memory interface ${op.targetId} is not declared on body ${ctx.body.bodyId} (beyond the envelope)`,
          surface: "memory",
          targetId: op.targetId,
        };
      }
      return null;
    case "action":
      if (!ctx.actionsById.has(op.targetId)) {
        return {
          code: "CAPABILITY_NOT_DECLARED",
          message: `action ${op.targetId} is not declared on body ${ctx.body.bodyId} (beyond the envelope)`,
          surface: "action",
          targetId: op.targetId,
        };
      }
      return null;
    case "model-inference":
    case "compute":
      return null;
  }
}

function checkPermission(op: BodyOperation, ctx: RunContext): AgentRuntimeError | null {
  switch (op.kind) {
    case "tool":
      if (!ctx.grantedCapabilities.has("tool")) {
        return {
          code: "PERMISSION_DENIED",
          message: `tool ${op.targetId} denied: body has no "tool" permission`,
          capability: "tool",
          targetId: op.targetId,
        };
      }
      return null;
    case "observe":
      if (!ctx.grantedCapabilities.has("observe")) {
        return {
          code: "PERMISSION_DENIED",
          message: `observation ${op.targetId} denied: body has no "observe" permission`,
          capability: "observe",
          targetId: op.targetId,
        };
      }
      return null;
    case "memory": {
      if (!ctx.grantedCapabilities.has("memory")) {
        return {
          code: "PERMISSION_DENIED",
          message: `memory ${op.targetId} denied: body has no "memory" permission`,
          capability: "memory",
          targetId: op.targetId,
        };
      }
      const memory = ctx.memoriesById.get(op.targetId) as MemoryInterface;
      const access = op.access ?? "read";
      const allowed =
        access === "read"
          ? memory.access === "read" || memory.access === "read-write"
          : memory.access === "write" || memory.access === "read-write";
      if (!allowed) {
        return {
          code: "PERMISSION_DENIED",
          message: `memory ${op.targetId} denied: interface access is "${memory.access}", operation needs "${access}"`,
          capability: "memory",
          targetId: op.targetId,
        };
      }
      return null;
    }
    case "action":
      if (!ctx.grantedCapabilities.has("write")) {
        return {
          code: "PERMISSION_DENIED",
          message: `action ${op.targetId} denied: body has no "write" permission`,
          capability: "write",
          targetId: op.targetId,
        };
      }
      return null;
    case "model-inference": {
      if (!ctx.grantedCapabilities.has("model-inference")) {
        return {
          code: "PERMISSION_DENIED",
          message: `model inference denied: body has no "model-inference" permission`,
          capability: "model-inference",
          targetId: op.targetId,
        };
      }
      if (op.targetId !== ctx.model.modelId) {
        return {
          code: "PERMISSION_DENIED",
          message: `model inference denied: ${op.targetId} is not the assigned model ${ctx.model.modelId} (no second model router)`,
          capability: "model-inference",
          targetId: op.targetId,
        };
      }
      return null;
    }
    case "compute":
      return null; // pure computation needs no capability
  }
}

/** Deterministic digest helper re-exported for tests. */
export function digestOf(value: unknown): string {
  return canonicalJson(value);
}
