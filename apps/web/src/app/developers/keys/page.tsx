/**
 * Developers › API keys (TL6-003, rewired to the ACCOUNT API) — the
 * account-owned key manager: list (kind/mode/tier/created/last-used/
 * revoked), mint flow (the once-only secret), revoke (live-mode confirm
 * gated).
 *
 * PROTECTED ROUTE: this surface manages the signed-in account's keys, so
 * the page gates on the studio session cookie — no session → /login
 * (reason=signin, sanitized next back here). An observed 401 from the
 * API (expired/revoked session) exits through the expire handler, which
 * clears the stale cookies and lands /login?reason=expired.
 *
 * Data arrives through the honest seam: the page server-side attempts
 * GET /v1/account/keys with the session bearer and renders exactly what
 * was observed — failures name the route and the observed reason, never
 * a fake success (Gate Q).
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ApiKeysManager } from "@/components/developers/api-keys-manager";
import { WorkspacePage } from "@/components/workspace-page";
import { attemptListKeys, getStudioAccountDisplay, getStudioSessionToken } from "@/lib/account-surface";
import { requireWorkspaceRoute } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const route = requireWorkspaceRoute("/developers/keys");

export const metadata: Metadata = {
  title: route.title,
  description: route.subtitle,
};

interface ApiKeysPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ApiKeysPage({ searchParams }: ApiKeysPageProps) {
  const params = await searchParams;
  const welcome = params.welcome === "1";

  // Protected-route handling: no session → the login flow (next back here).
  if ((await getStudioSessionToken()) === null) {
    redirect("/login?next=%2Fdevelopers%2Fkeys&reason=signin");
  }

  const [account, result] = await Promise.all([getStudioAccountDisplay(), attemptListKeys()]);

  if (!result.ok && result.failure.outcome === "unauthenticated") {
    // The session cookie no longer reflects a live server-side session —
    // exit through the expire handler (clears the stale cookies honestly).
    redirect("/api/dashboard/account/expire?next=%2Fdevelopers%2Fkeys");
  }

  return (
    <WorkspacePage title={route.title} subtitle={route.subtitle}>
      <ApiKeysManager account={account} result={result} welcome={welcome} />
    </WorkspacePage>
  );
}
