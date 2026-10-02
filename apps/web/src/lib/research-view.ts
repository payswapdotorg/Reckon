/**
 * Research view model (UI-008) — the §13 learning ladder + the research
 * job queue mapping.
 *
 * HONESTY LAW (Gate Q — THE law of this workspace): simulation/
 * counterfactual evidence must be visually distinct from observed. The
 * job queue carries DECLARED queue state; there is NO frozen experiment
 * contract (seed/world-model/policy/performance fields are research-
 * runtime internals) — their absence is stated, never fabricated.
 */
import type { ResearchJobState, ResearchJobView } from "@reckon/sdk";

export const LEARNING_LADDER = [
  {
    id: "supervised",
    stage: "1",
    title: "Supervised",
    description: "Direct outcome labels; the calibration floor.",
  },
  {
    id: "bandets-ope",
    stage: "2",
    title: "Contextual Bandits / OPE",
    description: "Off-policy evaluation over logged feedback.",
  },
  {
    id: "offline-pl",
    stage: "3",
    title: "Offline Policy Learning",
    description: "Learn policies from logs without live exposure.",
  },
  {
    id: "sequential-sim",
    stage: "4",
    title: "Sequential Simulation",
    description: "Multi-step simulated trajectories.",
  },
  {
    id: "rl",
    stage: "5",
    title: "RL",
    description: "Full reinforcement learning loops (simulated).",
  },
  {
    id: "org-search",
    stage: "6",
    title: "Organization Search",
    description: "Searching agent-organization structures.",
  },
  {
    id: "bounded-live",
    stage: "7",
    title: "Bounded Live Evaluation",
    description: "Capped live exposure; explicitly bounded risk.",
  },
  {
    id: "calibration",
    stage: "8",
    title: "Calibration",
    description: "Measured honest-confidence alignment.",
  },
] as const;

export const JOB_STATE_LABELS: Readonly<Record<ResearchJobState, string>> = {
  queued: "waiting for a lease",
  leased: "leased to a worker",
  done: "completed",
  failed: "failed",
};

export interface JobRow {
  readonly jobId: string;
  readonly kind: string;
  readonly state: ResearchJobState;
  readonly stateLabel: string;
  readonly resultRef: string | null;
  readonly updatedIso: string;
}

export function jobRows(jobs: readonly ResearchJobView[]): readonly JobRow[] {
  return jobs.map((job) => ({
    jobId: job.jobId,
    kind: job.kind,
    state: job.state,
    stateLabel: JOB_STATE_LABELS[job.state],
    resultRef: job.resultRef,
    updatedIso: new Date(job.updatedAt).toISOString(),
  }));
}

/** Count jobs per state (queue summary). */
export function stateCounts(jobs: readonly ResearchJobView[]): Readonly<Record<ResearchJobState, number>> {
  const counts: Record<ResearchJobState, number> = { queued: 0, leased: 0, done: 0, failed: 0 };
  for (const job of jobs) counts[job.state] += 1;
  return counts;
}
