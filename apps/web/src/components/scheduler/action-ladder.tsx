/**
 * ActionLadder (UI-006) — HOLD / CONTINUE / QUEUE / SUGGEST / SWITCH /
 * INTERRUPT / RESUME / END with the decision's chosen action highlighted.
 *
 * The ladder makes the scheduler's vocabulary visible as a first-class
 * product surface (§11): every action states its meaning; the chosen one
 * carries the emerald accent. Server component.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { LadderStep } from "@/lib/scheduler-view";
import styles from "./action-ladder.module.css";

export interface ActionLadderProps {
  readonly ladder: readonly LadderStep[];
}

export function ActionLadder({ ladder }: ActionLadderProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Action ladder</CardTitle>
        <CardDescription>
          The scheduler&rsquo;s full action vocabulary — one of these is chosen per decision;
          ranking alone authorizes none of them.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className={styles.ladder}>
          {ladder.map((step) => (
            <li
              key={step.action}
              className={`${styles.step} ${step.chosen ? styles.chosen : ""}`}
              aria-current={step.chosen ? "true" : undefined}
            >
              <span className={styles.action}>{step.action}</span>
              <span className={styles.meaning}>{step.meaning}</span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
