/**
 * Drift analytics (S3-002) — PURE drift-indicator computation from the
 * model.drift events feed (the events console data source), unit-tested
 * in test/analytics-drift.test.ts. No "server-only", no env access, no
 * React (the root NodeNext typecheck covers this file through the test).
 *
 * WHAT IT COMPUTES (documented, exact semantics):
 *  - The drift feed is the events surface (GET /v1/events — the S3-001
 *    pending route the events console also attempts) filtered to
 *    `model.drift.detected` rows. The wire expectation is the S2-002
 *    frozen webhook-event contract: the thin envelope
 *    `{ id, object: "event", created, tenant, type, data: { object: … } }`
 *    whose drift payload carries { modelId, modelVersion, driftScore,
 *    threshold, window, metric, evaluatedAt } verbatim.
 *  - SEVERITY MAPPING (frozen, documented): ratio = driftScore / threshold.
 *    ratio ≥ 1 → CRITICAL (the model crossed its alert threshold);
 *    ratio ≥ 0.8 → WARNING (approaching the threshold); below → INFO.
 *    A zero threshold with a positive score is CRITICAL (any drift
 *    crosses it); a zero threshold with a zero score is INFO.
 *  - INDICATOR CARDS: one card per model — the LATEST evaluation wins
 *    (highest evaluatedAt; input order breaks exact ties), with the
 *    model's total event count. Cards order by severity, then model id
 *    (deterministic).
 *  - Rows of OTHER event types are a legitimate part of a general events
 *    feed: they are counted (`otherTypeCount`), never treated as errors.
 *    A drift-typed row that does not carry the typed payload IS a shape
 *    violation — the page parse fails honestly (withheld, not guessed).
 *
 * The events read itself is pending (GET /v1/events); the fetch attempts
 * the real route with injectable fetch, exactly the developers-api law.
 */

import {
  attemptSurfaceCall,
  parsePaginationEnvelope,
  type FetchLike,
  type PaginationEnvelope,
  type SurfaceEndpoint,
  type SurfaceResult,
} from "./developers-api.js";
import type { EvidenceClassId } from "./evidence.js";

/* ================================================================== *
 * The drift feed route + event type (named verbatim in honest states)
 * ================================================================== */

/** The events-console data source (the S3-001 pending list route). */
export const PENDING_DRIFT_EVENT_ROUTE = "GET /v1/events";

/** The S2-002 event-catalog type this view consumes. */
export const DRIFT_EVENT_TYPE = "model.drift.detected";

/* ================================================================== *
 * Severity mapping (frozen constants + pure function)
 * ================================================================== */

export type DriftSeverity = "critical" | "warning" | "info";

/**
 * The warning band: a drift score at or above this fraction of the
 * threshold is "approaching" it.
 */
export const DRIFT_WARNING_RATIO = 0.8;

/**
 * Severity for one drift evaluation. Pure and total: both inputs are
 * non-negative finite numbers by the wire guard, so a severity always
 * exists — there is no "unknown" severity to render.
 */
export function severityForDrift(driftScore: number, threshold: number): DriftSeverity {
  if (threshold <= 0) {
    // A zero threshold: any positive drift crosses it; zero drift is clean.
    return driftScore > 0 ? "critical" : "info";
  }
  const ratio = driftScore / threshold;
  if (ratio >= 1) {
    return "critical";
  }
  if (ratio >= DRIFT_WARNING_RATIO) {
    return "warning";
  }
  return "info";
}

/** severity rank for deterministic ordering (critical first). */
export function driftSeverityRank(severity: DriftSeverity): number {
  if (severity === "critical") {
    return 0;
  }
  if (severity === "warning") {
    return 1;
  }
  return 2;
}

/** driftScore / threshold × 100, rounded to one decimal — null when the threshold is 0. */
export function driftRatioPct(driftScore: number, threshold: number): number | null {
  if (threshold <= 0) {
    return null;
  }
  return Math.round((driftScore / threshold) * 1000) / 10;
}

/* ================================================================== *
 * Drift event records + strict wire guards
 * ================================================================== */

/**
 * One model.drift.detected event — the S2-002 thin envelope projected to
 * the fields this view consumes (the payload fields are verbatim from
 * the frozen ModelDriftDetectedData contract).
 */
export interface DriftEventRecord {
  readonly id: string;
  readonly created: number;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly driftScore: number;
  readonly threshold: number;
  readonly window: string;
  readonly metric: string;
  readonly evaluatedAt: number;
}

export interface DriftEventsPage {
  readonly events: readonly DriftEventRecord[];
  /** Rows of other (non-drift) event types in the same feed — counted, not errors. */
  readonly otherTypeCount: number;
  readonly pagination: PaginationEnvelope;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asNonNegativeNumber(value: unknown): number | null {
  const number = asFiniteNumber(value);
  return number !== null && number >= 0 ? number : null;
}

/**
 * Guard one drift event row: the frozen S2-002 shape. `type` must be the
 * drift type (callers pre-filter); the payload must carry every typed
 * field. Anything else is a shape violation — null, never a guess.
 */
export function parseDriftEventRecord(value: unknown): DriftEventRecord | null {
  if (!isRecord(value)) return null;
  if (value["type"] !== DRIFT_EVENT_TYPE) return null;
  const id = asNonEmptyString(value["id"]);
  const created = asFiniteNumber(value["created"]);
  const data = isRecord(value["data"]) ? value["data"] : null;
  const payload = data !== null && isRecord(data["object"]) ? data["object"] : null;
  if (id === null || created === null || payload === null) return null;
  const modelId = asNonEmptyString(payload["modelId"]);
  const modelVersion = asNonEmptyString(payload["modelVersion"]);
  const driftScore = asNonNegativeNumber(payload["driftScore"]);
  const threshold = asNonNegativeNumber(payload["threshold"]);
  const window = asNonEmptyString(payload["window"]);
  const metric = asNonEmptyString(payload["metric"]);
  const evaluatedAt = asFiniteNumber(payload["evaluatedAt"]);
  if (
    modelId === null ||
    modelVersion === null ||
    driftScore === null ||
    threshold === null ||
    window === null ||
    metric === null ||
    evaluatedAt === null
  ) {
    return null;
  }
  return { id, created, modelId, modelVersion, driftScore, threshold, window, metric, evaluatedAt };
}

/**
 * Guard a drift feed page: the S2-001 list envelope over S2-002 webhook
 * event rows. Every row must be an event record with a non-empty type;
 * non-drift rows are counted as `otherTypeCount`, drift rows must parse
 * strictly.
 */
export function parseDriftEventsPage(value: unknown): DriftEventsPage | null {
  if (!isRecord(value) || !Array.isArray(value["data"])) return null;
  const events: DriftEventRecord[] = [];
  let otherTypeCount = 0;
  for (const row of value["data"]) {
    if (!isRecord(row)) return null;
    const type = asNonEmptyString(row["type"]);
    if (type === null) return null;
    if (type !== DRIFT_EVENT_TYPE) {
      otherTypeCount += 1;
      continue;
    }
    const record = parseDriftEventRecord(row);
    if (record === null) return null;
    events.push(record);
  }
  const pagination = parsePaginationEnvelope(value["pagination"]);
  if (pagination === null) return null;
  return { events, otherTypeCount, pagination };
}

/* ================================================================== *
 * Surface attempt (inject your own fetch in tests)
 * ================================================================== */

/**
 * GET /v1/events — the drift feed (the events-console data source,
 * filtered dashboard-side to the drift type). Pending; the honest
 * not-wired state names the route verbatim.
 */
export async function listDriftEvents(
  endpoint: SurfaceEndpoint,
  options: { readonly startingAfter?: string; readonly limit?: number },
  fetchImpl: FetchLike,
): Promise<SurfaceResult<DriftEventsPage>> {
  const params = new URLSearchParams();
  if (options.startingAfter !== undefined && options.startingAfter.length > 0) {
    params.set("starting_after", options.startingAfter);
  }
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  const result = await attemptSurfaceCall(endpoint, PENDING_DRIFT_EVENT_ROUTE, `/v1/events${query}`, { method: "GET" }, fetchImpl);
  if (!result.ok) return result;
  const page = parseDriftEventsPage(result.body);
  if (page === null) {
    return {
      ok: false,
      failure: {
        outcome: "error",
        detail:
          `${PENDING_DRIFT_EVENT_ROUTE} answered 200 but the body did not match the expected ` +
          `S2-001 list envelope over S2-002 webhook event rows ({ data: [{ id, type, created, data: { object: … } }, …], pagination }) — ` +
          `the response was withheld rather than guessed.`,
        pendingRoute: PENDING_DRIFT_EVENT_ROUTE,
        httpStatus: 200,
      },
    };
  }
  return { ok: true, data: page };
}

/* ================================================================== *
 * Indicator cards (per model, latest evaluation wins)
 * ================================================================== */

export interface DriftModelCard {
  readonly modelId: string;
  readonly modelVersion: string;
  readonly metric: string;
  readonly window: string;
  readonly driftScore: number;
  readonly threshold: number;
  readonly ratioPct: number | null;
  readonly severity: DriftSeverity;
  readonly eventCount: number;
  readonly latestEvaluatedAt: number;
  readonly latestEventId: string;
}

/**
 * Per-model drift indicator cards: the LATEST evaluation per model
 * (highest evaluatedAt; the LAST input row wins exact ties), each with
 * the model's total event count in the feed. Cards order by severity
 * rank, then model id — deterministic.
 */
export function driftModelCards(events: readonly DriftEventRecord[]): readonly DriftModelCard[] {
  interface ModelAccumulator {
    latest: DriftEventRecord;
    count: number;
  }
  const byModel = new Map<string, ModelAccumulator>();
  for (const event of events) {
    const current = byModel.get(event.modelId);
    if (current === undefined) {
      byModel.set(event.modelId, { latest: event, count: 1 });
      continue;
    }
    current.count += 1;
    if (event.evaluatedAt >= current.latest.evaluatedAt) {
      current.latest = event;
    }
  }
  const cards: DriftModelCard[] = [];
  for (const [modelId, accumulator] of byModel) {
    const latest = accumulator.latest;
    cards.push({
      modelId,
      modelVersion: latest.modelVersion,
      metric: latest.metric,
      window: latest.window,
      driftScore: latest.driftScore,
      threshold: latest.threshold,
      ratioPct: driftRatioPct(latest.driftScore, latest.threshold),
      severity: severityForDrift(latest.driftScore, latest.threshold),
      eventCount: accumulator.count,
      latestEvaluatedAt: latest.evaluatedAt,
      latestEventId: latest.id,
    });
  }
  cards.sort((a, b) => {
    const rankDelta = driftSeverityRank(a.severity) - driftSeverityRank(b.severity);
    if (rankDelta !== 0) return rankDelta;
    if (a.modelId < b.modelId) return -1;
    if (a.modelId > b.modelId) return 1;
    return 0;
  });
  return cards;
}

export interface DriftSummary {
  readonly driftEvents: number;
  readonly models: number;
  readonly criticalModels: number;
  readonly warningModels: number;
  readonly infoModels: number;
  readonly otherTypeCount: number;
}

/** Aggregate summary over the cards + the feed's non-drift row count. */
export function driftSummary(
  cards: readonly DriftModelCard[],
  otherTypeCount: number,
): DriftSummary {
  let criticalModels = 0;
  let warningModels = 0;
  let infoModels = 0;
  let driftEvents = 0;
  for (const card of cards) {
    if (card.severity === "critical") {
      criticalModels += 1;
    } else if (card.severity === "warning") {
      warningModels += 1;
    } else {
      infoModels += 1;
    }
    driftEvents += card.eventCount;
  }
  return { driftEvents, models: cards.length, criticalModels, warningModels, infoModels, otherTypeCount };
}

/* ================================================================== *
 * View model (built ONLY from real fetched records → evidence "observed")
 * ================================================================== */

export interface DriftCardView {
  readonly modelLabel: string;
  readonly versionLabel: string;
  readonly metricLabel: string;
  readonly windowLabel: string;
  readonly scoreLabel: string;
  readonly thresholdLabel: string;
  readonly ratioLabel: string;
  readonly severity: DriftSeverity;
  readonly severityLabel: string;
  readonly eventCountLabel: string;
}

export interface DriftView {
  readonly evidenceClass: EvidenceClassId;
  readonly summary: DriftSummary;
  readonly cards: readonly DriftCardView[];
  readonly otherTypeLabel: string | null;
  readonly caveatSentences: readonly string[];
}

const SEVERITY_LABELS: Record<DriftSeverity, string> = {
  critical: "Over threshold",
  warning: "Approaching threshold",
  info: "Within threshold",
};

/** Render-ready view model over the drift feed (evidence: observed). */
export function driftView(summary: DriftSummary, cards: readonly DriftModelCard[]): DriftView {
  const cardViews: DriftCardView[] = cards.map((card) => ({
    modelLabel: card.modelId,
    versionLabel: `v${card.modelVersion}`,
    metricLabel: card.metric,
    windowLabel: card.window,
    scoreLabel: card.driftScore.toFixed(2),
    thresholdLabel: card.threshold.toFixed(2),
    ratioLabel: card.ratioPct === null ? "threshold 0" : `${card.ratioPct.toFixed(1)}% of threshold`,
    severity: card.severity,
    severityLabel: SEVERITY_LABELS[card.severity],
    eventCountLabel: `${card.eventCount} event(s) in window`,
  }));
  const caveatSentences: string[] = [
    "Each card shows the model's LATEST evaluation from the feed — earlier events are counted, not shown.",
  ];
  if (summary.otherTypeCount > 0) {
    caveatSentences.push(
      `${summary.otherTypeCount} event(s) of other types rode the same feed — counted here, not part of the drift picture.`,
    );
  }
  return {
    evidenceClass: "observed",
    summary,
    cards: cardViews,
    otherTypeLabel:
      summary.otherTypeCount > 0 ? `${summary.otherTypeCount} non-drift event(s) in the feed` : null,
    caveatSentences,
  };
}
