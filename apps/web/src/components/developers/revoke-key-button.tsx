/**
 * RevokeKeyButton — per-row revoke affordance, gated by the account mode
 * (S3-001). In TEST mode the request arms immediately; in LIVE mode the
 * dashboard's confirm dialog intercepts it first (the mode machine's
 * destructive gate) — the operator confirms a live revoke explicitly.
 *
 * The armed action is executed exactly once, against the studio's
 * server-side proxy (DELETE /api/dashboard/keys/{id} → the real
 * DELETE /v1/api-keys/{id} attempt), and the observed outcome — success
 * or the honest failure — is reported back to the manager.
 */
"use client";

import { useEffect, useRef } from "react";
import { useDashboardMode } from "@/components/shell/mode-provider";
import { Button } from "@/components/ui/button";
import { REVOKE_API_KEY_ACTION_ID, revokeActionFor } from "@/lib/api-keys-view";
import type { ApiKeyRecord, SurfaceFailure } from "@/lib/developers-api";

export interface RevokeKeyButtonProps {
  readonly record: ApiKeyRecord;
  /** Reported by the button after the observed outcome lands. */
  readonly onOutcome: (outcome: { keyId: string; ok: boolean; title: string; detail: string }) => void;
  readonly disabled?: boolean;
}

interface ProxyFailureShape {
  readonly failure?: { readonly outcome?: unknown; readonly detail?: unknown };
}

export function RevokeKeyButton({ record, onOutcome, disabled = false }: RevokeKeyButtonProps) {
  const { mode, state, requestDestructive, completeDestructive } = useDashboardMode();
  const action = revokeActionFor(record);
  const executingRef = useRef(false);

  // Watch for THIS action being armed (confirm accepted in live mode, or
  // direct in test mode) and execute it exactly once.
  const armed = state.armedDestructive;
  const isArmed =
    armed !== null && armed.id === REVOKE_API_KEY_ACTION_ID && armed.context === action.context;

  useEffect(() => {
    if (!isArmed || executingRef.current) {
      return;
    }
    executingRef.current = true;
    completeDestructive();

    void (async () => {
      try {
        const response = await fetch(`/api/dashboard/keys/${encodeURIComponent(record.id)}`, {
          method: "DELETE",
        });
        const body: unknown = await response.json();
        if (response.ok && typeof body === "object" && body !== null && (body as { revoked?: unknown }).revoked === true) {
          onOutcome({
            keyId: record.id,
            ok: true,
            title: `Revoked ${record.prefix}`,
            detail: "The key no longer authenticates API requests.",
          });
          return;
        }
        onOutcome({
          keyId: record.id,
          ok: false,
          ...revokeFailureView(body),
        });
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        onOutcome({
          keyId: record.id,
          ok: false,
          title: "Not revoked — the studio's proxy did not answer",
          detail: reason,
        });
      } finally {
        executingRef.current = false;
      }
    })();
  }, [isArmed, completeDestructive, onOutcome, record.id, record.prefix]);

  const busy = isArmed && executingRef.current;

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={disabled || busy}
      title={
        mode === "live"
          ? "Revoking in live mode asks for confirmation first."
          : "Revoke this key (test mode — no confirmation needed)."
      }
      onClick={() => requestDestructive(action)}
    >
      {busy ? "Revoking…" : "Revoke"}
    </Button>
  );
}

function revokeFailureView(body: unknown): { title: string; detail: string } {
  const failure = (body as ProxyFailureShape | null)?.failure as Partial<SurfaceFailure> | undefined;
  const detail =
    typeof failure?.detail === "string" && failure.detail.length > 0
      ? failure.detail
      : "The proxy returned an unrecognized response — the key was not revoked.";
  switch (failure?.outcome) {
    case "unconfigured":
      return { title: "Not revoked — studio not configured", detail };
    case "unreachable":
      return { title: "Not revoked — API unreachable", detail };
    case "not-wired":
      return { title: "Not revoked — key management is not wired yet", detail };
    default:
      return { title: "Not revoked — the API rejected the request", detail };
  }
}
