/**
 * SurfaceStateCard — the honest-degradation card for the developer
 * platform surfaces (S3-001). The S2-001 API hardened the core surface;
 * the developer-platform management routes (keys/logs/events) are NOT
 * WIRED yet — so instead of an empty table or a fake success, the card
 * states exactly what was observed and names the pending API route(s)
 * verbatim.
 *
 * Every failure kind has precise copy (Gate Q):
 *  - unconfigured: the studio's demo key is missing (how to fix it);
 *  - unreachable: the network failure that was actually observed;
 *  - not-wired: the route answered 404/501 — pending route named;
 *  - error: anything else the API said, verbatim.
 */
import { CircleAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SurfaceFailure } from "@/lib/developers-api";
import styles from "./surface-state.module.css";

const FAILURE_COPY: Record<SurfaceFailure["outcome"], { title: string; hint: string }> = {
  unconfigured: {
    title: "Studio not configured",
    hint: "Set RECKON_DEMO_API_KEY in the server environment — this surface reports real API state only.",
  },
  unreachable: {
    title: "API unreachable",
    hint: "This is the observed network state — the card never invents data. Retry once the API is reachable.",
  },
  "not-wired": {
    title: "Not wired yet",
    hint: "The API answered, but this route is not mounted yet. The dashboard will light up automatically once it lands.",
  },
  error: {
    title: "The API rejected the request",
    hint: "The observed response is shown verbatim — nothing was reshaped or guessed.",
  },
};

export interface SurfaceStateCardProps {
  /** Which surface this is (used in the heading, e.g. "API keys"). */
  readonly surfaceName: string;
  readonly failure: SurfaceFailure;
}

export function SurfaceStateCard({ surfaceName, failure }: SurfaceStateCardProps) {
  const copy = FAILURE_COPY[failure.outcome];
  return (
    <Card tone="degraded">
      <CardHeader>
        <CardTitle className={styles.title}>
          <CircleAlert className={styles.icon} aria-hidden="true" strokeWidth={1.75} size={20} />
          {surfaceName}: {copy.title.toLowerCase()}
        </CardTitle>
        <CardDescription>{copy.hint}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className={styles.detail}>{failure.detail}</p>
        {failure.pendingRoute !== null ? (
          <div className={styles.pendingRow}>
            <span className={styles.pendingLabel}>Pending API route</span>
            <code className={styles.pendingRoute}>{failure.pendingRoute}</code>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Compact variant for the Developers landing surface grid. */
export function SurfaceStateSummary({ failure }: { readonly failure: SurfaceFailure }) {
  return (
    <p className={styles.summaryDetail} data-surface-outcome={failure.outcome}>
      <span className={styles.summaryOutcome}>{failure.outcome}</span>
      {failure.detail}
    </p>
  );
}
