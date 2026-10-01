/**
 * W3-010 — the performance-envelope regression test (the guard).
 *
 * Runs the deterministic benchmark harness (envelope-bench.ts) ONCE and
 * asserts the documented budgets per stage (p50/p95/p99). The budgets
 * are calibrated against the measured baseline (see tests/perf/README.md)
 * with ~5× headroom at p50/p95 and ~6× at p99 — generous enough to stay
 * stable on shared CI hardware (parallel test workers, JIT and GC
 * jitter), tight enough that an ORDER-OF-MAGNITUDE regression in any
 * stage FAILS this test (the roadmap guard).
 *
 * The envelope must ALSO surface through the observability records: the
 * decision records carry the measured latency (advanced onto the
 * injected clock), scheduler-action records carry the emitted SWITCH
 * action and enqueue/dequeue counts, and outcome-linkage records link
 * every measured outcome to its decision (worker-3 handoff list).
 *
 * Evidence class: controlled-local (measured on the benchmark host; NOT
 * production latency claims — AGENTS.md "Production truth").
 */
import { describe, expect, it } from "vitest";
import {
  ENVELOPE_ITERATIONS,
  ENVELOPE_SCALE,
  ENVELOPE_WARMUP_ITERATIONS,
  formatEnvelopeReport,
  runEnvelopeBenchmark,
  type StageStats,
} from "./envelope-bench.js";

const RESULT = runEnvelopeBenchmark();

/**
 * The DOCUMENTED envelope budgets (milliseconds). Any stage regressing
 * beyond its budget FAILS the suite. Every budget holds ≈5× headroom
 * over the measured baseline at p50/p95 and ≈6× at p99 — generous enough
 * to stay stable on shared CI hardware (parallel test workers, JIT and
 * GC jitter, ~2× slower cores), tight enough that an order-of-magnitude
 * (10×) regression in ANY stage breaches its p50 budget. Calibration
 * rationale and baseline numbers: tests/perf/README.md.
 */
export const ENVELOPE_BUDGETS = {
  normalization: { p50: 8, p95: 12, p99: 30 },
  decision: { p50: 50, p95: 75, p99: 120 },
  scheduling: { p50: 15, p95: 30, p99: 40 },
  outcomeRecording: { p50: 1.5, p95: 3, p99: 8 },
  endToEnd: { p50: 75, p95: 100, p99: 180 },
} as const;

type StageKey = keyof typeof ENVELOPE_BUDGETS;

function stageOf(key: StageKey): StageStats {
  const stages = RESULT.stages;
  switch (key) {
    case "normalization":
      return stages.normalization;
    case "decision":
      return stages.decision;
    case "scheduling":
      return stages.scheduling;
    case "outcomeRecording":
      return stages.outcomeRecording;
    case "endToEnd":
      return stages.endToEnd;
  }
}

describe("W3-010 performance envelope — no-LLM fast path", () => {
  it("runs the deterministic benchmark at the documented realistic scale", () => {
    // The scale the adapters produce: ~78% of every WebFlix adapter
    // limit (256 items/import, 8 realizations/item, 256 candidates/set).
    expect(RESULT.scale.catalogItems).toBe(ENVELOPE_SCALE.catalogItems);
    expect(RESULT.scale.realizations).toBe(ENVELOPE_SCALE.catalogItems * ENVELOPE_SCALE.realizationsPerItem);
    expect(RESULT.scale.candidateRows).toBe(ENVELOPE_SCALE.candidateRows + ENVELOPE_SCALE.ghostRows);
    expect(RESULT.scale.expandedExperiences).toBe(512); // 128 rows × (3 formats + 1) = 512
    expect(RESULT.scale.scoredExperiences).toBe(RESULT.scale.expandedExperiences);
    expect(RESULT.meta.measuredIterations).toBe(ENVELOPE_ITERATIONS);
    expect(RESULT.meta.warmupIterations).toBe(ENVELOPE_WARMUP_ITERATIONS);
    for (const key of Object.keys(ENVELOPE_BUDGETS) as StageKey[]) {
      expect(stageOf(key).samples).toBe(ENVELOPE_ITERATIONS);
    }
  });

  it("enforces the documented per-stage budgets (the regression guard)", () => {
    const failures: string[] = [];
    for (const key of Object.keys(ENVELOPE_BUDGETS) as StageKey[]) {
      const stage = stageOf(key);
      const budget = ENVELOPE_BUDGETS[key];
      if (stage.p50 > budget.p50) failures.push(`${key}: p50 ${stage.p50}ms > budget ${budget.p50}ms`);
      if (stage.p95 > budget.p95) failures.push(`${key}: p95 ${stage.p95}ms > budget ${budget.p95}ms`);
      if (stage.p99 > budget.p99) failures.push(`${key}: p99 ${stage.p99}ms > budget ${budget.p99}ms`);
    }
    if (failures.length > 0) {
      throw new Error(
        `performance envelope REGRESSION — stage(s) beyond budget:\n${failures.join("\n")}\n` +
          `measured:\n${formatEnvelopeReport(RESULT)}`,
      );
    }
  });

  it("surfaces the envelope through the observability records", () => {
    const records = RESULT.records;
    // Decision records: one per measured iteration (+ warmup), with the
    // measured latency (injected-clock), policy version and action.
    const decisionRecords = records.filter((record) => record.kind === "decision");
    expect(decisionRecords.length).toBe(ENVELOPE_WARMUP_ITERATIONS + ENVELOPE_ITERATIONS);
    for (const record of decisionRecords) {
      if (record.kind !== "decision") continue;
      expect(record.latencySource).toBe("injected-clock");
      expect(record.status).toBe("ok");
      expect(record.action).toBe("SWITCH");
      expect(record.policy).toEqual({ policyId: "bench-policy", version: "1" });
      expect(record.latencyMs).toBeGreaterThanOrEqual(0);
    }
    const measuredDecisionRecords = decisionRecords.slice(ENVELOPE_WARMUP_ITERATIONS);
    const withRealLatency = measuredDecisionRecords.filter((record) => record.latencyMs > 0);
    expect(withRealLatency.length).toBe(measuredDecisionRecords.length);

    // Scheduler-action records: one per iteration, the emitted SWITCH.
    const schedulerRecords = records.filter((record) => record.kind === "scheduler-action");
    expect(schedulerRecords.length).toBe(ENVELOPE_WARMUP_ITERATIONS + ENVELOPE_ITERATIONS);
    for (const record of schedulerRecords) {
      if (record.kind !== "scheduler-action") continue;
      expect(record.action).toBe("SWITCH");
      expect(record.source).toBe("decision");
      expect(record.interruptedExperienceId).toBeDefined();
    }

    // Outcome linkage: every measured outcome linked to its decision.
    const linkageRecords = records.filter((record) => record.kind === "outcome-linkage");
    expect(linkageRecords.length).toBe(ENVELOPE_WARMUP_ITERATIONS + ENVELOPE_ITERATIONS);
    for (const record of linkageRecords) {
      if (record.kind !== "outcome-linkage") continue;
      expect(record.linked).toBe(true);
      expect(record.decisionId).toBeDefined();
      expect(record.eventType).toBe("completion");
      expect(record.outcomeEvidenceClass).toBe("controlled-local");
    }

    // No error records on the happy path.
    expect(records.filter((record) => record.kind === "error")).toHaveLength(0);
  });

  it("reports the measured envelope (the W3-011 baseline evidence)", () => {
    // Logging the measured numbers makes them citable baseline evidence
    // for the production-readiness packet (W3-011).
    console.log(`\nW3-010 performance envelope (measured on this host):\n${formatEnvelopeReport(RESULT)}\n`);
    expect(formatEnvelopeReport(RESULT)).toContain("normalization");
    expect(formatEnvelopeReport(RESULT)).toContain("end-to-end");
  });
});
