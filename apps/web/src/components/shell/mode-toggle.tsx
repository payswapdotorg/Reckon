/**
 * ModeToggle — the account-level test/live switch (S3-001): the Stripe
 * dashboard's signature affordance, placed at the top of the sidebar
 * rail. Segmented control, two options, the active side filled with the
 * mode's semantic color (test = amber --mode-test, live = emerald
 * --mode-live — both from the committed palette).
 *
 * Switching test→live opens the confirm dialog (mode machine); live→test
 * is immediate. The caption is the honest placeholder: persistence is
 * local, API-side semantics land with S2-003.
 *
 * Client component (mode context). Keyboard: each segment is a real
 * radio input — arrow keys move, Space/Enter select.
 */
"use client";

import { useDashboardMode } from "./mode-provider.js";
import styles from "./mode-toggle.module.css";

export function ModeToggle() {
  const { mode, requestModeSwitch } = useDashboardMode();

  return (
    <div className={styles.toggleBlock} data-reckon-mode-current={mode}>
      <div
        className={styles.segmented}
        role="radiogroup"
        aria-label="Account mode"
        data-active-mode={mode}
      >
        <label className={mode === "test" ? `${styles.segment} ${styles.segmentActiveTest}` : styles.segment}>
          <input
            type="radio"
            name="reckon-dashboard-mode"
            value="test"
            className={styles.input}
            checked={mode === "test"}
            onChange={() => requestModeSwitch("test")}
          />
          Test mode
        </label>
        <label className={mode === "live" ? `${styles.segment} ${styles.segmentActiveLive}` : styles.segment}>
          <input
            type="radio"
            name="reckon-dashboard-mode"
            value="live"
            className={styles.input}
            checked={mode === "live"}
            onChange={() => requestModeSwitch("live")}
          />
          Live mode
        </label>
      </div>
      <p className={styles.caption} title="Honest placeholder (S3-001)">
        Mode is visual + local — API routing lands with S2-003.
      </p>
    </div>
  );
}
