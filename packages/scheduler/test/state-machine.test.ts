/**
 * W2-004 acceptance tests — the LEGAL-TRANSITION MATRIX.
 *
 * SCHEDULER-ACTION LAW (lock #11): the scheduler emits exactly the eight
 * actions, every transition is validated against the matrix, and illegal
 * transitions are typed errors. This file tests the FULL 5×8 matrix
 * against a hard-coded expected table (the documented matrix), plus
 * decide()'s fail-closed behavior on terminal and illegal situations.
 */
import { describe, expect, it } from "vitest";
import type { ScheduleAction } from "@reckon/contracts";
import {
  ALL_ACTIONS,
  decide,
  isLegalTransition,
  LEGAL_TRANSITIONS,
  legalActionsFrom,
  nextStatus,
  PLAN_STATUSES,
  type PlanState,
  type PlanStatus,
} from "../src/index.js";

/** The documented legal-transition matrix, hard-coded for the test.
 *  `null` = ILLEGAL (typed error). */
const EXPECTED_MATRIX: Record<PlanStatus, Partial<Record<ScheduleAction, PlanStatus | null>>> = {
  idle: { HOLD: "idle", QUEUE: "queued", SUGGEST: "idle", RESUME: "playing", END: "ended", CONTINUE: null, SWITCH: null, INTERRUPT: null },
  queued: { HOLD: "queued", CONTINUE: "playing", QUEUE: "queued", SUGGEST: "queued", RESUME: "playing", END: "ended", SWITCH: null, INTERRUPT: null },
  playing: { HOLD: "playing", CONTINUE: "playing", QUEUE: "playing", SUGGEST: "playing", SWITCH: "playing", INTERRUPT: "interrupted", END: "ended", RESUME: null },
  interrupted: { HOLD: "interrupted", QUEUE: "interrupted", SUGGEST: "interrupted", SWITCH: "playing", RESUME: "playing", END: "ended", CONTINUE: null, INTERRUPT: null },
  ended: { HOLD: null, CONTINUE: null, QUEUE: null, SUGGEST: null, SWITCH: null, INTERRUPT: null, RESUME: null, END: null },
};

describe("W2-004 legal-transition matrix (full 5×8)", () => {
  it("exposes exactly the eight scheduler actions and five plan states", () => {
    expect(ALL_ACTIONS).toEqual([
      "HOLD",
      "CONTINUE",
      "QUEUE",
      "SUGGEST",
      "SWITCH",
      "INTERRUPT",
      "RESUME",
      "END",
    ]);
    expect(PLAN_STATUSES).toEqual(["idle", "playing", "queued", "interrupted", "ended"]);
  });

  it("matches the documented expected matrix for every (state, action) cell", () => {
    for (const status of PLAN_STATUSES) {
      for (const action of ALL_ACTIONS) {
        const expected = EXPECTED_MATRIX[status][action] ?? null;
        const actualLegal = isLegalTransition(status, action);
        const actualNext = nextStatus(status, action);
        if (expected === null) {
          expect(`${status}/${action} legal=${actualLegal}`).toBe(`${status}/${action} legal=false`);
          expect(actualNext).toBeUndefined();
        } else {
          expect(`${status}/${action} legal=${actualLegal}`).toBe(`${status}/${action} legal=true`);
          expect(actualNext).toBe(expected);
        }
      }
    }
  });

  it("ends (terminal state) has NO outgoing transitions at all", () => {
    expect(legalActionsFrom("ended")).toEqual([]);
    expect(LEGAL_TRANSITIONS.ended).toEqual({});
  });

  it("legalActionsFrom matches the matrix for every state", () => {
    for (const status of PLAN_STATUSES) {
      const expected = ALL_ACTIONS.filter((a) => (EXPECTED_MATRIX[status][a] ?? null) !== null);
      expect(legalActionsFrom(status).sort()).toEqual([...expected].sort());
    }
  });
});

describe("W2-004 decide(): terminal state and malformed states (typed errors)", () => {
  const baseRequest = {
    requestId: "req-1",
    tenant: { tenantId: "t-1" },
    subject: { kind: "user" as const, ref: "user-9" },
    objective: { objectiveId: "obj-1", kind: "relax" as const },
    attentionPolicy: { policyId: "ap-1", style: "balanced" as const },
    context: { contextId: "ctx-1" },
    candidates: {
      setId: "cs-1",
      candidates: [{ itemId: "item-1", realizationIds: [], source: "host-retrieval" }],
    },
    policySelector: { policyId: "p1", version: "1" },
    idempotencyKey: "idem-1",
  };

  function stateWith(status: PlanStatus, overrides: Partial<PlanState> = {}): PlanState {
    return {
      status,
      queue: [],
      resumeCheckpoints: [],
      ...(status === "playing" ? { currentExperienceId: "exp-1" } : {}),
      ...(status === "interrupted" ? { interruptedExperienceId: "exp-1" } : {}),
      ...overrides,
    };
  }

  it("returns a typed ILLEGAL_TRANSITION error from the terminal `ended` state", () => {
    const result = decide({
      currentState: stateWith("ended"),
      request: baseRequest as never,
      scored: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ILLEGAL_TRANSITION");
      if (result.error.code === "ILLEGAL_TRANSITION") {
        expect(result.error.from).toBe("ended");
      }
    }
  });

  it("returns typed INVALID_INPUT errors for malformed plan states", () => {
    const malformed: unknown[] = [
      { status: "playing", queue: [], resumeCheckpoints: [] }, // playing without current
      { status: "queued", queue: [], resumeCheckpoints: [] }, // queued with empty queue
      { status: "interrupted", queue: [], resumeCheckpoints: [] }, // interrupted without id
      { status: "floating", queue: [], resumeCheckpoints: [] }, // unknown status
    ];
    for (const currentState of malformed) {
      const result = decide({
        currentState: currentState as PlanState,
        request: baseRequest as never,
        scored: [],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
    }
  });
});
