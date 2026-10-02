/**
 * RankingHero (UI-006) — the product truth the scheduler workspace exists
 * to expose: RANKING ≠ PERMISSION TO INTERRUPT (FINAL TL HANDOFF §11).
 *
 * Server component; the statement is static truth (architecture-lock #11),
 * the chosen action + policy beneath it come from the mapped view.
 */
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SchedulerView } from "@/lib/scheduler-view";
import styles from "./ranking-hero.module.css";

export interface RankingHeroProps {
  readonly view: SchedulerView;
}

export function RankingHero({ view }: RankingHeroProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ranking is not permission to interrupt</CardTitle>
        <CardDescription>
          A better-ranked candidate never automatically interrupts the current experience. The
          scheduler separates RANKING (who scores best) from SWITCHING and INTERRUPTION (what may
          actually happen) — the ladder below states what was chosen.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className={styles.row}>
          <span className={styles.label}>Chosen action</span>
          <span className={styles.action}>{chosenOf(view)}</span>
          <span className={styles.policy}>
            policy <code className={styles.inlineCode}>{view.policy.policyId}</code> v
            {view.policy.version}
          </span>
        </div>
        <p className={styles.note}>
          The frozen decision contract carries no structured switch-cost fields (expected
          improvement, interruption cost, resume loss, net switching value) — such arithmetic is
          never computed or fabricated here; where the deciding policy recorded cost reasoning it
          appears verbatim in the reasons trail below.
        </p>
      </CardContent>
    </Card>
  );
}

function chosenOf(view: SchedulerView): string {
  return view.ladder.find((step) => step.chosen)?.action ?? "—";
}
