/**
 * UI-008 — research view model: the §13 ladder + queue mapping.
 * Laws under test: 8 rungs in order; observed vs simulated rung classes;
 * job-state labels; state counts.
 */
import { describe, expect, it } from "vitest";
import { LEARNING_LADDER, JOB_STATE_LABELS, jobRows, stateCounts } from "../src/lib/research-view.js";
import type { ResearchJobView } from "@reckon/sdk";

describe("LEARNING_LADDER — the §13 spine", () => {
  it("eight rungs in canonical order", () => {
    expect(LEARNING_LADDER.map((r) => r.title)).toEqual([
      "Supervised",
      "Contextual Bandits / OPE",
      "Offline Policy Learning",
      "Sequential Simulation",
      "RL",
      "Organization Search",
      "Bounded Live Evaluation",
      "Calibration",
    ]);
  });
});

describe("jobRows + stateCounts", () => {
  const jobs: readonly ResearchJobView[] = [
    {
      jobId: "job-1",
      kind: "calibration-run",
      state: "done",
      payload: null,
      resultRef: "runs/abc",
      createdAt: 1,
      updatedAt: 5_000,
    },
    {
      jobId: "job-2",
      kind: "sim-batch",
      state: "queued",
      payload: null,
      resultRef: null,
      createdAt: 2,
      updatedAt: 4_000,
    },
    {
      jobId: "job-3",
      kind: "sim-batch",
      state: "failed",
      payload: null,
      resultRef: null,
      createdAt: 3,
      updatedAt: 3_000,
    },
  ];

  it("maps rows verbatim with state labels", () => {
    const rows = jobRows(jobs);
    expect(rows[0]).toMatchObject({ jobId: "job-1", state: "done", stateLabel: "completed" });
    expect(rows[1]?.stateLabel).toBe("waiting for a lease");
    expect(rows[2]?.updatedIso).toBe(new Date(3_000).toISOString());
  });

  it("counts per state", () => {
    expect(stateCounts(jobs)).toEqual({ queued: 1, leased: 0, done: 1, failed: 1 });
    expect(JOB_STATE_LABELS.leased).toBe("leased to a worker");
  });
});
