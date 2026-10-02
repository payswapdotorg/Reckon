/**
 * UI-005 — plan view model: pure mapping from the ExperiencePlan contract
 * to the rolling timeline. Contract-faithfulness is the law: stages the
 * contract does not carry must surface explicit absence notes (Gate Q).
 */
import { describe, expect, it } from "vitest";
import { ExperienceSchema } from "@reckon/contracts";
import type { ExperiencePlan } from "@reckon/sdk";
import { planTimeline, TIMELINE_STAGES } from "../src/lib/plan-view.js";

function makePlan(overrides: Partial<ExperiencePlan> = {}): ExperiencePlan {
  return {
    schema: "reckon.experience-plan",
    schemaVersion: "0.1.0",
    planId: "plan-1",
    version: 2,
    tenant: { tenantId: "tenant-a" },
    subject: { kind: "user", ref: "user-9" },
    objective: { objectiveId: "obj-1", version: "1", kind: "relax", params: {} },
    attentionPolicy: { policyId: "ap-1", version: "1", style: "mindful", params: {} },
    queuedExperiences: [],
    replanTriggers: ["outcome-observed"],
    resumeCheckpoints: [],
    createdAt: 1_000,
    updatedAt: 9_000,
    ...overrides,
  } as ExperiencePlan;
}

import type { Experience } from "@reckon/sdk";

function experience(id: string): Experience {
  return ExperienceSchema.parse({
    schema: "reckon.experience",
    schemaVersion: "0.1.0",
    experienceId: id,
    itemId: "item-1",
    realizationId: "real-1",
    format: { kind: "full", params: {} },
    transformations: [],
    constraints: [],
  });
}

describe("planTimeline — the §10 rolling timeline mapping", () => {
  it("six stages in reading order, always", () => {
    const timeline = planTimeline(makePlan());
    expect(timeline.stages.map((stage) => stage.id)).toEqual([...TIMELINE_STAGES]);
  });

  it("maps currentExperience → CURRENT, queue[0] → NEXT, queue[1..] → QUEUED", () => {
    const timeline = planTimeline(
      makePlan({
        currentExperience: experience("exp-current"),
        queuedExperiences: [experience("exp-next"), experience("exp-q2"), experience("exp-q3")],
      }),
    );
    const byId = new Map(timeline.stages.map((stage) => [stage.id, stage]));
    expect(byId.get("CURRENT")?.experiences[0]?.experience.experienceId).toBe("exp-current");
    expect(byId.get("CURRENT")?.experiences[0]?.positionLabel).toBe("current");
    expect(byId.get("NEXT")?.experiences[0]?.experience.experienceId).toBe("exp-next");
    expect(byId.get("QUEUED")?.experiences.map((e) => e.experience.experienceId)).toEqual([
      "exp-q2",
      "exp-q3",
    ]);
    expect(byId.get("QUEUED")?.experiences[0]?.positionLabel).toBe("queued #2");
  });

  it("honest absence: empty plan → CURRENT/NEXT/QUEUED carry notes, never fabrications", () => {
    const timeline = planTimeline(makePlan());
    const byId = new Map(timeline.stages.map((stage) => [stage.id, stage]));
    expect(byId.get("CURRENT")?.absentNote).toMatch(/No current experience/);
    expect(byId.get("NEXT")?.absentNote).toMatch(/queue is empty/);
    expect(byId.get("QUEUED")?.absentNote).toMatch(/Nothing queued/);
  });

  it("OPPORTUNITY always states the contract gap (Gate Q)", () => {
    const timeline = planTimeline(
      makePlan({ currentExperience: experience("exp-current"), queuedExperiences: [experience("q")] }),
    );
    const opportunity = timeline.stages.find((stage) => stage.id === "OPPORTUNITY");
    expect(opportunity?.experiences).toEqual([]);
    expect(opportunity?.absentNote).toMatch(/no opportunity\/alternative-pool field/);
  });

  it("FUTURE HORIZON carries planningHorizon when set; honest absence when not", () => {
    const withHorizon = planTimeline(makePlan({ planningHorizon: { seconds: 3600, maxItems: 12 } }));
    const horizon = withHorizon.stages.find((stage) => stage.id === "FUTURE HORIZON");
    expect(horizon?.detail).toContain("3600s");
    expect(horizon?.detail).toContain("max 12 items");

    const without = planTimeline(makePlan());
    expect(without.stages.find((stage) => stage.id === "FUTURE HORIZON")?.absentNote).toMatch(
      /No planning horizon/,
    );
  });

  it("boundaries: replan triggers, interruption policy, resume checkpoints map verbatim", () => {
    const timeline = planTimeline(
      makePlan({
        replanTriggers: ["outcome-observed", "host-request"],
        interruptionPolicy: { policyId: "ip-1", version: "3" },
        resumeCheckpoints: [
          {
            experienceId: "exp-1",
            resumeToken: "tok",
            position: {},
            savedAt: 5_000,
          },
        ],
      }),
    );
    expect(timeline.boundaries.replanTriggers).toEqual(["outcome-observed", "host-request"]);
    expect(timeline.boundaries.interruptionPolicy).toEqual({ policyId: "ip-1", version: "3" });
    expect(timeline.boundaries.resumeCheckpoints[0]?.experienceId).toBe("exp-1");
  });

  it("NOW origin carries the plan version + update recency, no experiences", () => {
    const timeline = planTimeline(makePlan({ version: 7, updatedAt: 123_456 }));
    const now = timeline.stages.find((stage) => stage.id === "NOW");
    expect(now?.experiences).toEqual([]);
    expect(now?.detail).toContain("plan v7");
    expect(now?.detail).toContain("1970-01-01"); // ISO rendering of 123_456ms
  });
});
