/**
 * Deterministic pseudo-random number generation for @reckon/simulation.
 *
 * LAWS (architecture-lock #5 determinism / ADR-004 research runtime):
 * - NO Math.random, NO Date.now, NO wall-clock reads anywhere in this
 *   package — every stochastic draw is a pure function of an explicit
 *   seed.
 * - Seed derivation is documented and reproducible: seeds are sha256
 *   digests (via @reckon/contracts `digestBytes`) over a `|`-joined
 *   tuple of the derivation parts, truncated to an unsigned 64-bit
 *   integer and serialized as a DECIMAL STRING (portable, canonical-
 *   JSON safe).
 *
 * Algorithm: SplitMix64 — a well-studied, stateless-per-draw generator
 * with good statistical properties and exact integer arithmetic on
 * BigInt, so behavior is identical across processes and Node versions.
 *
 * This module is deliberately duplicated (identical algorithm) in
 * @reckon/evaluation and @reckon/learning: the frozen pnpm lockfile
 * permits no new workspace dependencies between W1 packages, and the
 * canonical shared home (@reckon/contracts) is FROZEN by CONTRACT-001.
 */
import { digestBytes } from "@reckon/contracts";

/** 2^64 − 1 — the uint64 domain. */
const UINT64_MASK = 0xffff_ffff_ffff_ffffn;
const UINT64_SPACE = 0x1_0000_0000_0000_0000n; // 2^64

/** Serializable seed: non-negative decimal integer <= 2^64 − 1. */
export type SeedString = string;

/** The RNG port implemented by every seeded stochastic component. */
export interface Rng {
  /** Next raw 64-bit draw as a BigInt in [0, 2^64). */
  nextUint64(): bigint;
  /** Uniform float in [0, 1) (53-bit precision, deterministic). */
  nextFloat(): number;
  /** Uniform integer in [0, n). Typed error for n <= 0. */
  nextBelow(n: number): number;
  /**
   * Draw an index proportionally to non-negative weights
   * (deterministic cumulative walk). Typed error on empty/negative
   * weights.
   */
  nextIndex(weights: readonly number[]): number;
  /** Standard-normal draw via Box–Muller (deterministic). */
  nextNormal(): number;
}

/**
 * Derive a child seed deterministically:
 * `sha256(part0 | part1 | …)` (first 16 hex chars) → uint64 decimal
 * string. String parts are used verbatim; numbers as decimal; bigints
 * as decimal. This is the DOCUMENTED seed-derivation function for
 * per-step seeds, ensemble seeds and environment seeds.
 */
export function deriveSeed(...parts: (string | number | bigint)[]): SeedString {
  const joined = parts.map((p) => String(p)).join("|");
  const hex = digestBytes(joined).slice(0, 16);
  return BigInt("0x" + hex).toString(10);
}

/** Validate + normalize a seed given as string or safe integer. */
export function normalizeSeed(seed: string | number): SeedString {
  let text: string;
  if (typeof seed === "number") {
    if (!Number.isInteger(seed) || seed < 0) {
      throw new Error(`seed must be a non-negative integer, got ${seed}`);
    }
    text = seed.toString(10);
  } else {
    text = seed.trim();
    if (!/^[0-9]+$/.test(text)) {
      throw new Error(`seed must be a non-negative decimal integer string, got "${seed}"`);
    }
  }
  const value = BigInt(text);
  if (value > UINT64_MASK) {
    throw new Error(`seed exceeds the uint64 domain (2^64 − 1)`);
  }
  return value.toString(10);
}

/** True when `seed` is a valid uint64 decimal seed string. */
export function isValidSeed(seed: string): boolean {
  if (!/^[0-9]+$/.test(seed)) return false;
  try {
    return BigInt(seed) <= UINT64_MASK;
  } catch {
    return false;
  }
}

/** Create a deterministic SplitMix64 RNG from a uint64 seed (any radix-10 string or integer). */
export function createRng(seed: string | number | bigint): Rng {
  const seedText = typeof seed === "bigint" ? seed.toString(10) : normalizeSeed(seed);
  let state = BigInt(seedText) & UINT64_MASK;

  const nextUint64 = (): bigint => {
    state = (state + 0x9e37_79b9_7f4a_7c15n) & UINT64_MASK;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58_476d_1ce4_e5b9n) & UINT64_MASK;
    z = ((z ^ (z >> 27n)) * 0x94d0_49bb_1331_11ebn) & UINT64_MASK;
    return (z ^ (z >> 31n)) & UINT64_MASK;
  };

  const nextFloat = (): number => {
    // Exact uint64/2^64 in float precision: deterministic across platforms.
    return Number(nextUint64()) / Number(UINT64_SPACE);
  };

  return {
    nextUint64,
    nextFloat,
    nextBelow(n: number): number {
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`nextBelow: n must be a positive integer, got ${n}`);
      }
      return Math.floor(nextFloat() * n);
    },
    nextIndex(weights: readonly number[]): number {
      if (weights.length === 0) throw new Error("nextIndex: empty weights");
      let total = 0;
      for (const w of weights) {
        if (!(w >= 0) || !Number.isFinite(w)) {
          throw new Error(`nextIndex: weights must be finite and non-negative, got ${w}`);
        }
        total += w;
      }
      if (total <= 0) throw new Error("nextIndex: total weight must be > 0");
      let target = nextFloat() * total;
      for (let i = 0; i < weights.length; i++) {
        target -= weights[i]!;
        if (target < 0) return i;
      }
      return weights.length - 1; // float under-count fallback (deterministic)
    },
    nextNormal(): number {
      // Box–Muller with u1 forced into (0, 1] to avoid log(0).
      const u1 = 1.0 - nextFloat();
      const u2 = nextFloat();
      return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    },
  };
}
