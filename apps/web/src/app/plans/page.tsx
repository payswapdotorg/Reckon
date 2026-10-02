/**
 * Plans — the Experience Plan workspace (UI-005).
 *
 * The rolling timeline (NOW → CURRENT → NEXT → QUEUED → OPPORTUNITY →
 * FUTURE HORIZON), replan triggers, interruption boundaries, resume
 * checkpoints and the full replan history.
 *
 * Data path (server components only): the plan-id lookup field is a plain
 * GET form (`/plans?id=…` — shareable, JS-optional); with no id the page
 * lists the tenant's recent plans through the SDK read surface
 * (`GET /v1/plans`) so the workspace starts from REAL data when any
 * exists. force-dynamic: every SDK read resolves at request time —
 * never a build-time snapshot, never fabricated state (Gate Q).
 */
import type { Metadata } from "next";
import { PlanLookup } from "@/components/plan/plan-lookup";
import { ReplanHistory } from "@/components/plan/replan-history";
import { RollingTimeline } from "@/components/plan/rolling-timeline";
import { RecentPlansCard } from "@/components/plan/recent-plans-card";
import { PlanUnavailabilityCard } from "@/components/plan/plan-unavailability-card";
import { WorkspacePage } from "@/components/workspace-page";
import { getReckonApiDisplayConfig } from "@/lib/reckon-client";
import { listRecentPlans, normalizePlanId, retrievePlan } from "@/lib/plan-retrieval";
import { planTimeline } from "@/lib/plan-view";
import { requireWorkspaceRoute } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const route = requireWorkspaceRoute("/plans");

export const metadata: Metadata = {
  title: route.title,
  description: route.subtitle,
};

interface PlansPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PlansPage({ searchParams }: PlansPageProps) {
  const params = await searchParams;
  const planId = normalizePlanId(params.id);

  const [retrieval, recent, apiConfig] = await Promise.all([
    planId === undefined ? Promise.resolve({ status: "idle" } as const) : retrievePlan(planId),
    planId === undefined ? listRecentPlans() : Promise.resolve(undefined),
    getReckonApiDisplayConfig(),
  ]);

  return (
    <WorkspacePage title={route.title} subtitle={route.subtitle}>
      <PlanLookup currentId={planId} />
      {retrieval.status === "found" ? (
        <>
          <RollingTimeline timeline={planTimeline(retrieval.plan)} />
          <ReplanHistory history={retrieval.history} />
        </>
      ) : retrieval.status === "idle" ? (
        <RecentPlansCard recent={recent} apiKeyNotConfigured={!apiConfig.demoApiKeyConfigured} />
      ) : (
        <PlanUnavailabilityCard retrieval={retrieval} />
      )}
    </WorkspacePage>
  );
}
