/**
 * EventsConsole — the Developers › Events surface (S3-001): the
 * webhook-events list view (type, created, status) with the replay
 * action as an honest placeholder — S2-002 lands the backend (event
 * catalog + HMAC signatures + replay), so the replay affordance renders
 * disabled, naming the pending route, and never fakes a delivery.
 *
 * The planned event catalog is shown as clearly-labeled ROADMAP
 * information (from the S2-002 work item), never as observed data.
 */
import { RotateCcw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { eventRowsView, PLANNED_EVENT_CATALOG, REPLAY_PENDING_ROUTE } from "@/lib/events-view";
import type { EventsPage, SurfaceFailure } from "@/lib/developers-api";
import { SurfaceStateCard } from "./surface-state.js";
import tableStyles from "./data-table.module.css";
import styles from "./events-console.module.css";

export interface EventsConsoleProps {
  readonly result:
    | { readonly ok: true; readonly data: EventsPage }
    | { readonly ok: false; readonly failure: SurfaceFailure };
}

export function EventsConsole({ result }: EventsConsoleProps) {
  return (
    <div className={styles.console}>
      {!result.ok ? (
        <SurfaceStateCard surfaceName="Events" failure={result.failure} />
      ) : result.data.events.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No events yet</CardTitle>
            <CardDescription>
              The events surface answered with an empty list — events appear here as the account
              sends and Reckon delivers them.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card padding="none" className={tableStyles.tableCard}>
          <div className={tableStyles.tableScroll}>
            <table className={tableStyles.table}>
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">Created</th>
                  <th scope="col">Status</th>
                  <th scope="col">Replay</th>
                </tr>
              </thead>
              <tbody>
                {eventRowsView(result.data.events).map((row) => (
                  <tr key={row.id}>
                    <td className={tableStyles.mono}>{row.type}</td>
                    <td className={`${tableStyles.mono} ${tableStyles.muted}`}>{row.createdLabel}</td>
                    <td>
                      <span
                        className={`${tableStyles.statusPill} ${
                          row.statusTone === "ok"
                            ? tableStyles.statusOk
                            : row.statusTone === "warn"
                              ? tableStyles.statusWarn
                              : row.statusTone === "error"
                                ? tableStyles.statusError
                                : tableStyles.statusNeutral
                        }`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td>
                      {/* Replay placeholder — S2-002 pending. The affordance
                          is real, the action is not wired; it never fakes. */}
                      <span
                        className={tableStyles.replayPlaceholder}
                        role="button"
                        aria-disabled="true"
                        title={`Replay lands with S2-002 (${REPLAY_PENDING_ROUTE})`}
                      >
                        <RotateCcw aria-hidden="true" size={12} strokeWidth={1.75} />
                        Replay
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Planned event catalog</CardTitle>
          <CardDescription>
            Roadmap (S2-002), not observed data — the catalog the events backend will deliver,
            with HMAC signatures and replay.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className={styles.catalogList}>
            {PLANNED_EVENT_CATALOG.map((entry) => (
              <li key={entry.type} className={styles.catalogItem}>
                <code className={styles.catalogType}>{entry.type}</code>
                <span className={styles.catalogMeaning}>{entry.meaning}</span>
              </li>
            ))}
          </ul>
          <p className={styles.catalogNote}>
            Replay will be <code className={styles.catalogCode}>{REPLAY_PENDING_ROUTE}</code> — the
            per-row affordance above activates when the surface lands.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
