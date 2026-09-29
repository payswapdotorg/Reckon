/**
 * Typed errors for the Agent Body runtime.
 *
 * THE BUDGET LAW: an Agent Body execution enforces budgets
 * (cost/tokens/wall-clock/calls) and latency limits (soft → degrade,
 * hard → yield) with typed `BudgetExhausted` / `DeadlineExceeded`
 * errors. All errors are typed values — never raw throws.
 */
import type { BudgetSpec, Permission } from "@reckon/contracts";

export type AgentRuntimeErrorCode =
  | "INVALID_INPUT"
  | "PERMISSION_DENIED"
  | "CAPABILITY_NOT_DECLARED"
  | "BUDGET_EXHAUSTED"
  | "DEADLINE_EXCEEDED"
  | "STEP_LIMIT_EXCEEDED";

export type CapabilitySurface = "tool" | "observation" | "memory" | "action";

export type AgentRuntimeError =
  | {
      code: "INVALID_INPUT";
      message: string;
      issues?: { path: string; message: string }[];
    }
  | {
      code: "PERMISSION_DENIED";
      message: string;
      capability: Permission["capability"];
      targetId: string;
    }
  | {
      code: "CAPABILITY_NOT_DECLARED";
      message: string;
      surface: CapabilitySurface;
      targetId: string;
    }
  | {
      code: "BUDGET_EXHAUSTED";
      message: string;
      budgetKind: BudgetSpec["kind"];
      customKind?: string;
      accumulated: number;
      limit: number;
    }
  | {
      code: "DEADLINE_EXCEEDED";
      message: string;
      elapsedMs: number;
      hardMs: number;
    }
  | {
      code: "STEP_LIMIT_EXCEEDED";
      message: string;
      steps: number;
      limit: number;
    };

/** Typed budget-exhaustion error (THE BUDGET LAW). */
export type BudgetExhaustedError = Extract<AgentRuntimeError, { code: "BUDGET_EXHAUSTED" }>;

/** Typed hard-deadline error (THE BUDGET LAW). */
export type DeadlineExceededError = Extract<AgentRuntimeError, { code: "DEADLINE_EXCEEDED" }>;

export type Result<T, E = AgentRuntimeError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function invalidInput(
  message: string,
  issues?: { path: string; message: string }[],
): { ok: false; error: AgentRuntimeError } {
  return { ok: false, error: { code: "INVALID_INPUT", message, issues } };
}
