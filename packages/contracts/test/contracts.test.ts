import { describe, it, expect } from "vitest";
import {
  DecisionRequestSchema,
  DecisionResultSchema,
  ExperienceSchema,
  OutcomeEventSchema,
  ObservedOutcomeEventSchema,
  ResearchOutcomeEventSchema,
  PreferenceDeltaSchema,
  AgentBodySchema,
  AgentOrganizationSchema,
  ExperiencePlanSchema,
  ContextSnapshotSchema,
  CandidateSetSchema,
  canonicalJson,
  contentDigest,
  stableClone,
  CONTRACT_VERSIONS,
  CONTRACT_IDS,
} from "../src/index.js";

const ctx = ContextSnapshotSchema.parse({ contextId: "ctx-1", at: 1_000 });

const experience = {
  experienceId: "exp-1",
  itemId: "item-1",
  realizationId: "real-1",
  format: { kind: "full" as const, params: {} },
};

const decisionRequest = {
  requestId: "req-1",
  tenant: { tenantId: "t-1" },
  subject: { kind: "user" as const, ref: "user-9" },
  objective: { objectiveId: "obj-1", kind: "relax" as const },
  attentionPolicy: { policyId: "ap-1", style: "balanced" as const },
  context: { contextId: "ctx-1" },
  candidates: {
    setId: "cs-1",
    candidates: [{ itemId: "item-1", realizationIds: ["real-1"], source: "host-retrieval" }],
  },
  policySelector: { policyId: "greedy-v1", version: "1" },
  idempotencyKey: "idem-1",
};

describe("core contracts parse and round-trip", () => {
  it("parses a valid DecisionRequest", () => {
    const parsed = DecisionRequestSchema.parse(decisionRequest);
    expect(parsed.requestId).toBe("req-1");
    expect(parsed.schema).toBe("reckon.decision-request");
    expect(parsed.schemaVersion).toBe(CONTRACT_VERSIONS[CONTRACT_IDS.decisionRequest]);
  });

  it("rejects a DecisionRequest without idempotencyKey", () => {
    const { idempotencyKey: _drop, ...withoutKey } = decisionRequest;
    expect(() => DecisionRequestSchema.parse(withoutKey)).toThrow();
  });

  it("rejects a DecisionRequest with an empty candidate set", () => {
    const bad = { ...decisionRequest, candidates: { setId: "cs-0", candidates: [] } };
    expect(() => DecisionRequestSchema.parse(bad)).toThrow();
  });

  it("parses a valid DecisionResult with schedule delta", () => {
    const result = DecisionResultSchema.parse({
      decisionId: "dec-1",
      requestId: "req-1",
      tenant: { tenantId: "t-1" },
      action: "SWITCH",
      selectedExperience: experience,
      policy: { policyId: "greedy-v1", version: "1" },
      scheduleDelta: { action: "SWITCH", enqueue: ["exp-2"] },
      at: 1_234,
    });
    expect(result.action).toBe("SWITCH");
    expect(result.scheduleDelta?.enqueue).toEqual(["exp-2"]);
  });

  it("accepts every scheduler action", () => {
    for (const action of ["HOLD", "CONTINUE", "QUEUE", "SUGGEST", "SWITCH", "INTERRUPT", "RESUME", "END"]) {
      expect(() =>
        DecisionResultSchema.parse({
          decisionId: `dec-${action}`,
          requestId: "req-1",
          tenant: { tenantId: "t-1" },
          action,
          policy: { policyId: "p", version: "1" },
          at: 1,
        })
      ).not.toThrow();
    }
  });

  it("parses a minimal Experience and a fully-specified one", () => {
    const minimal = ExperienceSchema.parse(experience);
    expect(minimal.format.kind).toBe("full");
    const full = ExperienceSchema.parse({
      ...experience,
      locale: "en-US",
      duration: 253,
      timing: { availabilityWindow: { fromMs: 0, untilMs: 1000 } },
      requirements: { deviceClass: ["tv"], requiresScreen: true },
      transformations: [{ kind: "transcode", params: { to: "hls" } }],
      constraints: [{ kind: "min-duration", seconds: 30 }],
    });
    expect(full.constraints).toHaveLength(1);
  });
});

describe("outcome evidence typing (contract rule #9)", () => {
  const baseOutcome = {
    eventId: "ev-1",
    tenant: { tenantId: "t-1" },
    subject: { kind: "user" as const, ref: "user-9" },
    eventType: "completion",
    occurredAt: 2_000,
    evidenceClass: "production-observed" as const,
    idempotencyKey: "idem-2",
  };

  it("parses an observed outcome", () => {
    const ev = OutcomeEventSchema.parse(baseOutcome);
    expect(ev.evidenceClass).toBe("production-observed");
    expect(() => ObservedOutcomeEventSchema.parse(ev)).not.toThrow();
  });

  it("rejects a simulated outcome from the observed schema", () => {
    const sim = { ...baseOutcome, evidenceClass: "simulated" as const };
    expect(() => ObservedOutcomeEventSchema.parse(sim)).toThrow();
    expect(() => ResearchOutcomeEventSchema.parse(sim)).not.toThrow();
  });

  it("supports append-oriented corrections via correctsEventId", () => {
    const correction = OutcomeEventSchema.parse({
      ...baseOutcome,
      eventId: "ev-2",
      eventType: "correction",
      correctsEventId: "ev-1",
    });
    expect(correction.correctsEventId).toBe("ev-1");
  });
});

describe("deterministic serialization and digests", () => {
  it("sorts object keys and drops undefined", () => {
    const a = { b: 1, a: undefined, c: [2, { z: 1, y: 2 }] };
    const b = { c: [2, { y: 2, z: 1 }], b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("produces identical digests for semantically equal contracts", () => {
    const p1 = PreferenceDeltaSchema.parse({
      deltaId: "d-1",
      tenant: { tenantId: "t-1" },
      subject: { kind: "user", ref: "user-9" },
      dimension: "genre.scifi",
      op: "add",
      value: 0.25,
      model: { modelId: "m-1", version: "3" },
      timestamp: 5_000,
    });
    const reordered = stableClone(p1);
    expect(contentDigest(p1)).toBe(contentDigest(reordered));
  });

  it("changes digest when any semantic value changes", () => {
    const p = { a: 1, b: [1, 2, 3] };
    const q = { a: 1, b: [1, 2, 4] };
    expect(contentDigest(p)).not.toBe(contentDigest(q));
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalJson({ x: Number.NaN })).toThrow();
    expect(() => canonicalJson({ x: Infinity })).toThrow();
  });
});

describe("agent contracts", () => {
  it("parses a minimal AgentBody", () => {
    const body = AgentBodySchema.parse({
      bodyId: "body-1",
      role: { roleId: "generalist", description: "Single generalist baseline" },
      termination: {},
    } as never);
    expect(body.bodyId).toBe("body-1");
  });

  it("parses an AgentOrganization with a generalist body", () => {
    const org = AgentOrganizationSchema.parse({
      organizationId: "org-1",
      bodies: [
        {
          bodyId: "body-1",
          role: { roleId: "generalist", description: "Single generalist baseline" },
        },
      ],
      terminationRules: [{ kind: "task-complete" }],
    });
    expect(org.bodies).toHaveLength(1);
    expect(org.terminationRules[0].kind).toBe("task-complete");
  });
});

describe("experience plan", () => {
  it("parses a rolling plan with replan triggers", () => {
    const plan = ExperiencePlanSchema.parse({
      planId: "plan-1",
      tenant: { tenantId: "t-1" },
      subject: { kind: "user", ref: "user-9" },
      objective: { objectiveId: "obj-1", kind: "relax" },
      attentionPolicy: { policyId: "ap-1", style: "mindful" },
      queuedExperiences: [experience],
      replanTriggers: ["context-changed", "user-feedback"],
      createdAt: 0,
      updatedAt: 1,
    });
    expect(plan.replanTriggers).toContain("context-changed");
    expect(plan.version).toBe(0);
  });
});

describe("candidate set", () => {
  it("requires at least one candidate", () => {
    expect(() => CandidateSetSchema.parse({ setId: "cs-1", candidates: [] })).toThrow();
    const ok = CandidateSetSchema.parse({
      setId: "cs-1",
      candidates: [{ itemId: "i-1", realizationIds: [], source: "search" }],
    });
    expect(ok.candidates[0].source).toBe("search");
  });
});
