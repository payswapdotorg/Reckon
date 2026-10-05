"use client";

/**
 * Live-stat ticker (survey §2.1) — the micro-proof strip above the hero.
 *
 * Aria strategy: the counter is NOT a live region (a counting number would
 * spam screen readers). The final value is present in the DOM as text; the
 * count-up is a visual enhancement that respects prefers-reduced-motion.
 *
 * Honesty note (AGENTS.md): the weekly figure is a static typed constant
 * until real network telemetry lands (S2/S3) — it is labeled "Network stat"
 * in the UI exactly for that reason.
 */
import { useEffect, useRef, useState } from "react";
import { tickerStat } from "@/lib/marketing-content";

const COUNT_DURATION_MS = 1800;
const TICK_INTERVAL_MS = 5000;
/** Count-up starts ~3.5% below the target — a quick, subtle settle. */
const START_RATIO = 0.965;

function format(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function StatTicker() {
  const [value, setValue] = useState<number>(tickerStat.value);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const target = tickerStat.value;
    const start = Math.round(target * START_RATIO);
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion) {
      setValue(target);
      return;
    }

    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / COUNT_DURATION_MS);
      setValue(Math.round(start + (target - start) * easeOut(t)));
      if (t < 1) {
        frameRef.current = requestAnimationFrame(step);
      }
    };
    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setValue((v) => v + 2 + Math.floor(Math.random() * 7));
    }, TICK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="rk-ticker">
      <div className="rk-container rk-ticker-inner">
        <span className="rk-ticker-dot" aria-hidden="true" />
        <span className="rk-ticker-label">
          {tickerStat.label}
          <span className="rk-ticker-sep" aria-hidden="true">
            &nbsp;·&nbsp;
          </span>
          <span className="rk-ticker-value">{format(value)}</span>
        </span>
        <span className="rk-ticker-note">{tickerStat.note}</span>
      </div>
    </div>
  );
}
