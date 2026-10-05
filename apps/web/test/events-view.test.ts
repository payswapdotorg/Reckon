/**
 * Events-console view tests (S3-001) — event row view models, delivery
 * status classification, and the replay-placeholder rules (the
 * affordance is real, the action is S2-002-pending).
 */
import { describe, expect, it } from "vitest";
import {
  PLANNED_EVENT_CATALOG,
  REPLAY_PENDING_ROUTE,
  eventRowView,
  eventRowsView,
  eventStatusTone,
} from "../src/lib/events-view.js";
import type { EventRecord } from "../src/lib/developers-api.js";

const record: EventRecord = {
  id: "evt-1",
  type: "recommendation.delivered",
  created_at: "2026-10-03T10:00:00.000Z",
  status: "delivered",
};

describe("event rows", () => {
  it("maps type, created, status; replay is always pending (S2-002)", () => {
    const row = eventRowView(record, (iso) => iso.slice(0, 10));
    expect(row).toMatchObject({
      type: "recommendation.delivered",
      createdLabel: "2026-10-03",
      status: "delivered",
      statusTone: "ok",
      replayPending: true,
    });
  });

  it("maps every row in order", () => {
    const rows = eventRowsView([record, { ...record, id: "evt-2", status: "failed" }], () => "T");
    expect(rows.map((row) => row.id)).toEqual(["evt-1", "evt-2"]);
    expect(rows[1]?.statusTone).toBe("error");
  });

  it("replayPending is true for every row — the placeholder never fakes", () => {
    for (const row of eventRowsView([record])) {
      expect(row.replayPending).toBe(true);
    }
  });
});

describe("delivery status classification", () => {
  it("delivered/succeeded/ok → ok", () => {
    expect(eventStatusTone("delivered")).toBe("ok");
    expect(eventStatusTone("Succeeded")).toBe("ok");
    expect(eventStatusTone("OK")).toBe("ok");
  });

  it("pending/retrying/queued → warn", () => {
    expect(eventStatusTone("pending")).toBe("warn");
    expect(eventStatusTone("retrying")).toBe("warn");
    expect(eventStatusTone("queued")).toBe("warn");
  });

  it("failed/dead/error* → error", () => {
    expect(eventStatusTone("failed")).toBe("error");
    expect(eventStatusTone("dead")).toBe("error");
    expect(eventStatusTone("error: timeout")).toBe("error");
  });

  it("anything the API invents stays neutral (never misclassified)", () => {
    expect(eventStatusTone("")).toBe("neutral");
    expect(eventStatusTone("weird-state")).toBe("neutral");
  });
});

describe("the planned catalog is roadmap, not data", () => {
  it("names the S2-002 event types with meanings", () => {
    expect(PLANNED_EVENT_CATALOG.map((entry) => entry.type)).toEqual([
      "recommendation.delivered",
      "model.drift.detected",
      "schedule.executed",
    ]);
    for (const entry of PLANNED_EVENT_CATALOG) {
      expect(entry.meaning.length).toBeGreaterThan(10);
    }
  });

  it("the replay route is named verbatim for the placeholder", () => {
    expect(REPLAY_PENDING_ROUTE).toBe("POST /v1/events/{id}/replay");
  });
});
