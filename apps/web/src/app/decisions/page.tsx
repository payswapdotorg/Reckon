/**
 * Decisions — the decision workspace (UI-004).
 *
 * Context, candidates, experiences and the selected decision — with
 * policy, uncertainty, constraints and switching cost in the open.
 *
 * Data path (server components only): the decision-id lookup field is a
 * plain GET form (`/decisions?id=…` — shareable, JS-optional); the page
 * retrieves the decision through the SDK seam
 * (`GET /v1/decisions/{id}` via getReckonClient) at request time
 * (force-dynamic) and renders exactly what the API returned:
 *
 *   - idle          → honest-empty default (the SDK decision surface has
 *                     no recent-decisions listing — W3-002);
 *   - not-configured / error → reference §7 degraded state with the typed
 *                     SDK failure surfaced verbatim (code, message);
 *   - found         → the full decision workspace (summary, context,
 *                     experience, candidates, costs) — no fabricated
 *                     data, no computed confidence (Gate Q).
 */
import type { Metadata } from "next";
import { DecisionIdleState } from "@/components/decisions/decision-idle-state";
import { DecisionLookup } from "@/components/decisions/decision-lookup";
import { DecisionUnavailableState } from "@/components/decisions/decision-unavailable-state";
import { DecisionWorkspace } from "@/components/decisions/decision-workspace";
import { WorkspacePage } from "@/components/workspace-page";
import { getReckonApiDisplayConfig } from "@/lib/reckon-client";
import { retrieveDecision } from "@/lib/decision-retrieval";
import { normalizeDecisionIdParam } from "@/lib/decision-view";
import { requireWorkspaceRoute } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const route = requireWorkspaceRoute("/decisions");

export const metadata: Metadata = {
  title: route.title,
  description: route.subtitle,
};

interface DecisionsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DecisionsPage({ searchParams }: DecisionsPageProps) {
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
        <DecisionWorkspace decision={retrieval.decision} />
      ) : (
        <DecisionUnavailableState retrieval={retrieval} />
      )}
    </WorkspacePage>
  );
}
