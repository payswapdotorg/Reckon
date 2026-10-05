/**
 * ModeBadge — a small pill naming the current account mode, tinted with
 * the mode's semantic color (test = amber, live = emerald). Embedded
 * anywhere a mode indicator belongs: the site header, the sidebar
 * footer, the Home status card. Client component (mode context); on the
 * server render it shows the default (test) and settles after mount.
 */
"use client";

import { useDashboardMode } from "./mode-provider.js";
import styles from "./mode-badge.module.css";

export function ModeBadge() {
  const { mode } = useDashboardMode();
  return (
    <span
      className={`${styles.badge} ${mode === "live" ? styles.badgeLive : styles.badgeTest}`}
      data-reckon-mode-indicator={mode}
      title={
        mode === "live"
          ? "Live mode — real account data. Destructive actions ask for confirmation."
          : "Test mode — safe defaults; destructive actions run ungated. (API routing lands with S2-003.)"
      }
    >
      {mode === "live" ? "LIVE MODE" : "TEST MODE"}
    </span>
  );
}
