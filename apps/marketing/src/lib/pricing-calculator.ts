/**
 * Reckon pricing — the volume calculator's pricing model (S1-003).
 *
 * A PURE, DETERMINISTIC function from monthly request volume to an
 * estimate: no clock, no randomness, no locale drift, no network. The
 * same input always yields a byte-identical estimate (unit-tested),
 * because the interactive calculator is just this function plus a slider.
 *
 * Model (stripe.com pricing grammar, docs/surveys/stripe-com-survey.md §2
 * — per-transaction pricing + interactive volume calculator):
 *
 *  - the ONLY metered unit is the live decision request; test-mode
 *    traffic is free (canned scenarios — apps/api "Test mode", S2-003);
 *  - volume is billed per full 1,000-request units (ceil), the per-1k
 *    analogue of Stripe's per-transaction fee;
 *  - the per-1k rate steps down through fixed volume brackets (the
 *    Scale tier's automatic volume discounts);
 *  - at the enterprise threshold quoting stops and the estimate becomes
 *    a "contact sales" handoff — custom volume agreements, never a
 *    surprise number.
 *
 * HONESTY LAW (binding): every figure below is ILLUSTRATIVE — Reckon has
 * no billing system; nothing is metered, charged, or enforced. The
 * calculator exists to show how per-1k pricing is DESIGNED to work, and
 * the UI labels that wherever a figure appears.
 *
 * Money is computed in INTEGER CENTS end-to-end (units × rateCents) so
 * estimates never float-drift; the single division by 100 happens at the
 * display formatter, which rounds from exact cents.
 *
 * This module is deliberately SELF-CONTAINED (zero imports): it is
 * shared by the client calculator, the pricing page, and the colocated
 * vitest suite, which typechecks under the root NodeNext program.
 */

/* ------------------------------------------------------------------ */
/* Constants — the published pricing model (illustrative)              */
/* ------------------------------------------------------------------ */

/** Requests per billable unit — pricing is per 1,000 decision requests. */
export const REQUESTS_PER_UNIT = 1_000;

/** Standard list rate: 90 cents per 1k requests ($0.90). ILLUSTRATIVE. */
export const BASE_RATE_CENTS = 90;

/**
 * Volume (requests/month) at which volume-discounted Scale pricing
 * begins. Below this the estimate is on the Standard tier's list rate.
 */
export const SCALE_THRESHOLD = 5_000_000;

/**
 * Volume (requests/month) at which quoting stops entirely: the estimate
 * becomes the enterprise handoff ("contact sales" — custom agreements).
 */
export const ENTERPRISE_THRESHOLD = 500_000_000;

/** The tier an estimate lands on. "enterprise" only ever means handoff. */
export type VolumeTierId = "standard" | "scale" | "enterprise";

/** One volume-discount bracket — a half-open [min, max) request range. */
export interface VolumeBracket {
  /** Inclusive lower bound, requests/month. */
  readonly minVolume: number;
  /** Exclusive upper bound, requests/month (null = unbounded). */
  readonly maxVolumeExclusive: number | null;
  /** Discount off the list rate, in whole percent (display only). */
  readonly discountPct: number;
  /** Exact effective per-1k rate in integer cents — never computed from
   *  the percent at runtime, so no float can creep into a quote. */
  readonly rateCents: number;
}

/**
 * The bracket table. Contiguous by construction (each bracket starts
 * where the previous ends) and ends exactly at ENTERPRISE_THRESHOLD —
 * both invariants are pinned by tests.
 */
export const VOLUME_BRACKETS: readonly VolumeBracket[] = [
  { minVolume: 0, maxVolumeExclusive: SCALE_THRESHOLD, discountPct: 0, rateCents: 90 },
  { minVolume: SCALE_THRESHOLD, maxVolumeExclusive: 25_000_000, discountPct: 10, rateCents: 81 },
  { minVolume: 25_000_000, maxVolumeExclusive: 100_000_000, discountPct: 20, rateCents: 72 },
  { minVolume: 100_000_000, maxVolumeExclusive: ENTERPRISE_THRESHOLD, discountPct: 30, rateCents: 63 },
] as const;

/* ------------------------------------------------------------------ */
/* The estimate                                                        */
/* ------------------------------------------------------------------ */

/** The result of estimateMonthlyPrice — everything the UI renders. */
export interface VolumeEstimate {
  /** Normalized input: a finite integer ≥ 0. */
  readonly requestsPerMonth: number;
  /** Which tier this volume lands on (enterprise = handoff only). */
  readonly tierId: VolumeTierId;
  /** Display name for the tier. */
  readonly tierName: "Standard" | "Scale" | "Enterprise";
  /** Billable 1k-units — ceil(volume / REQUESTS_PER_UNIT). */
  readonly billableUnits: number;
  /** Effective per-1k rate in integer cents (null at handoff). */
  readonly rateCents: number | null;
  /** Volume discount in percent (null at handoff). */
  readonly discountPct: number | null;
  /** Exact monthly estimate in integer cents (null at handoff). */
  readonly monthlyEstimateCents: number | null;
  /** monthlyEstimateCents / 100, for display (null at handoff). */
  readonly monthlyEstimateUsd: number | null;
  /** True when volume ≥ ENTERPRISE_THRESHOLD — quote becomes "custom". */
  readonly isEnterpriseHandoff: boolean;
}

/**
 * Total input normalization, documented and deterministic:
 *  - non-finite numbers (NaN, ±Infinity) → 0;
 *  - negative numbers → 0;
 *  - non-integers → floored (a partial request is not a request).
 */
export function normalizeVolume(input: number): number {
  if (!Number.isFinite(input) || input < 0) return 0;
  return Math.floor(input);
}

/**
 * The bracket a normalized volume falls into, or null when the volume is
 * at/above ENTERPRISE_THRESHOLD (beyond the table = the handoff).
 */
export function resolveBracket(volume: number): VolumeBracket | null {
  for (const bracket of VOLUME_BRACKETS) {
    const belowMax = bracket.maxVolumeExclusive === null || volume < bracket.maxVolumeExclusive;
    if (volume >= bracket.minVolume && belowMax) return bracket;
  }
  return null;
}

/**
 * The pricing function. `estimateMonthlyPrice(volume)` → estimate.
 *
 * Boundaries (all pinned by tests):
 *  - 0           → Standard, 0 units, $0
 *  - 999 / 1000  → 1 unit (an exact multiple never rounds up)
 *  - 1001        → 2 units
 *  - 5M − 1      → Standard list rate (90¢/1k)
 *  - 5M          → Scale, 10% bracket (81¢/1k) — the discount can make
 *    the TOTAL drop at a bracket edge; that is intended volume pricing
 *  - 25M / 100M  → 20% / 30% brackets
 *  - 500M        → enterprise handoff: no rate, no quote, tier "enterprise"
 */
export function estimateMonthlyPrice(requestsPerMonth: number): VolumeEstimate {
  const volume = normalizeVolume(requestsPerMonth);
  const billableUnits = Math.ceil(volume / REQUESTS_PER_UNIT);
  const bracket = resolveBracket(volume);

  if (bracket === null) {
    // At or beyond the enterprise threshold: quoting stops. No number is
    // invented; the UI hands off to "contact sales".
    return {
      requestsPerMonth: volume,
      tierId: "enterprise",
      tierName: "Enterprise",
      billableUnits,
      rateCents: null,
      discountPct: null,
      monthlyEstimateCents: null,
      monthlyEstimateUsd: null,
      isEnterpriseHandoff: true,
    };
  }

  const monthlyEstimateCents = billableUnits * bracket.rateCents;
  return {
    requestsPerMonth: volume,
    tierId: volume >= SCALE_THRESHOLD ? "scale" : "standard",
    tierName: volume >= SCALE_THRESHOLD ? "Scale" : "Standard",
    billableUnits,
    rateCents: bracket.rateCents,
    discountPct: bracket.discountPct,
    monthlyEstimateCents,
    monthlyEstimateUsd: monthlyEstimateCents / 100,
    isEnterpriseHandoff: false,
  };
}

/* ------------------------------------------------------------------ */
/* Deterministic display formatters                                    */
/* ------------------------------------------------------------------ */

/**
 * Exact cents → "$1,234.56". Locale pinned to en-US; fraction digits are
 * demand-driven — whole-dollar amounts render clean ("$4,050") while
 * sub-dollar rates keep BOTH cents ("$0.90", never "$0.9"). Branching on
 * `cents % 100` (not on the float) keeps the decision exact.
 */
export function formatUsdFromCents(cents: number): string {
  const hasCents = Math.trunc(cents) % 100 !== 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** Integer request counts → "5,000,000" (locale pinned, deterministic). */
export function formatRequestCount(count: number): string {
  return new Intl.NumberFormat("en-US").format(count);
}
