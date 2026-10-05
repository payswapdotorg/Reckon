/**
 * AnalyticsModeNote — the /analytics mode-awareness banner (S3-002), the
 * client-side read of the account's test/live mode machine next to the
 * honest statement of what that mode means for these server-rendered
 * views:
 *
 *  - the dashboard reads the API with ONE configured key
 *    (RECKON_DEMO_API_KEY), so a view's data is whatever that key's mode
 *    returned;
 *  - records carry their OWN mode evidence — request-log rows report the
 *    key prefix (sk_test_/sk_live_), so test-key traffic renders with the
 *    TEST chip in the latency view (test evidence, per the S3-002 law);
 *  - the account toggle itself is local/visual for now (the S3-001
 *    honest placeholder) — switching it does not refilter these views.
 */
"use client";

import { useDashboardMode } from "@/components/shell/mode-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import styles from "./analytics-views.module.css";

export function AnalyticsModeNote() {
  const { mode } = useDashboardMode();
  const chipClass =
    mode === "live" ? `${styles.modeChip} ${styles.modeChipLive}` : `${styles.modeChip} ${styles.modeChipTest}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mode &amp; evidence</CardTitle>
        <CardDescription>
          How the test/live mode machine interacts with these analytics views.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className={styles.noteRows}>
          <div className={styles.noteRow}>
            <dt className={styles.noteKey}>Account mode</dt>
            <dd className={styles.noteRow}>
              <span className={chipClass}>{mode} mode</span>
              <span>
                the toggle in the sidebar switches it (test → live asks first); a persisted mode
                settles in after mount.
              </span>
            </dd>
          </div>
          <div className={styles.noteRow}>
            <dt className={styles.noteKey}>Data source</dt>
            <dd>
              These views read the API with the studio&apos;s configured key
              (<code>RECKON_DEMO_API_KEY</code>) — each view states its evidence class from what
              that key&apos;s traffic actually returned.
            </dd>
          </div>
          <div className={styles.noteRow}>
            <dt className={styles.noteKey}>Test evidence</dt>
            <dd>
              Records carry their own mode evidence: request-log rows report the key prefix, so
              test-key traffic (<code>sk_test_…</code>) renders with the TEST chip — test evidence,
              labeled as such, never mixed silently with live.
            </dd>
          </div>
          <div className={styles.noteRow}>
            <dt className={styles.noteKey}>Toggle scope</dt>
            <dd>
              The toggle is visual and local for now (the S3-001 placeholder) — switching it does
              not refilter these server-rendered views.
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
