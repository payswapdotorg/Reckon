/**
 * Ad retention (AD-005) — the retention management surface: per-record
 * retention state (basis, expiry — laws 1/3) with per-ad forget, plus
 * bulk forget over the frozen target vocabulary (item / advertiser /
 * all). Expiry changes have no public route (UX_DX_GAP-2, disclosed,
 * never worked around); forget is terminal (law 2) and host-owned
 * rights boundaries ride verbatim (law 4).
 *
 * Data path: the remembered lane through the SDK seam at request time.
 */
import type { Metadata } from "next";
import { WorkspacePage } from "@/components/workspace-page";
import { RetentionView } from "@/components/ads/retention-view";
import { AdsUnavailableState, AdsNotConfiguredState } from "@/components/ads/ads-unavailable-state";
import { formatEpochMs } from "@/lib/auth-view";
import { queryAds } from "@/lib/ads-retrieval";
import { requireWorkspaceRoute } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const route = requireWorkspaceRoute("/ads/retention");

export const metadata: Metadata = {
  title: route.title,
  description: route.subtitle,
};

export default async function RetentionPage() {
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
        <AdsNotConfiguredState surface="The retention surface" reason={retrieval.reason} />
      ) : retrieval.status === "error" ? (
        <AdsUnavailableState surface="The retention surface" failure={retrieval.failure} />
      ) : retrieval.status === "answered" ? (
        <RetentionView
          records={retrieval.result.remembered.map((candidate) => candidate.record)}
          scopeLabel={`subject ${retrieval.scope.subject.ref} · tenant ${retrieval.scope.tenant.tenantId}`}
          clockLabel={formatEpochMs(retrieval.at)}
        />
      ) : null /* idle: unreachable — this page always queries */}
    </WorkspacePage>
  );
}
