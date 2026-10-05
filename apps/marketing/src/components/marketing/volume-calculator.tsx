"use client";

/**
 * Volume calculator (S1-003) — the interactive per-1k pricing estimator,
 * stripe.com pricing-page grammar. A slider + number field + presets
 * feed ONE pure function (src/lib/pricing-calculator.ts — deterministic,
 * unit-tested) and the readout renders its estimate. No fetching, no
 * clock, no randomness: the same volume always paints the same numbers.
 *
 * A11y: both controls carry labels (visible label for the number field,
 * aria-label for the slider), presets are an aria-pressed button group,
 * and the readout is a polite live region so changes are announced
 * without stealing focus.
 */
import { useState } from "react";
import { ArrowRight } from "@/components/marketing/icons";
import { SectionHeading } from "@/components/marketing/section-heading";
import {
  ENTERPRISE_THRESHOLD,
  estimateMonthlyPrice,
  formatRequestCount,
  formatUsdFromCents,
} from "@/lib/pricing-calculator";
import { calculatorCopy } from "@/lib/pricing-content";

export function VolumeCalculator() {
  const [volume, setVolume] = useState<number>(calculatorCopy.defaultVolume);
  const [rawInput, setRawInput] = useState<string>(String(calculatorCopy.defaultVolume));

  const estimate = estimateMonthlyPrice(volume);

  /** Slider and presets commit a whole, clamped volume and sync the field. */
  function commit(next: number): void {
    const clamped = Math.max(
      0,
      Math.min(calculatorCopy.inputMax, Math.floor(Number.isFinite(next) ? next : 0)),
    );
    setVolume(clamped);
    setRawInput(String(clamped));
  }

  /** Typing updates the raw field immediately; the estimate follows
   *  whatever valid prefix has been typed so far (never fights typing). */
  function onType(text: string): void {
    setRawInput(text);
    const parsed = Number(text);
    if (text.trim() !== "" && Number.isFinite(parsed) && parsed >= 0) {
      setVolume(Math.min(calculatorCopy.inputMax, Math.floor(parsed)));
    }
  }

  return (
    <section className="rk-section" id="calculator" aria-labelledby="rk-calc-title">
      <div className="rk-container">
        <SectionHeading
          center
          eyebrow={calculatorCopy.eyebrow}
          title={calculatorCopy.title}
          sub={calculatorCopy.sub}
        />

        <div className="rk-calc">
          <div className="rk-calc-controls">
            <label className="rk-calc-input-label" htmlFor="rk-calc-input">
              {calculatorCopy.inputLabel}
            </label>
            <input
              id="rk-calc-input"
              className="rk-calc-input"
              type="number"
              inputMode="numeric"
              min={0}
              max={calculatorCopy.inputMax}
              step={1_000}
              value={rawInput}
              onChange={(event) => onType(event.target.value)}
            />
            <input
              type="range"
              className="rk-calc-slider"
              aria-label={calculatorCopy.sliderLabel}
              min={0}
              max={calculatorCopy.sliderMax}
              step={calculatorCopy.sliderStep}
              value={Math.min(volume, calculatorCopy.sliderMax)}
              onChange={(event) => commit(Number(event.target.value))}
            />
            <div className="rk-calc-presets" role="group" aria-label={calculatorCopy.presetsLabel}>
              {calculatorCopy.presets.map((preset) => (
                <button
                  type="button"
                  key={preset}
                  className={volume === preset ? "rk-calc-preset rk-calc-preset-active" : "rk-calc-preset"}
                  aria-pressed={volume === preset}
                  onClick={() => commit(preset)}
                >
                  {formatRequestCount(preset)}
                </button>
              ))}
            </div>
            <p className="rk-calc-input-note">
              Test-mode traffic never counts — only live decision requests are metered.
            </p>
          </div>

          <div className="rk-calc-readout" aria-live="polite">
            {estimate.isEnterpriseHandoff ? (
              <>
                <p className="rk-calc-tier">
                  <span className="rk-calc-tier-chip rk-calc-tier-chip-enterprise">
                    {estimate.tierName}
                  </span>
                </p>
                <p className="rk-calc-handoff-title">{calculatorCopy.handoffTitle}</p>
                <p className="rk-calc-handoff-body">{calculatorCopy.handoffBody}</p>
                <div className="rk-calc-handoff-cta">
                  <a className="rk-btn rk-btn-secondary" href={calculatorCopy.handoffCta.href}>
                    {calculatorCopy.handoffCta.label}
                    <ArrowRight size={16} />
                  </a>
                </div>
              </>
            ) : (
              <>
                <p className="rk-calc-tier">
                  <span className="rk-calc-tier-chip">{estimate.tierName}</span>
                  {estimate.discountPct !== null && estimate.discountPct > 0 ? (
                    <span className="rk-calc-discount">−{estimate.discountPct}% volume</span>
                  ) : null}
                </p>
                <dl className="rk-calc-stats">
                  <div className="rk-calc-stat">
                    <dt className="rk-calc-stat-label">{calculatorCopy.readoutRateLabel}</dt>
                    <dd className="rk-calc-stat-value">
                      {estimate.rateCents === null
                        ? "—"
                        : `${formatUsdFromCents(estimate.rateCents)} / 1k`}
                    </dd>
                  </div>
                  <div className="rk-calc-stat">
                    <dt className="rk-calc-stat-label">{calculatorCopy.readoutUnitsLabel}</dt>
                    <dd className="rk-calc-stat-value">{formatRequestCount(estimate.billableUnits)}</dd>
                  </div>
                </dl>
                <p className="rk-calc-estimate">
                  <span className="rk-calc-estimate-label">{calculatorCopy.readoutEstimateLabel}</span>
                  <span className="rk-calc-estimate-value">
                    {estimate.monthlyEstimateCents === null
                      ? "—"
                      : formatUsdFromCents(estimate.monthlyEstimateCents)}
                  </span>
                </p>
                <p className="rk-calc-readout-note">
                  {estimate.billableUnits === 0
                    ? calculatorCopy.zeroVolumeNote
                    : `At ${formatRequestCount(estimate.requestsPerMonth)} live requests / month · enterprise handoff at ${formatRequestCount(ENTERPRISE_THRESHOLD)}`}
                </p>
              </>
            )}
          </div>
        </div>

        <p className="rk-calc-note">{calculatorCopy.footnote}</p>
      </div>
    </section>
  );
}
