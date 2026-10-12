/**
 * ForgetAdButton (AD-005) — the per-record forget affordance, gated by
 * the account mode exactly like the key-revoke pattern (TL6-003): in
 * TEST mode the request arms immediately; in LIVE mode the dashboard's
 * confirm dialog intercepts it first — forgetting is TERMINAL (law 2),
 * so a live forget deserves the same explicit confirmation.
 *
 * The armed action executes exactly once against the studio's proxy
 * (POST /api/dashboard/ads/forget → the REAL POST /v1/ads/forget through
 * the SDK seam) and the observed outcome — success (the forgotten
 * record ids) or the honest failure — reports back to the host surface,
 * which refreshes the server tree so the record disappears from the
 * lane truthfully (it can never return: forgotten is terminal).
 */
"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useDashboardMode } from "@/components/shell/mode-provider";
import { Button } from "@/components/ui/button";
import { FORGET_AD_ACTION_ID, forgetActionFor } from "@/lib/ads-view";
import type { AdForgetTargetLike } from "@/lib/ads-view";
import styles from "./forget-ad-button.module.css";

export interface ForgetAdButtonProps {
  readonly target: AdForgetTargetLike;
  /** Optional reason kept on the forget audit trail (≤256 chars). */
  readonly reason?: string;
  /** Where the outcome surfaces (the parent surface renders it). */
  readonly onOutcome: (outcome: ForgetOutcome) => void;
  readonly disabled?: boolean;
  /** Compact row variant (tables); default standalone. */
  readonly compact?: boolean;
}

export interface ForgetOutcome {
  readonly ok: boolean;
  readonly title: string;
  readonly detail: string;
}

interface ProxyResponseShape {
  readonly ok?: boolean;
  readonly forgotten?: {
    readonly forgottenCount?: number;
    readonly forgottenRecordIds?: unknown;
    readonly detail?: string;
  };
  readonly failure?: { readonly detail?: unknown };
}

export function ForgetAdButton({
  target,
  reason,
  onOutcome,
  disabled = false,
  compact = false,
}: ForgetAdButtonProps) {
  const router = useRouter();
  const { state, requestDestructive, completeDestructive } = useDashboardMode();
  const action = forgetActionFor(target);
  const executingRef = useRef(false);

  // Watch for THIS action being armed (confirm accepted in live mode, or
  // direct in test mode) and execute it exactly once.
  const armed = state.armedDestructive;
  const isArmed =
    armed !== null && armed.id === FORGET_AD_ACTION_ID && armed.context === action.context;

  useEffect(() => {
    if (!isArmed || executingRef.current) {
      return;
    }
    executingRef.current = true;
    completeDestructive();

    void (async () => {
      try {
        const response = await fetch("/api/dashboard/ads/forget", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            reason !== undefined && reason.length > 0 ? { ...target, reason } : target,
          ),
        });
        const body: unknown = await response.json();
        const parsed = body as ProxyResponseShape | null;
        if (response.ok && parsed?.ok === true) {
          const count = parsed.forgotten?.forgottenCount ?? 0;
          const ids = Array.isArray(parsed.forgotten?.forgottenRecordIds)
            ? (parsed.forgotten?.forgottenRecordIds as unknown[]).filter(
                (id): id is string => typeof id === "string",
              )
            : [];
          onOutcome({
            ok: true,
            title: count === 0 ? "Nothing was forgotten" : `Forgot ${count} ${count === 1 ? "record" : "records"}`,
            detail:
              count === 0
                ? "No matching, not-yet-forgotten records were in Personal Ad Memory — forget is idempotent."
                : `Terminal (law 2): ${ids.length > 0 ? `${ids.join(", ")} can never be retrieved again` : "these records can never be retrieved again"}.`,
          });
          // The lane truth changed — re-render the server tree.
          router.refresh();
          return;
        }
        const detail =
          typeof parsed?.failure?.detail === "string" && parsed.failure.detail.length > 0
            ? parsed.failure.detail
            : "The proxy returned an unrecognized response — nothing was forgotten.";
        onOutcome({ ok: false, title: "Not forgotten — the API rejected the request", detail });
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        onOutcome({ ok: false, title: "Not forgotten — the studio's proxy did not answer", detail: reason });
      } finally {
        executingRef.current = false;
      }
    })();
  }, [isArmed, completeDestructive, onOutcome, router, target, reason]);

  const busy = isArmed && executingRef.current;

  return (
    <Button
      variant={compact ? "ghost" : "secondary"}
      size="sm"
      className={compact ? styles.compact : undefined}
      disabled={disabled || busy}
      title="Forget is terminal (law 2): the record can never be retrieved from Personal Ad Memory again."
      onClick={() => requestDestructive(action)}
    >
      {busy ? "Forgetting…" : action.label}
    </Button>
  );
}
