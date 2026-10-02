/**
 * RetryButton — the §7 single action: a ghost "Retry" that re-runs the
 * current route's server components (router.refresh()), so server-side
 * probes and data loads genuinely re-attempt. Client component.
 */
"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ComponentPropsWithoutRef } from "react";
import { Button } from "@/components/ui/button";
import styles from "./retry-button.module.css";

export interface RetryButtonProps extends Omit<ComponentPropsWithoutRef<"button">, "type"> {
  label?: string;
}

export function RetryButton({ label = "Retry", className, ...props }: RetryButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  function handleRetry() {
    setBusy(true);
    router.refresh();
    // The refresh round-trip re-renders the page; release the busy state
    // on the next tick so the press is perceivable without blocking.
    window.setTimeout(() => setBusy(false), 400);
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      className={`${styles.retry}${className ? ` ${className}` : ""}`}
      onClick={handleRetry}
      disabled={busy}
      leadingIcon={
        <RotateCcw
          className={busy ? styles.spin : undefined}
          aria-hidden="true"
          strokeWidth={1.75}
          size={14}
        />
      }
      {...props}
    >
      {label}
    </Button>
  );
}
