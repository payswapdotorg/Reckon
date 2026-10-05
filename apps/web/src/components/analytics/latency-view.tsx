/**
 * LatencyView — the /analytics latency view (S3-002): p50/p95/p99 over
 * decision-route request logs (nearest-rank), a CSS bucket histogram,
 * the honest "n=" sample counts, and per-mode evidence from the key
 * prefixes (test-key traffic labeled TEST, live-key traffic LIVE).
 *
 * Honest states (Gate Q): a failed request-log surface renders the S3-001
 * degradation card naming GET /v1/request-logs; a log window with no
 * decision-route rows renders the honest empty state — percentiles are
 * withheld, never zero.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EvidenceClassBadge } from "@/components/ui/evidence-class-badge";
import { SurfaceStateCard } from "@/components/developers/surface-state";
import { latencySummary, latencyView, PENDING_REQUEST_LOG_ROUTE } from "@/lib/analytics-latency";
import type { RequestLogsPage, SurfaceResult } from "@/lib/developers-api";
import styles from "./analytics-views.module.css";

export interface LatencyViewProps {
  readonly logs: SurfaceResult<RequestLogsPage>;
}

/** The mode chip class per key-mode evidence. */
function modeChipClass(mode: "test" | "live" | "unlabeled"): string {
  if (mode === "test") return `${styles.modeChip} ${styles.modeChipTest}`;
  if (mode === "live") return `${styles.modeChip} ${styles.modeChipLive}`;
  return `${styles.modeChip} ${styles.modeChipUnlabeled}`;
}

export function LatencyView({ logs }: LatencyViewProps) {
  if (!logs.ok) {
    return <SurfaceStateCard surfaceName="Decision latency" failure={logs.failure} />;
  }

  const summary = latencySummary(logs.data.logs);
  const view = latencyView(summary);

  return (
    <Card>
      <CardHeader>
        <div className={styles.viewHead}>
          <CardTitle>Decision latency</CardTitle>
          {summary.n > 0 ? <EvidenceClassBadge evidenceClass={view.evidenceClass} /> : null}
        </div>
        <CardDescription>
          Nearest-rank percentiles over the decision route&apos;s requests
          (<code>POST /v1/decisions</code> rows in the request log) — every figure states its
          sample count.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {summary.n === 0 ? (
          <div className={styles.emptyPane}>
            <p className={styles.emptyTitle}>
              {logs.data.logs.length === 0
                ? "No requests logged yet"
                : "No decision requests in the fetched log window"}
            </p>
            <p className={styles.emptyNote}>
              {logs.data.logs.length === 0
                ? "The request-log surface answered with an empty first page — latency percentiles appear as decision requests are served."
                : "The window holds only non-decision requests; this distribution covers the decision route alone, so percentiles are withheld rather than mixed."}
            </p>
          </div>
        ) : (
          <>
            <div className={styles.statGrid}>
              {view.percentileRows.map((row) => (
                <div className={styles.stat} key={row.id}>
                  <span className={styles.statLabel}>{row.label}</span>
                  <span className={styles.statValue}>{row.valueLabel}</span>
                  <span className={styles.statHint}>{view.nLabel}</span>
                </div>
              ))}
              <div className={styles.stat}>
                <span className={styles.statLabel}>Observed range</span>
                <span className={styles.statValue}>
                  {view.minLabel} – {view.maxLabel}
                </span>
                <span className={styles.statHint}>{view.statusLabel}</span>
              </div>
            </div>

            {view.modeChips.length > 0 ? (
              <div className={styles.modeChipRow} aria-label="Mode evidence of the samples">
                {view.modeChips.map((chip) => (
                  <span key={chip.mode} className={modeChipClass(chip.mode)}>
                    {chip.label === "Test-key traffic" ? "test evidence" : chip.label === "Live-key traffic" ? "live evidence" : "unlabeled"}
                    <span className={styles.modeChipMeta}>
                      {chip.nLabel} · {chip.p95Label}
                    </span>
                  </span>
                ))}
              </div>
            ) : null}

            <h4 className={styles.caveatTitle}>Latency distribution</h4>
            <ul className={styles.barList} aria-hidden="true">
              {view.buckets.map((bucket) => (
                <li className={styles.barRow} key={bucket.label}>
                  <span className={styles.barLabel}>{bucket.label}</span>
                  <span className={styles.barTrack}>
                    <span
                      className={styles.barFill}
                      style={{ width: `${bucket.sharePct ?? 0}%` }}
                    />
                  </span>
                  <span className={styles.barCount}>
                    {bucket.count}
                    {bucket.sharePct !== null ? ` (${bucket.sharePct.toFixed(1)}%)` : ""}
                  </span>
                </li>
              ))}
            </ul>
            {view.otherRouteLabel !== null ? (
              <p className={styles.sourceNote}>{view.otherRouteLabel}</p>
            ) : null}

            <h4 className={styles.caveatTitle}>Sample caveats</h4>
            <ul className={styles.caveatList}>
              {view.caveats.map((caveat) => (
                <li className={styles.caveatItem} key={caveat.id}>
                  <span className={styles.caveatMarker} aria-hidden="true">
                    ▲
                  </span>
                  {caveat.sentence}
                </li>
              ))}
            </ul>

            {/* Screen-reader table: the same distribution, tabular. */}
            <table className={styles.srOnly}>
              <caption>Decision latency distribution by bucket</caption>
              <thead>
                <tr>
                  <th scope="col">Bucket</th>
                  <th scope="col">Count</th>
                  <th scope="col">Share</th>
                </tr>
              </thead>
              <tbody>
                {view.buckets.map((bucket) => (
                  <tr key={bucket.label}>
                    <th scope="row">{bucket.label}</th>
                    <td>{bucket.count}</td>
                    <td>{bucket.sharePct === null ? "not computable" : `${bucket.sharePct.toFixed(1)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** The pending route this view needs (rendered by the surface card above). */
export const LATENCY_PENDING_ROUTES: readonly string[] = [PENDING_REQUEST_LOG_ROUTE];
