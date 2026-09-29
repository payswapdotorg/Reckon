/**
 * Deterministic pseudo-random number generation for @reckon/learning.
 *
 * IDENTICAL ALGORITHM to @reckon/simulation/src/rng.ts (SplitMix64 +
 * sha256 seed derivation). Deliberately duplicated: the frozen pnpm
 * lockfile permits no new workspace dependencies between W1 packages
 * and the canonical shared home (@reckon/contracts) is FROZEN by
 * CONTRACT-001. Every stochastic evaluation component (epsilon-greedy
 * exploration, Thompson-style sampling) draws ONLY from these seeded
 * generators — NO Math.random, NO Date.now.
 */
import { digestBytes } from "@reckon/contracts";

const UINT64_MASK = 0xffff_ffff_ffff_ffffn;
const UINT64_SPACE = 0x1_0000_0000_0000_0000n;

/** Serializable seed: non-negative decimal integer <= 2^64 − 1. */
export type SeedString = string;

/** The RNG port implemented by every seeded evaluation component. */
export interface Rng {
  nextUint64(): bigint;
  nextFloat(): number;
  nextBelow(n: number): number;
  nextIndex(weights: readonly number[]): number;
  nextNormal(): number;
}

/**
 * Derive a child seed deterministically:
 * `sha256(part0 | part1 | …)` (first 16 hex chars) → uint64 decimal
 * string. Same documented derivation as the simulation package.
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

/** Create a deterministic SplitMix64 RNG from a uint64 seed. */
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
      return weights.length - 1;
    },
    nextNormal(): number {
      const u1 = 1.0 - nextFloat();
      const u2 = nextFloat();
      return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    },
  };
}
