/**
 * ReplanHistory (UI-005) — the version chain with recorded reasons.
 *
 * Data comes from GET /v1/plans/{id}/history (each entry: the plan at that
 * version + the persistence-recorded replan reason — the plan contract
 * itself carries no reason field, so the reason column states null
 * honestly when the creating path recorded none).
 */
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { PlanVersionEntry } from "@reckon/sdk";
import styles from "./replan-history.module.css";

export interface ReplanHistoryProps {
  readonly history: readonly PlanVersionEntry[];
}

export function ReplanHistory({ history }: ReplanHistoryProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Replan history</CardTitle>
        <CardDescription>
          The full version chain (oldest → newest) with each version&rsquo;s recorded replan
          reason. Plans are versioned, never overwritten — every replan is a new version.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {history.length === 0 ? (
          <p className={styles.empty}>
            No version history recorded for this plan id (the history surface returned an empty
            chain — the plan may predate history tracking, or the read failed and was bounded to
            the latest version).
          </p>
        ) : (
          <ol className={styles.chain}>
            {history.map((entry, index) => (
              <li key={`${entry.plan.planId}-${entry.version}`} className={styles.entry}>
                <div className={styles.entryHead}>
                  <Badge>v{entry.version}</Badge>
                  {index === history.length - 1 ? <Badge>latest</Badge> : null}
                  <span className={styles.when}>
                    {new Date(entry.plan.updatedAt).toISOString()}
                  </span>
                </div>
                <p className={styles.reason}>
                  {entry.reason === null ? (
                    <>
                      <span className={styles.noReason}>no reason recorded</span> — this version
                      was not created through the replan path (or the creating host recorded no
                      reason).
                    </>
                  ) : (
                    entry.reason
                  )}
                </p>
                <dl className={styles.facts}>
                  <div className={styles.fact}>
                    <dt>objective</dt>
                    <dd>
                      <code className={styles.inlineCode}>{entry.plan.objective.objectiveId}</code>{" "}
                      ({entry.plan.objective.kind})
                    </dd>
                  </div>
                  <div className={styles.fact}>
                    <dt>queue</dt>
                    <dd>{entry.plan.queuedExperiences.length} queued</dd>
                  </div>
                  <div className={styles.fact}>
                    <dt>current</dt>
                    <dd>
                      {entry.plan.currentExperience === undefined
                        ? "none"
                        : entry.plan.currentExperience.experienceId}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
