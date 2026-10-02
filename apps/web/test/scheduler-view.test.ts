/**
 * UI-006 — scheduler view model: pure mapping from DecisionResult to the
 * §11 surfaces. The law under test: RANKING ≠ PERMISSION TO INTERRUPT is
 * stated, the ladder is complete, absent contract fields surface as
 * explicit gaps, and NO switch-cost arithmetic is ever computed.
 */
import { describe, expect, it } from "vitest";
import { DecisionResultSchema } from "@reckon/contracts";
import { schedulerView, scoreRowCells, ACTION_LADDER } from "../src/lib/scheduler-view.js";

function makeDecision(overrides: Record<string, unknown> = {}) {
  return DecisionResultSchema.parse({
    schema: "reckon.decision-result",
    schemaVersion: "0.1.0",
    decisionId: "dec-1",
    requestId: "req-1",
    tenant: { tenantId: "tenant-a" },
    action: "SUGGEST",
    alternatives: [
      {
        experienceId: "exp-best",
        score: 0.87,
        uncertainty: { confidence: 0.62, method: "posterior" },
        reason: "strong objective fit",
      },
      { experienceId: "exp-gated", score: 0.71, excludedBy: "hard-constraint:region" },
    ],
    policy: { policyId: "greedy-v1", version: "3" },
    scheduleDelta: {
      action: "QUEUE",
      planId: "plan-9",
      enqueue: ["exp-best"],
      dequeue: [],
    },
    reasons: [
      { code: "SWITCH_COST", message: "switching cost exceeds expected improvement" },
    ],
    at: 10_000,
    ...overrides,
  });
}

describe("schedulerView — the §11 mapping", () => {
  it("complete 8-action ladder with exactly the chosen one marked", () => {
    const view = schedulerView(makeDecision());
    expect(view.ladder.map((s) => s.action)).toEqual([...ACTION_LADDER]);
    expect(ACTION_LADDER).toHaveLength(8);
    expect(view.ladder.filter((s) => s.chosen)).toHaveLength(1);
    expect(view.ladder.find((s) => s.chosen)?.action).toBe("SUGGEST");
    expect(view.ladder.find((s) => s.action === "INTERRUPT")?.meaning).toMatch(
      /permitted boundary/,
    );
  });

  it("score rows carry contract fields verbatim; absent fields are null (never computed)", () => {
    const view = schedulerView(makeDecision());
    expect(view.scores).toHaveLength(2);
    expect(view.scores[0]).toMatchObject({
      experienceId: "exp-best",
      score: 0.87,
      reason: "strong objective fit",
      excludedBy: null,
    });
    expect(view.scores[0]?.uncertainty).toMatchObject({ confidence: 0.62 });
    expect(view.scores[1]?.score).toBe(0.71);
    expect(view.scores[1]?.excludedBy).toBe("hard-constraint:region");
  });

  it("consequences: delta action, plan, enqueue/dequeue counts", () => {
    const view = schedulerView(makeDecision());
    const byLabel = new Map(view.consequences.map((r) => [r.label, r.value]));
    expect(byLabel.get("delta action")).toBe("QUEUE");
    expect(byLabel.get("plan")).toBe("plan-9");
    expect(byLabel.get("enqueued")).toBe("1");
    expect(byLabel.get("dequeued")).toBe("0");
  });

  it("honest absence: no scheduleDelta → an explicit not-provided row", () => {
    const view = schedulerView(makeDecision({ scheduleDelta: undefined }));
    const byLabel = new Map(view.consequences.map((r) => [r.label, r.value]));
    expect(byLabel.get("schedule delta")).toMatch(/not provided by the contract/);
  });

  it("latency observations map when present", () => {
    const view = schedulerView(makeDecision({ latency: { latencyMsP50: 12.5, latencyMsP95: 40.25 } }));
    const byLabel = new Map(view.consequences.map((r) => [r.label, r.value]));
    expect(byLabel.get("decision latency p50")).toBe("12.5 ms");
    expect(byLabel.get("decision latency p95")).toBe("40.3 ms");
  });

  it("reasons trail passes through verbatim", () => {
    const view = schedulerView(makeDecision());
    expect(view.reasons).toEqual([
      { code: "SWITCH_COST", message: "switching cost exceeds expected improvement" },
    ]);
  });

  it("scoreRowCells renders gaps as em-dash, uncertainty cells joined", () => {
    const view = schedulerView(makeDecision());
    const cells = scoreRowCells(view.scores[0]!);
    expect(cells.score).toBe("0.870");
    expect(cells.uncertainty).toContain("confidence 0.620");
    expect(cells.uncertainty).toContain("method posterior");
    expect(cells.excludedBy).toBe("—");
    const gated = scoreRowCells(view.scores[1]!);
    expect(gated.uncertainty).toBe("—");
    expect(gated.reason).toBe("—");
    expect(gated.excludedBy).toBe("hard-constraint:region");
  });
});
