/**
 * AccountSurfaceStateCard — the honest-degradation card for the ACCOUNT
 * lane (TL6-003): the account-family counterpart of SurfaceStateCard
 * (the demo lane). Renders exactly what the account API attempt
 * observed — the outcome kind, the verbatim detail and the pending
 * route — never a fake success, never a masked reason (Gate Q).
 */
import { CircleAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AccountSurfaceFailure } from "@/lib/account-api";
import styles from "./surface-state.module.css";

const FAILURE_COPY: Record<AccountSurfaceFailure["outcome"], { title: string; hint: string }> = {
  unauthenticated: {
    title: "not signed in",
    hint: "This surface manages the signed-in account's keys — a valid session is required.",
  },
  unreachable: {
    title: "API unreachable",
    hint: "This is the observed network state — the card never invents data. Retry once the API is reachable.",
  },
  "not-wired": {
    title: "not wired yet",
    hint: "The API answered, but the account surface is not mounted on this deployment. The dashboard will light up automatically once it lands.",
  },
  error: {
    title: "the API rejected the request",
    hint: "The observed response is shown verbatim — nothing was reshaped or guessed.",
  },
};

export interface AccountSurfaceStateCardProps {
  /** Which surface this is (used in the heading, e.g. "API keys"). */
  readonly surfaceName: string;
  readonly failure: AccountSurfaceFailure;
}

export function AccountSurfaceStateCard({ surfaceName, failure }: AccountSurfaceStateCardProps) {
  const copy = FAILURE_COPY[failure.outcome];
  return (
    <Card tone="degraded">
      <CardHeader>
        <CardTitle className={styles.title}>
          <CircleAlert className={styles.icon} aria-hidden="true" strokeWidth={1.75} size={20} />
          {surfaceName}: {copy.title}
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

/** Compact variant for the Developers landing surface grid (account lane). */
export function AccountSurfaceStateSummary({ failure }: { readonly failure: AccountSurfaceFailure }) {
  return (
    <p className={styles.summaryDetail} data-surface-outcome={failure.outcome}>
      <span className={styles.summaryOutcome}>{failure.outcome}</span>
      {failure.detail}
    </p>
  );
}
