/**
 * DeterministicTestExecutor — TEST INFRASTRUCTURE.
 *
 * This executor is NOT a real implementation: it replays a scripted
 * operation sequence and returns a scripted output so the Agent Body
 * runtime's enforcement (permissions, budgets, latency limits) can be
 * tested deterministically. Real executors arrive in later waves
 * (W2-006 Personal Agent runtime / W2-008 Agent Organization runtime).
 *
 * Script semantics:
 * - operations are declared one per step, in order;
 * - when the script is exhausted the executor finishes with `output`;
 * - when the runtime reports `degraded` (soft deadline passed) and a
 *   `degradedOutput` is configured, the executor finishes immediately
 *   with that fallback (demonstrating soft-deadline degradation).
 */
import type { BodyExecutor, BodyOperation, BodyRunState, BodyStep } from "./contracts.js";

export interface TestScript {
  operations: BodyOperation[];
  /** Final output when the script completes without degradation. */
  output?: unknown;
  /** Fallback output once the soft deadline passes (degradation). */
  degradedOutput?: unknown;
}

export function createDeterministicTestExecutor(script: TestScript): BodyExecutor {
  return {
    executorId: "deterministic-test-executor",
    step(state: BodyRunState): BodyStep {
      if (state.degraded && script.degradedOutput !== undefined) {
        return { kind: "done", output: script.degradedOutput };
      }
      if (state.stepIndex < script.operations.length) {
        return { kind: "operation", operation: script.operations[state.stepIndex] };
      }
      return { kind: "done", output: script.output ?? null };
    },
  };
}
