/**
 * WorkspacePlaceholder — the honest empty state every foundation page
 * renders until its workspace goes live (UI-003..UI-009): full shell,
 * real title/subtitle, "No data loaded — connect the API" degradation
 * card. Server component; copy comes from the workspace registry.
 */
import { EmptyState } from "./empty-state";
import { WorkspacePage } from "./workspace-page";
import type { WorkspaceRoute } from "@/lib/workspace";

export interface WorkspacePlaceholderProps {
  route: WorkspaceRoute;
}

export function WorkspacePlaceholder({ route }: WorkspacePlaceholderProps) {
  return (
    <WorkspacePage title={route.title} subtitle={route.subtitle}>
      <EmptyState
        title="No data loaded"
        reason={`${route.emptyStateReason}`}
        note="This workspace shows only real Reckon API state — no demo or fabricated data. Connect the API to populate it."
      />
    </WorkspacePage>
  );
}
