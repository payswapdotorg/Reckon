/**
 * ScheduleConsequences (UI-006) — the schedule delta ordered by the
 * decision (enqueue/dequeue/resume checkpoint + plan linkage) plus latency
 * observations, followed by the policy's verbatim reasons trail.
 *
 * Absent contract fields surface as explicit "not provided" rows (Gate Q).
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SchedulerView } from "@/lib/scheduler-view";
import styles from "./schedule-consequences.module.css";

export interface ScheduleConsequencesProps {
  readonly view: SchedulerView;
}

export function ScheduleConsequences({ view }: ScheduleConsequencesProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Schedule consequences + reasons</CardTitle>
        <CardDescription>
          What this decision changed (or would change) in the plan, the measured decision latency,
          and the deciding policy&rsquo;s recorded reasoning — verbatim.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className={styles.facts}>
          {view.consequences.map((row) => (
            <div key={row.label} className={styles.fact}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
        <h4 className={styles.reasonsTitle}>Reasons trail</h4>
        {view.reasons.length === 0 ? (
          <p className={styles.empty}>
            The deciding policy recorded no reasons for this decision (the contract allows an
            empty reasons array).
          </p>
        ) : (
          <ul className={styles.reasons}>
            {view.reasons.map((reason) => (
              <li key={reason.code} className={styles.reason}>
                <code className={styles.code}>{reason.code}</code>
                <span>{reason.message}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
