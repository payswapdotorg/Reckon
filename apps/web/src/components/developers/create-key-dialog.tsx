/**
 * CreateKeyDialog — the account-key mint flow (TL6-003, rewired to
 * POST /v1/account/keys): the Stripe pattern. The dialog collects the
 * key kind (the mint mode rides the dashboard's test/live toggle — the
 * API mints unnamed keys: kind and mode only, no name), submits to the
 * studio's session proxy, and on a REAL success shows the RAW key
 * EXACTLY ONCE with a copy affordance and the "store it now" warning.
 *
 * The flow's state machine lives in lib/api-keys-view.ts (pure, tested):
 * this component only renders it — the once-only law is enforced by the
 * machine, not by discipline. Failures render the honest outcome
 * (unauthenticated / unreachable / not-wired / error) — never a fake
 * key. An observed 401 reports the expired session to the manager
 * (which routes to /login?reason=expired).
 */
"use client";

import { useEffect, useState } from "react";
import { Check, Copy, TriangleAlert, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDashboardMode } from "@/components/shell/mode-provider";
import {
  nextMintKeyFlowState,
  visibleMintedSecret,
  type MintKeyFlowState,
} from "@/lib/api-keys-view";
import type { AccountSurfaceFailure } from "@/lib/account-api";
import styles from "./create-key-dialog.module.css";

export interface CreateKeyDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Reports mint completion (refresh) or an expired session (route to login). */
  readonly onSettled: (expired: boolean) => void;
}

interface ProxyCreatedKey {
  readonly keyId: string;
  readonly kind: "secret" | "publishable";
  readonly mode: "live" | "test";
  readonly tier: "free" | "pro" | "enterprise";
  readonly createdAt: number;
  readonly lastUsedAt: number | null;
  readonly revokedAt: number | null;
  readonly key: string;
}

export function CreateKeyDialog({ open, onClose, onSettled }: CreateKeyDialogProps) {
  const { mode } = useDashboardMode();
  const [flow, setFlow] = useState<MintKeyFlowState>({ phase: "closed" });
  const [kind, setKind] = useState<"secret" | "publishable">("secret");
  const [copied, setCopied] = useState(false);

  // Reset transient form state whenever the dialog opens.
  useEffect(() => {
    if (open) {
      setFlow({ phase: "choosing" });
      setKind("secret");
      setCopied(false);
    } else {
      // Closing ALWAYS discards a held secret (once-only law).
      setFlow({ phase: "closed" });
    }
  }, [open]);

  async function submit() {
    setFlow({ phase: "submitting", kind, mode });
    try {
      const response = await fetch("/api/dashboard/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, mode }),
      });
      const body: unknown = await response.json();
      const created = response.ok && isCreatedKey(body) ? body : null;
      // Settle AT the transition (never inside a state updater): a real
      // mint refreshes the server-rendered list behind the dialog; an
      // observed 401 hands over to the expired-session flow.
      let expired = false;
      if (created === null) {
        expired = asFailure(body).outcome === "unauthenticated";
      }
      if (created !== null) {
        onSettled(false);
      } else if (expired) {
        onSettled(true);
      }
      setFlow((current) =>
        nextMintKeyFlowState(current, {
          type: "RESULT",
          result:
            created !== null
              ? { ok: true, key: created.key }
              : { ok: false, failure: asFailure(body) },
        }),
      );
    } catch (cause) {
      // The proxy itself failed (network to our own server). Honest text.
      const reason = cause instanceof Error ? cause.message : String(cause);
      setFlow((current) =>
        nextMintKeyFlowState(current, {
          type: "RESULT",
          result: {
            ok: false,
            failure: {
              outcome: "unreachable",
              detail: `The studio's key-mint proxy did not answer — ${reason}`,
              code: null,
              param: null,
              pendingRoute: "POST /v1/account/keys",
              httpStatus: null,
            },
          },
        }),
      );
    }
  }

  async function copySecret(secret: string) {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const secret = visibleMintedSecret(flow);

  return (
    <div
      className={styles.overlay}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Create API key" className={styles.dialog}>
        <div className={styles.dialogHead}>
          <h2 className={styles.dialogTitle}>Create API key</h2>
          <button type="button" className={styles.closeButton} aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" size={16} strokeWidth={1.75} />
          </button>
        </div>

        {flow.phase === "choosing" || flow.phase === "submitting" ? (
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <span className={styles.fieldLabel}>Key kind</span>
            <div className={styles.kindRow} role="radiogroup" aria-label="Key kind">
              <label className={kind === "secret" ? `${styles.kindOption} ${styles.kindSelected}` : styles.kindOption}>
                <input
                  type="radio"
                  name="new-key-kind"
                  value="secret"
                  className={styles.kindInput}
                  checked={kind === "secret"}
                  disabled={flow.phase === "submitting"}
                  onChange={() => setKind("secret")}
                />
                <span className={styles.kindTitle}>Secret (sk_)</span>
                <span className={styles.kindHint}>Server-side API authentication</span>
              </label>
              <label
                className={kind === "publishable" ? `${styles.kindOption} ${styles.kindSelected}` : styles.kindOption}
              >
                <input
                  type="radio"
                  name="new-key-kind"
                  value="publishable"
                  className={styles.kindInput}
                  checked={kind === "publishable"}
                  disabled={flow.phase === "submitting"}
                  onChange={() => setKind("publishable")}
                />
                <span className={styles.kindTitle}>Publishable (pk_)</span>
                <span className={styles.kindHint}>Client-side identification only — never a credential</span>
              </label>
            </div>

            <p className={styles.modeNote}>
              The key will be minted in the account&apos;s current mode:{" "}
              <Badge uppercase>{mode}</Badge>
              <span className={styles.modeHint}>
                (the mint mode rides the dashboard toggle — test keys never touch live traffic)
              </span>
            </p>

            <p className={styles.modeNote}>
              Account keys are unnamed — the API mints <code className={styles.kindHint}>kind + mode</code> only. Names
              arrive with the developer-platform key store.
            </p>

            <div className={styles.dialogActions}>
              <Button variant="secondary" size="md" onClick={onClose} disabled={flow.phase === "submitting"}>
                Cancel
              </Button>
              <Button variant="primary" size="md" type="submit" disabled={flow.phase === "submitting"}>
                {flow.phase === "submitting" ? "Creating…" : "Create key"}
              </Button>
            </div>
          </form>
        ) : null}

        {flow.phase === "created" && secret !== null ? (
          <div className={styles.secretBlock}>
            <div className={styles.secretWarning} role="alert">
              <TriangleAlert aria-hidden="true" size={18} strokeWidth={1.75} className={styles.secretWarningIcon} />
              <div>
                <strong className={styles.secretWarningTitle}>Store this key now.</strong>
                <p className={styles.secretWarningBody}>
                  This is the only time the full key is shown. Reckon stores only a hash — once this dialog closes, the
                  key cannot be recovered or displayed again.
                </p>
              </div>
            </div>
            <div className={styles.secretRow}>
              <input className={styles.secretInput} readOnly value={secret} aria-label="Full API key" />
              <Button
                variant="secondary"
                size="md"
                onClick={() => void copySecret(secret)}
                leadingIcon={copied ? <Check aria-hidden="true" size={14} /> : <Copy aria-hidden="true" size={14} />}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className={styles.dialogActions}>
              <Button
                variant="primary"
                size="md"
                onClick={() => setFlow((current) => nextMintKeyFlowState(current, { type: "SECRET_STORED" }))}
              >
                I&apos;ve stored it
              </Button>
            </div>
          </div>
        ) : null}

        {flow.phase === "stored" ? (
          <div className={styles.storedBlock}>
            <p className={styles.storedText}>
              The <strong>{flow.summary.token}</strong> key (<code className={styles.storedCode}>{flow.summary.keyId}</code>
              , tier <Badge uppercase>{flow.summary.tier}</Badge>) is minted and ready. The raw key has been discarded
              from this session — it will not be shown again.
            </p>
            <div className={styles.dialogActions}>
              <Button variant="primary" size="md" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        ) : null}

        {flow.phase === "failed" ? (
          <div className={styles.failedBlock}>
            <p className={styles.failedTitle}>The key was not minted.</p>
            <p className={styles.failedDetail}>{flow.failure.detail}</p>
            {flow.failure.pendingRoute !== null ? (
              <p className={styles.failedPending}>
                API route: <code>{flow.failure.pendingRoute}</code>
              </p>
            ) : null}
            <div className={styles.dialogActions}>
              <Button variant="secondary" size="md" onClick={onClose}>
                Close
              </Button>
              {flow.failure.outcome === "unauthenticated" ? (
                <Button variant="primary" size="md" onClick={onClose}>
                  Sign in again
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => setFlow((current) => nextMintKeyFlowState(current, { type: "RETRY" }))}
                >
                  Retry
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ---- proxy response guards (the studio's own /api/dashboard/keys) ---- */

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCreatedKey(value: unknown): value is { key: ProxyCreatedKey } {
  return (
    isRecordLike(value) &&
    value["ok"] === true &&
    isRecordLike(value["key"]) &&
    typeof (value["key"] as Record<string, unknown>)["key"] === "string" &&
    typeof (value["key"] as Record<string, unknown>)["keyId"] === "string"
  );
}

function asFailure(value: unknown): AccountSurfaceFailure {
  if (isRecordLike(value) && isRecordLike(value["failure"])) {
    const failure = value["failure"] as Record<string, unknown>;
    const outcome = failure["outcome"];
    return {
      outcome:
        outcome === "unauthenticated" ||
        outcome === "unreachable" ||
        outcome === "not-wired" ||
        outcome === "error"
          ? outcome
          : "error",
      detail:
        typeof failure["detail"] === "string" && failure["detail"].length > 0
          ? failure["detail"]
          : "The proxy returned an unrecognized failure.",
      code: typeof failure["code"] === "string" ? failure["code"] : null,
      param: typeof failure["param"] === "string" ? failure["param"] : null,
      pendingRoute: typeof failure["pendingRoute"] === "string" ? failure["pendingRoute"] : null,
      httpStatus: typeof failure["httpStatus"] === "number" ? failure["httpStatus"] : null,
    };
  }
  return {
    outcome: "error",
    detail: "The key-mint proxy returned an unrecognized response — nothing was created.",
    code: null,
    param: null,
    pendingRoute: "POST /v1/account/keys",
    httpStatus: null,
  };
}
