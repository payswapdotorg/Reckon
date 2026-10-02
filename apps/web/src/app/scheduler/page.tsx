/**
 * Scheduler — the scheduler/interruption workspace (UI-006).
 *
 * RANKING vs SWITCHING vs INTERRUPTION exposed as the product truth:
 * the action ladder states what was chosen; the score breakdown shows
 * exactly what the contract carries (never computed switch-cost
 * arithmetic); schedule consequences + the reasons trail complete the §11
 * view.
 *
 * Data path (server components only): the scheduler state of record IS the
 * decision — retrieved by id through the SDK seam (GET /v1/decisions/{id})
 * via the same JS-optional GET-form lookup pattern as the other
 * workspaces. The SDK exposes no recent-decisions listing (W3-002); that
 * limitation is stated on the page (honest, like UI-004).
 *
 * force-dynamic: every read resolves at request time — never a build-time
 * snapshot, never fabricated state (Gate Q).
 */
import type { Metadata } from "next";
import { DecisionLookup } from "@/components/decisions/decision-lookup";
import { DecisionIdleState } from "@/components/decisions/decision-idle-state";
import { DecisionUnavailableState } from "@/components/decisions/decision-unavailable-state";
import { ActionLadder } from "@/components/scheduler/action-ladder";
import { RankingHero } from "@/components/scheduler/ranking-hero";
import { ScheduleConsequences } from "@/components/scheduler/schedule-consequences";
import { ScoreBreakdown } from "@/components/scheduler/score-breakdown";
import { WorkspacePage } from "@/components/workspace-page";
import { getReckonApiDisplayConfig } from "@/lib/reckon-client";
import { retrieveDecision } from "@/lib/decision-retrieval";
import { normalizeDecisionIdParam } from "@/lib/decision-view";
import { schedulerView } from "@/lib/scheduler-view";
import { requireWorkspaceRoute } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const route = requireWorkspaceRoute("/scheduler");

export const metadata: Metadata = {
  title: route.title,
  description: route.subtitle,
};

interface SchedulerPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SchedulerPage({ searchParams }: SchedulerPageProps) {
  const params = await searchParams;
  const decisionId = normalizeDecisionIdParam(params.id);

  const [retrieval, apiConfig] = await Promise.all([
    decisionId === undefined
      ? Promise.resolve({ status: "idle" } as const)
      : retrieveDecision(decisionId),
    getReckonApiDisplayConfig(),
  ]);

  return (
    <WorkspacePage title={route.title} subtitle={route.subtitle}>
      <DecisionLookup currentId={decisionId} />
      {retrieval.status === "idle" ? (
        <DecisionIdleState apiKeyNotConfigured={!apiConfig.demoApiKeyConfigured} />
      ) : retrieval.status === "found" ? (
        (() => {
          const view = schedulerView(retrieval.decision);
          return (
            <>
              <RankingHero view={view} />
              <ActionLadder ladder={view.ladder} />
              <ScoreBreakdown scores={view.scores} />
              <ScheduleConsequences view={view} />
            </>
          );
        })()
      ) : (
        <DecisionUnavailableState retrieval={retrieval} />
      )}
    </WorkspacePage>
  );
}
