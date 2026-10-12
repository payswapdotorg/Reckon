/**
 * ApiKeysManager — the Developers › API keys surface (TL6-003, rewired to
 * the ACCOUNT API). Server data arrives as props (fetched through the
 * studio's session seam): the manager renders the keys table when the
 * account surface answered, or the honest state card when it did not
 * (naming the route). The mint flow (CreateKeyDialog) is always available
 * — it attempts the REAL POST /v1/account/keys and reports the observed
 * outcome.
 *
 * Client component: the mint/revoke flows, the once-only secret and the
 * live-mode revoke gating are all interactive. After a successful mint
 * or revoke the manager asks Next to re-render the server tree so the
 * table reflects the account's real key inventory.
 */
"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useDashboardMode } from "@/components/shell/mode-provider";
import { AccountSurfaceStateCard } from "./account-surface-state.js";
import { CreateKeyDialog } from "./create-key-dialog.js";
import { RevokeKeyButton } from "./revoke-key-button.js";
import type { StudioAccountDisplay } from "@/lib/account-surface";
import type { AccountSurfaceResult } from "@/lib/account-api";
import { accountKeyRowsView } from "@/lib/api-keys-view";
import { formatEpochMs } from "@/lib/auth-view";
import tableStyles from "./data-table.module.css";
import styles from "./api-keys-manager.module.css";
import type { AccountKey } from "@reckon/contracts";

export interface ApiKeysManagerProps {
  /** The display-safe signed-in account (from the session cookie; may be null if the metadata cache is absent). */
  readonly account: StudioAccountDisplay | null;
  readonly result: AccountSurfaceResult<readonly AccountKey[]>;
  /** True right after signup (the progressive continuation banner). */
  readonly welcome: boolean;
}

interface RevokeOutcome {
  readonly keyId: string;
  readonly ok: boolean;
  readonly title: string;
  readonly detail: string;
}

export function ApiKeysManager({ account, result, welcome }: ApiKeysManagerProps) {
  const router = useRouter();
  const { mode } = useDashboardMode();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [revokeOutcome, setRevokeOutcome] = useState<RevokeOutcome | null>(null);

  const handleRevokeOutcome = useCallback((outcome: RevokeOutcome) => {
    setRevokeOutcome(outcome);
  }, []);

  /** A completed mint (or an expired session mid-mint) — re-render the server list. */
  const handleMintSettled = useCallback(
    (expired: boolean) => {
      if (expired) {
        router.push("/login?reason=expired&next=%2Fdevelopers%2Fkeys");
        return;
      }
      router.refresh();
    },
    [router],
  );

  /** The revoke flow observed an expired session — hand over to login. */
  const handleSessionExpired = useCallback(() => {
    router.push("/login?reason=expired&next=%2Fdevelopers%2Fkeys");
  }, [router]);

  return (
    <div className={styles.manager}>
      <div className={styles.headRow}>
        <p className={styles.headNote}>
          Keys carry the mode they were minted in — <span className={styles.headNoteStrong}>sk_/pk_ + live/test</span>.
          Secrets are shown once, at mint time.
        </p>
        <Button variant="primary" size="md" onClick={() => setDialogOpen(true)} leadingIcon={<Plus aria-hidden="true" size={14} />}>
          Create key
        </Button>
      </div>

      {welcome && result.ok ? (
        <Card tone="default" className={styles.welcomeCard}>
          <CardHeader>
            <CardTitle className={styles.welcomeTitle}>
              <Sparkles aria-hidden="true" size={16} strokeWidth={1.75} />
              Welcome to Reckon{account !== null ? `, ${account.fullName.split(" ")[0]}` : ""} — your account is ready
            </CardTitle>
            <CardDescription>
              The progressive path: create your first API key below, then make your first decision call with it. The
              secret is shown exactly once.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="primary" size="md" onClick={() => setDialogOpen(true)}>
              Create your first key
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {revokeOutcome !== null ? (
        <div
          className={revokeOutcome.ok ? styles.outcomeOk : styles.outcomeFailed}
          role="status"
        >
          <strong>{revokeOutcome.title}.</strong> <span>{revokeOutcome.detail}</span>
        </div>
      ) : null}

      {!result.ok ? (
        <AccountSurfaceStateCard surfaceName="API keys" failure={result.failure} />
      ) : result.data.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No keys yet</CardTitle>
            <CardDescription>
              The account surface answered with an empty list — mint the account&apos;s first key.
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
                API keys ({result.data.length}) for{" "}
                <span className={styles.captionAccount}>{account?.email ?? "this account"}</span> — current dashboard
                mode: <Badge uppercase>{mode}</Badge>
              </caption>
              <thead>
                <tr>
                  <th scope="col">Key</th>
                  <th scope="col">Key ID</th>
                  <th scope="col">Mode</th>
                  <th scope="col">Tier</th>
                  <th scope="col">Created</th>
                  <th scope="col">Last used</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {accountKeyRowsView(result.data, mode, formatEpochMs).map((row) => (
                  <tr key={row.id} className={row.revoked ? tableStyles.rowMuted : undefined}>
                    <td>
                      <span className={tableStyles.mono}>{row.token}</span>
                      <span className={styles.kindLabel}>{row.kindLabel}</span>
                    </td>
                    <td className={tableStyles.mono} title={row.id}>
                      {row.id}
                    </td>
                    <td>
                      <span
                        className={`${tableStyles.modeChip} ${
                          row.mode === "live" ? tableStyles.modeChipLive : tableStyles.modeChipTest
                        } ${row.matchesMode ? "" : tableStyles.modeChipOther}`}
                        title={
                          row.mode === mode
                            ? `Matches the current dashboard mode (${mode})`
                            : `Minted in ${row.mode} mode — the dashboard is in ${mode}`
                        }
                      >
                        {row.mode}
                      </span>
                    </td>
                    <td>
                      <Badge uppercase>{row.tier}</Badge>
                    </td>
                    <td className={`${tableStyles.mono} ${tableStyles.muted}`}>{row.createdLabel}</td>
                    <td className={`${tableStyles.mono} ${tableStyles.muted}`}>{row.lastUsedLabel}</td>
                    <td>
                      {row.revoked ? (
                        <span className={styles.revokedChip} title={row.revokedLabel ?? undefined}>
                          Revoked
                        </span>
                      ) : (
                        <span className={styles.activeChip}>Active</span>
                      )}
                    </td>
                    <td className={tableStyles.cellActions}>
                      <RevokeKeyButton
                        record={findRecord(result.data, row.id)}
                        onOutcome={handleRevokeOutcome}
                        onSessionExpired={handleSessionExpired}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <CreateKeyDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSettled={handleMintSettled} />
    </div>
  );
}

function findRecord(records: readonly AccountKey[], id: string): AccountKey {
  const record = records.find((candidate) => candidate.keyId === id);
  if (record === undefined) {
    throw new Error(`No key record for row id ${id}`);
  }
  return record;
}
