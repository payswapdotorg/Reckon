/**
 * Ads — the Ad Query workspace (AD-005), the section root.
 *
 * The product behavior from docs/architecture/ad-memory.md: the user can
 * answer explicit queries about ads ("What laptop ads have I seen?"),
 * see eligible current ads supplied by host/providers, and ALWAYS tell
 * remembered ads from newly retrieved/provider-supplied ads (law 9) and
 * advertising from ordinary recommendations (law 8).
 *
 * Data path (server components only): the query form is a plain GET
 * form (shareable, JS-optional); the page runs the query through the
 * SDK seam (`POST /v1/ads/query` via getReckonClient, mode both) at
 * request time (force-dynamic) — or at the URL's pinned replay clock —
 * and renders EXACTLY what the API returned:
 *
 *   - idle (no query yet) → honest-empty default with the lane law;
 *   - not-configured / error → §7 degraded state with the typed SDK
 *     failure surfaced verbatim;
 *   - answered → the two lanes (law 9: SEPARATE sections, provenance
 *     badges on every card), query understanding + notes disclosed.
 */
import type { Metadata } from "next";
import { WorkspacePage } from "@/components/workspace-page";
import { AdsQueryForm } from "@/components/ads/ads-query-form";
import { AdLanes } from "@/components/ads/ad-lanes";
import { AdsUnavailableState, AdsNotConfiguredState } from "@/components/ads/ads-unavailable-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AdMutedNote } from "@/components/ads/ad-facts";
import { formatEpochMs } from "@/lib/auth-view";
import { normalizeAdsQueryParams, adQueryCardViews } from "@/lib/ads-view";
import { queryAds, type AdQueryRetrieval } from "@/lib/ads-retrieval";
import { requireWorkspaceRoute } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const route = requireWorkspaceRoute("/ads");

export const metadata: Metadata = {
  title: route.title,
  description: route.subtitle,
};

interface AdsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdsPage({ searchParams }: AdsPageProps) {
  const params = await searchParams;
  const normalized = normalizeAdsQueryParams(params);
  const hasQuery =
    params.q !== undefined ||
    params.mode !== undefined ||
    params.labels !== undefined ||
    params.surfaces !== undefined ||
    params.from !== undefined ||
    params.until !== undefined ||
    params.limit !== undefined ||
    params.at !== undefined;
  const retrieval: AdQueryRetrieval = hasQuery
    ? await queryAds(normalized)
    : { status: "idle" };

  return (
    <WorkspacePage title={route.title} subtitle={route.subtitle}>
      <AdsQueryForm action="/ads" params={normalized} />
      {retrieval.status === "idle" ? (
        <Card>
          <CardHeader>
            <CardTitle>Ask your ad memory</CardTitle>
            <CardDescription>
              Nothing queried yet — run a query above. The answer renders in two SEPARATE lanes:
              remembered ads (from Personal Ad Memory) and provider-supplied ads (current
              availability declarations) — never merged, each card carrying its origin class (law
              9) and the Advertising mark (law 8). Retrieval and any re-ranking run through the
              existing decision-kernel surface (see Compare).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AdMutedNote>
              Scope: the demo lane&rsquo;s subject — configure RECKON_DEMO_TENANT_ID /
              RECKON_DEMO_SUBJECT_REF to point the studio at a different memory.
            </AdMutedNote>
          </CardContent>
        </Card>
      ) : retrieval.status === "not-configured" ? (
        <AdsNotConfiguredState surface="The ad query" reason={retrieval.reason} />
      ) : retrieval.status === "error" ? (
        <AdsUnavailableState surface="The ad query" failure={retrieval.failure} />
      ) : (
        <>
          {retrieval.result.queryUnderstanding !== undefined &&
          retrieval.result.queryUnderstanding.terms.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Query understanding (disclosed)</CardTitle>
                <CardDescription>
                  The effective terms the retrieval stage used — disclosed verbatim. Semantic
                  matching here is lexical; any model-assisted expansion would carry its model
                  provenance on this very line (never a hidden ranker).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AdMutedNote>
                  {retrieval.result.queryUnderstanding.terms.join(" · ")}
                  {retrieval.result.queryUnderstanding.modelProvenance !== undefined
                    ? ` — model-assisted (${retrieval.result.queryUnderstanding.modelProvenance.system})`
                    : " — no model consulted"}
                </AdMutedNote>
              </CardContent>
            </Card>
          ) : null}
          <AdLanes
            {...adQueryCardViews(retrieval.result)}
            clockLabel={`${formatEpochMs(retrieval.at)} (epoch ${retrieval.at}) — subject ${retrieval.scope.subject.ref}, tenant ${retrieval.scope.tenant.tenantId}`}
          />
          {retrieval.result.notes.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Honest notes</CardTitle>
                <CardDescription>
                  What was NOT searched or could not be evaluated — disclosed per result.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul>
                  {retrieval.result.notes.map((note, index) => (
                    <li key={index}>{note}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </WorkspacePage>
  );
}
