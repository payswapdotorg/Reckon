/**
 * Plan state and the LEGAL-TRANSITION MATRIX (architecture-lock #11).
 *
 * Plan states (documented semantics):
 * - `idle`: no current experience, nothing primed in the queue.
 * - `queued`: the queue is primed (≥1 experience), nothing playing.
 * - `playing`: a current experience is active (queue may also be primed).
 * - `interrupted`: the current experience was interrupted; it carries a
 *   resume checkpoint (RESUME LAW, lock #12).
 * - `ended`: TERMINAL — no legal actions exist from this state.
 *
 * Action semantics (documented):
 * - HOLD: make no change (passive no-op).
 * - CONTINUE: keep the current experience going (from `playing`), or
 *   proceed with the head of the queue (from `queued`).
 * - QUEUE: enqueue experience(s) for later; never changes playback.
 * - SUGGEST: surface a suggestion; the user decides (non-binding).
 * - SWITCH: replace the active/interrupted experience with a new one;
 *   the away-experience gets a resume checkpoint slot (RESUME LAW).
 * - INTERRUPT: stop the current experience now (checkpoint slot); nothing
 *   replaces it yet.
 * - RESUME: resume an interrupted experience from its checkpoint.
 * - END: terminate the plan (host-driven).
 */
import {
  IdSchema,
  ResumeCheckpointSchema,
  type Id,
  type ResumeCheckpoint,
  type ScheduleAction,
} from "@reckon/contracts";

export const PLAN_STATUSES = ["idle", "playing", "queued", "interrupted", "ended"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export interface PlanState {
  status: PlanStatus;
  /** The active experience. REQUIRED when status is "playing". */
  currentExperienceId?: Id;
  /** The interrupted experience. REQUIRED when status is "interrupted". */
  interruptedExperienceId?: Id;
  /** Ordered queue of pending experience ids. REQUIRED non-empty when
   *  status is "queued". */
  queue: Id[];
  /** Saved resume points (contract checkpoints, caller-supplied). */
  resumeCheckpoints: ResumeCheckpoint[];
}

/**
 * The legal-transition matrix: (currentStatus, action) → next status.
 * An absent entry means the transition is ILLEGAL (typed error).
 *
 * Runtime preconditions beyond the matrix (validated by the scheduler):
 * - RESUME from `idle`/`queued` requires ≥1 resume checkpoint.
 * - CONTINUE from `queued` requires a non-empty queue (implied by
 *   well-formedness: `queued` ⇒ queue non-empty).
 * - SWITCH requires an active or interrupted experience in the state.
 * - INTERRUPT requires an active experience (`playing`).
 */
export const LEGAL_TRANSITIONS: Readonly<
  Record<PlanStatus, Partial<Record<ScheduleAction, PlanStatus>>>
> = Object.freeze({
  idle: Object.freeze({ HOLD: "idle", QUEUE: "queued", SUGGEST: "idle", RESUME: "playing", END: "ended" }),
  queued: Object.freeze({
    HOLD: "queued",
    CONTINUE: "playing",
    QUEUE: "queued",
    SUGGEST: "queued",
    RESUME: "playing",
    END: "ended",
  }),
  playing: Object.freeze({
    HOLD: "playing",
    CONTINUE: "playing",
    QUEUE: "playing",
    SUGGEST: "playing",
    SWITCH: "playing",
    INTERRUPT: "interrupted",
    END: "ended",
  }),
  interrupted: Object.freeze({
    HOLD: "interrupted",
    QUEUE: "interrupted",
    SUGGEST: "interrupted",
    SWITCH: "playing",
    RESUME: "playing",
    END: "ended",
  }),
  ended: Object.freeze({}),
});

/** Is the (status, action) transition legal per the matrix? */
export function isLegalTransition(from: PlanStatus, action: ScheduleAction): boolean {
  return LEGAL_TRANSITIONS[from]?.[action] !== undefined;
}

/** The matrix's next status for a legal transition, else undefined. */
export function nextStatus(from: PlanStatus, action: ScheduleAction): PlanStatus | undefined {
  return LEGAL_TRANSITIONS[from]?.[action];
}

/** All actions that are legal from a status, in canonical action order
 *  (useful for matrix tests and introspection). */
export function legalActionsFrom(from: PlanStatus): ScheduleAction[] {
  const all: ScheduleAction[] = [
    "HOLD",
    "CONTINUE",
    "QUEUE",
    "SUGGEST",
    "SWITCH",
    "INTERRUPT",
    "RESUME",
    "END",
  ];
  return all.filter((action) => isLegalTransition(from, action));
}

/**
 * Structural well-formedness of a plan state (typed issues, never
 * throws). Rules:
 * - status is a known PlanStatus;
 * - `playing` ⇒ currentExperienceId present;
 * - `queued` ⇒ queue non-empty;
 * - `interrupted` ⇒ interruptedExperienceId present;
 * - ids are valid contract Ids; checkpoints are schema-valid.
 */
export function planStateIssues(state: unknown): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (state === null || typeof state !== "object") {
    return [{ path: "currentState", message: "must be an object" }];
  }
  const s = state as Record<string, unknown>;
  if (typeof s["status"] !== "string" || !PLAN_STATUSES.includes(s["status"] as PlanStatus)) {
    issues.push({ path: "currentState.status", message: `must be one of ${PLAN_STATUSES.join(", ")}` });
    return issues;
  }
  const status = s["status"] as PlanStatus;
  if (s["currentExperienceId"] !== undefined) {
    const parsed = IdSchema.safeParse(s["currentExperienceId"]);
    if (!parsed.success) {
      issues.push({ path: "currentState.currentExperienceId", message: "must be a valid id" });
    }
  }
  if (s["interruptedExperienceId"] !== undefined) {
    const parsed = IdSchema.safeParse(s["interruptedExperienceId"]);
    if (!parsed.success) {
      issues.push({ path: "currentState.interruptedExperienceId", message: "must be a valid id" });
    }
  }
  if (!Array.isArray(s["queue"])) {
    issues.push({ path: "currentState.queue", message: "must be an array of ids" });
  } else {
    for (let i = 0; i < s["queue"].length; i++) {
      const parsed = IdSchema.safeParse(s["queue"][i]);
      if (!parsed.success) {
        issues.push({ path: `currentState.queue[${i}]`, message: "must be a valid id" });
      }
    }
    if (status === "queued" && s["queue"].length === 0) {
      issues.push({ path: "currentState.queue", message: "must be non-empty when status is queued" });
    }
  }
  if (!Array.isArray(s["resumeCheckpoints"])) {
    issues.push({ path: "currentState.resumeCheckpoints", message: "must be an array" });
  } else {
    for (let i = 0; i < s["resumeCheckpoints"].length; i++) {
      const parsed = ResumeCheckpointSchema.safeParse(s["resumeCheckpoints"][i]);
      if (!parsed.success) {
        issues.push({
          path: `currentState.resumeCheckpoints[${i}]`,
          message: parsed.error.issues.map((x) => x.message).join("; "),
        });
      }
    }
  }
  if (status === "playing" && s["currentExperienceId"] === undefined) {
    issues.push({
      path: "currentState.currentExperienceId",
      message: "required when status is playing",
    });
  }
  if (status === "interrupted" && s["interruptedExperienceId"] === undefined) {
    issues.push({
      path: "currentState.interruptedExperienceId",
      message: "required when status is interrupted",
    });
  }
  return issues;
}
