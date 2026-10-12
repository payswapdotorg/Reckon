/**
 * Ad compare (AD-005) — the compare/re-rank workspace.
 *
 * The product behavior from docs/architecture/ad-memory.md: retrieved
 * ad candidates are compared and re-ranked through the EXISTING Reckon
 * decision kernel, and the re-rank is VISIBLE — before (the retrieval
 * lanes' own order, hints only) and after (the kernel's order, with the
 * defer/present/suppress reasons from the decision response).
 *
 * There is NO second ranking in the UI: the page composes ONE candidate
 * set through the SDK's frozen-semantics mapping
 * (`buildAdBearingCandidates`), resolves the ad experiences, declares
 * the ads' USER value through the documented reward-term bridge, and
 * sends ONE DecisionRequest through the kernel (the composition is the
 * AD-004 one-pipeline law; see docs/architecture/ad-selection.md).
 *
 * Data path: plain GET form → query both lanes → the kernel → render
 * exactly what both returned. Idle state explains the flow; every
 * failure degrades honestly.
 */
import type { Metadata } from "next";
import { WorkspacePage } from "@/components/workspace-page";
import { AdsQueryForm } from "@/components/ads/ads-query-form";
import { RerankCompareView } from "@/components/ads/rerank-view";
import { AdsUnavailableState, AdsNotConfiguredState } from "@/components/ads/ads-unavailable-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AdMutedNote } from "@/components/ads/ad-facts";
import { formatEpochMs } from "@/lib/auth-view";
import { normalizeAdsQueryParams } from "@/lib/ads-view";
import { requestAdRerank } from "@/lib/ads-retrieval";
import { requireWorkspaceRoute } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const route = requireWorkspaceRoute("/ads/compare");

export const metadata: Metadata = {
  title: route.title,
  description: route.subtitle,
};

interface ComparePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ComparePage({ searchParams }: ComparePageProps) {
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
  const retrieval = hasQuery
    ? await requestAdRerank(normalized)
    : { status: "idle" as const };

  return (
    <WorkspacePage title={route.title} subtitle={route.subtitle}>
      <AdsQueryForm action="/ads/compare" params={normalized} />
      {retrieval.status === "idle" ? (
        <Card>
          <CardHeader>
            <CardTitle>Run a query through the kernel</CardTitle>
            <CardDescription>
              Nothing compared yet. A query here runs the full one-pipeline flow: the ad query
              (both lanes, provenance-carrying) → the frozen-semantics candidate mapping →
              experience resolution → the declared user-value reward term → ONE decision request
              through the kernel. The result shows the BEFORE order (the lanes&rsquo; own, hints
              only) and the AFTER order (the kernel&rsquo;s, with its reasons) — the re-rank is
              the kernel&rsquo;s, never the UI&rsquo;s.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AdMutedNote>
              The kernel decides whether an ad shows at all, which format, when — whether to
              continue/queue/suggest/interrupt. An ad is not shown merely because it has high
              commercial value (law 7): commercial value has no ranking path by design.
            </AdMutedNote>
          </CardContent>
        </Card>
      ) : retrieval.status === "not-configured" ? (
        <AdsNotConfiguredState surface="The ad compare" reason={retrieval.reason} />
      ) : retrieval.status === "query-error" ? (
        <AdsUnavailableState surface="The ad query (compare stage 1)" failure={retrieval.failure} />
      ) : retrieval.status === "no-candidates" ? (
        <Card tone="degraded">
          <CardHeader>
            <CardTitle>Nothing to rank</CardTitle>
            <CardDescription>
              The query answered, but no currently-eligible ad candidates passed the selection
              gates at the evaluation clock {formatEpochMs(retrieval.at)} — the kernel never sees
              an empty candidate set (a CandidateSet requires at least one candidate).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul>
              {retrieval.notes.map((note, index) => (
                <li key={index}>{note}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : retrieval.status === "error" ? (
        <AdsUnavailableState
          surface={
            retrieval.stage === "resolve"
              ? "Experience resolution (compare stage 2)"
              : "The decision kernel (compare stage 3)"
          }
          failure={retrieval.failure}
        />
      ) : (
        <RerankCompareView
          queryResult={retrieval.queryResult}
          decision={retrieval.decision}
          experiences={retrieval.experiences}
          clockLabel={formatEpochMs(retrieval.at)}
          notes={retrieval.notes}
        />
      )}
    </WorkspacePage>
  );
}
