/**
 * Agent-runtime kernel contracts: the operation protocol between the
 * runtime (enforcer) and an injected executor (worker). Wave 1 ships
 * only the DeterministicTestExecutor; real executors (LLM-backed or
 * otherwise) arrive in later waves behind this same seam.
 */
import type { ModelAssignment } from "@reckon/contracts";
import type { AgentRuntimeError } from "./errors.js";

/** Usage an executor declares for one operation (metered by the runtime). */
export interface UsageReport {
  cost?: number;
  tokens?: number;
  custom?: Record<string, number>;
}

/** Operation kinds the envelope can enforce. */
export type BodyOperationKind =
  | "tool"
  | "observe"
  | "memory"
  | "action"
  | "model-inference"
  | "compute";

/** A single declared unit of body work. The executor declares it; the
 *  runtime validates it against the envelope (declared surface +
 *  permissions) and meters its usage BEFORE it is accepted. */
export interface BodyOperation {
  kind: BodyOperationKind;
  /** toolId / observationId / memoryId / actionId / modelId. */
  targetId: string;
  /** Memory access direction (memory operations only; default read). */
  access?: "read" | "write";
  usage?: UsageReport;
  /** Executor-computed output (opaque to the runtime). */
  output?: unknown;
}

/** An accepted operation in the run's audit log (partial-state report). */
export interface AcceptedOperation {
  index: number;
  operation: BodyOperation;
  elapsedMs: number;
}

/** Task handed to the body instance. */
export interface BodyTask {
  taskId: string;
  input?: unknown;
}

/** The state the executor sees at each step. `degraded` is true once
 *  the soft latency deadline has passed (the executor may degrade —
 *  e.g. fall back to a cached answer). */
export interface BodyRunState {
  stepIndex: number;
  degraded: boolean;
  task: BodyTask;
  /** The model assignment — DATA only (model-neutral law). */
  model: ModelAssignment;
  /** Accepted operations so far (audit log). */
  log: ReadonlyArray<AcceptedOperation>;
}

export type BodyStep =
  | { kind: "operation"; operation: BodyOperation }
  | { kind: "done"; output: unknown };

/**
 * The executor port. `step` returns the next operation or a final
 * output; the runtime enforces the envelope around every step.
 * Synchronous in wave 1 (deterministic test executors); real executors
 * arrive in later waves.
 */
export interface BodyExecutor {
  executorId: string;
  step(state: BodyRunState): BodyStep;
}

/** Metered usage totals for a run. `calls` counts accepted operations;
 *  `wallClockMs` is the injected clock's elapsed time at run end. */
export interface RunUsage {
  cost: number;
  tokens: number;
  calls: number;
  wallClockMs: number;
  custom: Record<string, number>;
}

/**
 * A run outcome. All variants carry the audit log and usage totals.
 * - `completed`: the executor finished;
 * - `blocked`: envelope violation (un-permitted / beyond envelope) or a
 *   malformed operation — the offending operation was NOT executed;
 * - `aborted`: a budget was exhausted mid-run (partial-state report) or
 *   the runtime step limit was hit;
 * - `yielded`: the hard latency deadline passed (typed
 *   DeadlineExceeded) — the body yields with its partial state.
 */
export type BodyRunResult =
  | {
      status: "completed";
      runId: string;
      taskId: string;
      output: unknown;
      degraded: boolean;
      usage: RunUsage;
      log: AcceptedOperation[];
      model: ModelAssignment;
      executorId: string;
    }
  | {
      status: "blocked";
      runId: string;
      taskId: string;
      error: AgentRuntimeError;
      degraded: boolean;
      usage: RunUsage;
      log: AcceptedOperation[];
      model: ModelAssignment;
      executorId: string;
    }
  | {
      status: "aborted";
      runId: string;
      taskId: string;
      error: AgentRuntimeError;
      degraded: boolean;
      usage: RunUsage;
      log: AcceptedOperation[];
      model: ModelAssignment;
      executorId: string;
    }
  | {
      status: "yielded";
      runId: string;
      taskId: string;
      error: AgentRuntimeError;
      degraded: true;
      usage: RunUsage;
      log: AcceptedOperation[];
      model: ModelAssignment;
      executorId: string;
    };

/**
 * Deterministic clock for reproducible runs: every `now()` call returns
 * start + step × callCount (auto-advancing — runs are synchronous, so
 * the clock must advance on its own). Use for tests and research
 * replay; production uses the system clock.
 */
export function createStepClock(startMs: number, stepMs: number): { now(): number } {
  let calls = 0;
  return {
    now() {
      const t = startMs + stepMs * calls;
      calls += 1;
      return t;
    },
  };
}
