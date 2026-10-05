/**
 * Funnel analytics tests (S3-002) — the decisions → outcomes →
 * preference-delta stage mapping: unique-id counting, the decision →
 * outcome linkage, the subject-level delta linkage, the evidence
 * partition, honest rates on zero denominators, the caveat model, the
 * view-model shape and the honest surface attempts.
 */
import { describe, expect, it } from "vitest";
import {
  FUNNEL_STAGE_DESCRIPTIONS,
  FUNNEL_STAGE_IDS,
  FUNNEL_STAGE_LABELS,
  PENDING_DECISION_LIST_ROUTE,
  PENDING_OUTCOME_LIST_ROUTE,
  PENDING_PREFERENCE_DELTA_LIST_ROUTE,
  funnelCaveats,
  funnelCounts,
  funnelStages,
  funnelView,
  listPreferenceDeltaTrail,
  parsePreferenceDeltaTrailPage,
  parsePreferenceDeltaTrailRecord,
  type DecisionTrailRecord,
  type OutcomeTrailRecord,
  type PreferenceDeltaTrailRecord,
} from "../src/lib/analytics-funnel.js";
import type { FetchLike, SurfaceEndpoint } from "../src/lib/developers-api.js";

const endpoint: SurfaceEndpoint = { baseUrl: "http://127.0.0.1:8080", apiKey: "sk_test_a".padEnd(32, "x") };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fetchReturning(responses: Response[]): FetchLike {
  let index = 0;
  return () => {
    const response = responses[index];
    index += 1;
    if (response === undefined) {
      throw new Error("unexpected extra fetch call");
    }
    return Promise.resolve(response);
  };
}

/* ---------------- fixtures ---------------- */

function decision(decisionId: string): DecisionTrailRecord {
  return { decisionId };
}

function outcome(fields: Partial<OutcomeTrailRecord> & { eventId: string }): OutcomeTrailRecord {
  return {
    decisionId: "dec-1",
    eventType: "impression",
    occurredAt: 1000,
    evidenceClass: "production-observed",
    subjectKind: "user",
    subjectRef: "user-1",
    ...fields,
  };
}

function delta(fields: Partial<PreferenceDeltaTrailRecord> & { deltaId: string }): PreferenceDeltaTrailRecord {
  return { subjectKind: "user", subjectRef: "user-1", ...fields };
}

const PAGE = { has_more: false, next_cursor: null };

/* ---------------- stage metadata ---------------- */

describe("funnel stage metadata", () => {
  it("the three stages are decisions → outcomes → preference-delta, in order", () => {
    expect(FUNNEL_STAGE_IDS).toEqual(["decisions", "outcomes", "preference-delta"]);
    expect(FUNNEL_STAGE_LABELS.decisions).toBe("Decisions");
    expect(FUNNEL_STAGE_LABELS.outcomes).toBe("Linked outcomes");
    expect(FUNNEL_STAGE_LABELS["preference-delta"]).toBe("Preference deltas");
    for (const id of FUNNEL_STAGE_IDS) {
      expect(FUNNEL_STAGE_DESCRIPTIONS[id].length).toBeGreaterThan(10);
    }
  });

  it("the pending routes are the S3-002 analytics reads, named verbatim", () => {
    expect(PENDING_DECISION_LIST_ROUTE).toBe("GET /v1/decisions");
    expect(PENDING_OUTCOME_LIST_ROUTE).toBe("GET /v1/outcomes");
    expect(PENDING_PREFERENCE_DELTA_LIST_ROUTE).toBe("GET /v1/preferences/events");
  });
});

/* ---------------- wire guards ---------------- */

describe("preference-delta trail wire guards", () => {
  it("projects the frozen subject shape", () => {
    expect(
      parsePreferenceDeltaTrailRecord({ deltaId: "delta-1", subject: { kind: "user", ref: "user-1" } }),
    ).toEqual({ deltaId: "delta-1", subjectKind: "user", subjectRef: "user-1" });
  });

  it("rejects malformed rows — wrong kind vocabulary, missing fields, non-objects", () => {
    expect(parsePreferenceDeltaTrailRecord({ deltaId: "d", subject: { kind: "robot", ref: "u1" } })).toBeNull();
    expect(parsePreferenceDeltaTrailRecord({ deltaId: "d", subject: { kind: "user" } })).toBeNull();
    expect(parsePreferenceDeltaTrailRecord({ subject: { kind: "user", ref: "u1" } })).toBeNull();
    expect(parsePreferenceDeltaTrailRecord("delta")).toBeNull();
  });

  it("requires the envelope + pagination on the page", () => {
    expect(
      parsePreferenceDeltaTrailPage({
        data: [{ deltaId: "delta-1", subject: { kind: "user", ref: "user-1" } }],
        pagination: PAGE,
      })?.deltas,
    ).toHaveLength(1);
    expect(parsePreferenceDeltaTrailPage({ data: [] })).toBeNull();
    expect(parsePreferenceDeltaTrailPage({ data: [{}], pagination: PAGE })).toBeNull();
  });
});

/* ---------------- stage assignment ---------------- */

describe("funnelCounts (the stage assignment)", () => {
  it("counts unique decisions, linked-outcome decisions and subject-linked deltas", () => {
    const counts = funnelCounts(
      [decision("dec-1"), decision("dec-2"), decision("dec-3"), decision("dec-4"), decision("dec-1")],
      [
        outcome({ eventId: "o1", decisionId: "dec-1", subjectRef: "user-1" }),
        outcome({ eventId: "o2", decisionId: "dec-1", subjectRef: "user-1" }),
        outcome({ eventId: "o3", decisionId: "dec-2", subjectRef: "user-2" }),
        outcome({ eventId: "o4", decisionId: null, subjectRef: "user-9" }),
      ],
      [
        delta({ deltaId: "d1", subjectRef: "user-1" }),
        delta({ deltaId: "d2", subjectRef: "user-2" }),
        delta({ deltaId: "d3", subjectRef: "user-7" }),
      ],
    );
    expect(counts).toEqual({
      decisions: 4,
      decisionsWithOutcome: 2,
      deltasForSubjects: 2,
      unlinkedOutcomes: 1,
      researchOutcomes: 0,
      deltasWithoutOutcomeSubject: 1,
    });
  });

  it("research-class outcomes never link a decision (the frozen evidence law)", () => {
    const counts = funnelCounts(
      [decision("dec-1")],
      [
        outcome({ eventId: "r1", decisionId: "dec-1", evidenceClass: "fixture" }),
        outcome({ eventId: "r2", decisionId: "dec-1", evidenceClass: "simulated" }),
      ],
      [],
    );
    expect(counts.researchOutcomes).toBe(2);
    expect(counts.decisionsWithOutcome).toBe(0);
  });

  it("duplicate delta ids collapse — the count is unique deltas", () => {
    const counts = funnelCounts(
      [decision("dec-1")],
      [outcome({ eventId: "o1" })],
      [delta({ deltaId: "d1" }), delta({ deltaId: "d1" })],
    );
    expect(counts.deltasForSubjects).toBe(1);
  });

  it("the subject match is (kind, ref) — same ref under a different kind does not match", () => {
    const counts = funnelCounts(
      [decision("dec-1")],
      [outcome({ eventId: "o1", subjectKind: "user", subjectRef: "s-1" })],
      [delta({ deltaId: "d1", subjectKind: "audience", subjectRef: "s-1" })],
    );
    expect(counts.deltasForSubjects).toBe(0);
    expect(counts.deltasWithoutOutcomeSubject).toBe(1);
  });

  it("empty inputs produce an all-zero funnel", () => {
    expect(funnelCounts([], [], [])).toEqual({
      decisions: 0,
      decisionsWithOutcome: 0,
      deltasForSubjects: 0,
      unlinkedOutcomes: 0,
      researchOutcomes: 0,
      deltasWithoutOutcomeSubject: 0,
    });
  });
});

/* ---------------- stage views + honest rates ---------------- */

describe("funnelStages (counts + honest rates)", () => {
  it("shares and step rates are computed against real denominators", () => {
    const stages = funnelStages(
      funnelCounts(
        [decision("dec-1"), decision("dec-2"), decision("dec-3"), decision("dec-4")],
        [
          outcome({ eventId: "o1", decisionId: "dec-1", subjectRef: "user-1" }),
          outcome({ eventId: "o2", decisionId: "dec-2", subjectRef: "user-2" }),
        ],
        [delta({ deltaId: "d1", subjectRef: "user-1" })],
      ),
    );
    expect(stages.map((stage) => stage.count)).toEqual([4, 2, 1]);
    expect(stages.map((stage) => stage.shareOfFirstPct)).toEqual([100, 50, 25]);
    expect(stages[0]?.shareOfPreviousPct).toBeNull();
    expect(stages[1]?.shareOfPreviousPct).toBe(50);
    expect(stages[2]?.shareOfPreviousPct).toBe(50);
  });

  it("an empty first stage withholds every rate — no division by zero", () => {
    const stages = funnelStages(funnelCounts([], [], []));
    expect(stages.map((stage) => stage.count)).toEqual([0, 0, 0]);
    expect(stages.every((stage) => stage.shareOfFirstPct === null)).toBe(true);
    expect(stages.every((stage) => stage.shareOfPreviousPct === null)).toBe(true);
  });

  it("an empty middle stage withholds the step rate into stage 3", () => {
    const stages = funnelStages(
      funnelCounts([decision("dec-1"), decision("dec-2")], [], [delta({ deltaId: "d1" })]),
    );
    expect(stages.map((stage) => stage.count)).toEqual([2, 0, 0]);
    expect(stages[1]?.shareOfFirstPct).toBe(0);
    expect(stages[2]?.shareOfPreviousPct).toBeNull();
  });

  it("rates round to one decimal", () => {
    const stages = funnelStages(
      funnelCounts([decision("d1"), decision("d2"), decision("d3")], [outcome({ eventId: "o1" })], []),
    );
    expect(stages[1]?.shareOfFirstPct).toBe(33.3);
  });
});

/* ---------------- caveats ---------------- */

describe("funnelCaveats (the reading model)", () => {
  it("the subject-level-linkage caveat is ALWAYS present", () => {
    const caveats = funnelCaveats(funnelCounts([], [], []));
    expect(caveats[0]?.id).toBe("subject-level-linkage");
    expect(caveats[0]?.sentence).toContain("SUBJECT level");
  });

  it("an empty first stage carries the empty-funnel caveat", () => {
    const ids = funnelCaveats(funnelCounts([], [], [])).map((caveat) => caveat.id);
    expect(ids).toContain("empty-first-stage");
  });

  it("a non-empty funnel with an empty outcomes stage carries the zero-denominator caveat", () => {
    const ids = funnelCaveats(
      funnelCounts([decision("dec-1")], [], []),
    ).map((caveat) => caveat.id);
    expect(ids).toContain("zero-denominator");
    expect(ids).not.toContain("empty-first-stage");
  });

  it("a healthy closed-loop funnel carries ONLY the subject-level caveat", () => {
    const counts = funnelCounts(
      [decision("dec-1")],
      [outcome({ eventId: "o1" })],
      [delta({ deltaId: "d1" })],
    );
    expect(funnelCaveats(counts)).toHaveLength(1);
  });

  it("exclusion caveats appear only for non-zero exclusions", () => {
    const counts = funnelCounts(
      [decision("dec-1")],
      [
        outcome({ eventId: "r1", evidenceClass: "fixture" }),
        outcome({ eventId: "u1", decisionId: null }),
      ],
      [delta({ deltaId: "d-out", subjectRef: "user-404" })],
    );
    const ids = funnelCaveats(counts).map((caveat) => caveat.id);
    expect(ids).toContain("research-evidence-excluded");
    expect(ids).toContain("unlinked-outcomes-excluded");
    expect(ids).toContain("deltas-outside-funnel");
  });
});

/* ---------------- view model ---------------- */

describe("funnelView (view-model shape)", () => {
  it("tags computed data as observed evidence and carries the three stages", () => {
    const view = funnelView(
      funnelCounts(
        [decision("dec-1"), decision("dec-2")],
        [outcome({ eventId: "o1", decisionId: "dec-1" })],
        [delta({ deltaId: "d1" })],
      ),
    );
    expect(view.evidenceClass).toBe("observed");
    expect(view.stages.map((stage) => stage.id)).toEqual([...FUNNEL_STAGE_IDS]);
    expect(view.stages.map((stage) => stage.label)).toEqual([
      FUNNEL_STAGE_LABELS.decisions,
      FUNNEL_STAGE_LABELS.outcomes,
      FUNNEL_STAGE_LABELS["preference-delta"],
    ]);
    expect(view.exclusionLabels).toHaveLength(3);
    expect(view.caveats.length).toBeGreaterThan(0);
  });
});

/* ---------------- surface attempts (injectable fetch) ---------------- */

describe("preference-delta surface attempts (the honest outcome mapping)", () => {
  it("404 maps to not-wired with the pending route named verbatim", async () => {
    const result = await listPreferenceDeltaTrail(
      endpoint,
      {},
      fetchReturning([jsonResponse(404, { error: { code: "NOT_FOUND", message: "no route" } })]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.outcome).toBe("not-wired");
      expect(result.failure.pendingRoute).toBe(PENDING_PREFERENCE_DELTA_LIST_ROUTE);
    }
  });

  it("a valid 200 page flows through", async () => {
    const result = await listPreferenceDeltaTrail(
      endpoint,
      { limit: 50 },
      fetchReturning([
        jsonResponse(200, {
          data: [{ deltaId: "delta-1", subject: { kind: "user", ref: "user-1" } }],
          pagination: PAGE,
        }),
      ]),
    );
    expect(result).toEqual({
      ok: true,
      data: { deltas: [delta({ deltaId: "delta-1" })], pagination: PAGE },
    });
  });

  it("a 200 body with a bad row is an error — withheld rather than guessed", async () => {
    const result = await listPreferenceDeltaTrail(
      endpoint,
      {},
      fetchReturning([jsonResponse(200, { data: [{ deltaId: 7 }], pagination: PAGE })]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.outcome).toBe("error");
      expect(result.failure.detail).toContain("withheld rather than guessed");
    }
  });
});
