/**
 * SignOutButton — the shell's sign-out affordance (TL6-003). Client
 * component: posts to the studio's logout proxy, which attempts the REAL
 * POST /v1/account/logout and clears the session cookies only when the
 * API actually revoked the session (or said it was already invalid) —
 * an unreachable API keeps the cookies and reports the observed failure
 * here (never a silent fake logout).
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import styles from "./sign-out-button.module.css";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/dashboard/account/logout", { method: "POST" });
      const body: unknown = await response.json().catch(() => null);
      if (response.ok && typeof body === "object" && body !== null && (body as { ok?: unknown }).ok === true) {
        router.push("/login?reason=signed-out");
        router.refresh();
        return;
      }
      const detail =
        typeof body === "object" && body !== null && typeof (body as { failure?: { detail?: unknown } }).failure?.detail === "string"
          ? (body as { failure: { detail: string } }).failure.detail
          : "The logout proxy returned an unrecognized response.";
      setError(`Sign-out did not complete — ${detail} The session cookie was kept so you can retry.`);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      setError(`Sign-out did not complete — ${reason}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className={styles.wrap}>
      <Button variant="ghost" size="sm" onClick={() => void signOut()} disabled={busy} title="Revoke this session on the API and sign out">
        <LogOut aria-hidden="true" size={13} strokeWidth={1.75} />
        {busy ? "Signing out…" : "Sign out"}
      </Button>
      {error !== null ? (
        <span className={styles.error} role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
