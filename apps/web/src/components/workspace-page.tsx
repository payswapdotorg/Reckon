/**
 * WorkspacePage — reference §2 content body language: page title →
 * subtitle → content blocks, single column, generous vertical rhythm.
 * Server-compatible presentational scaffold shared by all seven routes.
 */
import type { ReactNode } from "react";
import styles from "./workspace-page.module.css";

export interface WorkspacePageProps {
  title: string;
  subtitle: string;
  children: ReactNode;
}

export function WorkspacePage({ title, subtitle, children }: WorkspacePageProps) {
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.subtitle}>{subtitle}</p>
      </header>
      <div className={styles.body}>{children}</div>
    </div>
  );
}
