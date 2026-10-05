/**
 * Analytics — the operator analytics section (S3-002): CTR lift, latency
 * percentiles, drift indicators and the decision-loop funnel, each
 * composed from REAL backend state probed server-side at request time.
 *
 * Every view states its evidence class (Gate Q): observed data when a
 * surface answers, the pending API route named verbatim when it does not
 * — never fabricated numbers. Mode awareness lives in the note card (the
 * test/live machine) and in the per-record mode evidence of the views
 * themselves.
 *
 * force-dynamic: the trail attempts resolve at request time and the page
 * renders exactly what was observed.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AnalyticsModeNote } from "@/components/analytics/analytics-mode-note";
import { CtrLiftView } from "@/components/analytics/ctr-lift-view";
import { DriftView } from "@/components/analytics/drift-view";
import { FunnelView } from "@/components/analytics/funnel-view";
import { LatencyView } from "@/components/analytics/latency-view";
import { WorkspacePage } from "@/components/workspace-page";
import {
  ANALYTICS_TRAIL_LIMIT,
  fetchDecisionTrail,
  fetchDriftEvents,
  fetchOutcomeTrail,
  fetchPreferenceDeltaTrail,
} from "@/lib/analytics-surface";
import { fetchRequestLogs } from "@/lib/developers-surface";
import { requireWorkspaceRoute } from "@/lib/workspace";
import styles from "@/components/analytics/analytics-views.module.css";

export const dynamic = "force-dynamic";

const route = requireWorkspaceRoute("/analytics");

export const metadata: Metadata = {
  title: route.title,
  description: route.subtitle,
};

export default async function AnalyticsPage() {
  const [decisions, outcomes, deltas, logs, driftEvents] = await Promise.all([
    fetchDecisionTrail(),
    fetchOutcomeTrail(),
    fetchPreferenceDeltaTrail(),
    fetchRequestLogs({ limit: ANALYTICS_TRAIL_LIMIT }),
    fetchDriftEvents(),
  ]);

  const related =
    route.relatedHrefs !== undefined
      ? route.relatedHrefs.map((href) => requireWorkspaceRoute(href))
      : [];

  return (
    <WorkspacePage title={route.title} subtitle={route.subtitle}>
      <AnalyticsModeNote />
      <CtrLiftView decisions={decisions} outcomes={outcomes} />
      <LatencyView logs={logs} />
      <DriftView events={driftEvents} />
      <FunnelView decisions={decisions} outcomes={outcomes} deltas={deltas} />
      {related.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Related live surfaces</CardTitle>
            <CardDescription>
              Studio workspaces that already show real data in this area today.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className={styles.relatedList}>
              {related.map((relatedRoute) => (
                <li key={relatedRoute.href}>
                  <Link href={relatedRoute.href} className={styles.relatedLink}>
                    {relatedRoute.title}
                    <span className={styles.relatedHint}>{relatedRoute.subtitle}</span>
                    <ArrowRight aria-hidden="true" size={13} strokeWidth={1.75} />
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </WorkspacePage>
  );
}
