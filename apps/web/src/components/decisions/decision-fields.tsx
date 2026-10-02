/**
 * Decision card field atoms (UI-004) — the shared row/value vocabulary for
 * the Decisions workspace cards, in the foundation's system-status-card
 * row language (11px uppercase keys, 13px values, mono code chips).
 *
 * `NotProvided` is the honest-empty marker: it renders exactly what the
 * frozen decision-result contract did NOT carry, with an optional note
 * saying where that datum would live. Never a placeholder value.
 */
import type { ReactNode } from "react";
import styles from "./decision-fields.module.css";

export interface FieldRowsProps {
  children: ReactNode;
}

/** Definition list of field rows (dl semantics like system-status-card). */
export function FieldRows({ children }: FieldRowsProps) {
  return <dl className={styles.rows}>{children}</dl>;
}

export interface FieldRowProps {
  label: string;
  children: ReactNode;
}

export function FieldRow({ label, children }: FieldRowProps) {
  return (
    <div className={styles.row}>
      <dt className={styles.rowKey}>{label}</dt>
      <dd className={styles.rowValue}>{children}</dd>
    </div>
  );
}

/** Mono code chip for ids, codes and exact wire values. */
export function CodeValue({ children }: { children: ReactNode }) {
  return <code className={styles.code}>{children}</code>;
}

export interface NotProvidedProps {
  /** Optional one-line note on where the datum lives when absent. */
  note?: string;
}

/**
 * The honest absence marker — renders when a contract field is optional
 * and the retrieved record did not carry it. Says precisely that.
 */
export function NotProvided({ note }: NotProvidedProps) {
  return (
    <span className={styles.notProvided}>
      not provided
      {note === undefined ? null : <span className={styles.notProvidedNote}> — {note}</span>}
    </span>
  );
}

/** A muted inline annotation (contract caveats, honesty notes). */
export function MutedNote({ children }: { children: ReactNode }) {
  return <p className={styles.mutedNote}>{children}</p>;
}
