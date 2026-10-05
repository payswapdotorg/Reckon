/**
 * CTR-lift analytics tests (S3-002) — the exposure grouping, engagement
 * window, Wilson intervals, lift sign/magnitude, the evidence partition
 * (research vs observed), the confidence caveat rendering model, the
 * wire guards over the S2-001 envelope, and the honest surface attempts
 * (injectable fetch, no network).
 */
import { describe, expect, it } from "vitest";
import {
  CLICK_THROUGH_EVENT_TYPES,
  IMPRESSION_EVENT_TYPE,
  OBSERVED_OUTCOME_EVIDENCE_CLASSES,
  PENDING_DECISION_LIST_ROUTE,
  PENDING_OUTCOME_LIST_ROUTE,
  RESEARCH_OUTCOME_EVIDENCE_CLASSES,
  computeCtrLift,
  ctrCaveats,
  ctrLiftView,
  isClickThroughEventType,
  isObservedOutcomeEvidence,
  isResearchOutcomeEvidence,
  listDecisionTrail,
  listOutcomeTrail,
  parseDecisionTrailPage,
  parseDecisionTrailRecord,
  parseOutcomeTrailPage,
  parseOutcomeTrailRecord,
  wilsonInterval,
  type DecisionTrailRecord,
  type OutcomeTrailRecord,
} from "../src/lib/analytics-ctr-lift.js";
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

function outcomeRow(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    eventId: "evt-1",
    decisionId: "dec-1",
    eventType: "impression",
    occurredAt: 1000,
    evidenceClass: "production-observed",
    subject: { kind: "user", ref: "user-1" },
    ...fields,
  };
}

const PAGE = { has_more: false, next_cursor: null };

/* ---------------- wire guards ---------------- */

describe("outcome-trail wire guards (the frozen outcome vocabulary)", () => {
  it("accepts a valid S2-001 envelope and projects the frozen fields", () => {
    const page = parseOutcomeTrailPage({
      data: [outcomeRow({}), outcomeRow({ eventId: "evt-2", decisionId: null })],
      pagination: PAGE,
    });
    expect(page).not.toBeNull();
    expect(page?.outcomes).toHaveLength(2);
    expect(page?.outcomes[1]?.decisionId).toBeNull();
  });

  it("rejects rows outside the frozen event-type vocabulary", () => {
    expect(parseOutcomeTrailRecord(outcomeRow({ eventType: "bogus" }))).toBeNull();
  });

  it("rejects rows outside the frozen evidence-class vocabulary", () => {
    expect(parseOutcomeTrailRecord(outcomeRow({ evidenceClass: "made-up" }))).toBeNull();
  });

  it("rejects rows with a malformed subject", () => {
    expect(parseOutcomeTrailRecord(outcomeRow({ subject: { kind: "robot", ref: "user-1" } }))).toBeNull();
    expect(parseOutcomeTrailRecord(outcomeRow({ subject: { ref: "user-1" } }))).toBeNull();
    expect(parseOutcomeTrailRecord(outcomeRow({ subject: null }))).toBeNull();
  });

  it("rejects non-finite occurrence times and malformed decision ids", () => {
    expect(parseOutcomeTrailRecord(outcomeRow({ occurredAt: Number.NaN }))).toBeNull();
    expect(parseOutcomeTrailRecord(outcomeRow({ occurredAt: "1000" }))).toBeNull();
    expect(parseOutcomeTrailRecord(outcomeRow({ decisionId: 42 }))).toBeNull();
    expect(parseOutcomeTrailRecord(outcomeRow({ decisionId: "" }))).toBeNull();
  });

  it("a missing envelope, a bad pagination block or a non-array data field rejects the page", () => {
    expect(parseOutcomeTrailPage({ data: [] })).toBeNull();
    expect(parseOutcomeTrailPage({ data: [outcomeRow({})], pagination: { has_more: "yes" } })).toBeNull();
    expect(parseOutcomeTrailPage({ data: {}, pagination: PAGE })).toBeNull();
    expect(parseOutcomeTrailPage({ data: [null], pagination: PAGE })).toBeNull();
  });
});

describe("decision-trail wire guards", () => {
  it("projects the decisionId from a valid row and tolerates extra fields", () => {
    expect(parseDecisionTrailRecord({ decisionId: "dec-1", action: "SUGGEST" })).toEqual({ decisionId: "dec-1" });
  });

  it("rejects rows without a decision id", () => {
    expect(parseDecisionTrailRecord({})).toBeNull();
    expect(parseDecisionTrailRecord({ decisionId: "" })).toBeNull();
    expect(parseDecisionTrailRecord("dec-1")).toBeNull();
  });

  it("requires the envelope + pagination on the page", () => {
    expect(parseDecisionTrailPage({ data: [{ decisionId: "dec-1" }], pagination: PAGE })?.decisions).toEqual([
      { decisionId: "dec-1" },
    ]);
    expect(parseDecisionTrailPage({ data: [{ decisionId: "dec-1" }] })).toBeNull();
  });
});

/* ---------------- evidence vocabulary ---------------- */

describe("evidence partition (the frozen outcome law)", () => {
  it("splits the frozen vocabulary exactly", () => {
    for (const evidenceClass of OBSERVED_OUTCOME_EVIDENCE_CLASSES) {
      expect(isObservedOutcomeEvidence(evidenceClass)).toBe(true);
      expect(isResearchOutcomeEvidence(evidenceClass)).toBe(false);
    }
    for (const evidenceClass of RESEARCH_OUTCOME_EVIDENCE_CLASSES) {
      expect(isResearchOutcomeEvidence(evidenceClass)).toBe(true);
      expect(isObservedOutcomeEvidence(evidenceClass)).toBe(false);
    }
  });

  it("the click-through set is a named subset of the vocabulary", () => {
    expect(CLICK_THROUGH_EVENT_TYPES).toEqual(["start", "conversion", "purchase"]);
    expect(isClickThroughEventType("start")).toBe(true);
    expect(isClickThroughEventType("purchase")).toBe(true);
    expect(isClickThroughEventType("skip")).toBe(false);
    expect(isClickThroughEventType(IMPRESSION_EVENT_TYPE)).toBe(false);
  });
});

/* ---------------- Wilson interval ---------------- */

describe("Wilson score interval", () => {
  it("degenerate rates pin their bound: 0 successes → low 0, all successes → high 1", () => {
    expect(wilsonInterval(0, 10)?.low).toBe(0);
    expect(wilsonInterval(10, 10)?.high).toBe(1);
  });

  it("brackets the point estimate", () => {
    const interval = wilsonInterval(5, 10);
    expect(interval).not.toBeNull();
    expect(interval!.low).toBeLessThan(0.5);
    expect(interval!.high).toBeGreaterThan(0.5);
  });

  it("is symmetric: interval(k, n).low mirrors interval(n−k, n).high", () => {
    const lowSide = wilsonInterval(3, 10);
    const highSide = wilsonInterval(7, 10);
    expect(lowSide!.low + highSide!.high).toBeCloseTo(1, 12);
  });

  it("null on impossible inputs — never a fabricated interval", () => {
    expect(wilsonInterval(0, 0)).toBeNull();
    expect(wilsonInterval(-1, 10)).toBeNull();
    expect(wilsonInterval(11, 10)).toBeNull();
  });
});

/* ---------------- exposure grouping + engagement ---------------- */

describe("exposure grouping (decision → impression linkage)", () => {
  it("an impression outcome exposes its decision; every other decision is the baseline", () => {
    const result = computeCtrLift(
      [decision("dec-1"), decision("dec-2")],
      [outcome({ eventId: "evt-1", decisionId: "dec-1", eventType: "impression" })],
    );
    expect(result.exposed.decisions).toBe(1);
    expect(result.unexposed.decisions).toBe(1);
    expect(result.impressions).toBe(1);
  });

  it("duplicate decision ids collapse — the group is unique decisions", () => {
    const result = computeCtrLift(
      [decision("dec-1"), decision("dec-1")],
      [],
    );
    expect(result.exposed.decisions + result.unexposed.decisions).toBe(1);
  });

  it("the FIRST impression is the earliest by occurredAt", () => {
    const result = computeCtrLift(
      [decision("dec-1")],
      [
        outcome({ eventId: "evt-late", eventType: "impression", occurredAt: 5000 }),
        outcome({ eventId: "evt-early", eventType: "impression", occurredAt: 2000 }),
        // A click-through between the two impressions still counts: it is
        // at or after the FIRST (earliest) impression.
        outcome({ eventId: "evt-click", eventType: "start", occurredAt: 3000 }),
      ],
    );
    expect(result.exposed.engaged).toBe(1);
  });
});

describe("engagement (the click-through window)", () => {
  it("a click-through at or after the first impression engages the exposed decision", () => {
    const result = computeCtrLift(
      [decision("dec-1")],
      [
        outcome({ eventId: "evt-imp", eventType: "impression", occurredAt: 1000 }),
        outcome({ eventId: "evt-click", eventType: "start", occurredAt: 1000 }),
      ],
    );
    expect(result.exposed.engaged).toBe(1);
    expect(result.clickThroughs).toBe(1);
  });

  it("a click-through BEFORE the first impression does not engage the exposed decision", () => {
    const result = computeCtrLift(
      [decision("dec-1")],
      [
        outcome({ eventId: "evt-imp", eventType: "impression", occurredAt: 2000 }),
        outcome({ eventId: "evt-click", eventType: "start", occurredAt: 1000 }),
      ],
    );
    expect(result.exposed.engaged).toBe(0);
    expect(result.clickThroughs).toBe(1);
  });

  it("an unexposed decision engages on any linked click-through (organic, no impression to order against)", () => {
    const result = computeCtrLift(
      [decision("dec-1")],
      [outcome({ eventId: "evt-click", eventType: "conversion", occurredAt: 100 })],
    );
    expect(result.unexposed.engaged).toBe(1);
    expect(result.unexposed.ctr).toBe(1);
  });
});

describe("evidence partition inside the computation", () => {
  it("research-class outcomes are counted and excluded from every rate", () => {
    const result = computeCtrLift(
      [decision("dec-1")],
      [
        outcome({ eventId: "evt-r1", evidenceClass: "fixture", eventType: "impression" }),
        outcome({ eventId: "evt-r2", evidenceClass: "simulated", eventType: "start" }),
      ],
    );
    expect(result.researchOutcomeCount).toBe(2);
    expect(result.exposed.decisions).toBe(0);
    expect(result.unexposed.decisions).toBe(1);
    expect(result.clickThroughs).toBe(0);
  });

  it("observed outcomes without a decisionId are counted and excluded from attribution", () => {
    const result = computeCtrLift(
      [decision("dec-1")],
      [outcome({ eventId: "evt-u", decisionId: null, eventType: "impression" })],
    );
    expect(result.unlinkedOutcomeCount).toBe(1);
    expect(result.exposed.decisions).toBe(0);
    expect(result.impressions).toBe(0);
  });
});

/* ---------------- lift sign + magnitude ---------------- */

describe("lift computation (sign, magnitude, honesty on empty denominators)", () => {
  it("exposed CTR above the baseline is a lift with exact magnitude", () => {
    const decisions = ["dec-1", "dec-2", "dec-3", "dec-4", "dec-5", "dec-6", "dec-7", "dec-8"].map(decision);
    const result = computeCtrLift(decisions, [
      // dec-1..dec-4 are exposed via impressions.
      outcome({ eventId: "i1", decisionId: "dec-1", eventType: "impression", occurredAt: 1 }),
      outcome({ eventId: "i2", decisionId: "dec-2", eventType: "impression", occurredAt: 1 }),
      outcome({ eventId: "i3", decisionId: "dec-3", eventType: "impression", occurredAt: 1 }),
      outcome({ eventId: "i4", decisionId: "dec-4", eventType: "impression", occurredAt: 1 }),
      // Two of the four exposed decisions click through.
      outcome({ eventId: "c1", decisionId: "dec-1", eventType: "start", occurredAt: 2 }),
      outcome({ eventId: "c2", decisionId: "dec-2", eventType: "purchase", occurredAt: 2 }),
      // One of the four unexposed decisions engages organically.
      outcome({ eventId: "c3", decisionId: "dec-5", eventType: "conversion", occurredAt: 2 }),
    ]);
    // exposed: 2/4 = 0.5; unexposed: 1/4 = 0.25
    expect(result.exposed.ctr).toBe(0.5);
    expect(result.unexposed.ctr).toBe(0.25);
    expect(result.lift.direction).toBe("lift");
    expect(result.lift.absolutePct).toBeCloseTo(25, 10);
    expect(result.lift.ratio).toBeCloseTo(2, 10);
  });

  it("exposed CTR below the baseline is a drop with negative magnitude", () => {
    const result = computeCtrLift(
      [decision("dec-1"), decision("dec-2")],
      [
        outcome({ eventId: "i1", decisionId: "dec-1", eventType: "impression", occurredAt: 1 }),
        outcome({ eventId: "c2", decisionId: "dec-2", eventType: "start", occurredAt: 2 }),
      ],
    );
    // exposed 0/1; unexposed 1/1 → drop of 100 pp
    expect(result.lift.direction).toBe("drop");
    expect(result.lift.absolutePct).toBeCloseTo(-100, 10);
  });

  it("equal CTRs are flat", () => {
    const result = computeCtrLift(
      [decision("dec-1"), decision("dec-2")],
      [
        outcome({ eventId: "i1", decisionId: "dec-1", eventType: "impression", occurredAt: 1 }),
        outcome({ eventId: "c1", decisionId: "dec-1", eventType: "start", occurredAt: 2 }),
        outcome({ eventId: "c2", decisionId: "dec-2", eventType: "start", occurredAt: 2 }),
      ],
    );
    expect(result.lift.direction).toBe("flat");
    expect(result.lift.absolutePct).toBe(0);
  });

  it("an empty baseline group makes the lift inconclusive — never a fabricated ratio", () => {
    const result = computeCtrLift(
      [decision("dec-1")],
      [
        outcome({ eventId: "i1", decisionId: "dec-1", eventType: "impression", occurredAt: 1 }),
        outcome({ eventId: "c1", decisionId: "dec-1", eventType: "start", occurredAt: 2 }),
      ],
    );
    expect(result.unexposed.decisions).toBe(0);
    expect(result.lift.direction).toBe("inconclusive");
    expect(result.lift.absolutePct).toBeNull();
    expect(result.lift.ratio).toBeNull();
  });

  it("a zero baseline CTR yields no ratio (division by zero is withheld)", () => {
    const result = computeCtrLift(
      [decision("dec-1"), decision("dec-2")],
      [
        outcome({ eventId: "i1", decisionId: "dec-1", eventType: "impression", occurredAt: 1 }),
        outcome({ eventId: "c1", decisionId: "dec-1", eventType: "start", occurredAt: 2 }),
      ],
    );
    expect(result.unexposed.ctr).toBe(0);
    expect(result.lift.ratio).toBeNull();
    expect(result.lift.absolutePct).toBeCloseTo(100, 10);
  });

  it("empty inputs produce empty groups with null rates", () => {
    const result = computeCtrLift([], []);
    expect(result.exposed).toEqual({ decisions: 0, engaged: 0, ctr: null, wilsonLow: null, wilsonHigh: null });
    expect(result.unexposed.ctr).toBeNull();
    expect(result.lift.direction).toBe("inconclusive");
  });
});

/* ---------------- confidence caveat rendering model ---------------- */

describe("confidence caveats (deterministic from the result)", () => {
  it("the observational caveat is ALWAYS present — no fabricated significance", () => {
    const caveats = ctrCaveats(computeCtrLift([], []));
    expect(caveats[0]?.id).toBe("observational");
  });

  it("small groups carry the small-sample caveat", () => {
    const result = computeCtrLift(
      [decision("dec-1"), decision("dec-2")],
      [outcome({ eventId: "i1", decisionId: "dec-1", eventType: "impression" })],
    );
    const ids = ctrCaveats(result).map((caveat) => caveat.id);
    expect(ids).toContain("small-sample-exposed");
    expect(ids).toContain("small-sample-unexposed");
  });

  it("an empty baseline carries the no-baseline caveat; a zero-CTR baseline the zero-baseline caveat", () => {
    // Every decision exposed → the baseline group is EMPTY.
    const noBaseline = ctrCaveats(
      computeCtrLift(
        [decision("dec-1"), decision("dec-2")],
        [
          outcome({ eventId: "i1", decisionId: "dec-1", eventType: "impression", occurredAt: 1 }),
          outcome({ eventId: "i2", decisionId: "dec-2", eventType: "impression", occurredAt: 1 }),
        ],
      ),
    );
    expect(noBaseline.map((caveat) => caveat.id)).toContain("no-baseline");

    const zeroBaseline = ctrCaveats(
      computeCtrLift(
        [decision("dec-1"), decision("dec-2")],
        [outcome({ eventId: "i1", decisionId: "dec-1", eventType: "impression" })],
      ),
    );
    expect(zeroBaseline.map((caveat) => caveat.id)).toContain("zero-baseline-ctr");
    expect(zeroBaseline.map((caveat) => caveat.id)).not.toContain("no-baseline");
  });

  it("exclusion caveats appear ONLY when the excluded counts are non-zero", () => {
    const clean = ctrCaveats(computeCtrLift([decision("dec-1")], []));
    expect(clean.map((caveat) => caveat.id)).not.toContain("research-evidence-excluded");
    expect(clean.map((caveat) => caveat.id)).not.toContain("unlinked-outcomes-excluded");

    const excluded = ctrCaveats(
      computeCtrLift(
        [decision("dec-1")],
        [
          outcome({ eventId: "r", evidenceClass: "fixture" }),
          outcome({ eventId: "u", decisionId: null }),
        ],
      ),
    );
    const ids = excluded.map((caveat) => caveat.id);
    expect(ids).toContain("research-evidence-excluded");
    expect(ids).toContain("unlinked-outcomes-excluded");
  });

  it("caveat sentences render the observed counts verbatim", () => {
    const caveats = ctrCaveats(
      computeCtrLift(
        [decision("dec-1")],
        [outcome({ eventId: "r", evidenceClass: "counterfactual" })],
      ),
    );
    const research = caveats.find((caveat) => caveat.id === "research-evidence-excluded");
    expect(research?.sentence).toContain("1 outcome(s)");
  });
});

/* ---------------- view model ---------------- */

describe("ctrLiftView (view-model shape)", () => {
  const decisions = ["dec-1", "dec-2", "dec-3", "dec-4", "dec-5", "dec-6", "dec-7", "dec-8"].map(decision);
  const result = computeCtrLift(decisions, [
    outcome({ eventId: "i1", decisionId: "dec-1", eventType: "impression", occurredAt: 1 }),
    outcome({ eventId: "i2", decisionId: "dec-2", eventType: "impression", occurredAt: 1 }),
    outcome({ eventId: "i3", decisionId: "dec-3", eventType: "impression", occurredAt: 1 }),
    outcome({ eventId: "i4", decisionId: "dec-4", eventType: "impression", occurredAt: 1 }),
    outcome({ eventId: "c1", decisionId: "dec-1", eventType: "start", occurredAt: 2 }),
    outcome({ eventId: "c2", decisionId: "dec-2", eventType: "purchase", occurredAt: 2 }),
    outcome({ eventId: "c3", decisionId: "dec-5", eventType: "conversion", occurredAt: 2 }),
  ]);
  const view = ctrLiftView(result);

  it("tags the computed data as observed evidence", () => {
    expect(view.evidenceClass).toBe("observed");
  });

  it("formats the lift, ratio and group rates", () => {
    expect(view.liftLabel).toBe("+25.0 pp");
    expect(view.liftRatioLabel).toBe("×2.00");
    expect(view.groups.map((group) => group.ctrLabel)).toEqual(["50.0%", "25.0%"]);
    expect(view.groups.map((group) => group.nLabel)).toEqual(["n = 4 decisions", "n = 4 decisions"]);
  });

  it("every group carries its CI label and the caveats ride along", () => {
    for (const group of view.groups) {
      expect(group.ciLabel).toMatch(/^95% CI /);
      expect(group.engagedLabel).toMatch(/engaged$/);
    }
    expect(view.caveats.length).toBeGreaterThan(0);
    expect(view.contextCounts).toHaveLength(4);
  });

  it("inconclusive results render 'not computable', never a zero", () => {
    const empty = ctrLiftView(computeCtrLift([], []));
    expect(empty.liftLabel).toBe("not computable");
    expect(empty.liftRatioLabel).toBeNull();
    expect(empty.groups.map((group) => group.ctrLabel)).toEqual(["not computable", "not computable"]);
  });
});

/* ---------------- surface attempts (injectable fetch) ---------------- */

describe("surface attempts (the honest outcome mapping)", () => {
  it("unconfigured when the studio key is missing", async () => {
    const result = await listDecisionTrail(
      { baseUrl: "http://127.0.0.1:8080", apiKey: "" },
      {},
      fetchReturning([]),
    );
    expect(result).toEqual({
      ok: false,
      failure: expect.objectContaining({ outcome: "unconfigured", pendingRoute: PENDING_DECISION_LIST_ROUTE }),
    });
  });

  it("unreachable when the network call fails", async () => {
    const failing: FetchLike = () => Promise.reject(new Error("ECONNREFUSED"));
    const result = await listOutcomeTrail(endpoint, {}, failing);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.outcome).toBe("unreachable");
      expect(result.failure.detail).toContain("ECONNREFUSED");
    }
  });

  it("404 maps to not-wired with the pending route named verbatim", async () => {
    const result = await listDecisionTrail(
      endpoint,
      {},
      fetchReturning([jsonResponse(404, { error: { code: "NOT_FOUND", message: "no route" } })]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.outcome).toBe("not-wired");
      expect(result.failure.pendingRoute).toBe(PENDING_DECISION_LIST_ROUTE);
      expect(result.failure.detail).toContain(PENDING_DECISION_LIST_ROUTE);
    }
  });

  it("the typed 501 NOT_WIRED envelope also maps to not-wired", async () => {
    const result = await listOutcomeTrail(
      endpoint,
      {},
      fetchReturning([jsonResponse(501, { error: { code: "NOT_WIRED", message: "not mounted" } })]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.outcome).toBe("not-wired");
      expect(result.failure.pendingRoute).toBe(PENDING_OUTCOME_LIST_ROUTE);
    }
  });

  it("a 200 body with the wrong shape is an error — withheld rather than guessed", async () => {
    const result = await listOutcomeTrail(
      endpoint,
      {},
      fetchReturning([jsonResponse(200, { data: [{ eventId: "evt-1" }] })]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.outcome).toBe("error");
      expect(result.failure.httpStatus).toBe(200);
      expect(result.failure.detail).toContain("withheld rather than guessed");
    }
  });

  it("a valid 200 page flows through", async () => {
    const result = await listOutcomeTrail(
      endpoint,
      { limit: 100 },
      fetchReturning([
        jsonResponse(200, { data: [outcomeRow({})], pagination: { has_more: false, next_cursor: null } }),
      ]),
    );
    expect(result).toEqual({
      ok: true,
      data: { outcomes: [outcome({ eventId: "evt-1" })], pagination: PAGE },
    });
  });

  it("carries the S2-001 cursor params when requested", async () => {
    let seenUrl = "";
    const spy: FetchLike = (url) => {
      seenUrl = url;
      return Promise.resolve(
        jsonResponse(200, { data: [], pagination: PAGE }),
      );
    };
    await listDecisionTrail(endpoint, { startingAfter: "dec-9", limit: 50 }, spy);
    expect(seenUrl).toBe("http://127.0.0.1:8080/v1/decisions?starting_after=dec-9&limit=50");
  });
});
