/**
 * Drift analytics tests (S3-002) — the severity mapping boundaries, the
 * ratio computation, the S2-002 wire guards over the events feed, the
 * per-model indicator cards (latest evaluation wins, deterministic
 * ordering), the summary and the honest surface attempts.
 */
import { describe, expect, it } from "vitest";
import {
  DRIFT_EVENT_TYPE,
  DRIFT_WARNING_RATIO,
  PENDING_DRIFT_EVENT_ROUTE,
  driftModelCards,
  driftRatioPct,
  driftSeverityRank,
  driftSummary,
  driftView,
  listDriftEvents,
  parseDriftEventRecord,
  parseDriftEventsPage,
  severityForDrift,
  type DriftEventRecord,
} from "../src/lib/analytics-drift.js";
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

/* ---------------- fixtures (the S2-002 thin-event wire shape) ---------------- */

function driftRow(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "evt-drift-1",
    object: "event",
    created: 5000,
    type: DRIFT_EVENT_TYPE,
    data: {
      object: {
        modelId: "model-a",
        modelVersion: "3",
        driftScore: 0.42,
        threshold: 0.5,
        window: "72h",
        metric: "ctr-calibration",
        evaluatedAt: 4900,
      },
    },
    ...fields,
  };
}

function driftEvent(fields: Partial<DriftEventRecord> & { id: string }): DriftEventRecord {
  return {
    created: 5000,
    modelId: "model-a",
    modelVersion: "3",
    driftScore: 0.42,
    threshold: 0.5,
    window: "72h",
    metric: "ctr-calibration",
    evaluatedAt: 4900,
    ...fields,
  };
}

const PAGE = { has_more: false, next_cursor: null };

/* ---------------- severity mapping (frozen boundaries) ---------------- */

describe("severity mapping (driftScore vs threshold)", () => {
  it("at or over the threshold is critical", () => {
    expect(severityForDrift(0.5, 0.5)).toBe("critical");
    expect(severityForDrift(0.7, 0.5)).toBe("critical");
    expect(severityForDrift(10, 5)).toBe("critical");
  });

  it("at or over the warning band (80% of the threshold) is a warning", () => {
    expect(DRIFT_WARNING_RATIO).toBe(0.8);
    expect(severityForDrift(0.4, 0.5)).toBe("warning");
    expect(severityForDrift(0.45, 0.5)).toBe("warning");
  });

  it("below the warning band is info", () => {
    expect(severityForDrift(0.39, 0.5)).toBe("info");
    expect(severityForDrift(0, 0.5)).toBe("info");
  });

  it("a zero threshold: any positive drift is critical, zero drift is info", () => {
    expect(severityForDrift(0.01, 0)).toBe("critical");
    expect(severityForDrift(0, 0)).toBe("info");
  });

  it("the severity rank orders critical → warning → info", () => {
    expect(driftSeverityRank("critical")).toBeLessThan(driftSeverityRank("warning"));
    expect(driftSeverityRank("warning")).toBeLessThan(driftSeverityRank("info"));
  });
});

describe("drift ratio", () => {
  it("is the score as a percentage of the threshold, one decimal", () => {
    expect(driftRatioPct(0.45, 0.5)).toBe(90);
    expect(driftRatioPct(0.42, 0.5)).toBe(84);
    expect(driftRatioPct(1, 4)).toBe(25);
  });

  it("a zero threshold has no ratio — withheld, not infinite", () => {
    expect(driftRatioPct(0.3, 0)).toBeNull();
  });
});

/* ---------------- wire guards (the S2-002 event shape) ---------------- */

describe("drift event wire guards", () => {
  it("accepts the frozen thin-event shape and projects the payload", () => {
    expect(parseDriftEventRecord(driftRow())).toEqual(driftEvent({ id: "evt-drift-1" }));
  });

  it("rejects the wrong type, a missing payload and malformed fields", () => {
    expect(parseDriftEventRecord(driftRow({ type: "recommendation.delivered" }))).toBeNull();
    expect(parseDriftEventRecord(driftRow({ data: {} }))).toBeNull();
    expect(parseDriftEventRecord(driftRow({ data: { object: { modelId: "model-a" } } }))).toBeNull();
    expect(parseDriftEventRecord(driftRow({ id: "" }))).toBeNull();
    expect(parseDriftEventRecord(driftRow({ created: "5000" }))).toBeNull();
    expect(parseDriftEventRecord("not-an-object")).toBeNull();
  });

  it("rejects negative scores/thresholds (the frozen contract is non-negative)", () => {
    const withScore = driftRow();
    (withScore.data as { object: Record<string, unknown> }).object.driftScore = -0.1;
    expect(parseDriftEventRecord(withScore)).toBeNull();
  });

  it("a mixed feed parses drift rows and COUNTS other types (never an error)", () => {
    const page = parseDriftEventsPage({
      data: [
        driftRow(),
        { id: "evt-other-1", object: "event", created: 1, type: "schedule.executed", data: { object: {} } },
        { id: "evt-other-2", object: "event", created: 2, type: "preference.updated", data: { object: {} } },
      ],
      pagination: PAGE,
    });
    expect(page?.events).toHaveLength(1);
    expect(page?.otherTypeCount).toBe(2);
  });

  it("a drift-typed row WITHOUT the typed payload rejects the whole page", () => {
    const page = parseDriftEventsPage({
      data: [driftRow({ data: { object: { modelId: "model-a" } } })],
      pagination: PAGE,
    });
    expect(page).toBeNull();
  });

  it("a row without a type, or a missing envelope, rejects the page", () => {
    expect(parseDriftEventsPage({ data: [{ id: "x", created: 1 }], pagination: PAGE })).toBeNull();
    expect(parseDriftEventsPage({ data: [driftRow()] })).toBeNull();
    expect(parseDriftEventsPage({ data: "nope", pagination: PAGE })).toBeNull();
  });
});

/* ---------------- indicator cards (latest evaluation per model) ---------------- */

describe("drift indicator cards", () => {
  it("the latest evaluation per model wins (highest evaluatedAt)", () => {
    const cards = driftModelCards([
      driftEvent({ id: "e1", modelId: "model-a", driftScore: 0.5, threshold: 0.5, evaluatedAt: 100 }),
      driftEvent({ id: "e2", modelId: "model-a", driftScore: 0.1, threshold: 0.5, evaluatedAt: 900 }),
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.latestEventId).toBe("e2");
    expect(cards[0]?.severity).toBe("info");
    expect(cards[0]?.eventCount).toBe(2);
  });

  it("an exact evaluatedAt tie: the LAST input row wins (documented)", () => {
    const cards = driftModelCards([
      driftEvent({ id: "e1", modelId: "model-a", driftScore: 0.1, evaluatedAt: 100 }),
      driftEvent({ id: "e2", modelId: "model-a", driftScore: 0.9, threshold: 0.5, evaluatedAt: 100 }),
    ]);
    expect(cards[0]?.latestEventId).toBe("e2");
  });

  it("cards order by severity rank, then model id — deterministic", () => {
    const cards = driftModelCards([
      driftEvent({ id: "a1", modelId: "model-z", driftScore: 0.1, threshold: 0.5, evaluatedAt: 1 }),
      driftEvent({ id: "b1", modelId: "model-b", driftScore: 0.45, threshold: 0.5, evaluatedAt: 2 }),
      driftEvent({ id: "c1", modelId: "model-a", driftScore: 0.9, threshold: 0.5, evaluatedAt: 3 }),
    ]);
    expect(cards.map((card) => card.modelId)).toEqual(["model-a", "model-b", "model-z"]);
    expect(cards.map((card) => card.severity)).toEqual(["critical", "warning", "info"]);
  });

  it("the same severity orders alphabetically by model id", () => {
    const cards = driftModelCards([
      driftEvent({ id: "z1", modelId: "model-zeta", driftScore: 0.1, threshold: 0.5, evaluatedAt: 1 }),
      driftEvent({ id: "a1", modelId: "model-alpha", driftScore: 0.2, threshold: 0.5, evaluatedAt: 1 }),
    ]);
    expect(cards.map((card) => card.modelId)).toEqual(["model-alpha", "model-zeta"]);
  });

  it("empty input renders no cards", () => {
    expect(driftModelCards([])).toEqual([]);
  });
});

describe("drift summary", () => {
  it("aggregates models by severity and counts events", () => {
    const cards = driftModelCards([
      driftEvent({ id: "e1", modelId: "model-a", driftScore: 0.9, threshold: 0.5, evaluatedAt: 1 }),
      driftEvent({ id: "e2", modelId: "model-a", driftScore: 0.95, threshold: 0.5, evaluatedAt: 2 }),
      driftEvent({ id: "e3", modelId: "model-b", driftScore: 0.45, threshold: 0.5, evaluatedAt: 3 }),
      driftEvent({ id: "e4", modelId: "model-c", driftScore: 0.1, threshold: 0.5, evaluatedAt: 4 }),
    ]);
    const summary = driftSummary(cards, 7);
    expect(summary).toEqual({
      driftEvents: 4,
      models: 3,
      criticalModels: 1,
      warningModels: 1,
      infoModels: 1,
      otherTypeCount: 7,
    });
  });
});

/* ---------------- view model ---------------- */

describe("driftView (view-model shape)", () => {
  const cards = driftModelCards([
    driftEvent({ id: "e1", modelId: "model-a", driftScore: 0.9, threshold: 0.5, evaluatedAt: 1 }),
  ]);
  const view = driftView(driftSummary(cards, 0), cards);

  it("tags the feed data as observed evidence", () => {
    expect(view.evidenceClass).toBe("observed");
  });

  it("renders the model, severity, ratio and counts", () => {
    expect(view.cards).toHaveLength(1);
    const card = view.cards[0]!;
    expect(card.modelLabel).toBe("model-a");
    expect(card.severityLabel).toBe("Over threshold");
    expect(card.ratioLabel).toBe("180.0% of threshold");
    expect(card.scoreLabel).toBe("0.90");
    expect(card.thresholdLabel).toBe("0.50");
    expect(card.eventCountLabel).toBe("1 event(s) in window");
  });

  it("the reading notes state the latest-evaluation semantics", () => {
    expect(view.caveatSentences[0]).toContain("LATEST evaluation");
  });

  it("non-drift rows surface as a note, not an error", () => {
    const withOthers = driftView(driftSummary(cards, 3), cards);
    expect(withOthers.otherTypeLabel).toBe("3 non-drift event(s) in the feed");
    expect(withOthers.caveatSentences.some((sentence) => sentence.includes("other types"))).toBe(true);
  });

  it("a zero-threshold model renders 'threshold 0', never an infinite ratio", () => {
    const zeroCards = driftModelCards([
      driftEvent({ id: "e1", modelId: "model-x", driftScore: 0.3, threshold: 0, evaluatedAt: 1 }),
    ]);
    const zeroView = driftView(driftSummary(zeroCards, 0), zeroCards);
    expect(zeroView.cards[0]?.ratioLabel).toBe("threshold 0");
    expect(zeroView.cards[0]?.severity).toBe("critical");
  });
});

/* ---------------- surface attempts (injectable fetch) ---------------- */

describe("drift surface attempts (the honest outcome mapping)", () => {
  it("404 maps to not-wired with the events route named verbatim", async () => {
    const result = await listDriftEvents(endpoint, {}, fetchReturning([jsonResponse(404, "no route")]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.outcome).toBe("not-wired");
      expect(result.failure.pendingRoute).toBe(PENDING_DRIFT_EVENT_ROUTE);
      expect(PENDING_DRIFT_EVENT_ROUTE).toBe("GET /v1/events");
    }
  });

  it("a mixed 200 feed flows through with otherTypeCount", async () => {
    const result = await listDriftEvents(
      endpoint,
      { limit: 100 },
      fetchReturning([
        jsonResponse(200, {
          data: [
            driftRow(),
            { id: "evt-other", object: "event", created: 1, type: "schedule.executed", data: { object: {} } },
          ],
          pagination: PAGE,
        }),
      ]),
    );
    expect(result).toEqual({
      ok: true,
      data: {
        events: [driftEvent({ id: "evt-drift-1" })],
        otherTypeCount: 1,
        pagination: PAGE,
      },
    });
  });

  it("a 200 body with a malformed drift row is an error — withheld rather than guessed", async () => {
    const result = await listDriftEvents(
      endpoint,
      {},
      fetchReturning([jsonResponse(200, { data: [driftRow({ data: null })], pagination: PAGE })]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.outcome).toBe("error");
      expect(result.failure.detail).toContain("withheld rather than guessed");
    }
  });

  it("unconfigured when the studio key is missing", async () => {
    const result = await listDriftEvents(
      { baseUrl: "http://127.0.0.1:8080", apiKey: " " },
      {},
      fetchReturning([]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.outcome).toBe("unconfigured");
    }
  });
});
