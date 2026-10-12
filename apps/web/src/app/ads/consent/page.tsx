/**
 * Ad consent (AD-005) — the permission/consent surface: what the agent
 * is permitted to retain/present per record, with the append-only
 * history, and the permission-changing action the PUBLIC API offers
 * (forget — terminal). Present-only transitions have no public route
 * (UX_DX_GAP-1, disclosed on the surface, never faked).
 *
 * Data path: the remembered lane through the SDK seam at request time
 * (the consent state IS persisted through the public API — reads via
 * /v1/ads/query, the terminal transition via /v1/ads/forget).
 */
import type { Metadata } from "next";
import { WorkspacePage } from "@/components/workspace-page";
import { ConsentView } from "@/components/ads/consent-view";
import { AdsUnavailableState, AdsNotConfiguredState } from "@/components/ads/ads-unavailable-state";
import { formatEpochMs } from "@/lib/auth-view";
import { queryAds } from "@/lib/ads-retrieval";
import { requireWorkspaceRoute } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const route = requireWorkspaceRoute("/ads/consent");

export const metadata: Metadata = {
  title: route.title,
  description: route.subtitle,
};

export default async function ConsentPage() {
  const retrieval = await queryAds({
    text: undefined,
    mode: "remembered",
    labels: [],
    surfaces: [],
    encounteredFromMs: undefined,
    encounteredUntilMs: undefined,
    limit: undefined,
    atMs: undefined,
  });

  return (
    <WorkspacePage title={route.title} subtitle={route.subtitle}>
      {retrieval.status === "not-configured" ? (
        <AdsNotConfiguredState surface="The consent surface" reason={retrieval.reason} />
      ) : retrieval.status === "error" ? (
        <AdsUnavailableState surface="The consent surface" failure={retrieval.failure} />
      ) : retrieval.status === "answered" ? (
        <ConsentView
          records={retrieval.result.remembered.map((candidate) => candidate.record)}
          scopeLabel={`subject ${retrieval.scope.subject.ref} · tenant ${retrieval.scope.tenant.tenantId}`}
          clockLabel={formatEpochMs(retrieval.at)}
        />
      ) : null /* idle: unreachable — this page always queries */}
    </WorkspacePage>
  );
}
