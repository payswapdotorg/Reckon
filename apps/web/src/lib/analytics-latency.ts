/**
 * Latency analytics (S3-002) — PURE percentile computation over decision
 * latencies from the request-log trail, unit-tested in
 * test/analytics-latency.test.ts. No "server-only", no env access, no
 * React (the root NodeNext typecheck covers this file through the test).
 *
 * WHAT IT COMPUTES (documented, exact semantics):
 *  - The sample set is the DECISION-route requests in the request-log
 *    trail: `POST /v1/decisions` rows (the S2-001 vocabulary records the
 *    route verbatim, with or without the method prefix).
 *  - Percentiles use the NEAREST-RANK method: the smallest value whose
 *    rank (1-based, ascending) is ≥ ceil(p/100 × n). Deterministic,
 *    explainable, the SLA convention — no interpolation is invented.
 *  - Every percentile row carries its honest "n=" sample count; an empty
 *    sample set yields NULL percentiles, never zeros.
 *  - Bucketing: a fixed, documented latency histogram (the CSS chart's
 *    data) with per-bucket counts and shares.
 *  - MODE AWARENESS: request-log rows carry the key prefix; samples from
 *    test keys (sk_test_/pk_test_) are labeled TEST evidence, live keys
 *    (sk_live_/pk_live_) LIVE evidence, anything else unlabeled — the
 *    per-mode split renders with the mode machine's own vocabulary.
 *  - Negative/non-positive latency samples are broken records: excluded
 *    from percentiles/buckets and REPORTED (withheld rather than guessed).
 *
 * The request-log read itself is the S3-001 pending route
 * (GET /v1/request-logs); the fetch lives in developers-api.ts and is
 * reused by the analytics surface seam — nothing here fabricates rows.
 */

import { PENDING_REQUEST_LOG_ROUTE, type RequestLogRecord, type SurfaceResult } from "./developers-api.js";
import type { EvidenceClassId } from "./evidence.js";
import { statusToneFor } from "./request-logs-view.js";

export { PENDING_REQUEST_LOG_ROUTE };

/* ================================================================== *
 * Decision-route classification + key-mode evidence
 * ================================================================== */

/** The decision surface this view measures (the frozen API route). */
export const DECISION_ROUTE_PATH = "/v1/decisions";

/**
 * A decision-route request row. The S2-001 request-log vocabulary records
 * routes verbatim as "METHOD /path" strings; both spellings of the
 * decision route are accepted, nothing else.
 */
export function isDecisionRequest(record: RequestLogRecord): boolean {
  if (record.method.trim().toUpperCase() !== "POST") {
    return false;
  }
  const route = record.route.trim();
  return route === DECISION_ROUTE_PATH || route === `POST ${DECISION_ROUTE_PATH}`;
}

export type RequestKeyMode = "test" | "live" | "unlabeled";

/**
 * Mode evidence from the S2-003 key vocabulary: the sk_/pk_ prefix the
 * request-log row reports, matched LITERALLY (the vocabulary is
 * lowercase by construction). Honest by construction — any other
 * spelling is UNLABELED, never guessed into a mode.
 */
export function keyModeFromPrefix(prefix: string): RequestKeyMode {
  const literal = prefix.trim();
  if (literal.startsWith("sk_test_") || literal.startsWith("pk_test_")) {
    return "test";
  }
  if (literal.startsWith("sk_live_") || literal.startsWith("pk_live_")) {
    return "live";
  }
  return "unlabeled";
}

/* ================================================================== *
 * Percentiles (nearest-rank) + buckets
 * ================================================================== */

/** The reported percentiles, in presentation order. */
export const LATENCY_PERCENTILES: readonly (50 | 95 | 99)[] = [50, 95, 99];

/**
 * Nearest-rank percentile over the sample values: ascending sort, rank =
 * ceil(p/100 × n), value = sorted[rank − 1]. Null on an empty input —
 * never a fabricated zero.
 */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0 || !Number.isFinite(p) || p <= 0 || p > 100) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  // ceil of a positive fraction is ≥ 1; clamp guards float dust.
  const index = Math.min(Math.max(rank, 1), sorted.length) - 1;
  return sorted[index] ?? null;
}

/**
 * The latency histogram bucket edges (ms), frozen for cross-window
 * comparability: [0,50), [50,100), [100,200), [200,500), [500,1000),
 * [1000,∞). The last bucket is open-ended.
 */
export const LATENCY_BUCKET_EDGES: readonly number[] = [0, 50, 100, 200, 500, 1000];

export const LATENCY_BUCKET_LABELS: readonly string[] = [
  "0–49 ms",
  "50–99 ms",
  "100–199 ms",
  "200–499 ms",
  "500–999 ms",
  "1000 ms+",
];

export interface LatencyBucket {
  readonly label: string;
  readonly floorMs: number;
  /** Exclusive upper edge; null = the open-ended last bucket. */
  readonly ceilingMs: number | null;
  readonly count: number;
  /** count / n × 100, rounded to one decimal — null when n = 0. */
  readonly sharePct: number | null;
}

function bucketFor(latencyMs: number): number {
  for (let index = LATENCY_BUCKET_EDGES.length - 1; index >= 0; index -= 1) {
    if (latencyMs >= LATENCY_BUCKET_EDGES[index]) {
      return index;
    }
  }
  return 0;
}

/* ================================================================== *
 * Summary + per-mode split + caveats
 * ================================================================== */

export interface LatencyModeSummary {
  readonly mode: RequestKeyMode;
  readonly label: string;
  readonly n: number;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
}

export interface LatencyCaveat {
  readonly id: string;
  readonly sentence: string;
}

export interface LatencySummary {
  /** Decision-route samples used (non-positive samples excluded). */
  readonly n: number;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
  readonly minMs: number | null;
  readonly maxMs: number | null;
  /** Status mix of the decision-route rows actually observed (all statuses kept). */
  readonly statusCounts: { readonly ok: number; readonly warn: number; readonly error: number };
  /** Non-positive latency rows — broken records, excluded and reported. */
  readonly nonPositiveSamples: number;
  /** Request-log rows that were NOT decision-route requests. */
  readonly otherRouteSamples: number;
  readonly byMode: readonly LatencyModeSummary[];
  readonly buckets: readonly LatencyBucket[];
  readonly caveats: readonly LatencyCaveat[];
}

/** Groups below this size carry the small-sample caveat. */
export const LATENCY_SMALL_SAMPLE_THRESHOLD = 20;

function modeLabelFor(mode: RequestKeyMode): string {
  if (mode === "test") return "Test-key traffic";
  if (mode === "live") return "Live-key traffic";
  return "Unlabeled keys";
}

export function latencySummary(records: readonly RequestLogRecord[]): LatencySummary {
  const decisionRows: RequestLogRecord[] = [];
  let otherRouteSamples = 0;
  for (const record of records) {
    if (isDecisionRequest(record)) {
      decisionRows.push(record);
    } else {
      otherRouteSamples += 1;
    }
  }

  const statusCounts = { ok: 0, warn: 0, error: 0 };
  const samples: number[] = [];
  const samplesByMode = new Map<RequestKeyMode, number[]>();
  let nonPositiveSamples = 0;
  for (const row of decisionRows) {
    const tone = statusToneFor(row.status);
    statusCounts[tone] += 1;
    if (row.latency_ms <= 0) {
      nonPositiveSamples += 1;
      continue;
    }
    samples.push(row.latency_ms);
    const mode = keyModeFromPrefix(row.key_prefix);
    const bucket = samplesByMode.get(mode) ?? [];
    bucket.push(row.latency_ms);
    samplesByMode.set(mode, bucket);
  }

  const bucketCounts = LATENCY_BUCKET_EDGES.map(() => 0);
  for (const sample of samples) {
    bucketCounts[bucketFor(sample)] += 1;
  }
  const buckets: LatencyBucket[] = LATENCY_BUCKET_EDGES.map((floorMs, index) => ({
    label: LATENCY_BUCKET_LABELS[index] ?? `${floorMs} ms+`,
    floorMs,
    ceilingMs: index < LATENCY_BUCKET_EDGES.length - 1 ? LATENCY_BUCKET_EDGES[index + 1] : null,
    count: bucketCounts[index] ?? 0,
    sharePct: samples.length > 0 ? Math.round(((bucketCounts[index] ?? 0) / samples.length) * 1000) / 10 : null,
  }));

  const byMode: LatencyModeSummary[] = [];
  for (const mode of ["test", "live", "unlabeled"] as const) {
    const modeSamples = samplesByMode.get(mode);
    if (modeSamples === undefined || modeSamples.length === 0) {
      continue;
    }
    byMode.push({
      mode,
      label: modeLabelFor(mode),
      n: modeSamples.length,
      p50: percentile(modeSamples, 50),
      p95: percentile(modeSamples, 95),
      p99: percentile(modeSamples, 99),
    });
  }

  const caveats: LatencyCaveat[] = [];
  if (samples.length === 0) {
    caveats.push({
      id: "no-samples",
      sentence: "No decision-route samples are in the fetched log window — percentiles are withheld, not zero.",
    });
  } else {
    if (samples.length < LATENCY_SMALL_SAMPLE_THRESHOLD) {
      caveats.push({
        id: "small-sample",
        sentence: `n = ${samples.length} decision requests — percentiles over a small window move sharply with each new request.`,
      });
    }
    if (nonPositiveSamples > 0) {
      caveats.push({
        id: "non-positive-samples",
        sentence: `${nonPositiveSamples} decision request(s) reported a non-positive latency — broken records, excluded from percentiles and buckets.`,
      });
    }
    const unlabeled = byMode.find((entry) => entry.mode === "unlabeled");
    if (unlabeled !== undefined) {
      caveats.push({
        id: "unlabeled-keys",
        sentence: `${unlabeled.n} sample(s) came from keys with no recognized test/live prefix — their mode evidence is unknown, so they are not labeled.`,
      });
    }
  }

  return {
    n: samples.length,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
    minMs: samples.length > 0 ? Math.min(...samples) : null,
    maxMs: samples.length > 0 ? Math.max(...samples) : null,
    statusCounts,
    nonPositiveSamples,
    otherRouteSamples,
    byMode,
    buckets,
    caveats,
  };
}

/* ================================================================== *
 * View model (built ONLY from real fetched records → evidence "observed")
 * ================================================================== */

export interface LatencyPercentileRow {
  readonly id: "p50" | "p95" | "p99";
  readonly label: string;
  readonly valueLabel: string;
}

export interface LatencyModeChip {
  readonly mode: RequestKeyMode;
  readonly label: string;
  readonly nLabel: string;
  readonly p95Label: string;
}

export interface LatencyView {
  readonly evidenceClass: EvidenceClassId;
  readonly nLabel: string;
  readonly percentileRows: readonly LatencyPercentileRow[];
  readonly minLabel: string;
  readonly maxLabel: string;
  readonly statusLabel: string;
  readonly modeChips: readonly LatencyModeChip[];
  readonly buckets: readonly LatencyBucket[];
  readonly otherRouteLabel: string | null;
  readonly caveats: readonly LatencyCaveat[];
}

function msLabel(value: number | null): string {
  return value === null ? "not computable" : `${value} ms`;
}

/** Render-ready view model over a computed summary (evidence: observed). */
export function latencyView(summary: LatencySummary): LatencyView {
  const percentileRows: LatencyPercentileRow[] = [
    { id: "p50", label: "p50", valueLabel: msLabel(summary.p50) },
    { id: "p95", label: "p95", valueLabel: msLabel(summary.p95) },
    { id: "p99", label: "p99", valueLabel: msLabel(summary.p99) },
  ];
  const modeChips: LatencyModeChip[] = summary.byMode.map((entry) => ({
    mode: entry.mode,
    label: entry.label,
    nLabel: `n = ${entry.n}`,
    p95Label: `p95 ${msLabel(entry.p95)}`,
  }));
  return {
    evidenceClass: "observed",
    nLabel: `n = ${summary.n} decision requests`,
    percentileRows,
    minLabel: msLabel(summary.minMs),
    maxLabel: msLabel(summary.maxMs),
    statusLabel: `${summary.statusCounts.ok} ok · ${summary.statusCounts.warn} warn · ${summary.statusCounts.error} error`,
    modeChips,
    buckets: summary.buckets,
    otherRouteLabel:
      summary.otherRouteSamples > 0
        ? `${summary.otherRouteSamples} non-decision request(s) in the window are not part of this distribution`
        : null,
    caveats: summary.caveats,
  };
}

/** Re-exported for the surface seam's typing convenience. */
export type { RequestLogRecord, SurfaceResult };
