/**
 * Ad card field atoms (AD-005) — the shared row/value vocabulary for the
 * Ads section cards, in the foundation's system-status-card row language
 * (11px uppercase keys, 13px values, mono code chips) — the same
 * conventions as the Decisions workspace's field atoms.
 *
 * `NotProvided` is the honest-empty marker: it renders exactly what the
 * frozen ad contracts did NOT carry. Never a placeholder value (Gate Q).
 */
import type { ReactNode } from "react";
import styles from "./ad-facts.module.css";

export interface AdFactRowsProps {
  children: ReactNode;
}

/** Definition list of fact rows (dl semantics like system-status-card). */
export function AdFactRows({ children }: AdFactRowsProps) {
  return <dl className={styles.rows}>{children}</dl>;
}

export interface AdFactRowProps {
  label: string;
  children: ReactNode;
}

export function AdFactRow({ label, children }: AdFactRowProps) {
  return (
    <div className={styles.row}>
      <dt className={styles.rowKey}>{label}</dt>
      <dd className={styles.rowValue}>{children}</dd>
    </div>
  );
}

/** Mono code chip for ids, digests and exact wire values. */
export function AdCodeValue({ children }: { children: ReactNode }) {
  return <code className={styles.code}>{children}</code>;
}

export interface AdNotProvidedProps {
  /** Optional one-line note on where the datum lives when absent. */
  note?: string;
}

/** The honest absence marker — says precisely what the record did not carry. */
export function AdNotProvided({ note }: AdNotProvidedProps) {
  return (
    <span className={styles.notProvided}>
      not provided
      {note === undefined ? null : <span className={styles.notProvidedNote}> — {note}</span>}
    </span>
  );
}

/** A muted inline annotation (contract caveats, honesty notes). */
export function AdMutedNote({ children }: { children: ReactNode }) {
  return <p className={styles.mutedNote}>{children}</p>;
}
