/**
 * DecisionLoading (UI-004) — skeleton placeholders in card shapes
 * (reference §9: "skeleton placeholders in card shapes, never spinners
 * blocking whole pages"). Shown while the server streams the decision
 * workspace; the shimmer is restrained and honors the global
 * prefers-reduced-motion override.
 */
import { Card } from "@/components/ui/card";
import styles from "./decision-loading.module.css";

export function DecisionLoading() {
  return (
    <div className={styles.stack} aria-busy="true" aria-live="polite">
      <span className={styles.srOnly}>Retrieving the decision workspace…</span>
      <Card className={styles.card}>
        <div className={styles.titleBar} />
        <div className={`${styles.line} ${styles.lineWide}`} />
        <div className={`${styles.line} ${styles.lineNarrow}`} />
        <div className={styles.actionBlock} />
      </Card>
      <Card className={styles.card}>
        <div className={styles.titleBar} />
        <div className={`${styles.line} ${styles.lineMedium}`} />
        <div className={`${styles.line} ${styles.lineNarrow}`} />
      </Card>
      <Card className={styles.card}>
        <div className={styles.titleBar} />
        <div className={`${styles.line} ${styles.lineWide}`} />
        <div className={`${styles.line} ${styles.lineMedium}`} />
        <div className={`${styles.line} ${styles.lineNarrow}`} />
      </Card>
    </div>
  );
}
