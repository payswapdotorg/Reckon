/**
 * Scheduler view model (UI-006) — pure mapping from the DecisionResult
 * contract to the scheduler/interruption reading order (FINAL TL HANDOFF
 * §11).
 *
 * THE PRODUCT TRUTH this workspace exists to expose: RANKING ≠ PERMISSION
 * TO INTERRUPT. A better-ranked candidate does not automatically interrupt
 * the current experience — the action ladder says what was actually
 * chosen, and the score breakdown shows only what the contract carries.
 *
 * Dependency-free, React-free (root NodeNext typecheck + unit tests).
 * HONESTY LAW (Gate Q): absent contract fields surface as explicit
 * "not provided by the contract" rows — never computed, never invented
 * (no derived net-switching-value arithmetic).
 */
import type { DecisionResult, ScheduleAction } from "@reckon/sdk";

/** Local structural mirror of the contract Uncertainty (frozen shape). */
interface Uncertainty {
  readonly confidence?: number;
  readonly spread?: number;
  readonly disagreement?: number;
  readonly oodScore?: number;
  readonly method?: string;
}

export const ACTION_LADDER: readonly ScheduleAction[] = [
  "HOLD",
  "CONTINUE",
  "QUEUE",
  "SUGGEST",
  "SWITCH",
  "INTERRUPT",
  "RESUME",
  "END",
];

export const ACTION_MEANINGS: Readonly<Record<ScheduleAction, string>> = {
  HOLD: "Do nothing now — the current experience stays; no queue change.",
  CONTINUE: "Keep presenting the current experience.",
  QUEUE: "Add the candidate to the plan queue without displacing anything.",
  SUGGEST: "Surface the candidate as a suggestion — the host decides.",
  SWITCH: "Replace the current experience with the selected candidate.",
  INTERRUPT: "Break the current experience at a permitted boundary.",
  RESUME: "Return to a saved resume checkpoint.",
  END: "Conclude the current experience (no successor selected).",
};

export interface LadderStep {
  readonly action: ScheduleAction;
  readonly meaning: string;
  readonly chosen: boolean;
}

export interface ScoreRow {
  readonly experienceId: string;
  readonly score: number | null;
  readonly uncertainty: Uncertainty | null;
  readonly reason: string | null;
  readonly excludedBy: string | null;
}

export interface ConsequenceRow {
  readonly label: string;
  readonly value: string;
}

export interface SchedulerView {
  readonly ladder: readonly LadderStep[];
  readonly scores: readonly ScoreRow[];
  readonly consequences: readonly ConsequenceRow[];
  readonly policy: { readonly policyId: string; readonly version: string };
  readonly reasons: readonly { code: string; message: string }[];
}

function uncertaintyCells(u: Uncertainty | null): string[] {
  if (u === null) return [];
  const cells: string[] = [];
  if (u.confidence !== undefined) cells.push(`confidence ${u.confidence.toFixed(3)}`);
  if (u.spread !== undefined) cells.push(`spread ${u.spread.toFixed(3)}`);
  if (u.disagreement !== undefined) cells.push(`disagreement ${u.disagreement.toFixed(3)}`);
  if (u.oodScore !== undefined) cells.push(`OOD ${u.oodScore.toFixed(3)}`);
  if (u.method !== undefined) cells.push(`method ${u.method}`);
  return cells;
}

/** Map one decision to the §11 scheduler view. */
export function schedulerView(decision: DecisionResult): SchedulerView {
  const ladder: LadderStep[] = ACTION_LADDER.map((action) => ({
    action,
    meaning: ACTION_MEANINGS[action],
    chosen: action === decision.action,
  }));

  const scores: ScoreRow[] = decision.alternatives.map((alt) => ({
    experienceId: alt.experienceId,
    score: alt.score ?? null,
    uncertainty: alt.uncertainty ?? null,
    reason: alt.reason ?? null,
    excludedBy: alt.excludedBy ?? null,
  }));

  const consequences: ConsequenceRow[] = [];
  const delta = decision.scheduleDelta;
  if (delta === undefined) {
    consequences.push({
      label: "schedule delta",
      value: "not provided by the contract for this decision",
    });
  } else {
    consequences.push({
      label: "delta action",
      value: delta.action,
    });
    if (delta.planId !== undefined) consequences.push({ label: "plan", value: delta.planId });
    consequences.push({ label: "enqueued", value: String(delta.enqueue.length) });
    consequences.push({ label: "dequeued", value: String(delta.dequeue.length) });
    if (delta.resumeCheckpoint !== undefined) {
      consequences.push({
        label: "resume checkpoint",
        value: delta.resumeCheckpoint.experienceId,
      });
    }
  }
  if (decision.latency?.latencyMsP50 !== undefined) {
    consequences.push({
      label: "decision latency p50",
      value: `${decision.latency.latencyMsP50.toFixed(1)} ms`,
    });
  }
  if (decision.latency?.latencyMsP95 !== undefined) {
    consequences.push({
      label: "decision latency p95",
      value: `${decision.latency.latencyMsP95.toFixed(1)} ms`,
    });
  }

  return {
    ladder,
    scores,
    consequences,
    policy: { policyId: decision.policy.policyId, version: decision.policy.version },
    reasons: decision.reasons.map((r) => ({ code: r.code, message: r.message })),
  };
}

/** Honest cells for the score table (nulls stay visible as gaps). */
export function scoreRowCells(row: ScoreRow): {
  score: string;
  uncertainty: string;
  reason: string;
  excludedBy: string;
} {
  return {
    score: row.score === null ? "—" : row.score.toFixed(3),
    uncertainty: uncertaintyCells(row.uncertainty).join(" · ") || "—",
    reason: row.reason ?? "—",
    excludedBy: row.excludedBy ?? "—",
  };
}
