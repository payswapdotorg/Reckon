/**
 * Overview — the landing workspace (UI-003 builds the full decision-loop
 * view; this foundation wave renders the honest state plus the system
 * status card that demonstrates the five evidence classes).
 *
 * force-dynamic: the reachability probe runs at request time so the
 * displayed connection state is what was actually observed, never a
 * build-time snapshot.
 */
import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";
import { SystemStatusCard } from "@/components/system-status-card";
import { WorkspacePage } from "@/components/workspace-page";
import { getReckonApiDisplayConfig } from "@/lib/reckon-client";
import { probeReckonApi } from "@/lib/reckon-status";
import { requireWorkspaceRoute } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const overview = requireWorkspaceRoute("/");

export const metadata: Metadata = {
  title: overview.title,
  description: overview.subtitle,
};

export default async function OverviewPage() {
  const [config, probe] = await Promise.all([getReckonApiDisplayConfig(), probeReckonApi()]);
  const reason = probe.reachable
    ? "connected — the API answers, but no workspace data is exposed through the SDK surface yet; activity appears here as decisions are requested."
    : overview.emptyStateReason;
  return (
    <WorkspacePage title={overview.title} subtitle={overview.subtitle}>
      <SystemStatusCard config={config} probe={probe} />
      <EmptyState
        title="No data loaded"
        reason={reason}
        note="This workspace shows only real Reckon API state — no demo or fabricated data. Connect the API to populate it."
      />
    </WorkspacePage>
  );
}
