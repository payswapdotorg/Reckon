/**
 * Developers — the developer-platform section landing (S3-001).
 *
 * The operator face of the S2-001 hardened API: the live connection
 * status plus the three developer surfaces (API keys, request logs,
 * events), each showing its REAL state — probed server-side at request
 * time. Not-wired surfaces say so and name the pending API route; they
 * never render fabricated data (Gate Q).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, KeyRound, List, Radio } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkspacePage } from "@/components/workspace-page";
import { SurfaceStateSummary } from "@/components/developers/surface-state";
import { getReckonApiDisplayConfig } from "@/lib/reckon-client";
import { probeReckonApi } from "@/lib/reckon-status";
import { fetchApiKeys, fetchEvents, fetchRequestLogs } from "@/lib/developers-surface";
import { requireWorkspaceRoute } from "@/lib/workspace";
import styles from "./developers-page.module.css";

export const dynamic = "force-dynamic";

const route = requireWorkspaceRoute("/developers");

export const metadata: Metadata = {
  title: route.title,
  description: route.subtitle,
};

export default async function DevelopersPage() {
  const [config, probe, keys, logs, events] = await Promise.all([
    getReckonApiDisplayConfig(),
    probeReckonApi(),
    fetchApiKeys(),
    fetchRequestLogs({ limit: 5 }),
    fetchEvents({ limit: 5 }),
  ]);

  return (
    <WorkspacePage title={route.title} subtitle={route.subtitle}>
      <Card>
        <CardHeader>
          <CardTitle>API connection</CardTitle>
          <CardDescription>
            The versioned Reckon API this dashboard fronts — probed live, server-side.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className={styles.rows}>
            <div className={styles.row}>
              <dt className={styles.rowKey}>API endpoint</dt>
              <dd className={styles.rowValue}>
                <code className={styles.code}>{probe.baseUrl}</code>
                {config.demoApiKeyConfigured ? (
                  <Badge>demo key configured</Badge>
                ) : (
                  <Badge uppercase>RECKON_DEMO_API_KEY not set</Badge>
                )}
              </dd>
            </div>
            <div className={styles.row}>
              <dt className={styles.rowKey}>Reachability</dt>
              <dd className={styles.rowValue}>
                <span className={probe.reachable ? styles.dotOk : styles.dotDown} aria-hidden="true" />
                <span className={styles.probeDetail}>{probe.detail}</span>
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <div className={styles.surfaceGrid}>
        <SurfaceLinkCard
          href="/developers/keys"
          icon={<KeyRound aria-hidden="true" size={16} strokeWidth={1.75} />}
          title="API keys"
          description="Create, inspect and revoke the account's sk_/pk_ keys — secrets shown exactly once."
          state={keys.ok ? <p className={styles.surfaceOk}>{keys.data.keys.length} key(s) listed</p> : <SurfaceStateSummary failure={keys.failure} />}
        />
        <SurfaceLinkCard
          href="/developers/logs"
          icon={<List aria-hidden="true" size={16} strokeWidth={1.75} />}
          title="Request logs"
          description="Every API request as it happened — method, route, status, latency, key prefix."
          state={logs.ok ? <p className={styles.surfaceOk}>{logs.data.logs.length} recent request(s)</p> : <SurfaceStateSummary failure={logs.failure} />}
        />
        <SurfaceLinkCard
          href="/developers/events"
          icon={<Radio aria-hidden="true" size={16} strokeWidth={1.75} />}
          title="Events"
          description="Webhook events — type, delivery status, replay (the S2-002 surface)."
          state={events.ok ? <p className={styles.surfaceOk}>{events.data.events.length} recent event(s)</p> : <SurfaceStateSummary failure={events.failure} />}
        />
      </div>
    </WorkspacePage>
  );
}

interface SurfaceLinkCardProps {
  readonly href: string;
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly description: string;
  readonly state: React.ReactNode;
}

function SurfaceLinkCard({ href, icon, title, description, state }: SurfaceLinkCardProps) {
  return (
    <Card className={styles.surfaceCard}>
      <CardHeader>
        <CardTitle className={styles.surfaceTitle}>
          {icon}
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className={styles.surfaceContent}>
        {state}
        <Link href={href} className={styles.surfaceLink}>
          Open {title.toLowerCase()}
          <ArrowRight aria-hidden="true" size={13} strokeWidth={1.75} />
        </Link>
      </CardContent>
    </Card>
  );
}
