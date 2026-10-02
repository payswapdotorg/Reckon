/**
 * EmptyState — the honest-degradation pattern imported wholesale from the
 * reference (§7): centered composition; large outlined warning triangle;
 * title → precise reason → single Retry action; light red-tinted card
 * (red-50 + soft red border); an explanatory line BELOW the card.
 *
 * Reckon law (Gate Q): never render fabricated data — states say exactly
 * what is missing and why.
 */
import { TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { RetryButton } from "./retry-button";
import styles from "./empty-state.module.css";

export interface EmptyStateProps {
  /** e.g. "No data loaded". */
  title: string;
  /** The precise reason — e.g. "connect the API at http://127.0.0.1:8080". */
  reason: string;
  /** Explanatory line rendered below the card. */
  note: string;
  /** Retry action label (default "Retry"). */
  actionLabel?: string;
}

export function EmptyState({ title, reason, note, actionLabel = "Retry" }: EmptyStateProps) {
  return (
    <div className={styles.emptyState}>
      <Card tone="degraded" padding="generous" className={styles.card}>
        <TriangleAlert className={styles.icon} aria-hidden="true" strokeWidth={1.5} size={28} />
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.reason}>{reason}</p>
        <RetryButton label={actionLabel} />
      </Card>
      <p className={styles.note}>{note}</p>
    </div>
  );
}
