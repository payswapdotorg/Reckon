/**
 * Current ads — the provider-supplied lane (AD-005).
 *
 * Eligible current ads supplied by host/ad providers: availability
 * declarations evaluated fresh per query, gated at the caller clock
 * (law 3). The page pins `mode: "available"` — memory records NEVER
 * appear here (law 9); each card shows the declaring channel, its
 * window, and the memory link when the same ad is also retained.
 *
 * Data path: the SDK seam at request time (or the URL's pinned replay
 * clock). No availability channel configured → the lane is honestly
 * empty with a disclosed note (rights are never inferred from catalog
 * presence — architecture-lock #23).
 */
import type { Metadata } from "next";
import { WorkspacePage } from "@/components/workspace-page";
import { AdsQueryForm } from "@/components/ads/ads-query-form";
import { AdsUnavailableState, AdsNotConfiguredState } from "@/components/ads/ads-unavailable-state";
import { AvailableAdsList } from "@/components/ads/available-ads-list";
import { normalizeAdsQueryParams } from "@/lib/ads-view";
import { queryAds, type AdQueryRetrieval } from "@/lib/ads-retrieval";
import { requireWorkspaceRoute } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const route = requireWorkspaceRoute("/ads/available");

export const metadata: Metadata = {
  title: route.title,
  description: route.subtitle,
};

interface AvailablePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AvailablePage({ searchParams }: AvailablePageProps) {
  const params = await searchParams;
  const normalized = normalizeAdsQueryParams(params);
  const hasQuery =
    params.q !== undefined ||
    params.labels !== undefined ||
    params.surfaces !== undefined ||
    params.limit !== undefined ||
    params.at !== undefined;
  const retrieval: AdQueryRetrieval = hasQuery
    ? await queryAds({ ...normalized, mode: "available" })
    : await queryAds({
        text: undefined,
        mode: "available",
        labels: [],
        surfaces: [],
        encounteredFromMs: undefined,
        encounteredUntilMs: undefined,
        limit: undefined,
        atMs: undefined,
      });

  return (
    <WorkspacePage title={route.title} subtitle={route.subtitle}>
      <AdsQueryForm action="/ads/available" params={normalized} fixedMode="available" />
      {retrieval.status === "not-configured" ? (
        <AdsNotConfiguredState surface="The provider-supplied lane" reason={retrieval.reason} />
      ) : retrieval.status === "error" ? (
        <AdsUnavailableState surface="The provider-supplied lane" failure={retrieval.failure} />
      ) : retrieval.status === "answered" ? (
        <AvailableAdsList
          candidates={retrieval.result.available}
          at={retrieval.at}
          notes={retrieval.result.notes}
        />
      ) : null /* idle: unreachable — this page always queries */}
    </WorkspacePage>
  );
}
