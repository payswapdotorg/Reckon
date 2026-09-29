/**
 * Typed errors and results for the scheduler kernel.
 *
 * SCHEDULER-ACTION LAW (lock #11): the scheduler emits exactly
 * HOLD / CONTINUE / QUEUE / SUGGEST / SWITCH / INTERRUPT / RESUME / END;
 * every state transition is validated against the legal-transition
 * matrix, and illegal transitions are typed errors — never raw throws,
 * never silent coercion.
 */
import type { ScheduleAction } from "@reckon/contracts";
import type { PlanStatus } from "./state.js";

export type SchedulerErrorCode = "INVALID_INPUT" | "ILLEGAL_TRANSITION";

export type SchedulerError =
  | {
      code: "INVALID_INPUT";
      message: string;
      issues?: { path: string; message: string }[];
    }
  | {
      code: "ILLEGAL_TRANSITION";
      message: string;
      from: PlanStatus;
      action: ScheduleAction;
    };

export type Result<T, E = SchedulerError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function invalidInput(
  message: string,
  issues?: { path: string; message: string }[],
): { ok: false; error: SchedulerError } {
  return { ok: false, error: { code: "INVALID_INPUT", message, issues } };
}

export function illegalTransition(
  from: PlanStatus,
  action: ScheduleAction,
  message?: string,
): { ok: false; error: SchedulerError } {
  return {
    ok: false,
    error: {
      code: "ILLEGAL_TRANSITION",
      message:
        message ??
        `illegal transition: action ${action} is not legal from plan state ${from}`,
      from,
      action,
    },
  };
}
