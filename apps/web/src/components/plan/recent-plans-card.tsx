/**
 * RecentPlansCard (UI-005) — the no-id default: the tenant's recent plans
 * from GET /v1/plans (latest version each, newest first).
 *
 * HONESTY: when the API is unreachable or the key unset, the card states
 * the precise condition (NEUTRAL tone — nothing failed, nothing was
 * requested); when the listing succeeds but is empty, it says the tenant
 * has no plans. Selecting a recent plan deep-links to
 * `/plans?id=…` (shareable, JS-optional).
 */
import { TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { RecentPlans } from "@/lib/plan-retrieval";
import styles from "./recent-plans-card.module.css";

export interface RecentPlansCardProps {
  readonly recent: RecentPlans | undefined;
  readonly apiKeyNotConfigured: boolean;
}

export function RecentPlansCard({ recent, apiKeyNotConfigured }: RecentPlansCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent plans</CardTitle>
        <CardDescription>
          The tenant&rsquo;s plans, latest version each, newest first (
          <code className={styles.inlineCode}>GET /v1/plans</code>). Select a plan to open its
          rolling timeline and replan history.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {apiKeyNotConfigured ? (
          <p className={styles.warnRow}>
            <TriangleAlert className={styles.warnIcon} aria-hidden />
            <span>
              No demo API key is configured in this studio — plan listing will report the precise
              configuration failure rather than fabricate data.
            </span>
          </p>
        ) : null}
        {recent === undefined ? null : recent.status === "not-configured" ? (
          <p className={styles.note}>
            Plan listing is unavailable in this studio configuration — the server-side SDK client
            is not configured (RECKON_DEMO_API_KEY). The lookup field above still retrieves
            individual plans by id once configured.
          </p>
        ) : recent.status === "error" ? (
          <p className={styles.note}>
            Plan listing failed — {recent.message}
            {recent.statusCode === undefined ? "" : ` (HTTP ${recent.statusCode})`}. Typed SDK
            error code: {recent.code}. The studio surfaces the precise failure it observed; retry
            re-attempts the listing.
          </p>
        ) : recent.plans.length === 0 ? (
          <p className={styles.note}>
            The listing succeeded and the tenant has no plans yet — create one through the API
            (POST /v1/plans) and it will appear here.
          </p>
        ) : (
          <ul className={styles.list}>
            {recent.plans.map((plan) => (
              <li key={`${plan.planId}-${plan.version}`} className={styles.item}>
                <a
                  href={`/plans?id=${encodeURIComponent(plan.planId)}`}
                  className={styles.link}
                >
                  <code className={styles.planId}>{plan.planId}</code>
                  <span className={styles.meta}>
                    <Badge>v{plan.version}</Badge>
                    <span className={styles.when}>
                      updated {new Date(plan.updatedAt).toISOString()}
                    </span>
                    <span className={styles.queue}>{plan.queuedExperiences.length} queued</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
