/**
 * IntegrationEffortScorecard aggregation (SIM-001).
 *
 * Aggregates the IntegrationEffortRecords produced by a ladder wave into
 * the machine-readable scorecard the program spec requires
 * (docs/simulations/scorecard.md):
 *
 * - deterministic medians/p95s (nearest-rank percentiles, summation in
 *   argument order — no floating-point reordering);
 * - recurring gaps grouped by (capability, friction) across DISTINCT
 *   ladder levels (domains);
 * - the 3-DOMAIN LAW: "When the same gap appears in at least three
 *   domains, upgrade the common platform primitive and replay earlier
 *   levels" — `platformUpgradeCandidate` is exactly `domainCount ≥ 3`.
 */
import {
  finalizeIntegrationEffortScorecard,
  type IntegrationEffortRecord,
  type IntegrationEffortScorecard,
  type ScorecardRecurringGap,
  type ReckonCompleteFriction,
  type ReckonCompleteCapability,
} from "@reckon/contracts";
import { percentileNearestRank, mean } from "./percentile.js";

export interface AggregateScorecardOptions {
  readonly scorecardId: string;
  /** Virtual clock time of generation (caller-supplied — deterministic). */
  readonly generatedAt: number;
}

/** Aggregate effort records into a sealed scorecard. */
export function aggregateIntegrationEffortScorecard(
  records: readonly IntegrationEffortRecord[],
  options: AggregateScorecardOptions,
): IntegrationEffortScorecard {
  if (records.length === 0) {
    throw new Error("aggregateIntegrationEffortScorecard: at least one record is required");
  }

  const glueLocs = records.map((r) => r.glue.loc);
  const firstDecisionMs = records.filter((r) => r.timing.firstDecisionSteps > 0).map((r) => r.timing.firstDecisionMs);
  const fullLoopMs = records.filter((r) => r.timing.fullLoopSteps > 0).map((r) => r.timing.fullLoopMs);
  const latencyP50s = records.filter((r) => r.latency.samples > 0).map((r) => r.latency.p50Ms);
  const latencyP95s = records.filter((r) => r.latency.samples > 0).map((r) => r.latency.p95Ms);

  const distinctHosts = new Set(records.map((r) => r.hostAdapterId)).size;
  const distinctLevels = new Set(
    records.filter((r) => r.ladderLevel !== undefined).map((r) => r.ladderLevel),
  ).size;

  const totalFailures = records.reduce((total, r) => total + r.failures.count, 0);
  const totalRetries = records.reduce((total, r) => total + r.failures.retryCount, 0);

  // --- recurring gaps (grouped across domains) -----------------------------
  const gapKey = (capability: ReckonCompleteCapability, friction: ReckonCompleteFriction) =>
    `${capability}|${friction}`;
  const groups = new Map<
    string,
    {
      capability: ReckonCompleteCapability;
      friction: ReckonCompleteFriction;
      levels: Set<number>;
      runCount: number;
    }
  >();
  for (const record of records) {
    for (const gap of record.gaps) {
      const key = gapKey(gap.capability, gap.friction);
      const group = groups.get(key) ?? {
        capability: gap.capability,
        friction: gap.friction,
        levels: new Set<number>(),
        runCount: 0,
      };
      if (record.ladderLevel !== undefined) group.levels.add(record.ladderLevel);
      group.runCount += 1;
      groups.set(key, group);
    }
  }
  const recurringGaps: ScorecardRecurringGap[] = [...groups.values()]
    .map((group) => ({
      capability: group.capability,
      friction: group.friction,
      ladderLevels: [...group.levels].sort((a, b) => a - b),
      domainCount: group.levels.size,
      runCount: group.runCount,
      platformUpgradeCandidate: group.levels.size >= 3,
    }))
    .sort((a, b) => (a.capability === b.capability ? a.friction.localeCompare(b.friction) : a.capability.localeCompare(b.capability)));

  return finalizeIntegrationEffortScorecard(
    {
      generatedAt: options.generatedAt,
      aggregate: {
        runCount: records.length,
        distinctHosts,
        distinctLevels,
        medianGlueLoc: percentileNearestRank(glueLocs, 50),
        p95GlueLoc: percentileNearestRank(glueLocs, 95),
        medianFirstDecisionMs: firstDecisionMs.length > 0 ? percentileNearestRank(firstDecisionMs, 50) : 0,
        p95FirstDecisionMs: firstDecisionMs.length > 0 ? percentileNearestRank(firstDecisionMs, 95) : 0,
        medianFullLoopMs: fullLoopMs.length > 0 ? percentileNearestRank(fullLoopMs, 50) : 0,
        p95FullLoopMs: fullLoopMs.length > 0 ? percentileNearestRank(fullLoopMs, 95) : 0,
        medianLatencyP50Ms: latencyP50s.length > 0 ? percentileNearestRank(latencyP50s, 50) : 0,
        p95LatencyP95Ms: latencyP95s.length > 0 ? percentileNearestRank(latencyP95s, 95) : 0,
        meanCapabilityCoverageRatio: mean(records.map((r) => r.capabilityCoverage.coverageRatio)),
        totalFailures,
        totalRetries,
      },
      recurringGaps,
      records: records.map((r) => ({
        recordId: r.recordId,
        runId: r.runId,
        hostAdapterId: r.hostAdapterId,
        ...(r.ladderLevel !== undefined ? { ladderLevel: r.ladderLevel } : {}),
        recordChecksum: r.checksum,
      })),
    },
    options.scorecardId,
  );
}
