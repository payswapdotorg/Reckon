/**
 * Agents — the Agent workspace (UI-007): Agent Body field cards + the
 * interactive Organization graph (FINAL TL HANDOFF §12).
 *
 * Data path (server components only): organization lookup by id through
 * the SDK read surface (GET /v1/agents/organizations/{id}) with a
 * JS-optional GET form; with no id the page lists the tenant's recent
 * bodies + organizations. force-dynamic: reads resolve at request time —
 * never a build-time snapshot, never fabricated state (Gate Q).
 */
import type { Metadata } from "next";
import { AgentBodyCard } from "@/components/agent/agent-body-card";
import { OrganizationGraph } from "@/components/agent/organization-graph";
import { AgentLookup } from "@/components/agent/agent-lookup";
import { AgentRecentCard } from "@/components/agent/agent-recent-card";
import { AgentUnavailableCard } from "@/components/agent/agent-unavailable-card";
import { WorkspacePage } from "@/components/workspace-page";
import { getReckonApiDisplayConfig } from "@/lib/reckon-client";
import { listAgentSurfaces, normalizeAgentParam, retrieveOrganization } from "@/lib/agent-retrieval";
import { requireWorkspaceRoute } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const route = requireWorkspaceRoute("/agents");

export const metadata: Metadata = {
  title: route.title,
  description: route.subtitle,
};

interface AgentsPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AgentsPage({ searchParams }: AgentsPageProps) {
  const params = await searchParams;
  const organizationId = normalizeAgentParam(params.org);

  const [retrieval, listings, apiConfig] = await Promise.all([
    organizationId === undefined
      ? Promise.resolve({ status: "idle" } as const)
      : retrieveOrganization(organizationId),
    organizationId === undefined ? listAgentSurfaces() : Promise.resolve(undefined),
    getReckonApiDisplayConfig(),
  ]);

  return (
    <WorkspacePage title={route.title} subtitle={route.subtitle}>
      <AgentLookup currentId={organizationId} />
      {retrieval.status === "found" ? (
        <>
          <OrganizationGraph organization={retrieval.value} />
          {retrieval.value.bodies.map((body) => (
            <AgentBodyCard key={body.bodyId} body={body} />
          ))}
        </>
      ) : retrieval.status === "idle" ? (
        <AgentRecentCard listings={listings} apiKeyNotConfigured={!apiConfig.demoApiKeyConfigured} />
      ) : (
        <AgentUnavailableCard retrieval={retrieval} />
      )}
    </WorkspacePage>
  );
}
