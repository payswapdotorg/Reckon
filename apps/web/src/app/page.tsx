/**
 * Overview — the landing workspace (UI-003): the full decision-loop view
 * per FINAL TL HANDOFF §8.
 *
 * Composition, top to bottom:
 *  1. WHAT SHOULD HAPPEN NEXT? — the answer card: a real decision read
 *     live through the SDK seam by id, or the honest idle/degraded state
 *     with the by-id lookup affordance;
 *  2. Decision activity — the contract-validated record behind the answer;
 *  3. The decision loop / Signals & state — every remaining §8 surface,
 *     each showing real data where the SDK provides it and a precise
 *     not-available reason where it does not;
 *  4. System status — the foundation's real /healthz probe surface.
 *
 * force-dynamic: the probe, the SDK read and searchParams resolve at
 * request time so the page shows what was actually observed — never a
 * build-time snapshot and never fabricated state (Gate Q).
 */
import type { Metadata } from "next";
import { DecisionActivityCard } from "@/components/overview/decision-activity-card";
import { LoopSignalsCards } from "@/components/overview/loop-signals-card";
import { NextActionHero } from "@/components/overview/next-action-hero";
import { SystemStatusCard } from "@/components/system-status-card";
import { WorkspacePage } from "@/components/workspace-page";
import { getReckonApiDisplayConfig } from "@/lib/reckon-client";
import { probeReckonApi } from "@/lib/reckon-status";
import { loadNextAction, normalizeDecisionId } from "@/lib/overview-data";
import { requireWorkspaceRoute } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const overview = requireWorkspaceRoute("/");

export const metadata: Metadata = {
  title: overview.title,
  description: overview.subtitle,
};

interface OverviewPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function OverviewPage({ searchParams }: OverviewPageProps) {
  const params = await searchParams;
  const decisionId = normalizeDecisionId(params.decision);

  const [config, probe, result] = await Promise.all([
    getReckonApiDisplayConfig(),
    probeReckonApi(),
    loadNextAction(decisionId),
  ]);

  return (
    <WorkspacePage title={overview.title} subtitle={overview.subtitle}>
      <NextActionHero result={result} config={config} probe={probe} />
      <DecisionActivityCard result={result} />
      <LoopSignalsCards result={result} />
      <SystemStatusCard config={config} probe={probe} />
    </WorkspacePage>
  );
}
