/**
 * ApiKeysManager — the Developers › API keys surface (S3-001).
 *
 * Server data arrives as props (fetched through the studio's honest
 * seam): the manager renders the keys table when the surface answered,
 * or the honest state card when it did not (naming the pending route).
 * The create flow (CreateKeyDialog) is always available — it attempts
 * the real POST /v1/api-keys and reports the observed outcome.
 *
 * Client component: the create/revoke flows, the once-only secret and
 * the live-mode revoke gating are all interactive.
 */
"use client";

import { useCallback, useState } from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useDashboardMode } from "@/components/shell/mode-provider";
import { apiKeyRowsView } from "@/lib/api-keys-view";
import type { ApiKeysPage, SurfaceFailure } from "@/lib/developers-api";
import { CreateKeyDialog } from "./create-key-dialog.js";
import { RevokeKeyButton } from "./revoke-key-button.js";
import { SurfaceStateCard } from "./surface-state.js";
import tableStyles from "./data-table.module.css";
import styles from "./api-keys-manager.module.css";

export interface ApiKeysManagerProps {
  readonly result:
    | { readonly ok: true; readonly data: ApiKeysPage }
    | { readonly ok: false; readonly failure: SurfaceFailure };
}

interface RevokeOutcome {
  readonly keyId: string;
  readonly ok: boolean;
  readonly title: string;
  readonly detail: string;
}

export function ApiKeysManager({ result }: ApiKeysManagerProps) {
  const { mode } = useDashboardMode();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [revokeOutcome, setRevokeOutcome] = useState<RevokeOutcome | null>(null);

  const handleRevokeOutcome = useCallback((outcome: RevokeOutcome) => {
    setRevokeOutcome(outcome);
  }, []);

  return (
    <div className={styles.manager}>
      <div className={styles.headRow}>
        <p className={styles.headNote}>
          Keys carry the mode they were created in —{" "}
          <span className={styles.headNoteStrong}>sk_/pk_ + live/test</span>. Secrets are shown once,
          at creation.
        </p>
        <Button variant="primary" size="md" onClick={() => setDialogOpen(true)} leadingIcon={<Plus aria-hidden="true" size={14} />}>
          Create key
        </Button>
      </div>

      {revokeOutcome !== null ? (
        <div
          className={revokeOutcome.ok ? styles.outcomeOk : styles.outcomeFailed}
          role="status"
        >
          <strong>{revokeOutcome.title}.</strong> <span>{revokeOutcome.detail}</span>
        </div>
      ) : null}

      {!result.ok ? (
        <SurfaceStateCard surfaceName="API keys" failure={result.failure} />
      ) : result.data.keys.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No keys yet</CardTitle>
            <CardDescription>
              The keys surface answered with an empty list — create the account&apos;s first key.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="secondary" size="md" onClick={() => setDialogOpen(true)}>
              Create the first key
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card padding="none" className={tableStyles.tableCard}>
          <div className={tableStyles.tableScroll}>
            <table className={tableStyles.table}>
              <caption className={styles.tableCaption}>
                API keys ({result.data.keys.length}
                {result.data.pagination?.has_more ? "+" : ""}) — current dashboard mode:{" "}
                <Badge uppercase>{mode}</Badge>
              </caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Token</th>
                  <th scope="col">Mode</th>
                  <th scope="col">Created</th>
                  <th scope="col">Last used</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {apiKeyRowsView(result.data.keys, mode).map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td className={tableStyles.mono}>{row.prefix}</td>
                    <td>
                      <span
                        className={`${tableStyles.modeChip} ${
                          row.mode === "live" ? tableStyles.modeChipLive : tableStyles.modeChipTest
                        } ${row.matchesMode ? "" : tableStyles.modeChipOther}`}
                        title={
                          row.mode === mode
                            ? `Matches the current dashboard mode (${mode})`
                            : `Created in ${row.mode} mode — the dashboard is in ${mode}`
                        }
                      >
                        {row.mode}
                      </span>
                    </td>
                    <td className={`${tableStyles.mono} ${tableStyles.muted}`}>{row.createdLabel}</td>
                    <td className={`${tableStyles.mono} ${tableStyles.muted}`}>{row.lastUsedLabel}</td>
                    <td className={tableStyles.cellActions}>
                      <RevokeKeyButton record={findRecord(result.data.keys, row.id)} onOutcome={handleRevokeOutcome} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <CreateKeyDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}

function findRecord<T extends { id: string }>(records: readonly T[], id: string): T {
  const record = records.find((candidate) => candidate.id === id);
  if (record === undefined) {
    throw new Error(`No key record for row id ${id}`);
  }
  return record;
}
