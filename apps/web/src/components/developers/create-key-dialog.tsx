/**
 * CreateKeyDialog — the create-key flow (S3-001): the Stripe pattern.
 * The dialog collects a name + key kind, submits to the studio's
 * server-side proxy (POST /api/dashboard/keys → the real POST
 * /v1/api-keys attempt), and on a REAL success shows the full secret
 * EXACTLY ONCE with a copy button and the "store it now" warning.
 *
 * The flow's state machine lives in lib/api-keys-view.ts (pure, tested):
 * this component only renders it — the once-only law is enforced by the
 * machine, not by discipline. Failures render the honest outcome
 * (unconfigured / unreachable / not-wired / error) — never a fake key.
 */
"use client";

import { useEffect, useState } from "react";
import { Check, Copy, TriangleAlert, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDashboardMode } from "@/components/shell/mode-provider";
import {
  KEY_NAME_MAX_LENGTH,
  isValidKeyName,
  nextCreateKeyFlowState,
  visibleSecret,
  type CreateKeyFlowState,
} from "@/lib/api-keys-view";
import styles from "./create-key-dialog.module.css";

export interface CreateKeyDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function CreateKeyDialog({ open, onClose }: CreateKeyDialogProps) {
  const { mode } = useDashboardMode();
  const [flow, setFlow] = useState<CreateKeyFlowState>({ phase: "closed" });
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"secret" | "publishable">("secret");
  const [nameTouched, setNameTouched] = useState(false);
  const [copied, setCopied] = useState(false);

  // Reset transient form state whenever the dialog opens.
  useEffect(() => {
    if (open) {
      setFlow({ phase: "naming" });
      setName("");
      setKind("secret");
      setNameTouched(false);
      setCopied(false);
    } else {
      // Closing ALWAYS discards a held secret (once-only law).
      setFlow({ phase: "closed" });
    }
  }, [open]);

  const nameInvalid = nameTouched && !isValidKeyName(name);

  async function submit() {
    if (!isValidKeyName(name)) {
      setNameTouched(true);
      return;
    }
    setFlow({ phase: "submitting", name: name.trim(), kind });
    try {
      const response = await fetch("/api/dashboard/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), kind, mode }),
      });
      const body: unknown = await response.json();
      setFlow((current) =>
        nextCreateKeyFlowState(current, {
          type: "RESULT",
          result:
            response.ok && isCreatedKey(body)
              ? {
                  ok: true,
                  key: {
                    id: body.key.id,
                    name: body.key.name,
                    prefix: body.key.prefix,
                    mode: body.key.mode,
                    kind: body.key.kind,
                    created_at: body.key.created_at,
                    // A freshly created key has, factually, never been used.
                    last_used_at: body.key.last_used_at ?? null,
                    secret: body.key.secret,
                  },
                }
              : { ok: false, failure: asFailure(body) },
        }),
      );
    } catch (cause) {
      // The proxy itself failed (network to our own server). Honest text.
      const reason = cause instanceof Error ? cause.message : String(cause);
      setFlow((current) =>
        nextCreateKeyFlowState(current, {
          type: "RESULT",
          result: {
            ok: false,
            failure: {
              outcome: "unreachable",
              detail: `The studio's key-creation proxy did not answer — ${reason}`,
              pendingRoute: "POST /v1/api-keys",
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

  const secret = visibleSecret(flow);

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

        {flow.phase === "naming" || flow.phase === "submitting" ? (
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label className={styles.fieldLabel} htmlFor="new-key-name">
              Key name
            </label>
            <input
              id="new-key-name"
              className={nameInvalid ? `${styles.input} ${styles.inputInvalid}` : styles.input}
              value={name}
              maxLength={KEY_NAME_MAX_LENGTH}
              placeholder='e.g. "production server"'
              aria-invalid={nameInvalid}
              aria-describedby={nameInvalid ? "new-key-name-error" : undefined}
              disabled={flow.phase === "submitting"}
              onChange={(event) => {
                setName(event.target.value);
                setNameTouched(true);
              }}
            />
            {nameInvalid ? (
              <p id="new-key-name-error" className={styles.fieldError}>
                A key name is required (1–{KEY_NAME_MAX_LENGTH} characters).
              </p>
            ) : null}

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
              The key will be created in the account's current mode:{" "}
              <Badge uppercase>{mode}</Badge>
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
                  This is the only time the full secret is shown. Reckon stores only a hash — once
                  this dialog closes, the secret cannot be recovered or displayed again.
                </p>
              </div>
            </div>
            <div className={styles.secretRow}>
              <input className={styles.secretInput} readOnly value={secret} aria-label="Full API key secret" />
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
                onClick={() => setFlow((current) => nextCreateKeyFlowState(current, { type: "SECRET_STORED" }))}
              >
                I&apos;ve stored it
              </Button>
            </div>
          </div>
        ) : null}

        {flow.phase === "stored" ? (
          <div className={styles.storedBlock}>
            <p className={styles.storedText}>
              Key <code className={styles.storedCode}>{flow.key.prefix}</code> ({flow.key.name}) is
              created and ready. The secret has been discarded from this session — it will not be
              shown again.
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
            <p className={styles.failedTitle}>The key was not created.</p>
            <p className={styles.failedDetail}>{flow.failure.detail}</p>
            {flow.failure.pendingRoute !== null ? (
              <p className={styles.failedPending}>
                Pending API route: <code>{flow.failure.pendingRoute}</code>
              </p>
            ) : null}
            <div className={styles.dialogActions}>
              <Button variant="secondary" size="md" onClick={onClose}>
                Close
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={() => setFlow((current) => nextCreateKeyFlowState(current, { type: "RETRY" }))}
              >
                Retry
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ---- proxy response guards (the studio's own /api/dashboard/keys) ---- */

interface ProxyCreatedKey {
  readonly key: {
    readonly id: string;
    readonly name: string;
    readonly prefix: string;
    readonly mode: "live" | "test";
    readonly kind: "secret" | "publishable";
    readonly created_at: string;
    readonly last_used_at?: string | null;
    readonly secret: string;
  };
}

interface ProxyFailure {
  readonly failure: {
    readonly outcome: "unconfigured" | "unreachable" | "not-wired" | "error";
    readonly detail: string;
    readonly pendingRoute: string | null;
    readonly httpStatus: number | null;
  };
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCreatedKey(value: unknown): value is ProxyCreatedKey {
  return (
    isRecordLike(value) &&
    value["ok"] === true &&
    isRecordLike(value["key"]) &&
    typeof (value["key"] as Record<string, unknown>)["secret"] === "string"
  );
}

function asFailure(value: unknown): ProxyFailure["failure"] {
  if (isRecordLike(value) && isRecordLike(value["failure"])) {
    const failure = value["failure"] as Record<string, unknown>;
    return {
      outcome:
        failure["outcome"] === "unconfigured" ||
        failure["outcome"] === "unreachable" ||
        failure["outcome"] === "not-wired" ||
        failure["outcome"] === "error"
          ? failure["outcome"]
          : "error",
      detail: typeof failure["detail"] === "string" ? failure["detail"] : "The proxy returned an unrecognized failure.",
      pendingRoute: typeof failure["pendingRoute"] === "string" ? failure["pendingRoute"] : null,
      httpStatus: typeof failure["httpStatus"] === "number" ? failure["httpStatus"] : null,
    };
  }
  return {
    outcome: "error",
    detail: "The key-creation proxy returned an unrecognized response — nothing was created.",
    pendingRoute: "POST /v1/api-keys",
    httpStatus: null,
  };
}
