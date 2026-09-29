/**
 * Deterministic string hashing → stable bucket indexes.
 *
 * Host vocabulary (labels, realization kinds, locales, preference
 * dimension names) is provider-specific by nature; it enters feature
 * vectors ONLY through these stable hashed buckets (architecture lock
 * #3: provider-neutral core — no raw provider strings in feature
 * names or values).
 *
 * Determinism: sha256 (via @reckon/contracts digestBytes) of the raw
 * string; the first 8 hex digits are the bucket seed. Identical
 * strings bucket identically across processes and replays.
 */
import { digestBytes } from "@reckon/contracts";

/** Number of buckets for hashed single strings. */
export const STRING_BUCKETS = 16;

/** Number of buckets for hashed label lists (count vectors). */
export const LABEL_BUCKETS = 16;

/** Stable bucket index of a single string in [0, buckets). */
export function stableBucket(value: string, buckets: number = STRING_BUCKETS): number {
  const hex = digestBytes(value).slice(0, 8);
  return Number.parseInt(hex, 16) % buckets;
}

/** Stable bucket COUNT vector of a list of strings (commutative). */
export function bucketCounts(values: readonly string[], buckets: number = LABEL_BUCKETS): number[] {
  const counts = new Array<number>(buckets).fill(0);
  for (const value of values) {
    counts[stableBucket(value, buckets)] += 1;
  }
  return counts;
}
