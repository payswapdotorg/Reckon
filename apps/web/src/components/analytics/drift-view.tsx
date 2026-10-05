/**
 * DriftView — the /analytics drift view (S3-002): per-model drift
 * indicator cards from the model.drift.detected events feed (the events
 * console data source), with the frozen severity mapping (over threshold
 * / approaching / within) and the honest latest-evaluation semantics.
 *
 * Honest states (Gate Q): a failed events surface renders the S3-001
 * degradation card naming GET /v1/events; an empty drift feed renders
 * the honest empty state (no model has crossed its drift threshold in
 * the window) — never a fabricated indicator.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EvidenceClassBadge } from "@/components/ui/evidence-class-badge";
import { SurfaceStateCard } from "@/components/developers/surface-state";
import {
  DRIFT_EVENT_TYPE,
  PENDING_DRIFT_EVENT_ROUTE,
  driftModelCards,
  driftSummary,
  driftView,
  type DriftSeverity,
} from "@/lib/analytics-drift";
import type { DriftEventsPage } from "@/lib/analytics-drift";
import type { SurfaceResult } from "@/lib/developers-api";
import styles from "./analytics-views.module.css";

export interface DriftViewProps {
  readonly events: SurfaceResult<DriftEventsPage>;
}

function severityPillClass(severity: DriftSeverity): string {
  if (severity === "critical") return `${styles.severityPill} ${styles.severityCritical}`;
  if (severity === "warning") return `${styles.severityPill} ${styles.severityWarning}`;
  return `${styles.severityPill} ${styles.severityInfo}`;
}

export function DriftView({ events }: DriftViewProps) {
  if (!events.ok) {
    return <SurfaceStateCard surfaceName="Model drift" failure={events.failure} />;
  }

  const cards = driftModelCards(events.data.events);
  const summary = driftSummary(cards, events.data.otherTypeCount);
  const view = driftView(summary, cards);
  const feedEmpty = events.data.events.length === 0 && events.data.otherTypeCount === 0;

  return (
    <Card>
      <CardHeader>
        <div className={styles.viewHead}>
          <CardTitle>Drift indicators</CardTitle>
          {cards.length > 0 ? <EvidenceClassBadge evidenceClass={view.evidenceClass} /> : null}
        </div>
        <CardDescription>
          Per-model drift state from the <code>{DRIFT_EVENT_TYPE}</code> events feed — the same
          data source the Developers › Events console reads. Severity is the frozen mapping:
          over threshold, approaching (≥ 80% of it), or within.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {feedEmpty ? (
          <div className={styles.emptyPane}>
            <p className={styles.emptyTitle}>No events in the feed</p>
            <p className={styles.emptyNote}>
              The events surface answered with an empty first page — drift indicators appear as the
              platform emits model.drift.detected events.
            </p>
          </div>
        ) : cards.length === 0 ? (
          <div className={styles.emptyPane}>
            <p className={styles.emptyTitle}>No drift events</p>
            <p className={styles.emptyNote}>
              The feed carries {events.data.otherTypeCount} event(s) of other types — no model has
              emitted a drift evaluation in this window. An empty drift feed is the healthy case;
              it is reported, not padded.
            </p>
          </div>
        ) : (
          <>
            <div className={styles.statGrid}>
              <div className={styles.stat}>
                <span className={styles.statLabel}>Models monitored</span>
                <span className={styles.statValue}>{summary.models}</span>
                <span className={styles.statHint}>{summary.driftEvents} drift event(s)</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statLabel}>Over threshold</span>
                <span
                  className={`${styles.statValue} ${
                    summary.criticalModels > 0 ? styles.statValueDrop : ""
                  }`}
                >
                  {summary.criticalModels}
                </span>
                <span className={styles.statHint}>models past their alert threshold</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statLabel}>Approaching</span>
                <span className={styles.statValue}>{summary.warningModels}</span>
                <span className={styles.statHint}>models at ≥ 80% of threshold</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statLabel}>Within threshold</span>
                <span className={styles.statValue}>{summary.infoModels}</span>
                <span className={styles.statHint}>models below the warning band</span>
              </div>
            </div>

            <div className={styles.driftGrid}>
              {view.cards.map((card) => (
                <div className={styles.driftCard} key={card.modelLabel}>
                  <div className={styles.driftModelRow}>
                    <h4 className={styles.driftModelId}>
                      {card.modelLabel} <span className={styles.driftScoreOf}>{card.versionLabel}</span>
                    </h4>
                    <span className={severityPillClass(card.severity)}>{card.severityLabel}</span>
                  </div>
                  <div className={styles.driftScoreRow}>
                    <span className={styles.driftScore}>{card.scoreLabel}</span>
                    <span className={styles.driftScoreOf}>
                      of threshold {card.thresholdLabel} · {card.ratioLabel}
                    </span>
                  </div>
                  <dl className={styles.driftFacts}>
                    <div>metric {card.metricLabel}</div>
                    <div>window {card.windowLabel}</div>
                    <div>{card.eventCountLabel}</div>
                  </dl>
                </div>
              ))}
            </div>

            <h4 className={styles.caveatTitle}>Reading notes</h4>
            <ul className={styles.caveatList}>
              {view.caveatSentences.map((sentence) => (
                <li className={styles.caveatItem} key={sentence}>
                  <span className={styles.caveatMarker} aria-hidden="true">
                    ▲
                  </span>
                  {sentence}
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** The pending route this view needs (rendered by the surface card above). */
export const DRIFT_PENDING_ROUTES: readonly string[] = [PENDING_DRIFT_EVENT_ROUTE];
