/**
 * RollingTimeline (UI-005) — the NOW → CURRENT → NEXT → QUEUED →
 * OPPORTUNITY → FUTURE HORIZON timeline (FINAL TL HANDOFF §10).
 *
 * Server component by design (no state, no effects): the view model comes
 * from `planTimeline()` (pure mapping, unit-tested). Horizontal rail on
 * desktop, vertical on mobile — the stages are the product's conceptual
 * center, so the rail reads left-to-right as one continuous roll.
 *
 * HONESTY (Gate Q): stages the contract does not carry (OPPORTUNITY) render
 * their explicit absence note — never fabricated content.
 */
import type { PlanTimeline, TimelineStage } from "@/lib/plan-view";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import styles from "./rolling-timeline.module.css";

/** Duration is contract-typed number(ms) | ISO-8601 string — both render honestly. */
function formatDuration(duration: number | string | undefined): string | null {
  if (duration === undefined) return null;
  if (typeof duration === "string") return duration;
  const seconds = Math.round(duration / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function StageExperience({ label, experienceId, formatKind, duration }: {
  readonly label: string;
  readonly experienceId: string;
  readonly formatKind: string;
  readonly duration: number | string | undefined;
}) {
  const durationLabel = formatDuration(duration);
  return (
    <li className={styles.experience}>
      <div className={styles.experienceHead}>
        <span className={styles.positionLabel}>{label}</span>
        <code className={styles.experienceId} title={experienceId}>
          {experienceId.length > 18 ? `${experienceId.slice(0, 15)}…` : experienceId}
        </code>
      </div>
      <div className={styles.experienceMeta}>
        <Badge>{formatKind}</Badge>
        {durationLabel !== null ? <span className={styles.duration}>{durationLabel}</span> : null}
      </div>
    </li>
  );
}

function Stage({ stage }: { readonly stage: TimelineStage }) {
  const isOrigin = stage.id === "NOW";
  return (
    <li className={`${styles.stage} ${isOrigin ? styles.origin : ""}`} data-stage={stage.id}>
      <div className={styles.stageHead}>
        <span className={styles.stageId}>{stage.id}</span>
        <span className={styles.stageHeadline}>{stage.headline}</span>
      </div>
      {stage.detail !== null ? <p className={styles.stageDetail}>{stage.detail}</p> : null}
      {stage.experiences.length > 0 ? (
        <ul className={styles.experiences}>
          {stage.experiences.map((entry) => (
            <StageExperience
              key={entry.experience.experienceId}
              label={entry.positionLabel}
              experienceId={entry.experience.experienceId}
              formatKind={entry.experience.format.kind}
              duration={entry.experience.duration}
            />
          ))}
        </ul>
      ) : stage.absentNote !== null ? (
        <p className={styles.absentNote}>{stage.absentNote}</p>
      ) : null}
    </li>
  );
}

export interface RollingTimelineProps {
  readonly timeline: PlanTimeline;
}

export function RollingTimeline({ timeline }: RollingTimelineProps) {
  const { boundaries } = timeline;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rolling timeline</CardTitle>
        <CardDescription>
          The continuously revisable plan: NOW → CURRENT → NEXT → QUEUED → OPPORTUNITY → FUTURE
          HORIZON. A media auto-playlist is one possible use of this generic planner — not its
          conceptual center.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className={styles.rail} aria-label="Plan rolling timeline">
          {timeline.stages.map((stage) => (
            <Stage key={stage.id} stage={stage} />
          ))}
        </ol>
        <div className={styles.boundaries}>
          <h4 className={styles.boundariesTitle}>Interruption boundaries</h4>
          <p className={styles.boundariesText}>
            {boundaries.interruptionPolicy === null ? (
              <>
                No interruption policy referenced on this plan — ranking never auto-interrupts
                (the contract field is optional).
              </>
            ) : (
              <>
                Interruption policy{" "}
                <code className={styles.inlineCode}>{boundaries.interruptionPolicy.policyId}</code>{" "}
                v{boundaries.interruptionPolicy.version} — ranking alone never interrupts the
                current experience.
              </>
            )}
          </p>
          <h4 className={styles.boundariesTitle}>Resume checkpoints</h4>
          {boundaries.resumeCheckpoints.length === 0 ? (
            <p className={styles.boundariesText}>None saved on this plan.</p>
          ) : (
            <ul className={styles.checkpoints}>
              {boundaries.resumeCheckpoints.map((checkpoint) => (
                <li key={checkpoint.experienceId} className={styles.checkpoint}>
                  <code className={styles.experienceId}>{checkpoint.experienceId}</code>
                  <span className={styles.duration}>
                    saved {new Date(checkpoint.savedAt).toISOString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
