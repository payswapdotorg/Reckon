/**
 * LearningLadder (UI-008) — the §13 organizing spine: Supervised →
 * Contextual Bandits/OPE → Offline Policy Learning → Sequential
 * Simulation → RL → Organization Search → Bounded Live Evaluation →
 * Calibration. Static product truth (the rung order), rendered as a
 * ladder; server component.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LEARNING_LADDER } from "@/lib/research-view";
import styles from "./learning-ladder.module.css";

export function LearningLadder() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>The learning ladder</CardTitle>
        <CardDescription>
          Evidence strengthens rung by rung — from supervised labels to bounded live evaluation and
          calibration. Where an experiment sits on this ladder says what its evidence can claim
          (Gate Q: simulated and counterfactual rungs are visually distinct from observed ones).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className={styles.ladder}>
          {LEARNING_LADDER.map((rung) => (
            <li
              key={rung.id}
              className={`${styles.rung} ${
                rung.id === "bounded-live" ? styles.observedRung : styles.simulatedRung
              }`}
            >
              <span className={styles.stage}>{rung.stage}</span>
              <span className={styles.rungBody}>
                <span className={styles.title}>{rung.title}</span>
                <span className={styles.description}>{rung.description}</span>
                <span className={styles.evidenceTag}>
                  {rung.id === "bounded-live" || rung.id === "calibration"
                    ? "observed-class rung"
                    : "simulated/counterfactual-class rung"}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
