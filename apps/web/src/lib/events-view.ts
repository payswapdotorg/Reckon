/**
 * Events-console view models (S3-001) — PURE logic, unit-tested in
 * test/events-view.test.ts.
 *
 * The webhook-events backend is S2-002 (event catalog + HMAC signatures
 * + replay). Until it lands, the console renders the honest surface
 * state (not-wired, naming GET /v1/events) plus the PLANNED event
 * catalog from the S2-002 work item — clearly labeled as roadmap, never
 * presented as observed data (Gate Q).
 *
 * Replay is a placeholder by design: the button exists (the affordance
 * is real) but is disabled with the pending route named
 * (POST /v1/events/{id}/replay) — it never fakes a delivery.
 */

import type { EventRecord } from "./developers-api.js";

/** The planned S2-002 event catalog (docs/work-items/state.json) — roadmap, not data. */
export const PLANNED_EVENT_CATALOG: readonly { readonly type: string; readonly meaning: string }[] = [
  { type: "recommendation.delivered", meaning: "A recommendation was served to a subject." },
  { type: "model.drift.detected", meaning: "A model's behavior drifted past its alert threshold." },
  { type: "schedule.executed", meaning: "A scheduled experience action was executed." },
];

/** The pending replay route, named verbatim in the UI. */
export const REPLAY_PENDING_ROUTE = "POST /v1/events/{id}/replay";

export interface EventRowView {
  readonly id: string;
  readonly type: string;
  readonly createdLabel: string;
  readonly status: string;
  /** Delivery tone for the status badge, classified from the reported status. */
  readonly statusTone: "ok" | "warn" | "error" | "neutral";
  /** Replay is pending (S2-002) — the affordance renders disabled. */
  readonly replayPending: true;
}

export function eventStatusTone(status: string): "ok" | "warn" | "error" | "neutral" {
  const normalized = status.trim().toLowerCase();
  if (normalized === "delivered" || normalized === "succeeded" || normalized === "ok") return "ok";
  if (normalized === "pending" || normalized === "retrying" || normalized === "queued") return "warn";
  if (normalized === "failed" || normalized === "dead" || normalized.startsWith("error")) return "error";
  return "neutral";
}

export function eventRowView(
  record: EventRecord,
  formatTime: (iso: string) => string = (iso) => iso,
): EventRowView {
  return {
    id: record.id,
    type: record.type,
    createdLabel: formatTime(record.created_at),
    status: record.status,
    statusTone: eventStatusTone(record.status),
    replayPending: true,
  };
}

export function eventRowsView(
  records: readonly EventRecord[],
  formatTime?: (iso: string) => string,
): readonly EventRowView[] {
  return records.map((record) => eventRowView(record, formatTime));
}
