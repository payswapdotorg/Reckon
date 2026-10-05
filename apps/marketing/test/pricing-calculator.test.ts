/**
 * Pricing calculator (S1-003) — the pure-function battery.
 *
 * Laws under test (work item S1-003):
 *  1. input normalization is total and deterministic (non-finite,
 *     negative, fractional inputs all collapse to documented integers);
 *  2. per-1k billing rounds UP to full 1,000-request units — and an
 *     exact multiple never rounds up a second unit;
 *  3. tier + bracket transitions land exactly on their published
 *     boundaries (5M → Scale/10%, 25M → 20%, 100M → 30%);
 *  4. the enterprise threshold is a clean handoff: at ≥ 500M the
 *     estimate stops quoting (no rate, no dollar figure, tier flips to
 *     "enterprise") — the calculator never invents a number;
 *  5. money is computed in integer cents — no float drift, ever;
 *  6. the same input always yields the same estimate (purity);
 *  7. the bracket table is contiguous and ends at the enterprise
 *     threshold (structural invariants the estimator relies on).
 *
 * Conventions: mirrors apps/web/test/*.test.ts + the S1-002 suite —
 * .js-suffixed relative imports (NodeNext typecheck compatibility),
 * vitest from the repo root.
 */
import { describe, expect, it } from "vitest";
import {
  BASE_RATE_CENTS,
  ENTERPRISE_THRESHOLD,
  REQUESTS_PER_UNIT,
  SCALE_THRESHOLD,
  VOLUME_BRACKETS,
  estimateMonthlyPrice,
  formatRequestCount,
  formatUsdFromCents,
  normalizeVolume,
  resolveBracket,
} from "../src/lib/pricing-calculator.js";

/* ------------------------------------------------------------------ */
/* 1. Input normalization — total, documented, deterministic           */
/* ------------------------------------------------------------------ */

describe("volume normalization", () => {
  it("passes sane integers through unchanged", () => {
    expect(normalizeVolume(0)).toBe(0);
    expect(normalizeVolume(42)).toBe(42);
    expect(normalizeVolume(5_000_000)).toBe(5_000_000);
  });

  it("collapses non-finite input to 0 (NaN, Infinity, -Infinity)", () => {
    expect(normalizeVolume(Number.NaN)).toBe(0);
    expect(normalizeVolume(Number.POSITIVE_INFINITY)).toBe(0);
    expect(normalizeVolume(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it("collapses negative input to 0", () => {
    expect(normalizeVolume(-1)).toBe(0);
    expect(normalizeVolume(-1_000_000)).toBe(0);
  });

  it("floors fractional volumes (a partial request is not a request)", () => {
    expect(normalizeVolume(1_234.9)).toBe(1_234);
    expect(normalizeVolume(0.9)).toBe(0);
  });

  it("absurd normalized volumes still estimate (0 → $0, standard tier)", () => {
    const estimate = estimateMonthlyPrice(Number.NaN);
    expect(estimate.requestsPerMonth).toBe(0);
    expect(estimate.tierId).toBe("standard");
    expect(estimate.monthlyEstimateCents).toBe(0);
    expect(estimate.monthlyEstimateUsd).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Per-1k billing — round up to full units                          */
/* ------------------------------------------------------------------ */

describe("billable units (per-1k rounding)", () => {
  it("1 request is one full unit", () => {
    const estimate = estimateMonthlyPrice(1);
    expect(estimate.billableUnits).toBe(1);
    expect(estimate.monthlyEstimateCents).toBe(90);
  });

  it("999 requests still round up to one unit", () => {
    expect(estimateMonthlyPrice(999).billableUnits).toBe(1);
  });

  it("an exact multiple never rounds up a second unit (1000 → 1)", () => {
    expect(estimateMonthlyPrice(1_000).billableUnits).toBe(1);
  });

  it("1001 requests are two units", () => {
    const estimate = estimateMonthlyPrice(1_001);
    expect(estimate.billableUnits).toBe(2);
    expect(estimate.monthlyEstimateCents).toBe(180);
  });

  it("2500 requests are three units", () => {
    expect(estimateMonthlyPrice(2_500).billableUnits).toBe(3);
  });

  it("units follow ceil(volume / REQUESTS_PER_UNIT) exactly", () => {
    for (const volume of [0, 1, 999, 1_000, 1_733, 99_999, 4_999_999]) {
      expect(estimateMonthlyPrice(volume).billableUnits).toBe(
        Math.ceil(volume / REQUESTS_PER_UNIT),
      );
    }
  });
});

/* ------------------------------------------------------------------ */
/* 3. Tier + bracket transitions                                       */
/* ------------------------------------------------------------------ */

describe("tier and bracket boundaries", () => {
  it("small volumes sit on the Standard list rate (0% discount)", () => {
    const estimate = estimateMonthlyPrice(250_000);
    expect(estimate.tierId).toBe("standard");
    expect(estimate.tierName).toBe("Standard");
    expect(estimate.rateCents).toBe(90);
    expect(estimate.discountPct).toBe(0);
    expect(estimate.isEnterpriseHandoff).toBe(false);
  });

  it("5M − 1 is still Standard list rate", () => {
    const estimate = estimateMonthlyPrice(SCALE_THRESHOLD - 1);
    expect(estimate.tierId).toBe("standard");
    expect(estimate.rateCents).toBe(90);
  });

  it("exactly 5M flips to Scale with the 10% bracket", () => {
    const estimate = estimateMonthlyPrice(SCALE_THRESHOLD);
    expect(estimate.tierId).toBe("scale");
    expect(estimate.tierName).toBe("Scale");
    expect(estimate.rateCents).toBe(81);
    expect(estimate.discountPct).toBe(10);
  });

  it("the 10% discount can LOWER the total at the bracket edge — intended", () => {
    // 4,999,999 × list rate vs 5,000,000 × discounted rate: volume
    // pricing steps the RATE down, so the total can drop at an edge.
    const below = estimateMonthlyPrice(SCALE_THRESHOLD - 1);
    const at = estimateMonthlyPrice(SCALE_THRESHOLD);
    expect(below.monthlyEstimateCents).toBe(450_000); // 5000 units × 90¢
    expect(at.monthlyEstimateCents).toBe(405_000); // 5000 units × 81¢
    expect(at.monthlyEstimateCents!).toBeLessThan(below.monthlyEstimateCents!);
  });

  it("exactly 25M steps to the 20% bracket", () => {
    const estimate = estimateMonthlyPrice(25_000_000);
    expect(estimate.rateCents).toBe(72);
    expect(estimate.discountPct).toBe(20);
    expect(estimate.tierId).toBe("scale");
  });

  it("24,999,999 is still the 10% bracket", () => {
    expect(estimateMonthlyPrice(24_999_999).rateCents).toBe(81);
  });

  it("exactly 100M steps to the 30% bracket", () => {
    const estimate = estimateMonthlyPrice(100_000_000);
    expect(estimate.rateCents).toBe(63);
    expect(estimate.discountPct).toBe(30);
  });

  it("99,999,999 is still the 20% bracket", () => {
    expect(estimateMonthlyPrice(99_999_999).rateCents).toBe(72);
  });

  it("499,999,999 is the last quoted volume (30% bracket)", () => {
    const estimate = estimateMonthlyPrice(ENTERPRISE_THRESHOLD - 1);
    expect(estimate.isEnterpriseHandoff).toBe(false);
    expect(estimate.rateCents).toBe(63);
    expect(estimate.tierId).toBe("scale");
  });

  it("resolveBracket returns null only beyond the table", () => {
    expect(resolveBracket(0)).not.toBeNull();
    expect(resolveBracket(ENTERPRISE_THRESHOLD - 1)).not.toBeNull();
    expect(resolveBracket(ENTERPRISE_THRESHOLD)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 4. Enterprise handoff                                               */
/* ------------------------------------------------------------------ */

describe("enterprise threshold handoff", () => {
  it("exactly 500M stops quoting — no rate, no figure, tier flips", () => {
    const estimate = estimateMonthlyPrice(ENTERPRISE_THRESHOLD);
    expect(estimate.isEnterpriseHandoff).toBe(true);
    expect(estimate.tierId).toBe("enterprise");
    expect(estimate.tierName).toBe("Enterprise");
    expect(estimate.rateCents).toBeNull();
    expect(estimate.discountPct).toBeNull();
    expect(estimate.monthlyEstimateCents).toBeNull();
    expect(estimate.monthlyEstimateUsd).toBeNull();
  });

  it("far beyond the threshold stays a handoff (2B)", () => {
    const estimate = estimateMonthlyPrice(2_000_000_000);
    expect(estimate.isEnterpriseHandoff).toBe(true);
    expect(estimate.monthlyEstimateCents).toBeNull();
  });

  it("the handoff still reports normalized volume + billable units", () => {
    const estimate = estimateMonthlyPrice(750_000_123.7);
    expect(estimate.requestsPerMonth).toBe(750_000_123);
    expect(estimate.billableUnits).toBe(750_001);
  });
});

/* ------------------------------------------------------------------ */
/* 5. Money exactness — integer cents end-to-end                       */
/* ------------------------------------------------------------------ */

describe("money exactness (no float drift)", () => {
  it("every estimate's cents field is an exact integer", () => {
    for (const volume of [1, 999, 1_001, 123_456, 5_000_001, 77_777_777, 499_999_999]) {
      const estimate = estimateMonthlyPrice(volume);
      expect(Number.isInteger(estimate.monthlyEstimateCents)).toBe(true);
    }
  });

  it("5M quotes exactly $4,050.00 (5000 × 81¢)", () => {
    const estimate = estimateMonthlyPrice(5_000_000);
    expect(estimate.monthlyEstimateCents).toBe(405_000);
    expect(estimate.monthlyEstimateUsd).toBe(4050);
  });

  it("123,456,789 quotes exactly 123,457 units × 63¢ = 7,777,791¢", () => {
    const estimate = estimateMonthlyPrice(123_456_789);
    expect(estimate.billableUnits).toBe(123_457);
    expect(estimate.rateCents).toBe(63);
    expect(estimate.monthlyEstimateCents).toBe(7_777_791);
    expect(estimate.monthlyEstimateUsd).toBeCloseTo(77_777.91, 10);
  });

  it("zero volume quotes exactly $0", () => {
    const estimate = estimateMonthlyPrice(0);
    expect(estimate.monthlyEstimateCents).toBe(0);
    expect(estimate.monthlyEstimateUsd).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* 6. Purity / determinism                                             */
/* ------------------------------------------------------------------ */

describe("determinism", () => {
  it("the same input yields the same estimate, every call", () => {
    const first = estimateMonthlyPrice(1_234_567);
    const second = estimateMonthlyPrice(1_234_567);
    expect(first).toEqual(second);
  });

  it("estimates are stable across the whole preset range", () => {
    for (const volume of [10_000, 100_000, 1_000_000, 10_000_000, 100_000_000]) {
      expect(estimateMonthlyPrice(volume)).toEqual(estimateMonthlyPrice(volume));
    }
  });

  it("a fractional input and its floor quote identically", () => {
    expect(estimateMonthlyPrice(9_999.5)).toEqual(estimateMonthlyPrice(9_999));
  });
});

/* ------------------------------------------------------------------ */
/* 7. Bracket-table structure + formatter                              */
/* ------------------------------------------------------------------ */

describe("bracket table structure", () => {
  it("brackets are contiguous: each starts where the previous ends", () => {
    for (let i = 1; i < VOLUME_BRACKETS.length; i += 1) {
      expect(VOLUME_BRACKETS[i].minVolume).toBe(VOLUME_BRACKETS[i - 1].maxVolumeExclusive);
    }
  });

  it("the table starts at 0 and ends exactly at the enterprise threshold", () => {
    expect(VOLUME_BRACKETS[0].minVolume).toBe(0);
    const last = VOLUME_BRACKETS[VOLUME_BRACKETS.length - 1];
    expect(last.maxVolumeExclusive).toBe(ENTERPRISE_THRESHOLD);
  });

  it("each bracket rate equals the list rate minus its discount, in exact cents", () => {
    for (const bracket of VOLUME_BRACKETS) {
      expect(bracket.rateCents).toBe((BASE_RATE_CENTS * (100 - bracket.discountPct)) / 100);
    }
  });

  it("SCALE_THRESHOLD is the first discounted bracket's floor", () => {
    expect(SCALE_THRESHOLD).toBe(VOLUME_BRACKETS[1].minVolume);
  });
});

describe("display formatters (deterministic, locale-pinned)", () => {
  it("formats cents as USD with clean integers and honest cents", () => {
    expect(formatUsdFromCents(0)).toBe("$0");
    expect(formatUsdFromCents(90)).toBe("$0.90");
    expect(formatUsdFromCents(405_000)).toBe("$4,050");
    expect(formatUsdFromCents(7_777_791)).toBe("$77,777.91");
    expect(formatUsdFromCents(63)).toBe("$0.63");
  });

  it("formats request counts with thousands separators", () => {
    expect(formatRequestCount(0)).toBe("0");
    expect(formatRequestCount(1_000)).toBe("1,000");
    expect(formatRequestCount(5_000_000)).toBe("5,000,000");
    expect(formatRequestCount(500_000_000)).toBe("500,000,000");
  });
});
