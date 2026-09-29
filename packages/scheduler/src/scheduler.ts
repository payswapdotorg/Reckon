/**
 * W2-004 — the scheduler.
 *
 * SCHEDULER-ACTION LAW (lock #11): the scheduler emits exactly
 * HOLD / CONTINUE / QUEUE / SUGGEST / SWITCH / INTERRUPT / RESUME / END;
 * every emission is validated against LEGAL_TRANSITIONS and logged as a
 * transition record before it is returned.
 *
 * SEPARATION LAW (lock #9): ranking never interrupts. The scheduler only
 * ever emits SWITCH/SUGGEST-from-switching when the caller supplied an
 * explicit switch evaluation (all numbers caller-supplied) whose net
 * value clears the thresholds. Without switch input, a playing plan
 * CONTINUEs no matter how highly-scored the candidates are.
 *
 * RESUME LAW (lock #12): every SWITCH/INTERRUPT records a resume
 * checkpoint slot. The resume token is caller-supplied (never invented);
 * a full contract `ResumeCheckpoint` is additionally appended to the
 * next plan state (and the schedule delta) only when BOTH a token and a
 * caller-supplied timestamp (`request.at`) are available — timestamps
 * are never invented either.
 *
 * Deterministic core policy (documented; NO LLM anywhere):
 * - ended → typed ILLEGAL_TRANSITION error (terminal state);
 * - endRequested → END (host-driven);
 * - playing:
 *     interruptRequested → INTERRUPT (host-driven);
 *     switch input present → SwitchEvaluator verdict:
 *        SWITCH → SWITCH(to the evaluated candidate) — UNLESS a
 *                 caller-supplied opportunity evaluation says there is
 *                 no interruption opportunity right now (W2-005): the
 *                 verdict is gated to CONTINUE (a bad moment is not
 *                 worth a net-positive switch);
 *        SUGGEST → SUGGEST(the evaluated candidate) — never gated
 *                  (suggestions are non-binding, they never interrupt);
 *        HOLD   → CONTINUE (keep the current experience);
 *     no switch input → CONTINUE;
 * - interrupted:
 *     switch verdict SWITCH (not gated) → SWITCH(to the candidate);
 *     switch verdict SWITCH (gated) → the resume/hold path (returning
 *                 the subject to their own interrupted experience beats
 *                 switching at a bad moment);
 *     otherwise resumable checkpoint → RESUME;
 *     otherwise → HOLD;
 * - idle/queued:
 *     scored candidates present:
 *        mindful attention policy → SUGGEST(best) (never auto-start);
 *        best not already queued → QUEUE(best);
 *        status queued → CONTINUE (proceed with the queue head);
 *        otherwise → HOLD;
 *     no candidates: queued + non-mindful → CONTINUE; else HOLD.
 */
import {
  contentDigest,
  DecisionRequestSchema,
  ExperienceSchema,
  type DecisionRequest,
  type Experience,
  type Id,
  type ResumeCheckpoint,
  type ScheduleAction,
  type ScheduleDelta,
} from "@reckon/contracts";
// Type-only cross-package import (W2-004 depends on W2-001 per the
// dependency graph). Erased at runtime; no package.json/lockfile change.
import type { ScoredExperience } from "../../decision/src/index.js";
import type { Result } from "./errors.js";
import { illegalTransition, invalidInput } from "./errors.js";
import {
  isLegalTransition,
  nextStatus,
  planStateIssues,
  type PlanState,
  type PlanStatus,
} from "./state.js";
import {
  evaluateSwitch,
  type SwitchEvaluationInput,
} from "./switch-evaluator.js";
import type { InterruptionOpportunityResult } from "./interruption-policy.js";

export type { ScoredExperience };
export type { InterruptionOpportunityResult };

export interface SchedulerInput {
  /** Observed plan state (caller-supplied). */
  currentState: PlanState;
  /** The decision request (contract-validated). */
  request: DecisionRequest;
  /** Scored ELIGIBLE experiences (policy output, caller-supplied here). */
  scored: ScoredExperience[];
  /**
   * Caller-supplied switch evaluation for ONE candidate (SEPARATION
   * LAW: all numbers explicit; absent ⇒ the scheduler never switches).
   * The candidate must be present in `scored`.
   */
  switch?: SwitchEvaluationInput;
  /**
   * Caller-supplied interruption-opportunity evaluation (W2-005,
   * composition — the frozen contract schemas are unchanged). Present
   * with `opportunity: false` ⇒ SWITCH verdicts are gated: the moment
   * is not suitable for interrupting (CONTINUE from `playing`, the
   * resume/hold path from `interrupted`). SUGGEST is never gated (a
   * suggestion is non-binding and does not interrupt). Absent ⇒ the
   * W2-004 behavior is unchanged. The switch numbers remain
   * caller-supplied (SEPARATION LAW) — the scheduler never derives
   * them from the opportunity.
   */
  opportunity?: InterruptionOpportunityResult;
  /** Caller-supplied resume tokens by experienceId (never invented). */
  resumeTokens?: Record<string, string>;
  /** Host explicitly requests ending the plan (drives END). */
  endRequested?: boolean;
  /** Host explicitly requests interrupting the current experience. */
  interruptRequested?: boolean;
}

/** Resume checkpoint SLOT — always recorded on SWITCH/INTERRUPT (the
 *  token is caller-supplied or null; NEVER invented). */
export interface ResumeCheckpointSlot {
  experienceId: Id;
  resumeToken: string | null;
  source: "SWITCH" | "INTERRUPT";
}

/** Validated transition record (lock #11: every transition validated
 *  and logged). Deterministic id derived from the transition content. */
export interface TransitionRecord {
  fromStatus: PlanStatus;
  action: ScheduleAction;
  toStatus: PlanStatus;
  legal: true;
  transitionId: string;
  /** Caller-supplied timestamp passthrough (never invented). */
  at?: number;
}

export interface SchedulerDecision {
  action: ScheduleAction;
  /** The selected experience, when one is chosen from `scored`. */
  selectedExperience?: Experience;
  /** The targeted experience id (also set for CONTINUE-from-queue head
   *  and RESUME targets when the full experience is not in `scored`). */
  selectedExperienceId?: Id;
  /** The plan state after applying the action. */
  nextState: PlanState;
  /** The validated + logged transition record. */
  transition: TransitionRecord;
  /** Resume checkpoint slot (present on every SWITCH/INTERRUPT). */
  resumeCheckpointSlot?: ResumeCheckpointSlot;
  /** Resume details (present on RESUME, from the chosen checkpoint). */
  resume?: { experienceId: Id; resumeToken: string; position: Record<string, unknown> };
  /** Contract-shaped schedule delta. */
  scheduleDelta: ScheduleDelta;
  /** Deterministic, host-readable reasons. */
  reasons: { code: string; message: string }[];
}

export interface Scheduler {
  decide(input: SchedulerInput): Result<SchedulerDecision>;
}

const ALL_ACTIONS: ScheduleAction[] = [
  "HOLD",
  "CONTINUE",
  "QUEUE",
  "SUGGEST",
  "SWITCH",
  "INTERRUPT",
  "RESUME",
  "END",
];

function compareScored(a: ScoredExperience, b: ScoredExperience): number {
  if (a.score !== b.score) return b.score - a.score;
  const idA = a.experience.experienceId;
  const idB = b.experience.experienceId;
  return idA < idB ? -1 : idA > idB ? 1 : 0;
}

function copyState(state: PlanState): PlanState {
  return {
    status: state.status,
    ...(state.currentExperienceId !== undefined ? { currentExperienceId: state.currentExperienceId } : {}),
    ...(state.interruptedExperienceId !== undefined
      ? { interruptedExperienceId: state.interruptedExperienceId }
      : {}),
    queue: [...state.queue],
    resumeCheckpoints: [...state.resumeCheckpoints],
  };
}

function transitionIdFor(
  from: PlanStatus,
  action: ScheduleAction,
  to: PlanStatus,
  selectedExperienceId: Id | null,
  at: number | null,
): string {
  const digest = contentDigest({
    from,
    action,
    to,
    selectedExperienceId,
    at,
  });
  return `tr-${digest.slice(0, 16)}`;
}

/** Pure, total, deterministic scheduling decision. */
export function decide(input: SchedulerInput): Result<SchedulerDecision> {
  if (input === null || typeof input !== "object") {
    return invalidInput("decide: input must be an object");
  }
  const issues: { path: string; message: string }[] = [];

  // 1. Validate the request against the frozen contract.
  const parsedRequest = DecisionRequestSchema.safeParse(input.request);
  if (!parsedRequest.success) {
    issues.push(
      ...parsedRequest.error.issues.map((i) => ({ path: `request.${i.path.join(".")}`, message: i.message })),
    );
  }

  // 2. Validate plan-state well-formedness.
  issues.push(...planStateIssues(input.currentState));

  // 3. Validate scored experiences.
  if (!Array.isArray(input.scored)) {
    issues.push({ path: "scored", message: "must be an array" });
  } else {
    input.scored.forEach((entry, index) => {
      const path = `scored[${index}]`;
      if (entry === null || typeof entry !== "object") {
        issues.push({ path, message: "must be an object" });
        return;
      }
      if (typeof entry.score !== "number" || !Number.isFinite(entry.score)) {
        issues.push({ path: `${path}.score`, message: "must be a finite number" });
      }
      const parsedExperience = ExperienceSchema.safeParse(entry.experience);
      if (!parsedExperience.success) {
        issues.push({
          path: `${path}.experience`,
          message: parsedExperience.error.issues.map((x) => x.message).join("; "),
        });
      }
    });
  }

  if (issues.length > 0) {
    return invalidInput("decide: invalid input", issues);
  }

  const request = parsedRequest.success ? parsedRequest.data : (undefined as never);
  const state = input.currentState;
  const scored = [...(input.scored as ScoredExperience[])].sort(compareScored);

  // 4. Request/state consistency (fail-closed on contradictions).
  const activeId = state.status === "playing" ? state.currentExperienceId : undefined;
  const interruptedId = state.status === "interrupted" ? state.interruptedExperienceId : undefined;
  const requestCurrentId = request.currentExperience?.experienceId;
  if (requestCurrentId !== undefined) {
    if (activeId !== undefined && requestCurrentId !== activeId) {
      return invalidInput(
        `decide: request.currentExperience ${requestCurrentId} does not match plan state current ${activeId}`,
      );
    }
    if (interruptedId !== undefined && requestCurrentId !== interruptedId) {
      return invalidInput(
        `decide: request.currentExperience ${requestCurrentId} does not match plan state interrupted ${interruptedId}`,
      );
    }
    if (activeId === undefined && interruptedId === undefined) {
      return invalidInput(
        "decide: request.currentExperience supplied but the plan state has no active or interrupted experience",
      );
    }
  }

  // 5. Validate optional caller-supplied inputs.
  if (input.resumeTokens !== undefined) {
    if (input.resumeTokens === null || typeof input.resumeTokens !== "object") {
      return invalidInput("decide: resumeTokens must be an object");
    }
    for (const [experienceId, token] of Object.entries(input.resumeTokens)) {
      if (typeof token !== "string" || token.length < 1 || token.length > 1024) {
        return invalidInput(`decide: resumeTokens[${experienceId}] must be a non-empty string (max 1024)`);
      }
    }
  }

  const switchInput = input.switch;
  if (switchInput !== undefined) {
    if (activeId === undefined && interruptedId === undefined) {
      return invalidInput(
        "decide: switch evaluation supplied but the plan state has no active or interrupted experience",
      );
    }
    const expectedCurrent = (activeId ?? interruptedId) as Id;
    if (switchInput.currentExperienceId !== expectedCurrent) {
      return invalidInput(
        `decide: switch.currentExperienceId ${switchInput.currentExperienceId} does not match plan state ${expectedCurrent}`,
      );
    }
    if (!scored.some((s) => s.experience.experienceId === switchInput.candidateExperienceId)) {
      return invalidInput(
        `decide: switch.candidateExperienceId ${switchInput.candidateExperienceId} not present in scored experiences`,
      );
    }
  }

  // 5b. Validate the optional caller-supplied opportunity evaluation
  // (W2-005 composition; the scheduler never fabricates one).
  if (input.opportunity !== undefined) {
    const opportunity = input.opportunity;
    if (
      opportunity === null ||
      typeof opportunity !== "object" ||
      typeof opportunity.opportunity !== "boolean"
    ) {
      return invalidInput("decide: opportunity must be { opportunity: boolean, reasons, urgency }");
    }
    if (
      typeof opportunity.urgency !== "number" ||
      !Number.isFinite(opportunity.urgency) ||
      opportunity.urgency < 0 ||
      opportunity.urgency > 1
    ) {
      return invalidInput("decide: opportunity.urgency must be a finite number in [0, 1]", [
        { path: "opportunity.urgency", message: `got ${String(opportunity.urgency)}` },
      ]);
    }
    if (
      !Array.isArray(opportunity.reasons) ||
      opportunity.reasons.some(
        (r) => r === null || typeof r !== "object" || typeof r.code !== "string" || typeof r.message !== "string",
      )
    ) {
      return invalidInput("decide: opportunity.reasons must be an array of { code, message }");
    }
    // A gated moment with no switch evaluation (and no host request) is
    // informational only: the core policy below has nothing to gate, so
    // the decision is unchanged.
  }

  // 6. Terminal state: no legal actions exist from `ended`.
  if (state.status === "ended") {
    return illegalTransition(
      "ended",
      "HOLD",
      "decide: plan is ended (terminal state); no actions are legal",
    );
  }

  // 7. Deterministic core policy.
  type Chosen =
    | { action: "HOLD" }
    | { action: "CONTINUE" }
    | { action: "QUEUE"; target: ScoredExperience }
    | { action: "SUGGEST"; target: ScoredExperience }
    | { action: "SWITCH"; target: ScoredExperience }
    | { action: "INTERRUPT" }
    | { action: "RESUME"; checkpoint: ResumeCheckpoint }
    | { action: "END" };

  let chosen: Chosen;
  const reasons: { code: string; message: string }[] = [];

  if (input.endRequested === true) {
    chosen = { action: "END" };
    reasons.push({ code: "end-requested", message: "host requested plan end" });
  } else if (state.status === "playing") {
    if (input.interruptRequested === true) {
      chosen = { action: "INTERRUPT" };
      reasons.push({ code: "interrupt-requested", message: "host requested interruption" });
    } else if (switchInput) {
      const evaluation = evaluateSwitch(switchInput);
      if (!evaluation.ok) return evaluation;
      const target = scored.find(
        (s) => s.experience.experienceId === switchInput.candidateExperienceId,
      ) as ScoredExperience;
      const suppliedOpportunity = input.opportunity;
      const gated = suppliedOpportunity !== undefined && suppliedOpportunity.opportunity === false;
      if (evaluation.value.verdict === "SWITCH" && gated) {
        // W2-005: no interruption opportunity — a net-positive switch is
        // NOT worth a bad moment; keep the current experience. (The
        // switch numbers remain caller-supplied; only the moment is
        // gated here.)
        chosen = { action: "CONTINUE" };
        reasons.push({
          code: "switch-gated-no-opportunity",
          message: "switch verdict SWITCH gated: the interruption-opportunity policy reports no opportunity right now",
        });
        reasons.push(
          ...(suppliedOpportunity as InterruptionOpportunityResult).reasons.map((r) => ({
            code: `opportunity-${r.code}`,
            message: r.message,
          })),
        );
      } else if (evaluation.value.verdict === "SWITCH") {
        chosen = { action: "SWITCH", target };
        reasons.push({
          code: "switch-net-positive",
          message: `net ${evaluation.value.netValue} > switchThreshold ${evaluation.value.thresholds.switchThreshold}`,
        });
        if (suppliedOpportunity !== undefined && suppliedOpportunity.opportunity) {
          reasons.push({
            code: "interruption-opportunity",
            message: `interruption opportunity present (urgency ${suppliedOpportunity.urgency})`,
          });
        }
      } else if (evaluation.value.verdict === "SUGGEST") {
        // SUGGEST is never gated: a suggestion is non-binding and does
        // not interrupt the current experience.
        chosen = { action: "SUGGEST", target };
        reasons.push({
          code: "switch-suggest-band",
          message: `net ${evaluation.value.netValue} within [suggestThreshold ${evaluation.value.thresholds.suggestThreshold}, switchThreshold ${evaluation.value.thresholds.switchThreshold}]`,
        });
      } else {
        chosen = { action: "CONTINUE" };
        reasons.push({
          code: "switch-below-threshold",
          message: `net ${evaluation.value.netValue} < suggestThreshold ${evaluation.value.thresholds.suggestThreshold}; keeping current experience`,
        });
      }
    } else {
      // SEPARATION LAW: no explicit switch evaluation ⇒ never switch,
      // no matter how highly-scored the candidates are.
      chosen = { action: "CONTINUE" };
      reasons.push({ code: "no-switch-input", message: "no switch evaluation supplied; continuing current experience" });
    }
  } else if (state.status === "interrupted") {
    if (switchInput) {
      const evaluation = evaluateSwitch(switchInput);
      if (!evaluation.ok) return evaluation;
      const suppliedOpportunity = input.opportunity;
      const gated = suppliedOpportunity !== undefined && suppliedOpportunity.opportunity === false;
      if (evaluation.value.verdict === "SWITCH" && !gated) {
        const target = scored.find(
          (s) => s.experience.experienceId === switchInput.candidateExperienceId,
        ) as ScoredExperience;
        chosen = { action: "SWITCH", target };
        reasons.push({
          code: "switch-net-positive",
          message: `net ${evaluation.value.netValue} > switchThreshold ${evaluation.value.thresholds.switchThreshold}`,
        });
      } else if (evaluation.value.verdict === "SWITCH" && gated) {
        // W2-005: no opportunity — prefer returning the subject to their
        // own interrupted experience over switching at a bad moment.
        chosen = resumeOrHold(state, reasons);
        reasons.push({
          code: "switch-gated-no-opportunity",
          message: "switch verdict SWITCH gated: the interruption-opportunity policy reports no opportunity right now",
        });
        reasons.push(
          ...(suppliedOpportunity as InterruptionOpportunityResult).reasons.map((r) => ({
            code: `opportunity-${r.code}`,
            message: r.message,
          })),
        );
      } else {
        chosen = resumeOrHold(state, reasons);
      }
    } else {
      chosen = resumeOrHold(state, reasons);
    }
  } else {
    // idle | queued — nothing is playing.
    const mindful = request.attentionPolicy.style === "mindful";
    if (state.resumeCheckpoints.length > 0) {
      // Continuity: an interrupted experience is resumable — resuming
      // returns the subject to their own prior state (not a new
      // attention-consuming action), so this precedes queueing.
      chosen = resumeOrHold(state, reasons);
    } else if (mindful && scored.length > 0) {
      chosen = { action: "SUGGEST", target: scored[0] };
      reasons.push({
        code: "mindful-suggest",
        message: "mindful attention policy: suggesting the best candidate instead of auto-starting",
      });
    } else if (scored.length > 0) {
      const best = scored[0];
      if (!state.queue.includes(best.experience.experienceId)) {
        chosen = { action: "QUEUE", target: best };
        reasons.push({ code: "queue-best", message: "queueing the best scored candidate" });
      } else if (state.status === "queued") {
        chosen = { action: "CONTINUE" };
        reasons.push({ code: "continue-queue-head", message: "best candidate already queued; proceeding with queue head" });
      } else {
        chosen = { action: "HOLD" };
        reasons.push({ code: "hold-nothing-new", message: "nothing new to queue" });
      }
    } else if (state.status === "queued" && !mindful) {
      chosen = { action: "CONTINUE" };
      reasons.push({ code: "continue-queue-head", message: "proceeding with queue head" });
    } else if (state.status === "queued") {
      chosen = { action: "HOLD" };
      reasons.push({
        code: "mindful-hold",
        message: "mindful attention policy: holding the primed queue instead of auto-continuing",
      });
    } else {
      chosen = { action: "HOLD" };
      reasons.push({ code: "hold-no-candidates", message: "no scored candidates and nothing queued" });
    }
  }

  // 8. Apply the chosen action.
  const at = request.at;
  const resumeTokens = input.resumeTokens ?? {};
  const deltaBase = { ...(request.planId !== undefined ? { planId: request.planId } : {}) };

  let action: ScheduleAction;
  let nextState: PlanState;
  let selectedExperience: Experience | undefined;
  let selectedExperienceId: Id | undefined;
  let resumeCheckpointSlot: ResumeCheckpointSlot | undefined;
  let resume: SchedulerDecision["resume"];
  let scheduleDelta: ScheduleDelta;

  switch (chosen.action) {
    case "HOLD": {
      action = "HOLD";
      nextState = copyState(state);
      scheduleDelta = { action, enqueue: [], dequeue: [] };
      break;
    }
    case "CONTINUE": {
      action = "CONTINUE";
      if (state.status === "queued") {
        const head = state.queue[0] as Id;
        selectedExperienceId = head;
        selectedExperience = scored.find((s) => s.experience.experienceId === head)?.experience;
        nextState = {
          status: "playing",
          currentExperienceId: head,
          queue: state.queue.slice(1),
          resumeCheckpoints: [...state.resumeCheckpoints],
        };
        scheduleDelta = { action, enqueue: [], dequeue: [head] };
      } else {
        selectedExperienceId = state.currentExperienceId;
        selectedExperience = request.currentExperience;
        nextState = copyState(state);
        scheduleDelta = { action, enqueue: [], dequeue: [] };
      }
      break;
    }
    case "QUEUE": {
      action = "QUEUE";
      const target = chosen.target;
      selectedExperience = target.experience;
      selectedExperienceId = target.experience.experienceId;
      const enqueueId = target.experience.experienceId;
      nextState = {
        status: state.status === "idle" ? "queued" : state.status,
        ...(state.currentExperienceId !== undefined
          ? { currentExperienceId: state.currentExperienceId }
          : {}),
        ...(state.interruptedExperienceId !== undefined
          ? { interruptedExperienceId: state.interruptedExperienceId }
          : {}),
        queue: [...state.queue, enqueueId],
        resumeCheckpoints: [...state.resumeCheckpoints],
      };
      scheduleDelta = { action, enqueue: [enqueueId], dequeue: [] };
      break;
    }
    case "SUGGEST": {
      action = "SUGGEST";
      const target = chosen.target;
      selectedExperience = target.experience;
      selectedExperienceId = target.experience.experienceId;
      nextState = copyState(state);
      scheduleDelta = { action, enqueue: [], dequeue: [] };
      break;
    }
    case "SWITCH": {
      action = "SWITCH";
      const target = chosen.target;
      selectedExperience = target.experience;
      selectedExperienceId = target.experience.experienceId;
      const awayId = (activeId ?? interruptedId) as Id;
      resumeCheckpointSlot = buildSlot(awayId, "SWITCH", resumeTokens, state);
      nextState = {
        status: "playing",
        currentExperienceId: target.experience.experienceId,
        queue: [...state.queue],
        resumeCheckpoints: appendCheckpoint(resumeCheckpointSlot, state, at, reasons),
      };
      scheduleDelta = {
        action,
        ...deltaBase,
        enqueue: [],
        dequeue: [],
        ...(resumeCheckpointForDelta(resumeCheckpointSlot, at) !== undefined
          ? { resumeCheckpoint: resumeCheckpointForDelta(resumeCheckpointSlot, at) }
          : {}),
      };
      break;
    }
    case "INTERRUPT": {
      action = "INTERRUPT";
      const awayId = activeId as Id;
      resumeCheckpointSlot = buildSlot(awayId, "INTERRUPT", resumeTokens, state);
      selectedExperienceId = awayId;
      selectedExperience = request.currentExperience;
      nextState = {
        status: "interrupted",
        interruptedExperienceId: awayId,
        queue: [...state.queue],
        resumeCheckpoints: appendCheckpoint(resumeCheckpointSlot, state, at, reasons),
      };
      scheduleDelta = {
        action,
        ...deltaBase,
        enqueue: [],
        dequeue: [],
        ...(resumeCheckpointForDelta(resumeCheckpointSlot, at) !== undefined
          ? { resumeCheckpoint: resumeCheckpointForDelta(resumeCheckpointSlot, at) }
          : {}),
      };
      break;
    }
    case "RESUME": {
      action = "RESUME";
      const checkpoint = chosen.checkpoint;
      selectedExperienceId = checkpoint.experienceId;
      selectedExperience = scored.find((s) => s.experience.experienceId === checkpoint.experienceId)?.experience;
      resume = {
        experienceId: checkpoint.experienceId,
        resumeToken: checkpoint.resumeToken,
        position: checkpoint.position,
      };
      nextState = {
        status: "playing",
        currentExperienceId: checkpoint.experienceId,
        queue: [...state.queue],
        resumeCheckpoints: [...state.resumeCheckpoints],
      };
      scheduleDelta = { action, enqueue: [], dequeue: [] };
      reasons.push({ code: "resume-from-checkpoint", message: `resuming ${checkpoint.experienceId}` });
      break;
    }
    case "END": {
      action = "END";
      nextState = { ...copyState(state), status: "ended" };
      scheduleDelta = { action, enqueue: [], dequeue: [] };
      break;
    }
  }

  // 9. Validate the transition against the matrix (fail-closed).
  if (!isLegalTransition(state.status, action)) {
    return illegalTransition(state.status, action, "decide: internal error — policy produced an illegal transition");
  }
  const matrixNext = nextStatus(state.status, action);
  if (nextState.status !== matrixNext) {
    return invalidInput(
      `decide: internal error — computed next status ${nextState.status} != matrix status ${matrixNext}`,
    );
  }

  const transition: TransitionRecord = {
    fromStatus: state.status,
    action,
    toStatus: nextState.status,
    legal: true,
    transitionId: transitionIdFor(
      state.status,
      action,
      nextState.status,
      selectedExperienceId ?? null,
      at ?? null,
    ),
    ...(at !== undefined ? { at } : {}),
  };

  const decision: SchedulerDecision = {
    action,
    ...(selectedExperience !== undefined ? { selectedExperience } : {}),
    ...(selectedExperienceId !== undefined ? { selectedExperienceId } : {}),
    nextState,
    transition,
    ...(resumeCheckpointSlot !== undefined ? { resumeCheckpointSlot } : {}),
    ...(resume !== undefined ? { resume } : {}),
    scheduleDelta,
    reasons,
  };
  return { ok: true, value: decision };
}

/** From `interrupted`: RESUME the most recent checkpoint for the
 *  interrupted experience, else the most recent checkpoint overall,
 *  else HOLD. Deterministic. */
function resumeOrHold(
  state: PlanState,
  reasons: { code: string; message: string }[],
): { action: "RESUME"; checkpoint: ResumeCheckpoint } | { action: "HOLD" } {
  const checkpoints = state.resumeCheckpoints;
  if (checkpoints.length === 0) {
    reasons.push({ code: "hold-no-checkpoint", message: "interrupted with no resume checkpoint; holding" });
    return { action: "HOLD" };
  }
  const interruptedId = state.interruptedExperienceId;
  let checkpoint: ResumeCheckpoint | undefined;
  if (interruptedId !== undefined) {
    for (let i = checkpoints.length - 1; i >= 0; i--) {
      if (checkpoints[i].experienceId === interruptedId) {
        checkpoint = checkpoints[i];
        break;
      }
    }
  }
  if (checkpoint === undefined) {
    checkpoint = checkpoints[checkpoints.length - 1];
  }
  reasons.push({ code: "resume-default", message: `resuming interrupted experience ${checkpoint.experienceId}` });
  return { action: "RESUME", checkpoint };
}

/** Build the resume checkpoint SLOT (token caller-supplied or null —
 *  never invented; an existing checkpoint's token is legitimate
 *  caller-supplied data and may be reused). */
function buildSlot(
  awayId: Id,
  source: "SWITCH" | "INTERRUPT",
  resumeTokens: Record<string, string>,
  state: PlanState,
): ResumeCheckpointSlot {
  const supplied = resumeTokens[awayId];
  if (supplied !== undefined) {
    return { experienceId: awayId, resumeToken: supplied, source };
  }
  const existing = state.resumeCheckpoints.find((c) => c.experienceId === awayId);
  if (existing !== undefined) {
    return { experienceId: awayId, resumeToken: existing.resumeToken, source };
  }
  return { experienceId: awayId, resumeToken: null, source };
}

/** Append a full contract checkpoint to the next state when BOTH a
 *  caller-supplied token and a caller-supplied timestamp exist
 *  (timestamps are never invented). Duplicate checkpoints for the same
 *  experience are not appended. */
function appendCheckpoint(
  slot: ResumeCheckpointSlot,
  state: PlanState,
  at: number | undefined,
  reasons: { code: string; message: string }[],
): ResumeCheckpoint[] {
  if (slot.resumeToken === null) {
    reasons.push({
      code: "resume-token-not-supplied",
      message: `checkpoint slot recorded for ${slot.experienceId}; no caller-supplied resume token (never invented)`,
    });
    return [...state.resumeCheckpoints];
  }
  if (at === undefined) {
    reasons.push({
      code: "resume-timestamp-not-supplied",
      message: "caller-supplied timestamp (request.at) missing; checkpoint not materialized (timestamps never invented)",
    });
    return [...state.resumeCheckpoints];
  }
  if (state.resumeCheckpoints.some((c) => c.experienceId === slot.experienceId)) {
    reasons.push({
      code: "resume-checkpoint-already-present",
      message: `checkpoint for ${slot.experienceId} already exists; not duplicated`,
    });
    return [...state.resumeCheckpoints];
  }
  reasons.push({
    code: "resume-checkpoint-recorded",
    message: `checkpoint recorded for ${slot.experienceId}`,
  });
  return [
    ...state.resumeCheckpoints,
    {
      experienceId: slot.experienceId,
      resumeToken: slot.resumeToken,
      position: {},
      savedAt: at,
    },
  ];
}

/** The contract-shaped checkpoint for the schedule delta — only when
 *  fully materializable (token + timestamp). */
function resumeCheckpointForDelta(
  slot: ResumeCheckpointSlot,
  at: number | undefined,
): { experienceId: Id; resumeToken: string } | undefined {
  if (slot.resumeToken === null || at === undefined) return undefined;
  return { experienceId: slot.experienceId, resumeToken: slot.resumeToken };
}

/** Factory for the stateless scheduler port. */
export function createScheduler(): Scheduler {
  return { decide };
}

export { ALL_ACTIONS };
