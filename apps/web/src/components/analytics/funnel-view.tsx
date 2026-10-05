/**
 * FunnelView — the /analytics funnel view (S3-002): the decisions →
 * outcomes → preference-delta funnel stage mapping with CSS stage bars
 * and honest rates (null on zero denominators).
 *
 * Honest states (Gate Q): a failed trail renders the S3-001 degradation
 * card naming its pending route (GET /v1/decisions, GET /v1/outcomes,
 * GET /v1/preferences/events) — one card per missing dependency. Empty
 * trails render the honest empty state. Computed data renders with the
 * `observed` badge and the subject-level-linkage caveat verbatim.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EvidenceClassBadge } from "@/components/ui/evidence-class-badge";
import { SurfaceStateCard } from "@/components/developers/surface-state";
import {
  funnelCounts,
  funnelView,
  PENDING_DECISION_LIST_ROUTE,
  PENDING_OUTCOME_LIST_ROUTE,
  PENDING_PREFERENCE_DELTA_LIST_ROUTE,
  type DecisionTrailPage,
  type OutcomeTrailPage,
  type PreferenceDeltaTrailPage,
} from "@/lib/analytics-funnel";
import type { DecisionTrailRecord, OutcomeTrailRecord, PreferenceDeltaTrailRecord } from "@/lib/analytics-funnel";
import type { SurfaceResult } from "@/lib/developers-api";
import styles from "./analytics-views.module.css";

export interface FunnelViewProps {
  readonly decisions: SurfaceResult<DecisionTrailPage>;
  readonly outcomes: SurfaceResult<OutcomeTrailPage>;
  readonly deltas: SurfaceResult<PreferenceDeltaTrailPage>;
}

export function FunnelView({ decisions, outcomes, deltas }: FunnelViewProps) {
  if (!decisions.ok || !outcomes.ok || !deltas.ok) {
    return (
      <div>
        {!decisions.ok ? (
          <SurfaceStateCard surfaceName="Funnel · decision trail" failure={decisions.failure} />
        ) : null}
        {!outcomes.ok ? (
          <SurfaceStateCard surfaceName="Funnel · outcome trail" failure={outcomes.failure} />
        ) : null}
        {!deltas.ok ? (
          <SurfaceStateCard surfaceName="Funnel · preference deltas" failure={deltas.failure} />
        ) : null}
      </div>
    );
  }

  const decisionRecords: readonly DecisionTrailRecord[] = decisions.data.decisions;
  const outcomeRecords: readonly OutcomeTrailRecord[] = outcomes.data.outcomes;
  const deltaRecords: readonly PreferenceDeltaTrailRecord[] = deltas.data.deltas;
  const counts = funnelCounts(decisionRecords, outcomeRecords, deltaRecords);
  const view = funnelView(counts);
  const hasNoData =
    decisionRecords.length === 0 && outcomeRecords.length === 0 && deltaRecords.length === 0;

  return (
    <Card>
      <CardHeader>
        <div className={styles.viewHead}>
          <CardTitle>Decision loop funnel</CardTitle>
          {!hasNoData ? <EvidenceClassBadge evidenceClass={view.evidenceClass} /> : null}
        </div>
        <CardDescription>
          The loop Reckon closes: decisions made, decisions with a linked observed outcome, and
          preference deltas appended for subjects with outcomes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {hasNoData ? (
          <div className={styles.emptyPane}>
            <p className={styles.emptyTitle}>No loop activity in the window</p>
            <p className={styles.emptyNote}>
              All three trails answered with empty first pages — the funnel appears as decisions,
              outcomes and preference deltas arrive.
            </p>
          </div>
        ) : (
          <>
            <ul className={styles.funnelList} aria-hidden="true">
              {view.stages.map((stage) => (
                <li className={styles.funnelStage} key={stage.id}>
                  <div className={styles.funnelFillTrack}>
                    <div
                      className={styles.funnelFill}
                      style={{ width: `${stage.shareOfFirstPct ?? 0}%` }}
                    />
                  </div>
                  <div className={styles.funnelStageBody}>
                    <div>
                      <h4 className={styles.funnelStageLabel}>{stage.label}</h4>
                      <p className={styles.funnelStageDesc}>{stage.description}</p>
                    </div>
                    <div className={styles.funnelStageNumbers}>
                      <span className={styles.funnelCount}>{stage.count}</span>
                      <span>
                        {stage.shareOfFirstPct === null
                          ? "share not computable"
                          : `${stage.shareOfFirstPct.toFixed(1)}% of decisions`}
                      </span>
                      <span>
                        {stage.shareOfPreviousPct === null
                          ? "step rate withheld"
                          : `${stage.shareOfPreviousPct.toFixed(1)}% of previous`}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className={styles.statGrid}>
              {view.exclusionLabels.map((entry) => (
                <div className={styles.stat} key={entry.label}>
                  <span className={styles.statLabel}>{entry.label}</span>
                  <span className={styles.statValue}>{entry.value}</span>
                </div>
              ))}
            </div>

            <h4 className={styles.caveatTitle}>Reading caveats</h4>
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

            {/* Screen-reader table: the funnel, tabular. */}
            <table className={styles.srOnly}>
              <caption>Decision loop funnel stages</caption>
              <thead>
                <tr>
                  <th scope="col">Stage</th>
                  <th scope="col">Count</th>
                  <th scope="col">Share of decisions</th>
                  <th scope="col">Step rate</th>
                </tr>
              </thead>
              <tbody>
                {view.stages.map((stage) => (
                  <tr key={stage.id}>
                    <th scope="row">{stage.label}</th>
                    <td>{stage.count}</td>
                    <td>
                      {stage.shareOfFirstPct === null
                        ? "not computable"
                        : `${stage.shareOfFirstPct.toFixed(1)}%`}
                    </td>
                    <td>
                      {stage.shareOfPreviousPct === null
                        ? "withheld"
                        : `${stage.shareOfPreviousPct.toFixed(1)}%`}
                    </td>
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

/** The pending routes this view needs (rendered by the surface cards above). */
export const FUNNEL_PENDING_ROUTES: readonly string[] = [
  PENDING_DECISION_LIST_ROUTE,
  PENDING_OUTCOME_LIST_ROUTE,
  PENDING_PREFERENCE_DELTA_LIST_ROUTE,
];
