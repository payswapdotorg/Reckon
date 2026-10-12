/**
 * Remembered ads — the remembered-lane browser (AD-005).
 *
 * The browser over Personal Ad Memory: every ad the agent retains for
 * the subject, filterable by text ("What laptop ads have I seen?"),
 * labels, surfaces and encounter window. The page pins `mode:
 * "remembered"` — provider-supplied supply NEVER appears here (law 9);
 * each card carries its origin class (remembered vs retained-from-supply)
 * and links to the record detail (evidence trail, rights, retention).
 *
 * Data path: plain GET form + the SDK seam at request time (or the URL's
 * pinned replay clock). Honesty law: idle/not-configured/error/answered
 * states say exactly what happened; nothing is fabricated.
 */
import type { Metadata } from "next";
import { WorkspacePage } from "@/components/workspace-page";
import { AdsQueryForm } from "@/components/ads/ads-query-form";
import { AdsUnavailableState, AdsNotConfiguredState } from "@/components/ads/ads-unavailable-state";
import { RememberedAdsList } from "@/components/ads/remembered-ads-list";
import { normalizeAdsQueryParams } from "@/lib/ads-view";
import { queryAds, type AdQueryRetrieval } from "@/lib/ads-retrieval";
import { requireWorkspaceRoute } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const route = requireWorkspaceRoute("/ads/remembered");

export const metadata: Metadata = {
  title: route.title,
  description: route.subtitle,
};

interface RememberedPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function RememberedPage({ searchParams }: RememberedPageProps) {
  const params = await searchParams;
  const normalized = normalizeAdsQueryParams(params);
  const hasQuery =
    params.q !== undefined ||
    params.labels !== undefined ||
    params.surfaces !== undefined ||
    params.from !== undefined ||
    params.until !== undefined ||
    params.limit !== undefined ||
    params.at !== undefined;
  const retrieval: AdQueryRetrieval = hasQuery
    ? await queryAds({ ...normalized, mode: "remembered" })
    : await queryAds({
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
      <AdsQueryForm action="/ads/remembered" params={normalized} fixedMode="remembered" />
      {retrieval.status === "not-configured" ? (
        <AdsNotConfiguredState surface="The remembered-ads lane" reason={retrieval.reason} />
      ) : retrieval.status === "error" ? (
        <AdsUnavailableState surface="The remembered-ads lane" failure={retrieval.failure} />
      ) : retrieval.status === "answered" ? (
        <RememberedAdsList
          candidates={retrieval.result.remembered}
          at={retrieval.at}
          scopeLabel={`subject ${retrieval.scope.subject.ref} · tenant ${retrieval.scope.tenant.tenantId}`}
          notes={retrieval.result.notes}
        />
      ) : null /* idle: unreachable — this page always queries */}
    </WorkspacePage>
  );
}
