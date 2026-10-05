/**
 * Latency analytics tests (S3-002) — decision-route classification, the
 * key-mode evidence from prefixes, nearest-rank percentile edge cases,
 * bucket boundaries, the per-mode split, honest n= counts, broken-record
 * exclusion and the view-model shape.
 */
import { describe, expect, it } from "vitest";
import {
  DECISION_ROUTE_PATH,
  LATENCY_BUCKET_EDGES,
  LATENCY_BUCKET_LABELS,
  LATENCY_PERCENTILES,
  LATENCY_SMALL_SAMPLE_THRESHOLD,
  PENDING_REQUEST_LOG_ROUTE,
  isDecisionRequest,
  keyModeFromPrefix,
  latencySummary,
  latencyView,
  percentile,
} from "../src/lib/analytics-latency.js";
import type { RequestLogRecord } from "../src/lib/developers-api.js";

/* ---------------- fixtures ---------------- */

function log(fields: Partial<RequestLogRecord> & { id: string }): RequestLogRecord {
  return {
    created_at: "2026-10-05T10:00:00.000Z",
    method: "POST",
    route: "POST /v1/decisions",
    status: 200,
    latency_ms: 120,
    key_prefix: "sk_test_…9f2K",
    ...fields,
  };
}

/* ---------------- decision-route classification ---------------- */

describe("decision-route classification", () => {
  it("accepts the decision route in both S2-001 spellings", () => {
    expect(isDecisionRequest(log({ id: "r1", route: "POST /v1/decisions" }))).toBe(true);
    expect(isDecisionRequest(log({ id: "r2", route: "/v1/decisions" }))).toBe(true);
  });

  it("tolerates case/whitespace drift in the method, not in the route", () => {
    expect(isDecisionRequest(log({ id: "r3", method: "post" }))).toBe(true);
    expect(isDecisionRequest(log({ id: "r4", method: " post " }))).toBe(true);
    expect(isDecisionRequest(log({ id: "r5", route: "/v1/decisions/", method: "POST" }))).toBe(false);
  });

  it("rejects every other route and method", () => {
    expect(isDecisionRequest(log({ id: "r6", method: "GET", route: "GET /v1/decisions/dec-1" }))).toBe(false);
    expect(isDecisionRequest(log({ id: "r7", route: "POST /v1/outcomes" }))).toBe(false);
    expect(isDecisionRequest(log({ id: "r8", route: "POST /v1/preferences/events" }))).toBe(false);
    expect(isDecisionRequest(log({ id: "r9", method: "DELETE", route: "DELETE /v1/api-keys/key-1" }))).toBe(false);
  });

  it("names the decision route it measures", () => {
    expect(DECISION_ROUTE_PATH).toBe("/v1/decisions");
  });
});

/* ---------------- key-mode evidence ---------------- */

describe("key-mode evidence from the S2-003 key vocabulary", () => {
  it("test key prefixes are TEST evidence", () => {
    expect(keyModeFromPrefix("sk_test_…9f2K")).toBe("test");
    expect(keyModeFromPrefix("pk_test_…a1b2")).toBe("test");
  });

  it("live key prefixes are LIVE evidence", () => {
    expect(keyModeFromPrefix("sk_live_…9f2K")).toBe("live");
    expect(keyModeFromPrefix("pk_live_…c3d4")).toBe("live");
  });

  it("anything else is honestly unlabeled — never guessed into a mode", () => {
    expect(keyModeFromPrefix("whsec_…signing")).toBe("unlabeled");
    expect(keyModeFromPrefix("")).toBe("unlabeled");
    expect(keyModeFromPrefix("SK_TEST_…9f2K")).toBe("unlabeled");
  });
});

/* ---------------- percentiles (nearest-rank edge cases) ---------------- */

describe("nearest-rank percentiles", () => {
  it("empty input is null — never a fabricated zero", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([], 95)).toBeNull();
    expect(percentile([], 99)).toBeNull();
  });

  it("a single sample is every percentile", () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });

  it("1..100: p50=50, p95=95, p99=99 (rank = ceil(p/100 × n))", () => {
    const values = Array.from({ length: 100 }, (_value, index) => index + 1);
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(95);
    expect(percentile(values, 99)).toBe(99);
  });

  it("even-n p50 rounds UP the rank (the documented convention)", () => {
    expect(percentile([10, 20], 50)).toBe(10);
    expect(percentile([10, 20, 30], 50)).toBe(20);
  });

  it("input order does not matter (sorts internally)", () => {
    expect(percentile([30, 10, 20], 50)).toBe(20);
    expect(percentile([99, 1, 50], 95)).toBe(99);
  });

  it("rejects invalid p values", () => {
    expect(percentile([1, 2, 3], 0)).toBeNull();
    expect(percentile([1, 2, 3], 101)).toBeNull();
    expect(percentile([1, 2, 3], Number.NaN)).toBeNull();
  });

  it("the reported percentile set is exactly p50/p95/p99", () => {
    expect(LATENCY_PERCENTILES).toEqual([50, 95, 99]);
  });
});

/* ---------------- bucketing ---------------- */

describe("latency buckets (frozen edges, honest shares)", () => {
  it("the frozen edges and labels stay in lockstep", () => {
    expect(LATENCY_BUCKET_EDGES).toEqual([0, 50, 100, 200, 500, 1000]);
    expect(LATENCY_BUCKET_LABELS).toHaveLength(LATENCY_BUCKET_EDGES.length);
  });

  it("boundary values land in the UPPER bucket (half-open [floor, ceiling))", () => {
    const summary = latencySummary([
      log({ id: "b1", latency_ms: 49 }),
      log({ id: "b2", latency_ms: 50 }),
      log({ id: "b3", latency_ms: 999 }),
      log({ id: "b4", latency_ms: 1000 }),
      log({ id: "b5", latency_ms: 0 }),
    ]);
    const counts = summary.buckets.map((bucket) => bucket.count);
    // 0 and 49 → bucket 0; 50 → bucket 1; 999 → bucket 4; 1000 → the open bucket.
    // NOTE: 0 ms is a non-positive sample → excluded and reported instead.
    expect(counts).toEqual([1, 1, 0, 0, 1, 1]);
    expect(summary.nonPositiveSamples).toBe(1);
  });

  it("shares are rounded to one decimal and null on an empty sample set", () => {
    const summary = latencySummary([
      log({ id: "s1", latency_ms: 10 }),
      log({ id: "s2", latency_ms: 10 }),
    ]);
    expect(summary.buckets[0]?.sharePct).toBe(100);
    expect(summary.buckets[1]?.sharePct).toBe(0);
    expect(latencySummary([]).buckets.every((bucket) => bucket.sharePct === null)).toBe(true);
  });
});

/* ---------------- the summary (filtering, status mix, mode split) ---------------- */

describe("latencySummary (the honest distribution)", () => {
  it("filters to decision-route rows and reports the rest as out-of-scope", () => {
    const summary = latencySummary([
      log({ id: "d1", latency_ms: 100 }),
      log({ id: "o1", route: "POST /v1/outcomes", latency_ms: 5 }),
      log({ id: "o2", method: "GET", route: "GET /v1/decisions/dec-1", latency_ms: 5 }),
    ]);
    expect(summary.n).toBe(1);
    expect(summary.otherRouteSamples).toBe(2);
    expect(summary.p50).toBe(100);
  });

  it("percentiles cover ALL decision requests; the status mix renders the blend", () => {
    const summary = latencySummary([
      log({ id: "m1", status: 200, latency_ms: 100 }),
      log({ id: "m2", status: 200, latency_ms: 120 }),
      log({ id: "m3", status: 400, latency_ms: 40 }),
      log({ id: "m4", status: 503, latency_ms: 900 }),
    ]);
    expect(summary.n).toBe(4);
    expect(summary.statusCounts).toEqual({ ok: 2, warn: 1, error: 1 });
    expect(summary.p50).toBe(100);
    expect(summary.p95).toBe(900);
    expect(summary.minMs).toBe(40);
    expect(summary.maxMs).toBe(900);
  });

  it("non-positive latencies are broken records: excluded and reported", () => {
    const summary = latencySummary([
      log({ id: "z1", latency_ms: 0 }),
      log({ id: "z2", latency_ms: -5 }),
      log({ id: "z3", latency_ms: 100 }),
    ]);
    expect(summary.n).toBe(1);
    expect(summary.nonPositiveSamples).toBe(2);
    expect(summary.buckets.reduce((total, bucket) => total + bucket.count, 0)).toBe(1);
  });

  it("splits by key-mode evidence: test, live, then unlabeled — only present modes", () => {
    const summary = latencySummary([
      log({ id: "t1", latency_ms: 100, key_prefix: "sk_test_…9f2K" }),
      log({ id: "t2", latency_ms: 300, key_prefix: "pk_test_…a1b2" }),
      log({ id: "l1", latency_ms: 900, key_prefix: "sk_live_…c3d4" }),
      log({ id: "u1", latency_ms: 50, key_prefix: "whsec_…signing" }),
    ]);
    expect(summary.byMode.map((entry) => entry.mode)).toEqual(["test", "live", "unlabeled"]);
    const test = summary.byMode[0];
    expect(test?.n).toBe(2);
    expect(test?.p50).toBe(100);
    expect(test?.p95).toBe(300);
    const live = summary.byMode[1];
    expect(live?.n).toBe(1);
    expect(live?.p99).toBe(900);
    const unlabeled = summary.byMode[2];
    expect(unlabeled?.n).toBe(1);
  });

  it("an all-test window renders only the test split (test evidence labeled as such)", () => {
    const summary = latencySummary([
      log({ id: "t1", latency_ms: 100 }),
      log({ id: "t2", latency_ms: 100 }),
    ]);
    expect(summary.byMode).toHaveLength(1);
    expect(summary.byMode[0]?.mode).toBe("test");
    expect(summary.byMode[0]?.label).toBe("Test-key traffic");
  });
});

/* ---------------- caveats ---------------- */

describe("latency caveats (honest n=, never reassurance)", () => {
  it("an empty window withholds percentiles with the no-samples caveat", () => {
    const summary = latencySummary([]);
    expect(summary.caveats.map((caveat) => caveat.id)).toEqual(["no-samples"]);
    expect(summary.caveats[0]?.sentence).toContain("withheld, not zero");
  });

  it("small windows carry the small-sample caveat with the observed n", () => {
    const summary = latencySummary(
      Array.from({ length: LATENCY_SMALL_SAMPLE_THRESHOLD - 1 }, (_value, index) =>
        log({ id: `s${index}`, latency_ms: 100 + index }),
      ),
    );
    expect(summary.caveats.map((caveat) => caveat.id)).toContain("small-sample");
    expect(summary.caveats.find((caveat) => caveat.id === "small-sample")?.sentence).toContain(
      `n = ${LATENCY_SMALL_SAMPLE_THRESHOLD - 1}`,
    );
  });

  it("a healthy window carries no caveats", () => {
    const summary = latencySummary(
      Array.from({ length: LATENCY_SMALL_SAMPLE_THRESHOLD }, (_value, index) =>
        log({ id: `h${index}`, latency_ms: 100 + index }),
      ),
    );
    expect(summary.caveats).toEqual([]);
  });

  it("broken records and unlabeled keys are reported as caveats", () => {
    const summary = latencySummary([
      log({ id: "z1", latency_ms: -1 }),
      log({ id: "u1", latency_ms: 10, key_prefix: "unknown" }),
      log({ id: "o1", latency_ms: 10 }),
    ]);
    const ids = summary.caveats.map((caveat) => caveat.id);
    expect(ids).toContain("non-positive-samples");
    expect(ids).toContain("unlabeled-keys");
  });
});

/* ---------------- view model ---------------- */

describe("latencyView (view-model shape)", () => {
  it("percentile rows carry their values and the n label", () => {
    const view = latencyView(
      latencySummary([log({ id: "v1", latency_ms: 142 }), log({ id: "v2", latency_ms: 200 })]),
    );
    expect(view.evidenceClass).toBe("observed");
    expect(view.nLabel).toBe("n = 2 decision requests");
    expect(view.percentileRows.map((row) => row.id)).toEqual(["p50", "p95", "p99"]);
    expect(view.percentileRows.map((row) => row.valueLabel)).toEqual(["142 ms", "200 ms", "200 ms"]);
    expect(view.modeChips).toHaveLength(1);
    expect(view.modeChips[0]?.nLabel).toBe("n = 2");
  });

  it("an empty summary renders 'not computable' values, never zeros", () => {
    const view = latencyView(latencySummary([]));
    expect(view.percentileRows.every((row) => row.valueLabel === "not computable")).toBe(true);
    expect(view.minLabel).toBe("not computable");
    expect(view.modeChips).toEqual([]);
  });

  it("the status label renders the observed blend", () => {
    const view = latencyView(
      latencySummary([log({ id: "s1" }), log({ id: "s2", status: 500 })]),
    );
    expect(view.statusLabel).toBe("1 ok · 0 warn · 1 error");
  });

  it("names its pending route for the honest states", () => {
    expect(PENDING_REQUEST_LOG_ROUTE).toBe("GET /v1/request-logs");
  });
});
