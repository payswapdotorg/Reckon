/**
 * CtrLiftView — the /analytics CTR-lift view (S3-002): exposure-grouped
 * CTR with lift, Wilson intervals and the confidence caveat rendering
 * model, computed from the REAL decision/outcome trail records.
 *
 * Honest states (Gate Q): a failed trail renders the S3-001 degradation
 * card naming its pending route (GET /v1/decisions / GET /v1/outcomes) —
 * one card per missing dependency, each lighting up independently when
 * its route lands. Empty trails render the honest empty state. Computed
 * data renders with the `observed` evidence badge and every caveat
 * verbatim — no fabricated significance, ever.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EvidenceClassBadge } from "@/components/ui/evidence-class-badge";
import { SurfaceStateCard } from "@/components/developers/surface-state";
import {
  computeCtrLift,
  ctrLiftView,
  PENDING_DECISION_LIST_ROUTE,
  PENDING_OUTCOME_LIST_ROUTE,
  type DecisionTrailPage,
  type OutcomeTrailPage,
} from "@/lib/analytics-ctr-lift";
import type { SurfaceResult } from "@/lib/developers-api";
import styles from "./analytics-views.module.css";

export interface CtrLiftViewProps {
  readonly decisions: SurfaceResult<DecisionTrailPage>;
  readonly outcomes: SurfaceResult<OutcomeTrailPage>;
}

export function CtrLiftView({ decisions, outcomes }: CtrLiftViewProps) {
  if (!decisions.ok || !outcomes.ok) {
    return (
      <div>
        {!decisions.ok ? (
          <SurfaceStateCard surfaceName="CTR lift · decision trail" failure={decisions.failure} />
        ) : null}
        {!outcomes.ok ? (
          <SurfaceStateCard surfaceName="CTR lift · outcome trail" failure={outcomes.failure} />
        ) : null}
      </div>
    );
  }

  const result = computeCtrLift(decisions.data.decisions, outcomes.data.outcomes);
  const view = ctrLiftView(result);
  const hasNoData =
    decisions.data.decisions.length === 0 && outcomes.data.outcomes.length === 0;

  return (
    <Card>
      <CardHeader>
        <div className={styles.viewHead}>
          <CardTitle>CTR lift</CardTitle>
          {!hasNoData ? <EvidenceClassBadge evidenceClass={view.evidenceClass} /> : null}
        </div>
        <CardDescription>
          Exposure-grouped click-through rate: decisions with a confirmed impression (the decision
          → impression linkage) versus decisions without one, with the lift between them.
        </CardDescription>
        <p className={styles.sourceNote}>
          Click-through events are <code>start</code>, <code>conversion</code> and{" "}
          <code>purchase</code> outcomes from the frozen vocabulary, linked back to decisions and
          counted at or after the first impression.
        </p>
      </CardHeader>
      <CardContent>
        {hasNoData ? (
          <div className={styles.emptyPane}>
            <p className={styles.emptyTitle}>No decisions or outcomes in the window</p>
            <p className={styles.emptyNote}>
              Both trails answered with empty first pages — the CTR comparison appears as decisions
              and impression outcomes arrive.
            </p>
          </div>
        ) : (
          <>
            <div className={styles.statGrid}>
              <div className={styles.stat}>
                <span className={styles.statLabel}>Lift (exposed − baseline)</span>
                <span
                  className={`${styles.statValue} ${
                    result.lift.direction === "lift"
                      ? styles.statValueLift
                      : result.lift.direction === "drop"
                        ? styles.statValueDrop
                        : ""
                  }`}
                >
                  {view.liftLabel}
                </span>
                {view.liftRatioLabel !== null ? (
                  <span className={styles.statHint}>ratio {view.liftRatioLabel}</span>
                ) : null}
              </div>
              {view.contextCounts.map((entry) => (
                <div className={styles.stat} key={entry.label}>
                  <span className={styles.statLabel}>{entry.label}</span>
                  <span className={styles.statValue}>{entry.value}</span>
                </div>
              ))}
            </div>

            <p className={styles.sourceNote}>{view.liftSentence}</p>

            <div className={styles.groupGrid}>
              {view.groups.map((group) => (
                <div className={styles.groupCard} key={group.key}>
                  <div className={styles.groupTitleRow}>
                    <h4 className={styles.groupTitle}>{group.title}</h4>
                    <span className={styles.groupSubtitle}>{group.nLabel}</span>
                  </div>
                  <p className={styles.groupSubtitle}>{group.subtitle}</p>
                  <span className={styles.groupCtr}>{group.ctrLabel}</span>
                  <div className={styles.groupMeta}>
                    <span>{group.ciLabel}</span>
                    <span>{group.engagedLabel}</span>
                  </div>
                </div>
              ))}
            </div>

            <h4 className={styles.caveatTitle}>Confidence caveats</h4>
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

            {/* Screen-reader table: the same numbers, tabular. */}
            <table className={styles.srOnly}>
              <caption>CTR lift by exposure group</caption>
              <thead>
                <tr>
                  <th scope="col">Group</th>
                  <th scope="col">Decisions</th>
                  <th scope="col">Engaged</th>
                  <th scope="col">CTR</th>
                  <th scope="col">95% CI</th>
                </tr>
              </thead>
              <tbody>
                {view.groups.map((group) => (
                  <tr key={group.key}>
                    <th scope="row">{group.title}</th>
                    <td>{result[group.key].decisions}</td>
                    <td>{result[group.key].engaged}</td>
                    <td>{group.ctrLabel}</td>
                    <td>{group.ciLabel}</td>
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
export const CTR_LIFT_PENDING_ROUTES: readonly string[] = [
  PENDING_DECISION_LIST_ROUTE,
  PENDING_OUTCOME_LIST_ROUTE,
];
