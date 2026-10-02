/**
 * Plan view model (UI-005) — pure mapping from the ExperiencePlan contract
 * to the rolling-timeline reading order (FINAL TL HANDOFF §10).
 *
 * Dependency-free and React-free so it typechecks under the root NodeNext
 * config and is unit-testable without a server. The mapping NEVER invents
 * data: stages the contract does not carry render as explicitly-absent
 * (the OPPORTUNITY stage has no contract field today — that honesty is
 * the point, Gate Q).
 */
import type { ExperiencePlan, Experience } from "@reckon/sdk";

/** Local structural mirror of the contract ResumeCheckpoint (frozen shape). */
interface ResumeCheckpoint {
  readonly experienceId: string;
  readonly resumeToken: string;
  readonly position: Record<string, unknown>;
  readonly savedAt: number;
}

export const TIMELINE_STAGES = [
  "NOW",
  "CURRENT",
  "NEXT",
  "QUEUED",
  "OPPORTUNITY",
  "FUTURE HORIZON",
] as const;
export type TimelineStageId = (typeof TIMELINE_STAGES)[number];

export interface TimelineExperience {
  readonly experience: Experience;
  /** Position label inside its stage (e.g. "queued #2"). */
  readonly positionLabel: string;
}

export interface TimelineStage {
  readonly id: TimelineStageId;
  readonly headline: string;
  /** Present when the contract carries data for this stage. */
  readonly experiences: readonly TimelineExperience[];
  /** Honest absence note when the contract carries no field for the stage. */
  readonly absentNote: string | null;
  /** Auxiliary contract data attached to the stage, if any. */
  readonly detail: string | null;
}

/** Resume checkpoints with their interrupted experience ids (contract field). */
export interface PlanBoundaries {
  readonly replanTriggers: readonly string[];
  readonly interruptionPolicy: { readonly policyId: string; readonly version: string } | null;
  readonly resumeCheckpoints: readonly ResumeCheckpoint[];
}

export interface PlanTimeline {
  readonly stages: readonly TimelineStage[];
  readonly boundaries: PlanBoundaries;
}

function describeHorizon(plan: ExperiencePlan): string | null {
  const horizon = plan.planningHorizon;
  if (horizon === undefined) return null;
  const parts: string[] = [];
  if (horizon.seconds !== undefined) {
    parts.push(`${horizon.seconds}s`);
  }
  if (horizon.maxItems !== undefined) {
    parts.push(`max ${horizon.maxItems} items`);
  }
  return parts.length > 0 ? `planning horizon: ${parts.join(" · ")}` : null;
}

/**
 * Map one plan to its rolling timeline. NOW is the origin marker (no data),
 * CURRENT ← currentExperience, NEXT ← queuedExperiences[0], QUEUED ← the
 * remaining queue, OPPORTUNITY ← no contract field (stated), FUTURE HORIZON
 * ← planningHorizon.
 */
export function planTimeline(plan: ExperiencePlan): PlanTimeline {
  const queued = plan.queuedExperiences;
  const stages: TimelineStage[] = [
    {
      id: "NOW",
      headline: "The current moment",
      experiences: [],
      absentNote: null,
      detail: `plan v${plan.version} · updated ${new Date(plan.updatedAt).toISOString()}`,
    },
    {
      id: "CURRENT",
      headline: "Current experience",
      experiences:
        plan.currentExperience === undefined
          ? []
          : [{ experience: plan.currentExperience, positionLabel: "current" }],
      absentNote:
        plan.currentExperience === undefined
          ? "No current experience on this plan (the contract field is optional)."
          : null,
      detail: null,
    },
    {
      id: "NEXT",
      headline: "Next up",
      experiences:
        queued.length > 0 ? [{ experience: queued[0]!, positionLabel: "next" }] : [],
      absentNote: queued.length === 0 ? "The queue is empty — nothing is next." : null,
      detail: null,
    },
    {
      id: "QUEUED",
      headline: "Queued experiences",
      experiences: queued.slice(1).map((experience, index) => ({
        experience,
        positionLabel: `queued #${index + 2}`,
      })),
      absentNote: queued.length <= 1 ? "Nothing queued beyond the next experience." : null,
      detail: null,
    },
    {
      id: "OPPORTUNITY",
      headline: "Opportunities",
      experiences: [],
      absentNote:
        "The frozen plan contract carries no opportunity/alternative-pool field — this stage stays honestly empty until a contract change adds one.",
      detail: null,
    },
    {
      id: "FUTURE HORIZON",
      headline: "Future horizon",
      experiences: [],
      absentNote:
        plan.planningHorizon === undefined
          ? "No planning horizon set on this plan."
          : null,
      detail: describeHorizon(plan),
    },
  ];

  return {
    stages,
    boundaries: {
      replanTriggers: [...plan.replanTriggers],
      interruptionPolicy:
        plan.interruptionPolicy === undefined ? null : { ...plan.interruptionPolicy },
      resumeCheckpoints: [...plan.resumeCheckpoints],
    },
  };
}
