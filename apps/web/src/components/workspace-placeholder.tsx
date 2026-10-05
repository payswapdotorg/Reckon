/**
 * WorkspacePlaceholder — the honest empty state every not-yet-live
 * section renders until its workspace goes live: full shell, real
 * title/subtitle, "No data loaded — connect the API" degradation card.
 * Server component; copy comes from the workspace registry.
 *
 * S3-001: section routes with `relatedHrefs` (the existing studio
 * workspaces that already surface related data) render them as honest
 * "related surfaces" links — an operator can reach live views without
 * waiting for the section's own backend.
 */
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { EmptyState } from "./empty-state.js";
import { WorkspacePage } from "./workspace-page.js";
import { requireWorkspaceRoute, type WorkspaceRoute } from "@/lib/workspace";
import styles from "./workspace-placeholder.module.css";

export interface WorkspacePlaceholderProps {
  route: WorkspaceRoute;
}

export function WorkspacePlaceholder({ route }: WorkspacePlaceholderProps) {
  const related =
    route.relatedHrefs !== undefined
      ? route.relatedHrefs.map((href) => requireWorkspaceRoute(href))
      : [];

  return (
    <WorkspacePage title={route.title} subtitle={route.subtitle}>
      <EmptyState
        title="No data loaded"
        reason={`${route.emptyStateReason}`}
        note="This workspace shows only real Reckon API state — no demo or fabricated data. Connect the API to populate it."
      />
      {related.length > 0 ? (
        <div className={styles.related}>
          <h2 className={styles.relatedTitle}>Related live surfaces</h2>
          <p className={styles.relatedNote}>
            These studio workspaces already show real data in this area today.
          </p>
          <ul className={styles.relatedList}>
            {related.map((relatedRoute) => (
              <li key={relatedRoute.href}>
                <Link href={relatedRoute.href} className={styles.relatedLink}>
                  <span className={styles.relatedLabel}>{relatedRoute.title}</span>
                  <span className={styles.relatedHint}>{relatedRoute.subtitle}</span>
                  <ArrowRight aria-hidden="true" size={13} strokeWidth={1.75} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </WorkspacePage>
  );
}
