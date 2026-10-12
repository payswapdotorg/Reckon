/**
 * Deterministic percentile computation over latency samples (SIM-001).
 *
 * Method: NEAREST-RANK. Values are sorted ascending; the p-th percentile
 * is the value at 1-based rank ⌈p/100 · n⌉, clamped into [1, n]. The
 * method is fixed here (never configurable) so p50/p95 in effort records
 * are byte-reproducible from the recorded call log alone.
 */

/** Nearest-rank percentile of a sample set (0 for an empty set). */
export function percentileNearestRank(
  values: readonly number[],
  p: 50 | 95 | number,
): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index]!;
}

/** The median (p50) — nearest-rank. */
export function median(values: readonly number[]): number {
  return percentileNearestRank(values, 50);
}

/** The mean (deterministic summation order = the argument order). */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
}

/** Sorted copy (ascending) of a numeric sample set. */
export function sortedNumbers(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b);
}
