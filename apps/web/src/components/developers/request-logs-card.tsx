/**
 * RequestLogsCard — the Developers › Request logs surface (S3-001):
 * time, method, route, status, latency, key prefix — with cursor
 * pagination controls that follow the S2-001 envelope exactly
 * (starting_after / next_cursor). The controls are plain links (the href
 * math lives in lib/request-logs-view.ts, pure + tested), so paging is
 * JS-optional and shareable.
 *
 * Honest states: a failed surface renders the state card naming the
 * pending route (GET /v1/request-logs); an empty page renders the empty
 * state — never fabricated rows.
 */
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requestLogRowsView, type LogsCursorState } from "@/lib/request-logs-view";
import type { SurfaceFailure } from "@/lib/developers-api";
import { SurfaceStateCard } from "./surface-state.js";
import tableStyles from "./data-table.module.css";
import styles from "./request-logs-card.module.css";

export interface RequestLogsCardProps {
  readonly result:
    | {
        readonly ok: true;
        readonly data: { readonly logs: readonly import("@/lib/developers-api").RequestLogRecord[]; readonly pagination: { has_more: boolean; next_cursor: string | null } };
      }
    | { readonly ok: false; readonly failure: SurfaceFailure };
  readonly cursorState: LogsCursorState;
  readonly nextHref: string | null;
  readonly prevHref: string | null;
  readonly pageNumber: number;
}

export function RequestLogsCard({ result, cursorState, nextHref, prevHref, pageNumber }: RequestLogsCardProps) {
  if (!result.ok) {
    return <SurfaceStateCard surfaceName="Request logs" failure={result.failure} />;
  }

  const rows = requestLogRowsView(result.data.logs);

  return (
    <Card padding="none" className={tableStyles.tableCard}>
      <CardHeader className={styles.cardHead}>
        <CardTitle>Request log</CardTitle>
        <CardDescription>
          Cursor-paginated the S2-001 way: each step feeds the last item&apos;s id back as
          <code className={styles.code}> starting_after</code>. No totals are invented — the API
          reports <code className={styles.code}>has_more</code>, nothing else.
        </CardDescription>
      </CardHeader>
      {rows.length === 0 ? (
        <div className={styles.emptyPage}>
          <p className={styles.emptyTitle}>
            {cursorState.current === null ? "No requests logged yet" : "No more requests on this cursor"}
          </p>
          <p className={styles.emptyNote}>
            {cursorState.current === null
              ? "The request-log surface answered with an empty first page — requests appear here as the API serves them."
              : "This cursor is exhausted. Step back with “Newer”."}
          </p>
        </div>
      ) : (
        <div className={tableStyles.tableScroll}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Method</th>
                <th scope="col">Route</th>
                <th scope="col">Status</th>
                <th scope="col">Latency</th>
                <th scope="col">Key</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className={`${tableStyles.mono} ${tableStyles.muted}`}>{row.createdLabel}</td>
                  <td className={tableStyles.mono}>{row.method}</td>
                  <td className={tableStyles.mono}>{row.route}</td>
                  <td>
                    <span
                      className={`${tableStyles.statusPill} ${
                        row.statusTone === "ok"
                          ? tableStyles.statusOk
                          : row.statusTone === "warn"
                            ? tableStyles.statusWarn
                            : tableStyles.statusError
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className={tableStyles.mono}>{row.latencyLabel}</td>
                  <td className={`${tableStyles.mono} ${tableStyles.muted}`}>{row.keyPrefix}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className={tableStyles.pagination} aria-label="Log pagination">
        <span className={tableStyles.pageLabel}>Page {pageNumber}</span>
        <div className={tableStyles.pageButtons}>
          {prevHref !== null ? (
            <Link href={prevHref} className={styles.pageLink} rel="prev">
              <ArrowLeft aria-hidden="true" size={13} strokeWidth={1.75} />
              Newer
            </Link>
          ) : (
            <span className={styles.pageLinkDisabled} aria-disabled="true" title="Already on the newest page">
              <ArrowLeft aria-hidden="true" size={13} strokeWidth={1.75} />
              Newer
            </span>
          )}
          {nextHref !== null ? (
            <Link href={nextHref} className={styles.pageLink} rel="next">
              Older
              <ArrowRight aria-hidden="true" size={13} strokeWidth={1.75} />
            </Link>
          ) : (
            <span className={styles.pageLinkDisabled} aria-disabled="true" title="No more pages (has_more is false)">
              Older
              <ArrowRight aria-hidden="true" size={13} strokeWidth={1.75} />
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}
